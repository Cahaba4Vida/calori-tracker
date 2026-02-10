const { json } = require("./_util");
const { query } = require("./_db");
const { requireUser } = require("./_auth");

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId } = auth.user;

  try {
    const activeCampaign = await query(
      `select id, title, question, placeholder, submit_label, activated_at
       from feedback_campaigns
       where is_active = true
       order by id desc
       limit 1`
    );

    const campaign = activeCampaign.rows[0] || null;
    if (!campaign) return json(200, { required: false, campaign: null });

    const answer = await query(
      `select campaign_id
       from feedback_responses
       where campaign_id = $1 and user_id = $2
       limit 1`,
      [campaign.id, userId]
    );

    return json(200, {
      required: answer.rowCount === 0,
      campaign: {
        id: campaign.id,
        title: campaign.title,
        question: campaign.question,
        placeholder: campaign.placeholder,
        submit_label: campaign.submit_label,
        activated_at: campaign.activated_at
      }
    });
  } catch (e) {
    if (e && e.code === "42P01") {
      return json(200, { required: false, campaign: null, warning: "feedback tables missing" });
    }
    return json(500, { error: "Could not load feedback status" });
  }
};
