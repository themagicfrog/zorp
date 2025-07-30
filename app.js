// import the slack bolt framework and airtable
const { App, ExpressReceiver } = require('@slack/bolt');
const Airtable = require('airtable');
require('dotenv').config();

// set up the express receiver to handle slack events
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events'
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
  stickersheet1: { name: 'PLANET STICKERSHEET', cost: 10, description: 'starter stickersheet' },
  stickersheet2: { name: 'GALAXY STICKERSHEET', cost: 35, description: 'premium stickersheet', requires: 'PLANET STICKERSHEET' },
  stickersheet3: { name: 'UNIVERSE STICKERSHEET', cost: 45, description: 'ultimate stickersheet', requires: 'GALAXY STICKERSHEET' }
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
    // get all approved coin requests for this user
    const approvedRequests = await base('Coin Requests').select({
      filterByFormula: `AND({Slack ID} = '${slackId}', {Status} = 'Approved')`
    }).all();

    // add up all the coins from approved requests
    let totalCoins = 0;
    approvedRequests.forEach(record => {
      const coins = record.get('Coins Given');
      if (coins && typeof coins === 'number') {
        totalCoins += coins;
      }
    });

    // update the user's coin total in airtable
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
  }
}

// update all users' coin totals (can be called periodically)
async function updateAllUserCoins() {
  try {
    // get all users
    const allUsers = await base('Users').select().all();
    
    // update each user's coin count
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
    // get all approved coin requests that haven't been processed yet
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
        console.log(`Skipping request ${request.id}: missing slackId or invalid coins`);
        continue;
      }

      try {
        // get or create the user
        const userRecord = await getOrCreateUser(slackId, displayName);
        const currentCoins = userRecord.get('Coins') || 0;
        const newCoins = currentCoins + coinsGiven;

        // update the user's coin balance
        await base('Users').update([
          {
            id: userRecord.id,
            fields: { 'Coins': newCoins }
          }
        ]);

        // mark the request as processed
        await base('Coin Requests').update([
          {
            id: request.id,
            fields: { 'Processed?': true }
          }
        ]);

        processedCount++;
        totalCoinsAdded += coinsGiven;

        console.log(`Processed request ${request.id}: ${displayName} +${coinsGiven} coins (new total: ${newCoins})`);

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
    // get all declined coin requests that haven't been processed yet
    const declinedRequests = await base('Coin Requests').select({
      filterByFormula: `AND({Status} = 'Declined', {Processed?} != 1)`
    }).all();

    let processedCount = 0;

    for (const request of declinedRequests) {
      try {
        // mark the request as processed
        await base('Coin Requests').update([
          {
            id: request.id,
            fields: { 'Processed?': true }
          }
        ]);

        processedCount++;
        console.log(`Processed declined request ${request.id}`);

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

    // get current stickersheets and add the new one
    const currentStickersheets = userRecord.get('Stickersheets') || [];
    const newStickersheets = [...currentStickersheets, config.name];

    // update the user's stickersheet list in airtable
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

    // make sure they don't go negative
    if (newCoins < 0) {
      throw new Error('Insufficient coins');
    }

    // update their coin balance in airtable
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
    console.error('Error getting user action count:', error);
    return 0;
  }
}

// check if user can still do a specific action
async function canUserDoAction(slackId, action) {
  try {
    const actionConfig = COIN_ACTIONS.find(a => a.value === action);
    if (!actionConfig || !actionConfig.max) return true; // No limit set
    
    const currentCount = await getUserActionCount(slackId, action);
    return currentCount < actionConfig.max;
  } catch (error) {
    console.error('Error checking if user can do action:', error);
    return true; // Allow if there's an error
  }
}

// get remaining times user can do each action - optimized with single query
async function getUserActionRemaining(slackId) {
  try {
    // Get all approved requests for this user in one query
    const approvedRequests = await base('Coin Requests').select({
      filterByFormula: `AND({Slack ID} = '${slackId}', {Status} = 'Approved')`
    }).all();

    // Count each action type
    const actionCounts = {};
    approvedRequests.forEach(record => {
      const action = record.get('Action');
      if (action) {
        actionCounts[action] = (actionCounts[action] || 0) + 1;
      }
    });

    // Calculate remaining for each action
    const remaining = {};
    for (const action of COIN_ACTIONS) {
      if (action.max) {
        const currentCount = actionCounts[action.value] || 0;
        remaining[action.value] = Math.max(0, action.max - currentCount);
      }
    }
    return remaining;
  } catch (error) {
    console.error('Error getting user action remaining:', error);
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
    // get all users sorted by coins (highest first)
    const allUsers = await base('Users').select({
      sort: [{ field: 'Coins', direction: 'desc' }]
    }).all();

    // get the top 10 users
    const top10Users = allUsers.slice(0, 10);

    // build the leaderboard message
    let leaderboardText = '*DAILY COIN LEADERBOARD*\n\n';
    
    // add each top user to the message
    top10Users.forEach((user, index) => {
      const position = index + 1;
      const displayName = user.get('Display Name') || 'Unknown';
      const coins = user.get('Coins') || 0;
      
      // add emojis for top 3 positions
      let emoji = '';
      if (position === 1) emoji = '🥇';
      else if (position === 2) emoji = '🥈';
      else if (position === 3) emoji = '🥉';
      else emoji = `${position}.`;
      
      leaderboardText += `${emoji} *${displayName}* - *${coins} coins*\n`;
    });

    // add total participants count
    leaderboardText += `\n*${allUsers.length} total jumpstarters competing!* `;

    // list of random leaderboard messages
    const leaderboardMessages = [
      "beep beep boop! here's today's coin leaderboard!",
      "the cows are mooing! time for the daily leaderboard!",
      "greetings earthlings! check out today's coin rankings!",
      "wahoo! it's leaderboard time! see who's collecting the most coins!",
    ];

    // post to #jumpstart channel
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

    console.log('Daily leaderboard posted successfully');
  } catch (error) {
    console.error('Error posting daily leaderboard:', error);
  }
}

// schedule daily leaderboard posting at 9:10 PM EST
function scheduleDailyLeaderboard() {
  // Calculate time until next 9:10 PM EST
  const now = new Date();
  const estOffset = -5; // EST is UTC-5
  const estTime = new Date(now.getTime() + (estOffset * 60 * 60 * 1000));
  
  // Set target time to 9:10 PM EST
  const targetTime = new Date(estTime);
  targetTime.setHours(21, 10, 0, 0); // 9:10 PM
  
  // If it's already past 9:10 PM today, schedule for tomorrow
  if (estTime.getTime() > targetTime.getTime()) {
    targetTime.setDate(targetTime.getDate() + 1);
  }
  
  // Calculate delay until target time
  const delay = targetTime.getTime() - estTime.getTime();
  
  // Schedule the first leaderboard post
  setTimeout(async () => {
    await postDailyLeaderboard();
    
    // Then schedule it to run every 24 hours
    setInterval(async () => {
      await postDailyLeaderboard();
    }, 24 * 60 * 60 * 1000); // 24 hours in milliseconds
  }, delay);
  
  console.log(`Daily leaderboard scheduled for ${targetTime.toLocaleString()}`);
}

// function to post daily random coin drop
async function postDailyRandomCoin() {
  try {
    // random messages for the coin drop
    const coinMessages = [
      "beep boop! you've seem to found a stray coin--collect it quick before someone else does!",
      "boooop beep!! what's this? a random coin, strange. finder's keeper's, take it before someone else does!"
    ];

    const randomMessage = getRandomMessage(coinMessages);

    // post to #jumpstart channel with claim button
    const result = await app.client.chat.postMessage({
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

    console.log('Daily random coin drop posted successfully');
    return result.ts; // return the timestamp for tracking
  } catch (error) {
    console.error('Error posting daily random coin drop:', error);
  }
}

// schedule daily random coin drop at a random time
function scheduleDailyRandomCoin() {
  // Calculate time until next random time (between 9 AM and 9 PM EST)
  const now = new Date();
  const estOffset = -5; // EST is UTC-5
  const estTime = new Date(now.getTime() + (estOffset * 60 * 60 * 1000));
  
  // Generate random time between 9 AM and 9 PM EST
  const randomHour = Math.floor(Math.random() * 12) + 9; // 9 AM to 9 PM
  const randomMinute = Math.floor(Math.random() * 60);
  
  // Set target time to random time today
  const targetTime = new Date(estTime);
  targetTime.setHours(randomHour, randomMinute, 0, 0);
  
  // If it's already past the random time today, schedule for tomorrow
  if (estTime.getTime() > targetTime.getTime()) {
    targetTime.setDate(targetTime.getDate() + 1);
  }
  
  // Calculate delay until target time
  const delay = targetTime.getTime() - estTime.getTime();
  
  // Schedule the first random coin drop
  setTimeout(async () => {
    await postDailyRandomCoin();
    
    // Then schedule it to run every 24 hours
    setInterval(async () => {
      await postDailyRandomCoin();
    }, 24 * 60 * 60 * 1000); // 24 hours in milliseconds
  }, delay);
  
  console.log(`Daily random coin drop scheduled for ${targetTime.toLocaleString()}`);
}

// handle the /collect command - opens a form for users to submit coin requests
app.command('/collect', async ({ ack, body, client }) => {
  try {
    await ack();
    const triggerId = body.trigger_id;
    const slackId = body.user_id;

    // list of random welcome messages
    const welcomeMessages = [
      "beep beep boop! i am Zorp and i am here to help you collect coins!",
      "hello earthling! do you hear the cows mooing? that means it's coin time!",
      "greetings human (or whatever they say), are you ready to collect some coins?",
      "welcome to the coin collection station! zorppy is here",
    ];

    // get user's remaining action counts with timeout
    let actionRemaining = {};
    try {
      actionRemaining = await withTimeout(getUserActionRemaining(slackId), 5000);
    } catch (timeoutError) {
      console.error('Timeout getting action remaining:', timeoutError);
      // Fallback to showing all actions if timeout
      actionRemaining = {};
      COIN_ACTIONS.forEach(a => {
        if (a.max) actionRemaining[a.value] = a.max;
      });
    }

    // create options with remaining counts - only show available actions
    const options = COIN_ACTIONS.map(a => {
      const remaining = actionRemaining[a.value] || 0;
      const canDo = remaining > 0;
      
      // Create shorter text to avoid 76 character limit
      let text = a.label;
      if (a.coins) {
        text += ` (${a.coins}c)`;
      }
      if (canDo) {
        text += ` - ${a.max} max`;
      } else {
        text += ` - MAXED`;
      }
      
      // Truncate if still too long
      if (text.length > 75) {
        text = text.substring(0, 72) + '...';
      }
      
      return {
        text: { type: 'plain_text', text },
        value: a.value,
        canDo: canDo
      };
    }).filter(option => option.canDo).map(({ text, value }) => ({ text, value }));

    // check if user has any available actions
    if (options.length === 0) {
      await client.chat.postMessage({
        channel: slackId,
        text: 'wow! you\'ve completed all the available actions! 🎉 you\'re a coin collection master!'
      });
      return;
    }

    // open a form for the user to fill out
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
    console.error('Error in /collect command:', error);
    // Send error message to user if modal fails to open
    try {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'oopsies! zorp couldn\'t open the collection form, pls try again or ask @magic frog for help'
      });
    } catch (dmError) {
      console.error('Error sending error DM:', dmError);
    }
  }
});

// handle when user submits the collect form
app.view('collect_modal', async ({ ack, view, body, client }) => {
  try {
    await ack();

    // get the data from the form
    const action = view.state.values['action_block']['action_selected'].selected_option.value;
    const threadLink = view.state.values['thread_link_block']['thread_link_input'].value || '';
    const requestNote = view.state.values['request_note_block']['request_note_input'].value || '';
    const slackId = body.user.id;
    const now = new Date().toISOString().split('T')[0];

    // check if user has reached the maximum for this action
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

    // try to get the user's display name from slack
    let displayName = body.user.name;
    try {
      const userInfo = await client.users.info({ user: slackId });
      displayName = userInfo.user.profile.display_name || userInfo.user.profile.real_name || body.user.name;
    } catch (userError) {
      // use fallback name if we can't get their display name
    }

    // figure out how many coins this action is worth
    const selectedAction = COIN_ACTIONS.find(a => a.value === action);
    const coinsGiven = selectedAction?.coins || null;

    // prepare the data to save to airtable
    const fields = {
      'Slack ID': slackId,
      'Display Name': displayName,
      'Action': action,
      'Status': 'Pending',
      'Message Link': threadLink,
      'Request Date': now
    };

    // add optional fields if they exist
    if (requestNote) fields['Request Note'] = requestNote;
    if (coinsGiven !== null) fields['Coins Given'] = coinsGiven;

    // list of random confirmation messages
    const confirmationMessages = [
      `hiya! my spaceship has gotten your request :D the minions will look at it soon`,
      `wahoo! my alien friends got your submission. we'll be scanning it soon :)`,
      `beep beep boop! the cows are mooing (aka we got your request, the minions will look at it soon)`,
      `your request is now at our UFO! you'll get your coins soon (as long as you're not a devious minion)`,
    ];

    // save the request to airtable, send confirmation dm, and create user if needed
    await Promise.all([
      base('Coin Requests').create([{ fields }]),
      client.chat.postMessage({
        channel: slackId,
        text: getRandomMessage(confirmationMessages)
      }),
      getOrCreateUser(slackId, displayName)
    ]);

  } catch (error) {
    // send error message to user if something goes wrong
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text: `oopsies! zorp couldn't submit your request, pls ask @magic frog for help`
      });
    } catch (dmError) {
    }
  }
});

