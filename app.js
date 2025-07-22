// app.js
const { App, ExpressReceiver } = require('@slack/bolt');
require('dotenv').config();

// Custom receiver for Slack events
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events'
});

// Initialize app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
});

// /collect command: reply "hi" in DM
app.command('/collect', async ({ ack, body, client }) => {
  await ack();

  await client.chat.postMessage({
    channel: body.user_id,
    text: 'hi'
  });
});

// Start server
const port = process.env.PORT || 3000;
receiver.app.listen(port, () => {
  console.log(`⚡️ Slack Bolt app running on port ${port}`);
});
