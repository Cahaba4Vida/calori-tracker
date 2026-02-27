const { json } = require("./_util");
const { query } = require("./_db");
const { requireUser } = require("./_auth");

exports.handler = async (event, context) => {
  if (event.httpMethod && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId } = auth.user;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const campaignId = Number(body.campaign_id);
  const responseText = String(body.response_text || "").trim();

  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return json(400, { error: "campaign_id is required" });
  }
  if (!responseText || responseText.length < 5) {
    return json(400, { error: "Please add a little more feedback before submitting." });
  }

  try {
    const campaign = await query(
      `select id, is_active from feedback_campaigns where id = $1 limit 1`,
      [campaignId]
    );
    const row = campaign.rows[0];
    if (!row || !row.is_active) {
      return json(400, { error: "This feedback request is no longer active." });
    }

    await query(
      `insert into feedback_responses(campaign_id, user_id, response_text)
       values ($1, $2, $3)
       on conflict (campaign_id, user_id)
       do update set response_text = excluded.response_text, submitted_at = now()`,
      [campaignId, userId, responseText.slice(0, 3000)]
    );

    return json(200, { ok: true });
  } catch (e) {
    if (e && e.code === "42P01") {
      return json(400, { error: "Feedback tables are missing. Run sql/005_admin_feedback.sql." });
    }
    return json(500, { error: "Could not submit feedback" });
  }
};