// handle the /shop command - opens the shop where users can buy stickersheets
app.command('/shop', async ({ ack, body, client }) => {
  try {
    await ack();
    
    const slackId = body.user_id;
    const triggerId = body.trigger_id;

    // automatically update user's coin count before showing shop
    await updateUserCoins(slackId);

    // get user's current coins and stickersheets
    const currentCoins = await getUserCoins(slackId);
    const currentStickersheets = await getUserStickersheetsList(slackId);
    const actionRemaining = await getUserActionRemaining(slackId);

    // check what stickersheets they can buy based on progression
    const hasPlanet = currentStickersheets.includes('PLANET STICKERSHEET');
    const hasGalaxy = currentStickersheets.includes('GALAXY STICKERSHEET');
    
    const canBuyPlanet = currentCoins >= 10;
    const canBuyGalaxy = hasPlanet && currentCoins >= 35;
    const canBuyUniverse = hasGalaxy && currentCoins >= 45;

    // create the dropdown options for stickersheets
    const stickersheetOptions = Object.entries(STICKERSHEET_CONFIG).map(([key, config]) => {
      let canBuy = false;
      let text = `${config.name} - ${config.cost} coins`;
      let description = config.description;

      // customize the text and description based on what they can buy
      switch (key) {
        case 'stickersheet1':
          canBuy = canBuyPlanet;
          if (!canBuy) description = 'need 10 coins';
          break;
        case 'stickersheet2':
          canBuy = canBuyGalaxy;
          if (!canBuy) {
            description = 'need PLANET stickersheet + 35 coins';
          }
          break;
        case 'stickersheet3':
          canBuy = canBuyUniverse;
          if (!canBuy) {
            description = 'need GALAXY stickersheet + 45 coins';
          }
          break;
      }

      return {
        text: { type: 'plain_text', text },
        value: key,
        description: { type: 'plain_text', text: description }
      };
    });

    // open the shop modal
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
              text: '*PLANET STICKERSHEET - 25 coins*'
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
              text: '*GALAXY STICKERSHEET - 35 coins & PLANET*'
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
              text: '*UNIVERSE STICKERSHEET - 45 coins & GALAXY*'
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
          },
          {
            type: 'divider'
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*your remaining actions:*\n' + 
                Object.entries(actionRemaining)
                  .filter(([action, remaining]) => remaining > 0)
                  .map(([action, remaining]) => {
                    const actionConfig = COIN_ACTIONS.find(a => a.value === action);
                    return `• ${actionConfig.label} - ${remaining} left`;
                  })
                  .join('\n') + 
                (Object.values(actionRemaining).every(count => count === 0) 
                  ? '\n• all actions completed!' 
                  : '')
            }
          }
        ]
      }
    });

  } catch (error) {
    // send error message if shop can't open
    try {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'oopies! zorp couldn\'t open the shop, pls ask @magic frog for help'
      });
    } catch (dmError) {
    }
  }
});

