const { App, ExpressReceiver } = require('@slack/bolt');
require('dotenv').config();

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events'
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
});

app.command('/collect', async ({ ack, body, client }) => {
  await ack();

  await client.chat.postMessage({
    channel: body.user_id,
    text: 'hi'
  });
});

const port = process.env.PORT || 3000;
receiver.app.listen(port, () => {
  console.log(`Slack Bolt app running on port ${port}`);
});
