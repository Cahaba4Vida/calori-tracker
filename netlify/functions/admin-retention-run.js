const { json } = require("./_util");
const { query } = require("./_db");

function parseDays(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(3650, Math.round(n)));
}

exports.handler = async (event) => {
  const token = process.env.RETENTION_ADMIN_TOKEN;
  const sent = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
  if (!token || sent !== token) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const keepDays = parseDays(body.keep_days ?? process.env.HOT_STORAGE_KEEP_DAYS, 90);
  const keepSummaryDays = parseDays(body.keep_summary_days ?? process.env.SUMMARY_KEEP_DAYS, keepDays);

  const archiveEntries = await query(
    `with moved as (
      insert into food_entries_archive(id, user_id, taken_at, entry_date, calories, protein_g, carbs_g, fat_g, raw_extraction, created_at, archived_at)
      select id, user_id, taken_at, entry_date, calories, protein_g, carbs_g, fat_g, raw_extraction, created_at, now()
      from food_entries
      where entry_date < (current_date - $1::int)
      on conflict (id) do nothing
      returning id
    )
    delete from food_entries f
    where exists (select 1 from moved m where m.id=f.id)
    returning f.id`,
    [keepDays]
  );

  const archiveSummaries = await query(
    `with moved as (
      insert into daily_summaries_archive(user_id, entry_date, total_calories, goal_calories, score, tips, created_at, archived_at)
      select user_id, entry_date, total_calories, goal_calories, score, tips, created_at, now()
      from daily_summaries
      where entry_date < (current_date - $1::int)
      on conflict (user_id, entry_date) do nothing
      returning user_id, entry_date
    )
    delete from daily_summaries d
    where exists (
      select 1 from moved m where m.user_id=d.user_id and m.entry_date=d.entry_date
    )
    returning d.user_id, d.entry_date`,
    [keepSummaryDays]
  );

  return json(200, {
    keep_days: keepDays,
    keep_summary_days: keepSummaryDays,
    archived_food_entries: archiveEntries.rowCount,
    archived_daily_summaries: archiveSummaries.rowCount
  });
};