// handle when user clicks okay on the what modal
app.view('what_modal', async ({ ack }) => {
  await ack();
  // Modal closes automatically when ack is called
});

// handle when user submits the shop form to buy a stickersheet
app.view('shop_modal', async ({ ack, view, body, client }) => {
  try {
    await ack();

    // get the selected stickersheet and user info
    const metadata = JSON.parse(view.private_metadata);
    const { slackId } = metadata;
    
    const selectedStickersheet = view.state.values['stickersheet_selection']['stickersheet_selected'].selected_option.value;
    const config = getStickersheetConfig(selectedStickersheet);
    
    // make sure they selected a valid stickersheet
    if (!config) {
      await client.chat.postMessage({
        channel: slackId,
        text: 'sorry! invalid stickersheet selection'
      });
      return;
    }
    
    // get current user data
    const currentCoins = await getUserCoins(slackId);
    const currentStickersheets = await getUserStickersheetsList(slackId);
    
    // check if they have the required stickersheet for progression
    if (config.requires && !currentStickersheets.includes(config.requires)) {
      await client.chat.postMessage({
        channel: slackId,
        text: `sorry! you need to buy ${config.requires} first before you can buy ${config.name}!`
      });
      return;
    }
    
    // check if they already own this stickersheet
    if (currentStickersheets.includes(config.name)) {
      await client.chat.postMessage({
        channel: slackId,
        text: `you already have that stickersheet, get a different one!`
      });
      return;
    }
    
    // check if they have enough coins
    if (currentCoins < config.cost) {
      await client.chat.postMessage({
        channel: slackId,
        text: `sorry! you only have ${currentCoins} coins but need ${config.cost} coins for ${config.name}. keep collecting with \`/collect\`!`
      });
      return;
    }

    // process the purchase - deduct coins and add stickersheet
    await Promise.all([
      deductCoins(slackId, config.cost),
      addStickersheet(slackId, selectedStickersheet)
    ]);

    // get updated user data for confirmation message
    const newBalance = await getUserCoins(slackId);
    const newStickersheets = await getUserStickersheets(slackId);

    // list of random purchase confirmation messages
    const purchaseMessages = [
      `${config.name} acquired! you now have ${newBalance} coins and ${newStickersheets} stickersheets!`,
      `yay! ${config.name} purchased! your balance: ${newBalance} coins, stickersheets: ${newStickersheets}`,
      `woo! you got ${config.name}! coins remaining: ${newBalance}, total stickersheets: ${newStickersheets}`,
      `amazing! ${config.name} purchased! you have ${newBalance} coins left and ${newStickersheets} stickersheets now!`
    ];

    // send confirmation message to user
    await client.chat.postMessage({
      channel: slackId,
      text: getRandomMessage(purchaseMessages)
    });

  } catch (error) {
    // send error message if purchase fails
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text: 'sorry! zappy couldn\'t process your purchase, pls ask @magic frog for help'
      });
    } catch (dmError) {
    }
  }
});

