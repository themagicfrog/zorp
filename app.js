// app.js
const { App, ExpressReceiver } = require('@slack/bolt');
const Airtable = require('airtable');
require('dotenv').config();

// Create a custom receiver to handle /slack/events
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events'
});

// Initialize Slack app with custom receiver
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
});

// Airtable setup
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// ------------------ /collect COMMAND ------------------

const COIN_ACTIONS = [
  { label: 'Comment on another game', value: 'comment', coins: 1 },
  { label: 'Help someone fix a problem', value: 'help', coins: null },
  { label: 'Post your game idea', value: 'post_idea', coins: 3 },
  { label: 'Attend an event', value: 'event', coins: 3 },
  { label: 'Post a progress update', value: 'update', coins: 3 },
  { label: 'Suggest a new coin idea', value: 'suggest', coins: 4 },
  { label: 'Tell a friend & post it', value: 'share', coins: 5 },
  { label: 'Host a workshop', value: 'host', coins: 7 },
  { label: 'Draw a sticker & get it in prizes', value: 'sticker', coins: 7 },
  { label: 'Post Jumpstart poster pic', value: 'poster', coins: 10 },
  { label: 'Record game explanation (face+voice)', value: 'record', coins: 10 },
  { label: 'Draw/make all assets', value: 'assets', coins: 20 },
  { label: 'Open PR & do a task', value: 'pr', coins: null },
  { label: 'Meetup w/ Jumpstarter IRL', value: 'meetup', coins: 30 }
];

app.command('/collect', async ({ ack, body, client }) => {
  try {
    await ack();
    const triggerId = body.trigger_id;
    const threadTs = body.thread_ts || body.message_ts;

    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'collect_modal',
        private_metadata: JSON.stringify({ thread_ts: threadTs, channel_id: body.channel_id }),
        title: { type: 'plain_text', text: 'Collect Coins' },
        submit: { type: 'plain_text', text: 'Submit' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'action_block',
            label: { type: 'plain_text', text: 'What did you do?' },
            element: {
              type: 'static_select',
              action_id: 'action_selected',
              options: COIN_ACTIONS.map(a => ({
                text: { type: 'plain_text', text: `${a.label}${a.coins ? ` (${a.coins} coins)` : ''}` },
                value: a.value
              }))
            }
          }
        ]
      }
    });
  } catch (error) {
    console.error('⚠️ Error in /collect command:', JSON.stringify(error, null, 2));
  }
});

app.view('collect_modal', async ({ ack, view, body, client }) => {
  try {
    await ack();

    const action = view.state.values['action_block']['action_selected'].selected_option.value;
    const metadata = JSON.parse(view.private_metadata);
    const slackId = body.user.id;
    const displayName = body.user.name;
    const now = new Date().toISOString().split('T')[0];

    await base('Coin Requests').create({
      fields: {
        'Slack ID': slackId,
        'Display Name': displayName,
        'Action': action,
        'Status': 'Pending',
        'Request Date': now,
        'Thread Link': `https://slack.com/app_redirect?channel=${metadata.channel_id}&message_ts=${metadata.thread_ts}`
      }
    });

    await client.chat.postMessage({
      channel: slackId,
      text: `✅ Got it! Your *${action}* coin request is submitted and awaiting review.`
    });
  } catch (error) {
    console.error('⚠️ Error in collect_modal view:', JSON.stringify(error, null, 2));
  }
});

// ------------------ /shop COMMAND ------------------

const STICKERS = [
  { name: 'Cool Frog', cost: 5 },
  { name: 'Rainbow Jumper', cost: 10 },
  { name: 'Zappy Zap', cost: 7 }
];

app.command('/shop', async ({ ack, body, client }) => {
  try {
    await ack();

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'shop_modal',
        title: { type: 'plain_text', text: 'Jumpstart Sticker Shop' },
        submit: { type: 'plain_text', text: 'Buy' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'sticker_block',
            label: { type: 'plain_text', text: 'Pick your sticker' },
            element: {
              type: 'static_select',
              action_id: 'sticker_selected',
              options: STICKERS.map(s => ({
                text: { type: 'plain_text', text: `${s.name} (${s.cost} coins)` },
                value: s.name
              }))
            }
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
    const userId = body.user.id;
    const stickerName = view.state.values['sticker_block']['sticker_selected'].selected_option.value;
    const sticker = STICKERS.find(s => s.name === stickerName);

    const userRecords = await base('Users').select({ filterByFormula: `{Slack ID} = '${userId}'` }).firstPage();
    const user = userRecords[0];

    if (!user) {
      await client.chat.postMessage({ channel: userId, text: `😢 Could not find your user record.` });
      return;
    }

    const currentCoins = user.fields['Coins'] || 0;
    const stickers = user.fields['Stickers Bought'] || [];

    if (currentCoins < sticker.cost) {
      await client.chat.postMessage({ channel: userId, text: `😔 You need ${sticker.cost} coins but only have ${currentCoins}.` });
      return;
    }

    await base('Users').update(user.id, {
      'Coins': currentCoins - sticker.cost,
      'Stickers Bought': [...stickers, stickerName]
    });

    await client.chat.postMessage({
      channel: userId,
      text: `🎉 You bought *${stickerName}*! You now have *${currentCoins - sticker.cost}* coins.`
    });
  } catch (error) {
    console.error('⚠️ Error in shop_modal view:', JSON.stringify(error, null, 2));
  }
});

// ------------------ BACKGROUND COIN GRANTER ------------------

async function processApprovedRequests() {
  try {
    const approved = await base('Coin Requests').select({
      filterByFormula: `AND({Status} = 'Approved', NOT({Fulfilled?}))`,
      maxRecords: 10
    }).firstPage();

    for (const request of approved) {
      try {
        const slackId = request.fields['Slack ID'];
        const coinsToAdd = request.fields['Coins Given'] || 0;

        const userRecords = await base('Users').select({
          filterByFormula: `{Slack ID} = '${slackId}'`
        }).firstPage();

        const user = userRecords[0];
        if (!user) continue;

        const currentCoins = user.fields['Coins'] || 0;
        await base('Users').update(user.id, {
          'Coins': currentCoins + coinsToAdd
        });

        await base('Coin Requests').update(request.id, {
          'Fulfilled?': true
        });

        await app.client.chat.postMessage({
          token: process.env.SLACK_BOT_TOKEN,
          channel: slackId,
          text: `🎉 Your request was approved! You earned *${coinsToAdd}* coins.`
        });
      } catch (innerErr) {
        console.error('⚠️ Error processing single approved request:', JSON.stringify(innerErr, null, 2));
      }
    }
  } catch (err) {
    console.error('⚠️ Error in processApprovedRequests:', JSON.stringify(err, null, 2));
  }
}

setInterval(processApprovedRequests, 60 * 1000); // every 60 seconds

// ------------------ GLOBAL ERROR HANDLER ------------------

app.error((error) => {
  console.error('🚨 Global Slack error:', JSON.stringify(error, null, 2));
});

// ------------------ START SERVER ------------------

const port = process.env.PORT || 3000;
receiver.app.listen(port, () => {
  console.log(`⚡️ Slack Bolt app is running on port ${port}`);
});
