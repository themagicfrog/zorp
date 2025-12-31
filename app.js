// import the slack bolt framework and airtable
const { App, ExpressReceiver } = require('@slack/bolt');
const Airtable = require('airtable');
require('dotenv').config();

// set up the express receiver to handle slack events
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: {
    events: '/slack/events'
  }
});

// create the slack app instance
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
});

// connect to airtable database
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// define all the stickersheet types and their requirements
const STICKERSHEET_CONFIG = {
  stickersheet1: { name: 'PLANET STICKERSHEET', cost: 7, description: 'starter stickersheet' },
  stickersheet2: { name: 'GALAXY STICKERSHEET', cost: 10, description: 'premium stickersheet', requires: 'PLANET STICKERSHEET' },
  stickersheet3: { name: 'UNIVERSE STICKERSHEET', cost: 13, description: 'ultimate stickersheet', requires: 'GALAXY STICKERSHEET' }
};

// define all the activities users can do to earn coins
const COIN_ACTIONS = [
  { label: 'Comment something meaningful on another game', value: 'Comment', coins: 1, max: 10 },
  { label: 'Post a progress update', value: 'Update', coins: 1, max: 10 },
  { label: 'Work in a huddle on your game', value: 'Huddle', coins: 2, max: 10 },
  { label: 'Post your game idea', value: 'Post', coins: 3, max: 1 },
  { label: 'Attend an event', value: 'Attend Event', coins: 3, max: 10 },
  { label: 'Tell a friend & post it somewhere (Reddit, Discord, etc.)', value: 'Share', coins: 3, max: 3 },
  { label: 'Post a Jumpstart poster somewhere', value: 'Poster', coins: 2, max: 3 },
  { label: 'Host an event (write note for coin #)', value: 'Host Event', coins: null, max: 10 },
  { label: 'Record game explanation and process (face+voice)', value: 'Record', coins: 10, max: 1 },
  { label: 'Draw/make all assets', value: 'Create Assets', coins: 15, max: 1 },
  { label: 'Help someone fix a problem in their game (write note for coin #)', value: 'Fix Problem', coins: null, max: 10 },
  { label: 'Open PR & do a task (write note for coin #)', value: 'Task (PR)', coins: null, max: 10 },
  { label: 'Meetup w/ a Jumpstarter IRL', value: 'IRL Meetup', coins: 25, max: 1 }
];

// helper function to get a user's record from airtable
async function getUserRecord(slackId) {
  const userRecords = await base('Users').select({
    filterByFormula: `{Slack ID} = '${slackId}'`
  }).firstPage();
  return userRecords.length > 0 ? userRecords[0] : null;
}

// helper function to get stickersheet info by type
function getStickersheetConfig(stickersheetType) {
  return STICKERSHEET_CONFIG[stickersheetType] || null;
}

// create a new user in airtable if they don't exist
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
          'Coins': 1
        }
      }
    ]);

    return newUser[0];
  } catch (error) {
    throw error;
  }
}

// update a user's coin total based on their approved requests
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
    }
  } catch (error) {
    // silently fail
  }
}

// update all users' coin totals
async function updateAllUserCoins() {
  try {
    const allUsers = await base('Users').select().all();
    for (const userRecord of allUsers) {
      const slackId = userRecord.get('Slack ID');
      if (slackId) {
        await updateUserCoins(slackId);
      }
    }
  } catch (error) {
    console.error('Error updating all user coins:', error);
  }
}

// process approved coin requests and update user balances
async function processApprovedCoinRequests() {
  try {
    const approvedRequests = await base('Coin Requests').select({
      filterByFormula: `AND({Status} = 'Approved', {Processed?} != 1)`
    }).all();

    let processedCount = 0;
    let totalCoinsAdded = 0;

    for (const request of approvedRequests) {
      const slackId = request.get('Slack ID');
      const coinsGiven = request.get('Coins Given');
      const displayName = request.get('Display Name');

      if (!slackId || !coinsGiven || typeof coinsGiven !== 'number') {
        continue;
      }

      try {
        const userRecord = await getOrCreateUser(slackId, displayName);
        const currentCoins = userRecord.get('Coins') || 0;
        const newCoins = currentCoins + coinsGiven;

        await base('Users').update([
          {
            id: userRecord.id,
            fields: { 'Coins': newCoins }
          }
        ]);

        await base('Coin Requests').update([
          {
            id: request.id,
            fields: { 'Processed?': true }
          }
        ]);

        processedCount++;
        totalCoinsAdded += coinsGiven;
      } catch (error) {
        console.error(`Error processing request ${request.id}:`, error);
      }
    }

    return { processedCount, totalCoinsAdded };
  } catch (error) {
    console.error('Error processing approved coin requests:', error);
    throw error;
  }
}

