const { App, ExpressReceiver } = require('@slack/bolt');
const Airtable = require('airtable');
require('dotenv').config();

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events'
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
});

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// Constants
const STICKERSHEET_CONFIG = {
  stickersheet1: { name: 'PLANET STICKERSHEET', cost: 10, description: 'starter stickersheet' },
  stickersheet2: { name: 'GALAXY STICKERSHEET', cost: 20, description: 'premium stickersheet', requires: 'PLANET STICKERSHEET' },
  stickersheet3: { name: 'UNIVERSE STICKERSHEET', cost: 30, description: 'ultimate stickersheet', requires: 'GALAXY STICKERSHEET' }
};

const COIN_ACTIONS = [
  { label: 'Comment something meaningful on another game', value: 'Comment', coins: 1 },
  { label: 'Work in a huddle on your game', value: 'Huddle', coins: 2 },
  { label: 'Help someone fix a problem in their game (write note for coin #)', value: 'Fix Problem', coins: null },
  { label: 'Post your game idea', value: 'Post', coins: 3 },
  { label: 'Attend an event', value: 'Attend Event', coins: 3 },
  { label: 'Post a progress update', value: 'Update', coins: 2 },
  { label: 'Tell a friend & post it somewhere (Reddit, Discord, etc.)', value: 'Share', coins: 5 },
  { label: 'Host an event (write note for coin #)', value: 'Host Event', coins: null },
  { label: 'Post a Jumpstart poster somewhere', value: 'Poster', coins: 10 },
  { label: 'Record game explanation and process (face+voice)', value: 'Record', coins: 10 },
  { label: 'Draw/make all assets', value: 'Create Assets', coins: 20 },
  { label: 'Open PR & do a task (write note for coin #)', value: 'Task (PR)', coins: null },
  { label: 'Meetup w/ a Jumpstarter IRL', value: 'IRL Meetup', coins: 30 }
];

// Helper function to get user record
async function getUserRecord(slackId) {
  const userRecords = await base('Users').select({
    filterByFormula: `{Slack ID} = '${slackId}'`
  }).firstPage();
  return userRecords.length > 0 ? userRecords[0] : null;
}

// Helper function to get stickersheet config
function getStickersheetConfig(stickersheetType) {
  return STICKERSHEET_CONFIG[stickersheetType] || null;
}

async function getOrCreateUser(slackId, displayName) {
  try {
    const existingUser = await getUserRecord(slackId);
    if (existingUser) {
      return existingUser;
    }

    const newUser = await base('Users').create([
      {
        fields: {
          'Slack ID': slackId,
          'Display Name': displayName,
          'Coins': 0
        }
      }
    ]);

    console.log(`✅ Created new user: ${displayName} (${slackId})`);
    return newUser[0];
  } catch (error) {
    console.error('⚠️ Error in getOrCreateUser:', error);
    throw error;
  }
}

async function updateUserCoins(slackId) {
  try {
    const approvedRequests = await base('Coin Requests').select({
      filterByFormula: `AND({Slack ID} = '${slackId}', {Status} = 'Approved')`
    }).all();

    let totalCoins = 0;
    approvedRequests.forEach(record => {
      const coins = record.get('Coins Given');
      if (coins && typeof coins === 'number') {
        totalCoins += coins;
      }
    });

    const userRecord = await getUserRecord(slackId);
    if (userRecord) {
      await base('Users').update([
        {
          id: userRecord.id,
          fields: { 'Coins': totalCoins }
        }
      ]);
      console.log(`✅ Updated coins for user ${slackId}: ${totalCoins} coins`);
    }
  } catch (error) {
    console.error('⚠️ Error updating user coins:', error);
  }
}

async function getUserCoins(slackId) {
  try {
    const userRecord = await getUserRecord(slackId);
    return userRecord ? (userRecord.get('Coins') || 0) : 0;
  } catch (error) {
    console.error('⚠️ Error getting user coins:', error);
    return 0;
  }
}

async function addStickersheet(slackId, stickersheetType) {
  try {
    const userRecord = await getUserRecord(slackId);
    if (!userRecord) return 0;

    const config = getStickersheetConfig(stickersheetType);
    if (!config) throw new Error(`Invalid stickersheet type: ${stickersheetType}`);

    const currentStickersheets = userRecord.get('Stickersheets') || [];
    const newStickersheets = [...currentStickersheets, config.name];

    await base('Users').update([
      {
        id: userRecord.id,
        fields: { 'Stickersheets': newStickersheets }
      }
    ]);

    console.log(`✅ Added ${config.name} for user ${slackId}: ${newStickersheets.length} total`);
    return newStickersheets.length;
  } catch (error) {
    console.error('⚠️ Error adding stickersheet:', error);
    throw error;
  }
}