// handle the /what command - shows detailed explanations of all activities
app.command('/what', async ({ ack, body, client }) => {
  try {
    await ack();
    const triggerId = body.trigger_id;

    // open a modal with detailed activity explanations
    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'what_modal',
        title: { type: 'plain_text', text: 'WHAT CAN I DO?' },
        submit: { type: 'plain_text', text: 'okay' },
        close: { type: 'plain_text', text: 'close' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*here are all the things you can do to earn coins!* '
            }
          },
          {
            type: 'divider'
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*💬 Comment (1 coin)*\n• something meaningful in someone else\'s game thread\n• do you have specific feedback on how they can make it better?\n• does their game remind you of another game?\n• is there a specific thing you really like about it?\n• "cool game" or "nice" doesn\'t count'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*👥 Huddle (2 coins)*\n• and work on your game in #jumpstart\n• join a huddle and work for at least 30 minutes\n• ideally have your video on\n• be talking about your game to others\n• actively working on your game\n• sitting in a huddle watching reels doesn\'t count\n• post a message after saying what you got done'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*🎮 Post (3 coins)*\n• your game idea!\n• first step to making your game is to get your idea'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*📅 Attend Event (3 coins)*\n• and post a summary message of what you learned during it or what you did\n• ex. workshops, jumpstartathons, playtest parties etc'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*📝 Update (1 coin)*\n• there is a minimum of 1 update at 10 hours, but you are encouraged to update more often too\n• make sure it is in your game thread and send to channel\n• includes roughly what you did/learned/whats next\n• add a screen recording or image to your message'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*📢 Share (3 coins)*\n• Jumpstart to your friends, family, or other communities you are part of (school, Discord, Reddit, your Insta)\n• because more people should know about Jumpstart\n• post a picture in #jumpstart proving that you did it'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*🎯 Host Event (variable coins)*\n• host an online event for Jumpstarters to go too\n• coin amount will vary on the event type you host, how many people go, and what they get out of it\n• starting a huddle counts!\n• ideas include but aren\'t limited to:\n  • idea brainstorm meeting\n  • weekend jumpstart lock in\n  • playtest party for people to test out each other\'s games\n  • workshops for a cool feature you want to show others how to add to their game\n• if you have an idea, please add it to the proposed events section in the Events canvas and tag me'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*🖼️ Poster (2 coins)*\n• print out our amazing Jumpstart poster and post it up somewhere anywhere near where you live\n• take a picture once you put it up and send to #jumpstart'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*🎥 Record (10 coins)*\n• Jumpstart was on Hack Club\'s instagram and you can be featured on HC\'s instagram too!\n• record yourself with face and voice talking about your game:\n  • your name, age, and where you\'re from\n  • what inspired you to make your game\n  • is this your first time with game dev\n  • whats challenging, surprising, easy, fun about it\n  • what you are currently working on adding to it\n  • what you plan to do next with your game\n  • record a timelapse of you working\n  • literally anything else, the more the merrier'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*🎨 Create Assets (15 coins)*\n• if you create all the assets you use in your game (music and art) YOU ARE SO COOL\n• they don\'t have to be the most perfect, but you should make all your game assets!!\n• it would be epic'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*🔧 Fix Problem (variable coins)*\n• there are a lot of beginners and experienced people here and people will be running into problems\n• help someone debug and solve an issue they have in their game\n• coin amount will vary based on the problem and how much you helped'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*📋 Task (PR) (variable coins)*\n• Jumpstart is a living growing thing and there will be tasks to make\n• i might give out a coin bounty for something to do once in a while'
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*🤝 IRL Meetup (25 coins)*\n• there are Jumpstarters from all over the world here!!\n• find someone who lives in the same town as you, find a time and place to meetup and work on your game together!\n• take a selfie and post in #jumpstart and write about what you got done, timelapse?'
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
                text: 'ready to collect some coins? use `/collect` to submit your activity!'
              }
            ]
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error in /what command:', error);
    // Send error message to user if modal fails to open
    try {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'oopsies! zorp couldn\'t open the activity guide, pls try again or ask @magic frog for help'
      });
    } catch (dmError) {
      console.error('Error sending error DM:', dmError);
    }
  }
});