// process declined coin requests and mark them as processed
async function processDeclinedCoinRequests() {
  try {
    const declinedRequests = await base('Coin Requests').select({
      filterByFormula: `AND({Status} = 'Declined', {Processed?} != 1)`
    }).all();

    let processedCount = 0;

    for (const request of declinedRequests) {
      try {
        await base('Coin Requests').update([
          {
            id: request.id,
            fields: { 'Processed?': true }
          }
        ]);
        processedCount++;
      } catch (error) {
        console.error(`Error processing declined request ${request.id}:`, error);
      }
    }

    return { processedCount };
  } catch (error) {
    console.error('Error processing declined coin requests:', error);
    throw error;
  }
}

// get how many coins a user currently has
async function getUserCoins(slackId) {
  try {
    const userRecord = await getUserRecord(slackId);
    return userRecord ? (userRecord.get('Coins') || 0) : 0;
  } catch (error) {
    return 0;
  }
}

// add a stickersheet to a user's collection
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

    return newStickersheets.length;
  } catch (error) {
    throw error;
  }
}

// take coins away from a user when they buy something
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

    return newCoins;
  } catch (error) {
    throw error;
  }
}

// get the list of stickersheets a user owns
async function getUserStickersheetsList(slackId) {
  try {
    const userRecord = await getUserRecord(slackId);
    return userRecord ? (userRecord.get('Stickersheets') || []) : [];
  } catch (error) {
    return [];
  }
}

// get how many stickersheets a user owns
async function getUserStickersheets(slackId) {
  try {
    const stickersheets = await getUserStickersheetsList(slackId);
    return stickersheets.length;
  } catch (error) {
    return 0;
  }
}

// get how many times a user has done a specific action
async function getUserActionCount(slackId, action) {
  try {
    const approvedRequests = await base('Coin Requests').select({
      filterByFormula: `AND({Slack ID} = '${slackId}', {Action} = '${action}', {Status} = 'Approved')`
    }).all();
    return approvedRequests.length;
  } catch (error) {
    return 0;
  }
}

// check if user can still do a specific action
async function canUserDoAction(slackId, action) {
  try {
    const actionConfig = COIN_ACTIONS.find(a => a.value === action);
    if (!actionConfig || !actionConfig.max) return true;
    
    const currentCount = await getUserActionCount(slackId, action);
    return currentCount < actionConfig.max;
  } catch (error) {
    return true;
  }
}

// get remaining times user can do each action
async function getUserActionRemaining(slackId) {
  try {
    const approvedRequests = await base('Coin Requests').select({
      filterByFormula: `AND({Slack ID} = '${slackId}', {Status} = 'Approved')`
    }).all();

    const actionCounts = {};
    approvedRequests.forEach(record => {
      const action = record.get('Action');
      if (action) {
        actionCounts[action] = (actionCounts[action] || 0) + 1;
      }
    });

    const remaining = {};
    for (const action of COIN_ACTIONS) {
      if (action.max) {
        const currentCount = actionCounts[action.value] || 0;
        remaining[action.value] = Math.max(0, action.max - currentCount);
      }
    }
    return remaining;
  } catch (error) {
    return {};
  }
}

// helper function to pick a random message from a list
function getRandomMessage(messages) {
  return messages[Math.floor(Math.random() * messages.length)];
}

// helper function to add timeout to promises
function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    )
  ]);
}