async function deductCoins(slackId, amount) {
  try {
    const userRecord = await getUserRecord(slackId);
    if (!userRecord) throw new Error('User not found');

    const currentCoins = userRecord.get('Coins') || 0;
    const newCoins = currentCoins - amount;

    if (newCoins < 0) {
      throw new Error('Insufficient coins');
    }

    await base('Users').update([
      {
        id: userRecord.id,
        fields: { 'Coins': newCoins }
      }
    ]);

    console.log(`✅ Deducted ${amount} coins from user ${slackId}: ${newCoins} remaining`);
    return newCoins;
  } catch (error) {
    console.error('⚠️ Error deducting coins:', error);
    throw error;
  }
}

async function getUserStickersheetsList(slackId) {
  try {
    const userRecord = await getUserRecord(slackId);
    return userRecord ? (userRecord.get('Stickersheets') || []) : [];
  } catch (error) {
    console.error('⚠️ Error getting user stickersheets list:', error);
    return [];
  }
}

async function getUserStickersheets(slackId) {
  try {
    const stickersheets = await getUserStickersheetsList(slackId);
    return stickersheets.length;
  } catch (error) {
    console.error('⚠️ Error getting user stickersheets:', error);
    return 0;
  }
}

// Helper function to get random message from array
function getRandomMessage(messages) {
  return messages[Math.floor(Math.random() * messages.length)];
}

app.command('/collect', async ({ ack, body, client }) => {
  try {
    await ack();
    const triggerId = body.trigger_id;

    const welcomeMessages = [
      "beep beep boop! i am Zorp and i am here to help you collect coins!",
      "hello earthling! do you hear the cows mooing? that means it's coin time!",
      "greetings human (or whatever they say), are you ready to collect some coins?",
      "welcome to the coin collection station! zorppy is here",
    ];

    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'collect_modal',
        title: { type: 'plain_text', text: 'COLLECT COINS' },
        submit: { type: 'plain_text', text: 'submit' },
        close: { type: 'plain_text', text: 'cancel' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'plain_text',
              text: getRandomMessage(welcomeMessages),
              emoji: true
            }
          },
          {
            type: 'input',
            block_id: 'action_block',
            label: { type: 'plain_text', text: 'what did you do?' },
            element: {
              type: 'static_select',
              action_id: 'action_selected',
              placeholder: { type: 'plain_text', text: 'select an action' },
              options: COIN_ACTIONS.map(a => ({
                text: { type: 'plain_text', text: `${a.label}${a.coins ? ` (${a.coins} coins)` : ''}` },
                value: a.value
              }))
            }
          },
          {
            type: 'input',
            block_id: 'thread_link_block',
            label: { type: 'plain_text', text: 'message proof link' },
            element: {
              type: 'plain_text_input',
              action_id: 'thread_link_input',
              placeholder: { type: 'plain_text', text: 'paste the link to your #jumpstart message with proof' }
            }
          },
          {
            type: 'input',
            block_id: 'request_note_block',
            label: { type: 'plain_text', text: 'anything to add?' },
            element: {
              type: 'plain_text_input',
              action_id: 'request_note_input',
              placeholder: { type: 'plain_text', text: 'optional: add any additional context or notes...' }
            },
            optional: true
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error in /collect command:', JSON.stringify(error, null, 2));
  }
});

app.view('collect_modal', async ({ ack, view, body, client }) => {
  try {
    await ack();

    const action = view.state.values['action_block']['action_selected'].selected_option.value;
    const threadLink = view.state.values['thread_link_block']['thread_link_input'].value || '';
    const requestNote = view.state.values['request_note_block']['request_note_input'].value || '';
    const slackId = body.user.id;
    const now = new Date().toISOString().split('T')[0];

    let displayName = body.user.name;
    try {
      const userInfo = await client.users.info({ user: slackId });
      displayName = userInfo.user.profile.display_name || userInfo.user.profile.real_name || body.user.name;
    } catch (userError) {
      console.log('⚠️ Could not fetch user info, using fallback name:', body.user.name);
    }

    const selectedAction = COIN_ACTIONS.find(a => a.value === action);
    const coinsGiven = selectedAction?.coins || null;

    const fields = {
      'Slack ID': slackId,
      'Display Name': displayName,
      'Action': action,
      'Status': 'Pending',
      'Message Link': threadLink,
      'Request Date': now
    };

    if (requestNote) fields['Request Note'] = requestNote;
    if (coinsGiven !== null) fields['Coins Given'] = coinsGiven;

    const confirmationMessages = [
      `hiya! my spaceship has gotten your request :D the minions will look at it soon`,
      `wahoo! my alien friends got your submission. we'll be scanning it soon :)`,
      `beep beep boop! the cows are mooing (aka we got your request, the minions will look at it soon)`,
      `your request is now at our UFO! you'll get your coins soon (as long as you're not a devious minion)`,
    ];

    await Promise.all([
      base('Coin Requests').create([{ fields }]),
      client.chat.postMessage({
        channel: slackId,
        text: getRandomMessage(confirmationMessages)
      }),
      getOrCreateUser(slackId, displayName)
    ]);

  } catch (error) {
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text: `oopsies! zorp couldn't submit your request, pls ask @magic frog for help`
      });
    } catch (dmError) {
      console.error('⚠️ Could not send error DM:', dmError);
    }
  }
});

