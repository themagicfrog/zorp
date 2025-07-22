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

async function getOrCreateUser(slackId, displayName) {
  try {
    const existingUsers = await base('Users').select({
      filterByFormula: `{Slack ID} = '${slackId}'`
    }).firstPage();

    if (existingUsers.length > 0) {
      return existingUsers[0];
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

    const userRecords = await base('Users').select({
      filterByFormula: `{Slack ID} = '${slackId}'`
    }).firstPage();

    if (userRecords.length > 0) {
      await base('Users').update([
        {
          id: userRecords[0].id,
          fields: {
            'Coins': totalCoins
          }
        }
      ]);
      console.log(`✅ Updated coins for user ${slackId}: ${totalCoins} coins`);
    }
  } catch (error) {
    console.error('⚠️ Error updating user coins:', error);
  }
}

async function syncUserOnRequest(slackId, displayName) {
  try {
    await getOrCreateUser(slackId, displayName);
  } catch (error) {
    console.error('⚠️ Error syncing user on request:', error);
  }
}

const COIN_ACTIONS = [
  { label: 'Comment something meaningful on another game', value: 'Comment', coins: 1 },
  { label: 'Work in a huddle on your game', value: 'Huddle', coins: 2 },
  { label: 'Help someone fix a problem in their game', value: 'Fix Problem', coins: null },
  { label: 'Post your game idea', value: 'Post', coins: 3 },
  { label: 'Attend an event', value: 'Attend Event', coins: 3 },
  { label: 'Post a progress update', value: 'Update', coins: 2 },
  { label: 'Tell a friend & post it somewhere (Reddit, Discord, etc.)', value: 'Share', coins: 5 },
  { label: 'Host an event', value: 'Host Event', coins: null },
  { label: 'Post a Jumpstart poster somewhere', value: 'Poster', coins: 10 },
  { label: 'Record game explanation and process (face+voice)', value: 'Record', coins: 10 },
  { label: 'Draw/make all assets', value: 'Create Assets', coins: 20 },
  { label: 'Open PR & do a task', value: 'Task (PR)', coins: null },
  { label: 'Meetup w/ a Jumpstarter IRL', value: 'IRL Meetup', coins: 30 }
];

app.command('/collect', async ({ ack, body, client }) => {
  try {
    await ack();
    const triggerId = body.trigger_id;



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
              text: (() => {
                const welcomeMessages = [
                  "beep beep boop! i am Zorp and i am here to help you collect coins!",
                  "hello earthling! do you hear the cows mooing? that means it's coin time!",
                  "greetings human (or whatever they say), are you ready to collect some coins?",
                  "welcome to the coin collection station! zorppy is here",
                ];
                return welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
              })(),
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
              placeholder: {
                type: 'plain_text',
                text: 'select an action'
              },
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
              placeholder: {
                type: 'plain_text',
                text: 'paste the link to your #jumpstart message with proof'
              }
            }
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
    const slackId = body.user.id;
    const now = new Date().toISOString().split('T')[0];

    let displayName = body.user.name;
    try {
      const userInfo = await client.users.info({
        user: slackId
      });
      displayName = userInfo.user.profile.display_name || userInfo.user.profile.real_name || body.user.name;
    } catch (userError) {
      console.log('⚠️ Could not fetch user info, using fallback name:', body.user.name);
    }

    const selectedAction = COIN_ACTIONS.find(a => a.value === action);
    const coinsGiven = selectedAction && selectedAction.coins ? selectedAction.coins : null;

    const fields = {
      'Slack ID': slackId,
      'Display Name': displayName,
      'Action': action,
      'Status': 'Pending',
      'Message Link': threadLink,
      'Request Date': now
    };

    if (coinsGiven !== null) {
      fields['Coins Given'] = coinsGiven;
    }

    const confirmationMessages = [
      `hiya! my spaceship has gotten your request :D the minions will look at it soon`,
      `wahoo! my alien friends got your submission. we'll be scanning it soon :)`,
      `beep beep boop! the cows are mooing (aka we got your request, the minions will look at it soon)`,
      `your request is now at our UFO! you'll get your coins soon (as long as you're not a devious minion)`,
    ];

    const randomMessage = confirmationMessages[Math.floor(Math.random() * confirmationMessages.length)];

    await Promise.all([
      base('Coin Requests').create([{ fields }]),
      client.chat.postMessage({
        channel: slackId,
        text: randomMessage
      }),
      syncUserOnRequest(slackId, displayName)
    ]);

  } catch (error) {
    
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text: `oopsies! zorp couldn't submit your request, pls ask @magic frog for help`
      });
    } catch (dmError) {
    }
  }
});


app.command('/update-coins', async ({ ack, body, client }) => {
  try {
    await ack();
    
    
    if (body.user_id !== 'U06UYA4AH6F') { 
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'sorry, you cant use this command'
      });
      return;
    }

    await client.chat.postMessage({
      channel: body.user_id,
      text: 'syncing users coin amounts... beep beep boop'
    });

    const allRequests = await base('Coin Requests').select().all();
    const uniqueUsers = new Map();

    allRequests.forEach(record => {
      const slackId = record.get('Slack ID');
      const displayName = record.get('Display Name');
      if (slackId && displayName) {
        uniqueUsers.set(slackId, displayName);
      }
    });

    let createdCount = 0;
    let updatedCount = 0;

    for (const [slackId, displayName] of uniqueUsers) {
      try {
        await getOrCreateUser(slackId, displayName);
        await updateUserCoins(slackId);
        createdCount++;
      } catch (error) {
        console.error(`Error processing user ${slackId}:`, error);
      }
    }

    await client.chat.postMessage({
      channel: body.user_id,
      text: `user sync complete! processed ${uniqueUsers.size} users`
    });

  } catch (error) {
    console.error('⚠️ Error in /sync-users command:', error);
    await client.chat.postMessage({
      channel: body.user_id,
      text: 'error during user sync'
    });
  }
});

