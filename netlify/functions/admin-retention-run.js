const { json } = require("./_util");
const { query } = require("./_db");

function parseDays(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(3650, Math.round(n)));
}

function parseMaxDbSizeGb(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0.1, Math.min(32, n));
}

async function getDatabaseSizeBytes() {
  const res = await query(`select pg_database_size(current_database())::bigint as bytes`);
  return Number(res.rows[0]?.bytes || 0);
}

async function trimOldestRows(tableName, orderBySql, limit) {
  return query(
    `delete from ${tableName}
     where ctid in (
       select ctid
       from ${tableName}
       order by ${orderBySql}
       limit $1
     )`,
    [limit]
  );
}

exports.handler = async (event) => {
  const headers = event.headers || {};
  const isScheduledRun = (headers["x-netlify-event"] || "") === "schedule";
  const token = process.env.RETENTION_ADMIN_TOKEN;
  const sent = headers["x-admin-token"] || headers["X-Admin-Token"];
  if (!isScheduledRun && (!token || sent !== token)) return json(401, { error: "Unauthorized" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const keepDays = parseDays(body.keep_days ?? process.env.HOT_STORAGE_KEEP_DAYS, 90);
  const keepSummaryDays = parseDays(body.keep_summary_days ?? process.env.SUMMARY_KEEP_DAYS, keepDays);
  const maxDbSizeGb = parseMaxDbSizeGb(body.max_db_size_gb ?? process.env.MAX_DB_SIZE_GB, 0.49);
  const maxDbSizeBytes = Math.round(maxDbSizeGb * 1024 * 1024 * 1024);

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

  const trimBatchSize = parseDays(body.trim_batch_size, 1000);
  const trimPassLimit = parseDays(body.trim_pass_limit, 20);

  let currentSizeBytes = await getDatabaseSizeBytes();
  const initialSizeBytes = currentSizeBytes;
  let trims = {
    archive_food_entries_deleted: 0,
    archive_daily_summaries_deleted: 0,
    hot_food_entries_deleted: 0,
    hot_daily_summaries_deleted: 0
  };

  for (let pass = 0; pass < trimPassLimit && currentSizeBytes > maxDbSizeBytes; pass += 1) {
    const trimArchiveFood = await trimOldestRows(
      "food_entries_archive",
      "archived_at asc, entry_date asc, id asc",
      trimBatchSize
    );
    trims.archive_food_entries_deleted += trimArchiveFood.rowCount;

    const trimArchiveSummaries = await trimOldestRows(
      "daily_summaries_archive",
      "archived_at asc, entry_date asc, user_id asc",
      trimBatchSize
    );
    trims.archive_daily_summaries_deleted += trimArchiveSummaries.rowCount;

    if (trimArchiveFood.rowCount === 0 && trimArchiveSummaries.rowCount === 0) {
      const trimHotFood = await trimOldestRows(
        "food_entries",
        "entry_date asc, created_at asc, id asc",
        trimBatchSize
      );
      trims.hot_food_entries_deleted += trimHotFood.rowCount;

      const trimHotSummaries = await trimOldestRows(
        "daily_summaries",
        "entry_date asc, created_at asc, user_id asc",
        trimBatchSize
      );
      trims.hot_daily_summaries_deleted += trimHotSummaries.rowCount;

      if (trimHotFood.rowCount === 0 && trimHotSummaries.rowCount === 0) break;
    }

    currentSizeBytes = await getDatabaseSizeBytes();
  }

  return json(200, {
    keep_days: keepDays,
    keep_summary_days: keepSummaryDays,
    max_db_size_gb: maxDbSizeGb,
    db_size_bytes_before_trim: initialSizeBytes,
    db_size_bytes_after_trim: currentSizeBytes,
    db_size_within_limit: currentSizeBytes <= maxDbSizeBytes,
    archived_food_entries: archiveEntries.rowCount,
    archived_daily_summaries: archiveSummaries.rowCount,
    ...trims
  });
};


exports.config = {
  schedule: "@hourly"
};
