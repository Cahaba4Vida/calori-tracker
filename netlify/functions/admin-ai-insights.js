const { json } = require("./_util");
const { query } = require("./_db");
const { requireAdminToken } = require("./_admin");
const { responsesCreate, outputText } = require("./_openai");

function cleanQuestion(v) {
  const q = String(v || "").trim();
  if (!q) return "What are people using this app for mostly, and what improvements should we prioritize next?";
  return q.slice(0, 600);
}

async function loadInsightsContext() {
  const [
    users,
    activeUsers7d,
    entries30d,
    sourceMix,
    avgCalories,
    avgScore,
    feedbackTotals,
    campaignSummary
  ] = await Promise.all([
    query(`select count(*)::int as count from user_profiles`),
    query(
      `select count(distinct user_id)::int as count
       from food_entries
       where entry_date >= current_date - 6`
    ),
    query(
      `select count(*)::int as count
       from food_entries
       where entry_date >= current_date - 29`
    ),
    query(
      `select coalesce(raw_extraction->>'source', 'unknown') as source, count(*)::int as count
       from food_entries
       where entry_date >= current_date - 29
       group by 1
       order by 2 desc
       limit 8`
    ),
    query(
      `select round(avg(total_calories))::int as avg_calories
       from daily_summaries
       where entry_date >= current_date - 29`
    ),
    query(
      `select round(avg(score), 1) as avg_score
       from daily_summaries
       where entry_date >= current_date - 29`
    ),
    query(
      `select
          count(*)::int as responses_total,
          count(distinct user_id)::int as unique_responders
       from feedback_responses`
    ),
    query(
      `select id, title, is_active, activated_at, deactivated_at
       from feedback_campaigns
       order by id desc
       limit 3`
    )
  ]);

  const usersTotal = users.rows[0]?.count || 0;
  const active7d = activeUsers7d.rows[0]?.count || 0;
  const entriesLast30d = entries30d.rows[0]?.count || 0;
  const avgEntriesPerActiveUser30d = active7d > 0
    ? Math.round((entriesLast30d / active7d) * 10) / 10
    : 0;

  return {
    users_total: usersTotal,
    active_users_7d: active7d,
    entries_30d: entriesLast30d,
    avg_entries_per_active_user_30d: avgEntriesPerActiveUser30d,
    entry_source_mix_30d: sourceMix.rows,
    avg_daily_calories_30d: avgCalories.rows[0]?.avg_calories ?? null,
    avg_daily_score_30d: avgScore.rows[0]?.avg_score ?? null,
    feedback_responses_total: feedbackTotals.rows[0]?.responses_total || 0,
    feedback_unique_responders: feedbackTotals.rows[0]?.unique_responders || 0,
    recent_feedback_campaigns: campaignSummary.rows
  };
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const question = cleanQuestion(body.question);

  try {
    const context = await loadInsightsContext();

    const response = await responsesCreate({
      model: "gpt-5-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You are a product analytics assistant for a calorie/weight tracker app. Use only the provided metrics. Return concise, practical insights with uncertainty notes when data is thin. Keep output under 250 words with sections: What users mostly do, Key opportunities, Recommended next 3 actions."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Admin question: ${question}\n\nMetrics JSON:\n${JSON.stringify(context, null, 2)}`
            }
          ]
        }
      ]
    });

    const answer = outputText(response) || "No insights generated.";

    return json(200, {
      question,
      insights: answer,
      metrics_used: context
    });
  } catch (e) {
    if (e && e.code === "42P01") {
      return json(400, { error: "Missing analytics tables. Ensure SQL migrations are applied." });
    }
    return json(e.statusCode || 500, { error: e.message || "Could not generate AI insights" });
  }
};