// Function to get user's current coin balance
async function getUserCoins(slackId) {
  try {
    const userRecords = await base('Users').select({
      filterByFormula: `{Slack ID} = '${slackId}'`
    }).firstPage();

    if (userRecords.length > 0) {
      return userRecords[0].get('Coins') || 0;
    }
    return 0;
  } catch (error) {
    console.error('⚠️ Error getting user coins:', error);
    return 0;
  }
}

// Function to update user's stickersheet count
async function addStickersheet(slackId) {
  try {
    const userRecords = await base('Users').select({
      filterByFormula: `{Slack ID} = '${slackId}'`
    }).firstPage();

    if (userRecords.length > 0) {
      const currentStickersheets = userRecords[0].get('Stickersheets') || 0;
      const newStickersheets = currentStickersheets + 1;

      await base('Users').update([
        {
          id: userRecords[0].id,
          fields: {
            'Stickersheets': newStickersheets
          }
        }
      ]);

      console.log(`✅ Added stickersheet for user ${slackId}: ${newStickersheets} total`);
      return newStickersheets;
    }
  } catch (error) {
    console.error('⚠️ Error adding stickersheet:', error);
    throw error;
  }
}

// Function to deduct coins from user
async function deductCoins(slackId, amount) {
  try {
    const userRecords = await base('Users').select({
      filterByFormula: `{Slack ID} = '${slackId}'`
    }).firstPage();

    if (userRecords.length > 0) {
      const currentCoins = userRecords[0].get('Coins') || 0;
      const newCoins = currentCoins - amount;

      if (newCoins < 0) {
        throw new Error('Insufficient coins');
      }

      await base('Users').update([
        {
          id: userRecords[0].id,
          fields: {
            'Coins': newCoins
          }
        }
      ]);

      console.log(`✅ Deducted ${amount} coins from user ${slackId}: ${newCoins} remaining`);
      return newCoins;
    }
  } catch (error) {
    console.error('⚠️ Error deducting coins:', error);
    throw error;
  }
}

app.command('/shop', async ({ ack, body, client }) => {
  try {
    await ack();
    const triggerId = body.trigger_id;
    const slackId = body.user.id;

    // Get user's current coin balance
    const currentCoins = await getUserCoins(slackId);

    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'shop_modal',
        private_metadata: JSON.stringify({ slackId, currentCoins }),
        title: { type: 'plain_text', text: 'Zorp Shop' },
        submit: { type: 'plain_text', text: 'Buy Stickersheet' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Welcome to the Zorp Shop!* 🛍️\n\nYou currently have *${currentCoins} coins* in your balance.`
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Available Items:*\n\n🎨 Stickersheet - 10 coins\n*Get a cool stickersheet for your collection!*'
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
                  ? '✅ You have enough coins to buy a stickersheet!'
                  : '❌ You need 10 coins to buy a stickersheet. Keep collecting!'
              }
            ]
          }
        ]
      }
    });
  } catch (error) {
    console.error('⚠️ Error in /shop command:', JSON.stringify(error, null, 2));
  }
});

app.view('shop_modal', async ({ ack, view, body, client }) => {
  try {
    await ack();

    const metadata = JSON.parse(view.private_metadata);
    const { slackId, currentCoins } = metadata;

    // Check if user has enough coins
    if (currentCoins < 10) {
      await client.chat.postMessage({
        channel: slackId,
        text: '❌ Sorry! You need 10 coins to buy a stickersheet. Keep collecting coins with `/collect`!'
      });
      return;
    }

    // Process the purchase
    await Promise.all([
      deductCoins(slackId, 10),
      addStickersheet(slackId)
    ]);

    // Get updated balance
    const newBalance = await getUserCoins(slackId);
    const newStickersheets = await getUserStickersheets(slackId);

    const purchaseMessages = [
      `🎉 Purchase successful! You now have ${newBalance} coins and ${newStickersheets} stickersheets!`,
      `✨ Yay! Stickersheet acquired! Your balance: ${newBalance} coins, Stickersheets: ${newStickersheets}`,
      `🚀 Woo! You got a stickersheet! Coins remaining: ${newBalance}, Total stickersheets: ${newStickersheets}`,
      `🌟 Amazing! Stickersheet purchased! You have ${newBalance} coins left and ${newStickersheets} stickersheets now!`
    ];

    const randomMessage = purchaseMessages[Math.floor(Math.random() * purchaseMessages.length)];

    await client.chat.postMessage({
      channel: slackId,
      text: randomMessage
    });

  } catch (error) {
    console.error('⚠️ Error in shop_modal view:', JSON.stringify(error, null, 2));
    
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text: '❌ Sorry! There was an error processing your purchase. Please try again or contact support.'
      });
    } catch (dmError) {
      console.error('⚠️ Could not send error DM:', dmError);
    }
  }
});

// Helper function to get user's stickersheet count
async function getUserStickersheets(slackId) {
  try {
    const userRecords = await base('Users').select({
      filterByFormula: `{Slack ID} = '${slackId}'`
    }).firstPage();

    if (userRecords.length > 0) {
      return userRecords[0].get('Stickersheets') || 0;
    }
    return 0;
  } catch (error) {
    console.error('⚠️ Error getting user stickersheets:', error);
    return 0;
  }
}

const port = process.env.PORT || 3000;
receiver.app.listen(port, () => {
  console.log(`🚀 Slack Bolt app running on port ${port}`);
});
