const { json } = require("./_util");
const { query } = require("./_db");
const { requireAdminToken } = require("./_admin");

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  try {
    const [
      users,
      foodEntries,
      foodEntriesArchive,
      weights,
      summaries,
      summariesArchive,
      activeUsers7d,
      dbSize,
      feedbackCampaign,
      feedbackResponseCount,
      feedbackRequiredUsers
    ] = await Promise.all([
      query(`select count(*)::int as count from user_profiles`),
      query(`select count(*)::int as count from food_entries`),
      query(`select count(*)::int as count from food_entries_archive`),
      query(`select count(*)::int as count from daily_weights`),
      query(`select count(*)::int as count from daily_summaries`),
      query(`select count(*)::int as count from daily_summaries_archive`),
      query(
        `select count(distinct user_id)::int as count
         from food_entries
         where entry_date >= current_date - 6`
      ),
      query(`select pg_database_size(current_database())::bigint as bytes`),
      query(
        `select id, title, question, is_active, activated_at, deactivated_at
         from feedback_campaigns
         order by id desc
         limit 1`
      ),
      query(
        `select count(*)::int as count
         from feedback_responses`
      ),
      query(`
        with active as (
          select id from feedback_campaigns where is_active = true order by id desc limit 1
        )
        select
          case
            when exists (select 1 from active) then (
              select count(*)::int
              from user_profiles u
              where not exists (
                select 1 from feedback_responses r
                where r.user_id = u.user_id and r.campaign_id = (select id from active)
              )
            )
            else 0
          end as count
      `)
    ]);

    return json(200, {
      users_total: users.rows[0]?.count || 0,
      active_users_7d: activeUsers7d.rows[0]?.count || 0,
      food_entries_hot: foodEntries.rows[0]?.count || 0,
      food_entries_archive: foodEntriesArchive.rows[0]?.count || 0,
      daily_weights: weights.rows[0]?.count || 0,
      daily_summaries_hot: summaries.rows[0]?.count || 0,
      daily_summaries_archive: summariesArchive.rows[0]?.count || 0,
      feedback_responses_total: feedbackResponseCount.rows[0]?.count || 0,
      users_pending_feedback: feedbackRequiredUsers.rows[0]?.count || 0,
      db_size_bytes: Number(dbSize.rows[0]?.bytes || 0),
      latest_feedback_campaign: feedbackCampaign.rows[0] || null
    });
  } catch (e) {
    if (e && e.code === "42P01") {
      return json(400, { error: "Admin feedback/stat tables are missing. Run sql/005_admin_feedback.sql." });
    }
    return json(500, { error: "Could not load admin stats" });
  }
};
