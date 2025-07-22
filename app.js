// app.js
const { App, ExpressReceiver } = require('@slack/bolt');
const Airtable = require('airtable');
require('dotenv').config();

// create a custom receiver to handle /slack/events
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events'
});

// initialize Slack app with custom receiver
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
});

// airtable setup
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY })
  .base(process.env.AIRTABLE_BASE_ID);

// ------------------ /collect COMMAND ------------------

const COIN_ACTIONS = [
  { label: 'Comment on another game', value: 'Comment', coins: 1 },
  { label: 'Help someone fix a problem', value: 'Fix Problem', coins: null },
  { label: 'Post your game idea', value: 'Post', coins: 3 },
  { label: 'Attend an event', value: 'Attend Event', coins: 3 },
  { label: 'Post a progress update', value: 'Update', coins: 3 },
  { label: 'Tell a friend & post it', value: 'Share', coins: 5 },
  { label: 'Host an event', value: 'Host Event', coins: 7 },
  { label: 'Post Jumpstart poster pic', value: 'Poster', coins: 10 },
  { label: 'Record game explanation (face+voice)', value: 'Record', coins: 10 },
  { label: 'Draw/make all assets', value: 'Create Assets', coins: 20 },
  { label: 'Open PR & do a task', value: 'Task (PR)', coins: null },
  { label: 'Meetup w/ Jumpstarter IRL', value: 'IRL Meetup', coins: 30 }
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
              text: "beep beep boop boop! Zorp is here to help you collect coins!",
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
    console.error('Error in /collect command:', JSON.stringify(error, null, 2));
  }
});

app.view('collect_modal', async ({ ack, view, body, client }) => {
  try {
    await ack();

    const action = view.state.values['action_block']['action_selected'].selected_option.value;
    const slackId = body.user.id;
    const displayName = body.user.name;
    const now = new Date().toISOString().split('T')[0];

    await base('Coin Requests').create({
      fields: {
        'Slack ID': slackId,
        'Display Name': displayName,
        'Action': action,
        'Status': 'Pending',
        'Request Date': now
      }
    });

    await client.chat.postMessage({
      channel: slackId,
      text: `hi! your ${action} request has been submitted yay`
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