// function to post leaderboard to #jumpstart channel
async function postDailyLeaderboard() {
  try {
    const allUsers = await base('Users').select({
      sort: [{ field: 'Coins', direction: 'desc' }]
    }).all();

    const top10Users = allUsers.slice(0, 10);
    let leaderboardText = '*DAILY COIN LEADERBOARD*\n\n';
    
    top10Users.forEach((user, index) => {
      const position = index + 1;
      const displayName = user.get('Display Name') || 'Unknown';
      const coins = user.get('Coins') || 0;
      
      let emoji = '';
      if (position === 1) emoji = '🥇';
      else if (position === 2) emoji = '🥈';
      else if (position === 3) emoji = '🥉';
      else emoji = `${position}.`;
      
      leaderboardText += `${emoji} *${displayName}* - *${coins} coins*\n`;
    });

    leaderboardText += `\n*${allUsers.length} total jumpstarters competing!* `;

    const leaderboardMessages = [
      "beep beep boop! here's today's coin leaderboard!",
      "the cows are mooing! time for the daily leaderboard!",
      "greetings earthlings! check out today's coin rankings!",
      "wahoo! it's leaderboard time! see who's collecting the most coins!",
    ];

    await app.client.chat.postMessage({
      channel: '#jumpstart',
      text: getRandomMessage(leaderboardMessages),
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: getRandomMessage(leaderboardMessages)
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: leaderboardText
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: 'top 3 get a special prize at the end!\nwant to see your position? use `/leaderboard` to check your ranking!'
            }
          ]
        }
      ]
    });
  } catch (error) {
    console.error('Error posting daily leaderboard:', error);
  }
}

// schedule daily leaderboard posting - DISABLED
function scheduleDailyLeaderboard() {
  return;
}

// function to post daily random coin drop
async function postDailyRandomCoin() {
  try {
    const coinMessages = [
      "beep boop! you've seem to found a stray coin--collect it quick before someone else does!",
      "boooop beep!! what's this? a random coin, strange. finder's keeper's, take it before someone else does!"
    ];

    const randomMessage = getRandomMessage(coinMessages);

    await app.client.chat.postMessage({
      channel: '#jumpstart',
      text: randomMessage,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: randomMessage
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'CLAIM',
                emoji: true
              },
              style: 'primary',
              action_id: 'claim_random_coin',
              value: 'claim'
            }
          ]
        }
      ]
    });
  } catch (error) {
    console.error('Error posting daily random coin drop:', error);
  }
}

// schedule daily random coin drop - DISABLED
function scheduleDailyRandomCoin() {
  return;
}

// handle the /zcollect command
app.command('/zcollect', async ({ ack, body, client }) => {
  try {
    await ack();
    const triggerId = body.trigger_id;
    const slackId = body.user_id;

    const welcomeMessages = [
      "beep beep boop! i am Zorp and i am here to help you collect coins!",
      "hello earthling! do you hear the cows mooing? that means it's coin time!",
      "greetings human (or whatever they say), are you ready to collect some coins?",
      "welcome to the coin collection station! zorppy is here",
    ];

    let actionRemaining = {};
    try {
      actionRemaining = await withTimeout(getUserActionRemaining(slackId), 5000);
      if (Object.keys(actionRemaining).length === 0) {
        COIN_ACTIONS.forEach(a => {
          if (a.max) actionRemaining[a.value] = a.max;
        });
      }
    } catch (timeoutError) {
      actionRemaining = {};
      COIN_ACTIONS.forEach(a => {
        if (a.max) actionRemaining[a.value] = a.max;
      });
    }

    const options = COIN_ACTIONS.map(a => {
      if (!a.max) {
        let text = a.label;
        if (a.coins) {
          text += ` (${a.coins}c)`;
        }
        if (text.length > 75) {
          text = text.substring(0, 72) + '...';
        }
        return {
          text: { type: 'plain_text', text },
          value: a.value,
          canDo: true
        };
      }
      
      const remaining = actionRemaining[a.value] || 0;
      const canDo = remaining > 0;
      
      let text = a.label;
      if (a.coins) {
        text += ` (${a.coins}c)`;
      }
      if (canDo) {
        text += ` - ${a.max} max`;
      } else {
        text += ` - MAXED`;
      }
      
      if (text.length > 75) {
        text = text.substring(0, 72) + '...';
      }
      
      return {
        text: { type: 'plain_text', text },
        value: a.value,
        canDo: canDo
      };
    }).filter(option => option.canDo).map(({ text, value }) => ({ text, value }));

    if (options.length === 0) {
      await client.chat.postMessage({
        channel: slackId,
        text: 'wow! you\'ve completed all the available actions! 🎉 you\'re a coin collection master!'
      });
      return;
    }

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
              options: options
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
    console.error('Error in /zcollect command:', error);
    try {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'oopsies! zorp couldn\'t open the collection form, pls try again or ask @magic frog for help'
      });
    } catch (dmError) {
      // silently fail
    }
  }
});

