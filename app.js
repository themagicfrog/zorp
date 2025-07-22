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
              text: (() => {
                const welcomeMessages = [
                  "beep beep boop! i am Zorp and i am here to help you collect coins!",
                  "hello earthling! do you hear the cows mooing? that means its coin time!",
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
              options: COIN_ACTIONS.map(a => ({
                text: { type: 'plain_text', text: `${a.label}${a.coins ? ` (${a.coins} coins)` : ''}` },
                value: a.value
              }))
            }
          },
          {
            type: 'input',
            block_id: 'thread_link_block',
            label: { type: 'plain_text', text: 'Thread Link' },
            element: {
              type: 'plain_text_input',
              action_id: 'thread_link_input',
              placeholder: {
                type: 'plain_text',
                text: 'paste the link to your thread or post here...'
              }
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
    const slackId = body.user.id;
    const now = new Date().toISOString().split('T')[0];

    // Get user info to get proper display name
    let displayName = body.user.name;
    try {
      const userInfo = await client.users.info({
        user: slackId
      });
      displayName = userInfo.user.profile.display_name || userInfo.user.profile.real_name || body.user.name;
    } catch (userError) {
      console.log('⚠️ Could not fetch user info, using fallback name:', body.user.name);
    }

    // Find the selected action to get the coin value
    const selectedAction = COIN_ACTIONS.find(a => a.value === action);
    const coinsGiven = selectedAction && selectedAction.coins ? selectedAction.coins : null;

    // Prepare fields for Airtable
    const fields = {
      'Slack ID': slackId,
      'Display Name': displayName,
      'Action': action,
      'Status': 'Pending',
      'Request Date': now
    };

    // Add Thread Link if provided
    if (threadLink) {
      fields['Thread Link'] = threadLink;
    }

    // Add Coins Given if the action has a coin value
    if (coinsGiven !== null) {
      fields['Coins Given'] = coinsGiven;
    }

    console.log('📝 Attempting to create Airtable record with fields:', fields);

    await base('Coin Requests').create([
      { fields }
    ]);

    console.log('✅ Airtable record created successfully');

    // Random confirmation messages
    const confirmationMessages = [
      `hiya zorppy's spaceship has gotten your ${action} request`,
      `wahoo! my alien friends got your ${action} submission. we'll be scanning it soon`,
      `beep beep boop! the cows are mooing (aka we got your ${action} request)`,
      `your ${action} request is now at our UFO. you'll get your coins soon`,
    ];

    const randomMessage = confirmationMessages[Math.floor(Math.random() * confirmationMessages.length)];

    await client.chat.postMessage({
      channel: slackId,
      text: randomMessage
    });

    console.log('✅ DM sent successfully');
  } catch (error) {
    console.error('⚠️ Error in collect_modal view:', JSON.stringify(error, null, 2));
    
    // Try to send error message to user
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

// Start the server
const port = process.env.PORT || 3000;
receiver.app.listen(port, () => {
  console.log(`🚀 Slack Bolt app running on port ${port}`);
});