// handle the /speak command - allows specific user to send messages to #jumpstart
app.command('/speak', async ({ ack, body, client }) => {
  try {
    await ack();
    
    // check if the user is authorized (only U06UYA4AH6F can use this command)
    if (body.user_id !== 'U06UYA4AH6F') {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'why are you trying to make me say something? i\'m not a robot!'
      });
      return;
    }

    const triggerId = body.trigger_id;

    // open a form for the user to fill out
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
    // Send error message to user if modal fails to open
    try {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'oopsies! zorp couldn\'t open the speak form, pls try again'
      });
    } catch (dmError) {
      console.error('Error sending error DM:', dmError);
    }
  }
});

// handle the /update-coins command - allows specific user to process approved coin requests
app.command('/update-coins', async ({ ack, body, client }) => {
  try {
    await ack();
    
    // check if the user is authorized (only U06UYA4AH6F can use this command)
    if (body.user_id !== 'U06UYA4AH6F') {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'why are you trying to update coins? i\'m not a robot!'
      });
      return;
    }

    // send initial message
    await client.chat.postMessage({
      channel: body.user_id,
      text: 'beep beep boop! processing coin requests...'
    });

    // process both approved and declined coin requests
    const [approvedResult, declinedResult] = await Promise.all([
      processApprovedCoinRequests(),
      processDeclinedCoinRequests()
    ]);

    // send results
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
    // Send error message to user
    try {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'oopsies! zorp couldn\'t process the coin requests, pls try again'
      });
    } catch (dmError) {
      console.error('Error sending error DM:', dmError);
    }
  }
});

