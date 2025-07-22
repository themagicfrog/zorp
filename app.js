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

  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'collect_coins_modal',
        title: {
          type: 'plain_text',
          text: 'Collect Coins',
          emoji: true
        },
        submit: {
          type: 'plain_text',
          text: 'Submit',
          emoji: true
        },
        close: {
          type: 'plain_text',
          text: 'Cancel',
          emoji: true
        },
        blocks: [
          {
            type: 'input',
            block_id: 'activity_selection',
            label: {
              type: 'plain_text',
              text: 'Select an activity to collect coins:',
              emoji: true
            },
            element: {
              type: 'static_select',
              placeholder: {
                type: 'plain_text',
                text: 'Choose an activity...',
                emoji: true
              },
              options: [
                {
                  text: {
                    type: 'plain_text',
                    text: 'Comment on another person\'s game (1 coin)',
                    emoji: true
                  },
                  value: 'comment_on_game_1'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Work on game in a huddle in jumpstart channel (1 coin)',
                    emoji: true
                  },
                  value: 'huddle_work_1'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Post your game idea message by end of day Wednesday (3 coins)',
                    emoji: true
                  },
                  value: 'post_game_idea_3'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Attend an event in jumpstart channel (3 coins)',
                    emoji: true
                  },
                  value: 'attend_event_3'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Post an update in your thread about something you learned or a problem you solved and send to channel (3 coins)',
                    emoji: true
                  },
                  value: 'post_update_3'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Suggest another way to earn coins and have idea approved (4 coins)',
                    emoji: true
                  },
                  value: 'suggest_idea_4'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Tell a friend or someone else about jumpstart, post it somewhere (reddit, discord, etc) (5 coins)',
                    emoji: true
                  },
                  value: 'promote_jumpstart_5'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Host an event (workshop, lock-in, etc.) (7 coins)',
                    emoji: true
                  },
                  value: 'host_event_7'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Print and post a Jumpstart poster where you live, take a picture (10 coins)',
                    emoji: true
                  },
                  value: 'post_poster_10'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Record yourself explaining your game (with face and voice) (10 coins)',
                    emoji: true
                  },
                  value: 'record_explanation_10'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Draw and create all your own assets (art or music) (20 coins)',
                    emoji: true
                  },
                  value: 'create_assets_20'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Help someone fix a problem (3-20 coins)',
                    emoji: true
                  },
                  value: 'help_someone_3_20'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Open a pull request to the jumpstart website and do a task (5-15 coins)',
                    emoji: true
                  },
                  value: 'pr_website_5_15'
                },
                {
                  text: {
                    type: 'plain_text',
                    text: 'Meetup in person with another jumpstarter near you to work on game, take selfie (30 coins)',
                    emoji: true
                  },
                  value: 'meetup_person_30'
                }
              ]
            }
          },
          {
            type: 'input',
            block_id: 'additional_details',
            label: {
              type: 'plain_text',
              text: 'Additional details (optional):',
              emoji: true
            },
            element: {
              type: 'plain_text_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'Provide any additional context or details about your activity...',
                emoji: true
              }
            },
            optional: true
          }
        ]
      }
    });
  } catch (error) {
    console.error('Error opening modal:', error);
  }
});

// Handle modal submission
app.view('collect_coins_modal', async ({ ack, body, view, client }) => {
  await ack();

  const selectedActivity = view.state.values.activity_selection.activity_selection.selected_option;
  const additionalDetails = view.state.values.additional_details.additional_details.value || 'No additional details provided';
  const userId = body.user.id;

  try {
    // Send confirmation message to the user
    await client.chat.postMessage({
      channel: userId,
      text: `✅ Coin collection submitted!`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Activity:* ${selectedActivity.text.text}\n*Additional Details:* ${additionalDetails}\n\nYour submission has been recorded! 🪙`
          }
        }
      ]
    });

    // You can add additional logic here to store the submission in a database
    // or send it to a specific channel for review

  } catch (error) {
    console.error('Error handling modal submission:', error);
  }
});

const port = process.env.PORT || 3000;
receiver.app.listen(port, () => {
  console.log(`Slack Bolt app running on port ${port}`);
});
