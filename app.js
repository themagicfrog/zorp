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

    const displayName = body.user.name;

    const selectedAction = COIN_ACTIONS.find(a => a.value === action);
    const coinsGiven = selectedAction && selectedAction.coins ? selectedAction.coins : null;

    const fields = {
      'Slack ID': slackId,
      'Display Name': displayName,
      'Action': action,
      'Status': 'Pending',
      'Thread Link': threadLink,
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
      })
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

const port = process.env.PORT || 3000;
receiver.app.listen(port, () => {
  console.log(`🚀 Slack Bolt app running on port ${port}`);
});
