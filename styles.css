# Calorie & Weight Tracker (Mock Local App)

## What this is

## Mock mode (no auth, local-only)
This build runs entirely in **mock mode**:
- No Netlify Identity login required.
- No backend/database required for core app usage.
- Data is cached in browser session storage (`caloriTrackerMockStateV1`) and resets when the tab/session ends (or via Reset Mock Session).
- Includes a mock landing page before entering onboarding and the full app experience.

A static web app deployed on Netlify using:
- Netlify Identity (email login)
- Netlify Functions (API backend)
- Neon Postgres (DATABASE_URL)
- OpenAI API (OPENAI_API_KEY) for nutrition-label extraction + coaching

No other backend services.

## Setup (Neon)
1. Create a Neon Postgres database.
2. Run the SQL migrations in order in Neon: `sql/001_init.sql`, `sql/002_user_profile_onboarding.sql`, `sql/003_capacity_optimizations.sql`, `sql/004_quick_fills.sql`, `sql/005_admin_feedback.sql`, `sql/006_billing_limits.sql`, `sql/007_admin_goals_and_passes.sql`, `sql/008_growth_billing_upgrades.sql`, `sql/009_reliability_growth.sql`, `sql/010_scheduled_reconcile_alerts.sql`.
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
   - `STRIPE_MONTHLY_PAYMENT_LINK_URL` (optional override for monthly upgrade URL)
   - `STRIPE_YEARLY_PAYMENT_LINK_URL` (optional override for yearly upgrade URL)
   - `STRIPE_SECRET_KEY` (required for Stripe webhook sync and Stripe billing portal)
   - `STRIPE_WEBHOOK_SECRET` (required for `/api/stripe-webhook` signature validation)

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

## Free vs Premium
- **Free tier**: up to 5 food entries/day, 3 AI actions/day, and last 20 days of history.
- **Premium**: monthly ($5) or yearly ($50) Stripe upgrades; includes unlimited food entries, unlimited AI actions, unlimited history, and data export.
- Use `/api/create-checkout-session` with `{ "interval": "monthly" | "yearly" }` for upgrade checkout links.
- Use `/api/stripe-webhook` to automatically keep subscription access in sync while payments stay active.

## Billing / Growth Upgrades
- Admin can now edit free-tier limits and monthly/yearly pricing URLs from `/admin.html`.
- Admin can grant direct premium passes or quick trial passes to specific users.
- Stripe webhooks are logged in `stripe_webhook_events` for observability and churn-risk monitoring.
- Premium users can export JSON or CSV via `/api/export-data?format=json|csv&from=YYYY-MM-DD&to=YYYY-MM-DD`.
- Users can manage billing through `/api/manage-subscription` (Stripe portal when configured).


## Reliability / Conversion instrumentation
- `stripe_webhook_events` enforces unique Stripe event ids for idempotent processing.
- `app_events` tracks in-app conversion events (`upgrade_click`, `manage_subscription_click`, `export_data_click`, `near_limit_warning_shown`).
- Admin can run `/api/admin-reconcile-subscriptions` to repair Stripe subscription state drift.
- Scheduled reconciliation runs hourly via `scheduled-reconcile-subscriptions` and logs runs to `subscription_reconcile_runs`.
- Alert notifications are emitted to `RECON_ALERT_WEBHOOK_URL` (optional) and persisted in `alert_notifications`.
- User-side tracking endpoint: `/api/track-event` (authenticated).

## Quality gates
- `npm run lint:syntax` performs syntax checks across all JS files.
- `npm run test:integration` runs billing integration tests for webhook duplicate handling, payment failure/cancellation transitions, and admin-pass entitlement override.
- CI runs `npm run test` on pushes and pull requests.