app.command('/shop', async ({ ack, body, client }) => {
  try {
    await ack();
    
    const slackId = body.user_id;
    const triggerId = body.trigger_id;
    console.log('🛍️ /shop command triggered by user:', slackId);

    const currentCoins = await getUserCoins(slackId);
    const currentStickersheets = await getUserStickersheetsList(slackId);
    console.log('💰 User coin balance:', currentCoins);
    console.log('🎨 User stickersheets:', currentStickersheets);

    const hasPlanet = currentStickersheets.includes('PLANET STICKERSHEET');
    const hasGalaxy = currentStickersheets.includes('GALAXY STICKERSHEET');
    
    const canBuyPlanet = currentCoins >= 10;
    const canBuyGalaxy = hasPlanet && currentCoins >= 20;
    const canBuyUniverse = hasGalaxy && currentCoins >= 30;

    const stickersheetOptions = Object.entries(STICKERSHEET_CONFIG).map(([key, config]) => {
      let canBuy = false;
      let text = `${config.name} - ${config.cost} coins`;
      let description = config.description;

      switch (key) {
        case 'stickersheet1':
          canBuy = canBuyPlanet;
          if (!canBuy) description = 'need 10 coins';
          break;
        case 'stickersheet2':
          canBuy = canBuyGalaxy;
          if (!canBuy) {
            text += ' (need PLANET)';
            description = 'need PLANET stickersheet + 20 coins';
          }
          break;
        case 'stickersheet3':
          canBuy = canBuyUniverse;
          if (!canBuy) {
            text += ' (need GALAXY)';
            description = 'need GALAXY stickersheet + 30 coins';
          }
          break;
      }

      return {
        text: { type: 'plain_text', text },
        value: key,
        description: { type: 'plain_text', text: description }
      };
    });

    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'shop_modal',
        private_metadata: JSON.stringify({ slackId }),
        title: { type: 'plain_text', text: 'ZORP SHOP' },
        submit: { type: 'plain_text', text: 'buy stickers' },
        close: { type: 'plain_text', text: 'cancel' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*welcome to the Zorp UFO shop!* \n\nyou currently have *${currentCoins} coins* in your space wallet. beep beep boop\n\nwhat would you like to buy?`
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*PLANET STICKERSHEET - 10 coins*\nstarter stickersheet'
            },
            accessory: {
              type: 'image',
              image_url: 'https://hc-cdn.hel1.your-objectstorage.com/s/v3/85a6f8e64fdf613039bbaf6b54dfbcaf2e41fabd_screenshot_2025-07-22_at_8.16.00___pm.png',
              alt_text: 'Stickersheet 1'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*GALAXY STICKERSHEET - 20 coins*\npremium stickersheet'
            },
            accessory: {
              type: 'image',
              image_url: 'https://hc-cdn.hel1.your-objectstorage.com/s/v3/ab4f895a99881636649ac7b3e6d8e6ef26b1f86b_screenshot_2025-07-22_at_8.17.09___pm.png',
              alt_text: 'Stickersheet 2'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*UNIVERSE STICKERSHEET - 30 coins*\nultimate stickersheet'
            },
            accessory: {
              type: 'image',
              image_url: 'https://hc-cdn.hel1.your-objectstorage.com/s/v3/3a63a621aaf53cae43848c745597d94f5305c848_screenshot_2025-07-22_at_8.18.27___pm.png',
              alt_text: 'Stickersheet 3'
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'input',
            block_id: 'stickersheet_selection',
            label: { type: 'plain_text', text: 'choose a stickersheet to buy:' },
            element: {
              type: 'static_select',
              action_id: 'stickersheet_selected',
              placeholder: { type: 'plain_text', text: 'select a stickersheet...' },
              options: stickersheetOptions
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: currentCoins >= 10 
                  ? 'you have enough coins to buy at least one stickersheet!'
                  : 'you need more coins to buy a stickersheet. keep collecting!'
              }
            ]
          }
        ]
      }
    });

  } catch (error) {
    console.error('⚠️ Error in /shop command:', error);
    
    try {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'oopies! zorp couldn\'t open the shop, pls ask @magic frog for help'
      });
    } catch (dmError) {
      console.error('⚠️ Could not send error DM:', dmError);
    }
  }
});

app.view('shop_modal', async ({ ack, view, body, client }) => {
  try {
    await ack();

    const metadata = JSON.parse(view.private_metadata);
    const { slackId } = metadata;
    
    const selectedStickersheet = view.state.values['stickersheet_selection']['stickersheet_selected'].selected_option.value;
    const config = getStickersheetConfig(selectedStickersheet);
    
    if (!config) {
      await client.chat.postMessage({
        channel: slackId,
        text: 'sorry! invalid stickersheet selection'
      });
      return;
    }
    
    const currentCoins = await getUserCoins(slackId);
    const currentStickersheets = await getUserStickersheetsList(slackId);
    
    // Check progression requirements
    if (config.requires && !currentStickersheets.includes(config.requires)) {
      await client.chat.postMessage({
        channel: slackId,
        text: `sorry! you need to buy ${config.requires} first before you can buy ${config.name}!`
      });
      return;
    }
    
    // Check if already owned
    if (currentStickersheets.includes(config.name)) {
      await client.chat.postMessage({
        channel: slackId,
        text: `you already have that stickersheet, get a different one!`
      });
      return;
    }
    
    // Check if enough coins
    if (currentCoins < config.cost) {
      await client.chat.postMessage({
        channel: slackId,
        text: `sorry! you only have ${currentCoins} coins but need ${config.cost} coins for ${config.name}. keep collecting with \`/collect\`!`
      });
      return;
    }

    await Promise.all([
      deductCoins(slackId, config.cost),
      addStickersheet(slackId, selectedStickersheet)
    ]);

    const newBalance = await getUserCoins(slackId);
    const newStickersheets = await getUserStickersheets(slackId);

    const purchaseMessages = [
      `${config.name} acquired! you now have ${newBalance} coins and ${newStickersheets} stickersheets!`,
      `yay! ${config.name} purchased! your balance: ${newBalance} coins, stickersheets: ${newStickersheets}`,
      `woo! you got ${config.name}! coins remaining: ${newBalance}, total stickersheets: ${newStickersheets}`,
      `amazing! ${config.name} purchased! you have ${newBalance} coins left and ${newStickersheets} stickersheets now!`
    ];

    await client.chat.postMessage({
      channel: slackId,
      text: getRandomMessage(purchaseMessages)
    });

    console.log(`✅ Purchase completed successfully: ${selectedStickersheet} for ${config.cost} coins`);

  } catch (error) {
    console.error('⚠️ Error in shop_modal view:', error);
    
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text: 'sorry! zappy couldn\'t process your purchase, pls ask @magic frog for help'
      });
    } catch (dmError) {
      console.error('⚠️ Could not send error DM:', dmError);
    }
  }
});

