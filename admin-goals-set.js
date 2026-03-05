const { json } = require("./_util");
const { query } = require("./_db");
const { requireAdminToken } = require("./_admin");

function cleanText(v, maxLen) {
  const x = String(v || "").trim();
  return x.slice(0, maxLen);
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const mode = body.mode === "deactivate" ? "deactivate" : "activate";

  try {
    if (mode === "deactivate") {
      const off = await query(
        `update feedback_campaigns
         set is_active = false, deactivated_at = now()
         where is_active = true
         returning id`
      );
      return json(200, { ok: true, mode, deactivated: off.rowCount });
    }

    const title = cleanText(body.title || "Quick feedback request", 120);
    const question = cleanText(body.question || "What should we improve?", 400);
    const placeholder = cleanText(body.placeholder || "Share your feedback", 120);
    const submit_label = cleanText(body.submit_label || "Submit feedback", 40);

    if (!title || !question) {
      return json(400, { error: "title and question are required" });
    }

    await query(`update feedback_campaigns set is_active = false, deactivated_at = now() where is_active = true`);

    const created = await query(
      `insert into feedback_campaigns(title, question, placeholder, submit_label, is_active, activated_at)
       values ($1, $2, $3, $4, true, now())
       returning id, title, question, placeholder, submit_label, is_active, activated_at`,
      [title, question, placeholder, submit_label]
    );

    return json(200, { ok: true, mode, campaign: created.rows[0] || null });
  } catch (e) {
    if (e && e.code === "42P01") {
      return json(400, { error: "Feedback tables are missing. Run sql/005_admin_feedback.sql." });
    }
    return json(500, { error: "Could not broadcast feedback form" });
  }
};
