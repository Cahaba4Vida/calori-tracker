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
2. Run the SQL migration in `sql/001_init.sql` in Neon.
3. Copy the connection string into Netlify env var `DATABASE_URL` (use pooled connection if available).

## Setup (Netlify)
1. Deploy this repo to Netlify.
2. Enable **Identity** in Netlify UI (Project configuration → Identity).
   - Enable email signups (and confirm emails if desired).
3. Set env vars (Project configuration → Environment variables):
   - `DATABASE_URL`
   - `OPENAI_API_KEY`

## Local dev
Netlify Identity context is not always present in local `netlify dev`. Test auth-dependent functions on a deployed preview/site.

## Notes
- The server computes the “day” using America/Denver for consistency.
- The app does not store images—photos are sent to the function for extraction and discarded.

## New in v1.1
- Edit/delete food entries
- Weekly charts (last 7 days) for calories (bars) and weight (line)