// handle when user submits the collect form
app.view('collect_modal', async ({ ack, view, body, client }) => {
  try {
    await ack();

    const action = view.state.values['action_block']['action_selected'].selected_option.value;
    const threadLink = view.state.values['thread_link_block']['thread_link_input'].value || '';
    const requestNote = view.state.values['request_note_block']['request_note_input'].value || '';
    const slackId = body.user.id;
    const now = new Date().toISOString().split('T')[0];

    const canDoAction = await canUserDoAction(slackId, action);
    if (!canDoAction) {
      const actionConfig = COIN_ACTIONS.find(a => a.value === action);
      const currentCount = await getUserActionCount(slackId, action);
      
      await client.chat.postMessage({
        channel: slackId,
        text: `sorry! you've already done "${actionConfig.label}" ${currentCount} times (max ${actionConfig.max}). you can't do this action anymore!`
      });
      return;
    }

    let displayName = body.user.name;
    try {
      const userInfo = await client.users.info({ user: slackId });
      displayName = userInfo.user.profile.display_name || userInfo.user.profile.real_name || body.user.name;
    } catch (userError) {
      // use fallback name
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
      // silently fail
    }
  }
});

// handle the /zshop command
app.command('/zshop', async ({ ack, body, client }) => {
  try {
    await ack();
    const triggerId = body.trigger_id;
    const slackId = body.user_id;

    const currentCoins = await getUserCoins(slackId) || 0;

    const stickersheetOptions = Object.entries(STICKERSHEET_CONFIG).map(([key, config]) => {
      let text = `${config.name} - ${config.cost} coins`;
      if (text.length > 75) {
        text = text.substring(0, 72) + '...';
      }
      return {
        text: { type: 'plain_text', text },
        value: key
      };
    });

    const welcomeText = `welcome to the Zorp UFO shop! you currently have ${currentCoins} coins in your space wallet. beep beep boop what would you like to buy?`;

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
              text: welcomeText
            }
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
          }
        ]
      }
    });

  } catch (error) {
    console.error('Error in /zshop command:', error);
    try {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'oopies! zorp couldn\'t open the shop, pls ask @magic frog for help'
      });
    } catch (dmError) {
      // silently fail
    }
  }
});

// handle when user submits the shop form
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
    
    if (config.requires && !currentStickersheets.includes(config.requires)) {
      await client.chat.postMessage({
        channel: slackId,
        text: `sorry! you need to buy ${config.requires} first before you can buy ${config.name}!`
      });
      return;
    }
    
    if (currentStickersheets.includes(config.name)) {
      await client.chat.postMessage({
        channel: slackId,
        text: `you already have that stickersheet, get a different one!`
      });
      return;
    }
    
    if (currentCoins < config.cost) {
      await client.chat.postMessage({
        channel: slackId,
        text: `sorry! you only have ${currentCoins} coins but need ${config.cost} coins for ${config.name}. keep collecting with \`/zcollect\`!`
      });
      return;
    }

    const [newBalance, newStickersheets] = await Promise.all([
      deductCoins(slackId, config.cost),
      addStickersheet(slackId, selectedStickersheet)
    ]);

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

  } catch (error) {
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text: 'sorry! zappy couldn\'t process your purchase, pls ask @magic frog for help'
      });
    } catch (dmError) {
      // silently fail
    }
  }
});

// handle the /speak command - admin only
app.command('/speak', async ({ ack, body, client }) => {
  try {
    await ack();
    
    if (body.user_id !== 'U06UYA4AH6F') {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'why are you trying to make me say something? i\'m not a robot!'
      });
      return;
    }

    const triggerId = body.trigger_id;

    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'speak_modal',
        title: { type: 'plain_text', text: 'ZORP SPEAK' },
        submit: { type: 'plain_text', text: 'send message' },
        close: { type: 'plain_text', text: 'cancel' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'plain_text',
              text: 'beep beep boop! what would you like zorp to say to #jumpstart?',
              emoji: true
            }
          },
          {
            type: 'input',
            block_id: 'message_block',
            label: { type: 'plain_text', text: 'message to send' },
            element: {
              type: 'plain_text_input',
              action_id: 'message_input',
              placeholder: { type: 'plain_text', text: 'type your message here...' },
              multiline: true
            }
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error in /speak command:', error);
    try {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'oopsies! zorp couldn\'t open the speak form, pls try again'
      });
    } catch (dmError) {
      // silently fail
    }
  }
});