// handle random coin claim button click
app.action('claim_random_coin', async ({ ack, body, client }) => {
  try {
    await ack();

    const slackId = body.user.id;
    const channelId = body.channel.id;
    const messageTs = body.message.ts;

    // get user info
    let displayName = body.user.username;
    try {
      const userInfo = await client.users.info({ user: slackId });
      displayName = userInfo.user.profile.display_name || userInfo.user.profile.real_name || body.user.username;
    } catch (userError) {
      // use fallback name if we can't get their display name
    }

    // create the coin request record
    const now = new Date().toISOString().split('T')[0];
    const fields = {
      'Slack ID': slackId,
      'Display Name': displayName,
      'Action': 'Claim',
      'Status': 'Approved',
      'Message Link': '',
      'Request Date': now,
      'Coins Given': 1,
      'Processed?': true
    };

    // save to airtable and update user coins
    await Promise.all([
      base('Coin Requests').create([{ fields }]),
      getOrCreateUser(slackId, displayName)
    ]);

    // update user's coin balance
    const userRecord = await getUserRecord(slackId);
    if (userRecord) {
      const currentCoins = userRecord.get('Coins') || 0;
      await base('Users').update([
        {
          id: userRecord.id,
          fields: { 'Coins': currentCoins + 1 }
        }
      ]);
    }

    // send confirmation DM to user
    await client.chat.postMessage({
      channel: slackId,
      text: 'congrats! you got the daily stray coin, look out for another one tomorrow'
    });

    // update the original message to show who got it
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: `there was a random coin, and <@${slackId}> got it! tomorrow there will be another one, so look out for it!`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `there was a random coin, and <@${slackId}> got it! tomorrow there will be another one, so look out for it!`
          }
        }
      ]
    });

  } catch (error) {
    console.error('Error handling random coin claim:', error);
    // send error message to user
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text: 'sorry! zorp couldn\'t process your claim, pls try again'
      });
    } catch (dmError) {
      console.error('Error sending error DM:', dmError);
    }
  }
});

