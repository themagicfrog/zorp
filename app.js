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

  // Check if the command was executed in a thread
  if (body.channel_id && body.response_url) {
    // Command was executed in a channel/thread, respond in the same context
    await client.chat.postMessage({
      channel: body.channel_id,
      thread_ts: body.thread_ts || body.message_ts, // Use thread_ts if in thread, message_ts if in channel
      text: 'hi'
    });
  } else {
    // Fallback to DM if no channel context
    await client.chat.postMessage({
      channel: body.user_id,
      text: 'hi'
    });
  }
});

const port = process.env.PORT || 3000;
receiver.app.listen(port, () => {
  console.log(`Slack Bolt app running on port ${port}`);
});