app.command('/leaderboard', async ({ ack, body, client }) => {
  try {
    await ack();
    
    const slackId = body.user_id;
    console.log('🏆 /leaderboard command triggered by user:', slackId);

    const allUsers = await base('Users').select({
      sort: [{ field: 'Coins', direction: 'desc' }]
    }).all();

    const currentUserIndex = allUsers.findIndex(user => user.get('Slack ID') === slackId);
    const currentUserPosition = currentUserIndex + 1;
    const currentUserCoins = currentUserIndex >= 0 ? allUsers[currentUserIndex].get('Coins') || 0 : 0;

    const top5Users = allUsers.slice(0, 5);

    let leaderboardText = '*COIN LEADERBOARD*\n\n';
    
    top5Users.forEach((user, index) => {
      const position = index + 1;
      const displayName = user.get('Display Name') || 'Unknown';
      const coins = user.get('Coins') || 0;
      
      leaderboardText += `*${position}.* ${displayName} - *${coins} coins*\n`;
    });

    if (currentUserPosition > 5) {
      leaderboardText += `\n*your position:* #${currentUserPosition} with *${currentUserCoins} coins*`;
    } else if (currentUserPosition > 0) {
      leaderboardText += `\n*your position:* #${currentUserPosition} with *${currentUserCoins} coins*`;
    } else {
      leaderboardText += `\n*your position:* not ranked yet - start collecting coins with \`/collect\`!`;
    }

    await client.chat.postMessage({
      channel: slackId,
      text: leaderboardText
    });

    console.log('✅ Leaderboard sent successfully');

  } catch (error) {
    console.error('⚠️ Error in /leaderboard command:', error);
    
    try {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'sorry! zorp couldn\'t load the leaderboard, pls ask @magic frog for help'
      });
    } catch (dmError) {
      console.error('⚠️ Could not send error DM:', dmError);
    }
  }
});

const port = process.env.PORT || 3000;
receiver.app.listen(port, () => {
  console.log(`🚀 Slack Bolt app running on port ${port}`);
});
