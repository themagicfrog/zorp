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

    // Send DM to user
    await client.chat.postMessage({
      channel: body.user_id,
      text: 'hi'
    });

    // More robust thread detection
    let threadTs;
    if (body.thread_ts) {
      threadTs = body.thread_ts;
    } else if (body.message_ts) {
      threadTs = body.message_ts;
    } else {
      threadTs = new Date().getTime().toString();
    }

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

// Start the server
const port = process.env.PORT || 3000;
receiver.app.listen(port, () => {
  console.log(`🚀 Slack Bolt app running on port ${port}`);
});
