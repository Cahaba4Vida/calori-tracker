# Calorie & Weight Tracker (Netlify + Neon + Netlify Identity)

## What this is
A static web app deployed on Netlify using:
- Netlify Identity (email login)
- Netlify Functions (API backend)
- Neon Postgres (DATABASE_URL)
- OpenAI API (OPENAI_API_KEY) for nutrition-label extraction + coaching

No other backend services.

## Setup (Neon)
1. Create a Neon Postgres database.
2. Run the SQL migrations in order in Neon: `sql/001_init.sql`, `sql/002_user_profile_onboarding.sql`, `sql/003_capacity_optimizations.sql`, `sql/004_quick_fills.sql`, `sql/005_admin_feedback.sql`.
3. Copy the connection string into Netlify env var `DATABASE_URL` (use pooled connection if available).

## Setup (Netlify)
1. Deploy this repo to Netlify.
2. Enable **Identity** in Netlify UI (Project configuration → Identity).
   - Enable email signups (and confirm emails if desired).
3. Set env vars (Project configuration → Environment variables):
   - `DATABASE_URL`
   - `OPENAI_API_KEY`
   - `PERSIST_DAILY_SUMMARIES` (`true` to store daily summaries, default is not persisted)
   - `RETENTION_ADMIN_TOKEN` (required for running retention endpoint)
   - `HOT_STORAGE_KEEP_DAYS` (optional, default `90`)
   - `SUMMARY_KEEP_DAYS` (optional, default uses `HOT_STORAGE_KEEP_DAYS`)
   - `MAX_DB_SIZE_GB` (optional, default `0.49`; auto-trims oldest archive/history when DB grows beyond this)
   - `ADMIN_DASH_TOKEN` (required for `/admin.html` and admin functions)

## Local dev
Netlify Identity context is not always present in local `netlify dev`. Test auth-dependent functions on a deployed preview/site.

## Notes
- The server computes the “day” using America/Denver for consistency.
- The app does not store images—photos are sent to the function for extraction and discarded.
- `raw_extraction` is intentionally compact (`source`, `confidence`, `estimated`, short `notes`) to reduce storage overhead.
- Retention/cold storage: run `/.netlify/functions/admin-retention-run` with header `x-admin-token: <RETENTION_ADMIN_TOKEN>` to archive + delete old rows from hot tables.
- Auto-retention now runs hourly (Netlify Scheduled Function) and enforces a DB-size ceiling (default `0.49 GB`) by trimming oldest rows first from archive tables, then hot tables only if still needed.
- Admin dashboard: open `/admin.html`, enter `ADMIN_DASH_TOKEN`, view user/app stats, and generate AI insights from current usage metrics.
- Mandatory feedback broadcast: from `/admin.html` you can activate a feedback form; logged-in users must submit it before continuing to use the app.

## New in v1.1
- Edit/delete food entries
- Weekly charts (last 7 days) for calories (bars) and weight (line)