// handle when user submits the speak form
app.view('speak_modal', async ({ ack, view, body, client }) => {
  try {
    await ack();

    // check if the user is authorized
    if (body.user.id !== 'U06UYA4AH6F') {
      return;
    }

    // get the message from the form
    const message = view.state.values['message_block']['message_input'].value || '';

    if (!message.trim()) {
      await client.chat.postMessage({
        channel: body.user.id,
        text: 'you need to type a message first!'
      });
      return;
    }

    // send the message to #jumpstart channel
    await client.chat.postMessage({
      channel: '#jumpstart',
      text: message
    });

    // send confirmation to the user
    await client.chat.postMessage({
      channel: body.user.id,
      text: 'message sent to #jumpstart! beep beep boop!'
    });

  } catch (error) {
    console.error('Error in speak modal submission:', error);
    // send error message if message fails to send
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text: 'sorry! zorp couldn\'t send your message, pls try again'
      });
    } catch (dmError) {
      console.error('Error sending error DM:', dmError);
    }
  }
});

// handle the /leaderboard command - shows top users by coin count
app.command('/leaderboard', async ({ ack, body, client }) => {
  try {
    await ack();
    
    const slackId = body.user_id;

    // automatically update the current user's coin count before showing leaderboard
    await updateUserCoins(slackId);

    // get all users sorted by coins (highest first)
    const allUsers = await base('Users').select({
      sort: [{ field: 'Coins', direction: 'desc' }]
    }).all();

    // find where the current user ranks
    const currentUserIndex = allUsers.findIndex(user => user.get('Slack ID') === slackId);
    const currentUserPosition = currentUserIndex + 1;
    const currentUserCoins = currentUserIndex >= 0 ? allUsers[currentUserIndex].get('Coins') || 0 : 0;

    // get the top 5 users
    const top5Users = allUsers.slice(0, 5);

    // build the leaderboard message
    let leaderboardText = '*COIN LEADERBOARD*\n\n';
    
    // add each top user to the message
    top5Users.forEach((user, index) => {
      const position = index + 1;
      const displayName = user.get('Display Name') || 'Unknown';
      const coins = user.get('Coins') || 0;
      
      leaderboardText += `*${position}.* ${displayName} - *${coins} coins*\n`;
    });

    // add the current user's position if they're not in top 5
    if (currentUserPosition > 5) {
      leaderboardText += `\n*your position:* #${currentUserPosition} with *${currentUserCoins} coins*`;
    } else if (currentUserPosition > 0) {
      leaderboardText += `\n*your position:* #${currentUserPosition} with *${currentUserCoins} coins*`;
    } else {
      leaderboardText += `\n*your position:* not ranked yet - start collecting coins with \`/collect\`!`;
    }

    // send the leaderboard to the user
    await client.chat.postMessage({
      channel: slackId,
      text: leaderboardText
    });

  } catch (error) {
    // send error message if leaderboard fails to load
    try {
      await client.chat.postMessage({
        channel: body.user_id,
        text: 'sorry! zorp couldn\'t load the leaderboard, pls ask @magic frog for help'
      });
    } catch (dmError) {
    }
  }
});

// add health check endpoints to keep the app awake
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

// start the server on the specified port
const port = process.env.PORT || 3000;
receiver.app.listen(port, () => {
  console.log(`Zorp bot is running on port ${port}`);
  
  // start the daily leaderboard scheduler
  scheduleDailyLeaderboard();
  
  // start the daily random coin drop scheduler
  scheduleDailyRandomCoin();
});