// handle the /update-coins command - admin only
app.command('/update-coins', async ({ ack, body, client }) => {
  try {
    await ack();
    
    if (body.user_id !== 'U06UYA4AH6F') {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'why are you trying to update coins? i\'m not a robot!'
      });
      return;
    }

    await client.chat.postMessage({
      channel: body.user_id,
      text: 'beep beep boop! processing coin requests...'
    });

    const [approvedResult, declinedResult] = await Promise.all([
      processApprovedCoinRequests(),
      processDeclinedCoinRequests()
    ]);

    let message = '';
    if (approvedResult.processedCount > 0 || declinedResult.processedCount > 0) {
      message = '✅ processed:';
      if (approvedResult.processedCount > 0) {
        message += `\n• ${approvedResult.processedCount} approved requests (+${approvedResult.totalCoinsAdded} coins)`;
      }
      if (declinedResult.processedCount > 0) {
        message += `\n• ${declinedResult.processedCount} declined requests`;
      }
      message += '\nbeep beep boop!';
    } else {
      message = 'no new requests to process! all caught up!';
    }

    await client.chat.postMessage({
      channel: body.user_id,
      text: message
    });

  } catch (error) {
    console.error('Error in /update-coins command:', error);
    try {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'oopsies! zorp couldn\'t process the coin requests, pls try again'
      });
    } catch (dmError) {
      // silently fail
    }
  }
});

// handle random coin claim button - DISABLED
app.action('claim_random_coin', async ({ ack, body, client }) => {
  try {
    await ack();
    await client.chat.postMessage({
      channel: body.user.id,
      text: 'sorry! random coin drops are currently disabled. beep beep boop!'
    });
  } catch (error) {
    console.error('Error handling random coin claim:', error);
  }
});

// handle when user submits the speak form
app.view('speak_modal', async ({ ack, view, body, client }) => {
  try {
    await ack();

    if (body.user.id !== 'U06UYA4AH6F') {
      return;
    }

    const message = view.state.values['message_block']['message_input'].value || '';

    if (!message.trim()) {
      await client.chat.postMessage({
        channel: body.user.id,
        text: 'you need to type a message first!'
      });
      return;
    }

    await client.chat.postMessage({
      channel: '#jumpstart',
      text: message
    });

    await client.chat.postMessage({
      channel: body.user.id,
      text: 'message sent to #jumpstart! beep beep boop!'
    });

  } catch (error) {
    console.error('Error in speak modal submission:', error);
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text: 'sorry! zorp couldn\'t send your message, pls try again'
      });
    } catch (dmError) {
      // silently fail
    }
  }
});

// handle the /leaderboard command
app.command('/leaderboard', async ({ ack, body, client }) => {
  try {
    await ack();
    
    const slackId = body.user_id;

    await updateUserCoins(slackId);

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
      leaderboardText += `\n*your position:* not ranked yet - start collecting coins with \`/zcollect\`!`;
    }

    await client.chat.postMessage({
      channel: slackId,
      text: leaderboardText
    });

  } catch (error) {
    try {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'sorry! zorp couldn\'t load the leaderboard, pls ask @magic frog for help'
      });
    } catch (dmError) {
      // silently fail
    }
  }
});

// health check endpoints
receiver.app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

receiver.app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// endpoint to manually trigger coin updates for all users
receiver.app.get('/update-coins', async (req, res) => {
  try {
    await updateAllUserCoins();
    res.status(200).json({
      status: 'success',
      message: 'All user coin counts updated',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to update coin counts',
      error: error.message
    });
  }
});

// start the server
const port = process.env.PORT || 3000;
receiver.app.listen(port, () => {
  console.log(`Zorp bot is running on port ${port}`);
  scheduleDailyLeaderboard();
  scheduleDailyRandomCoin();
});
