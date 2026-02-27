const crypto = require('crypto');
const { json } = require('./_util');
const { query } = require('./_db');
const { requireAdminToken } = require('./_admin');
const { sha256Hex, ensureAmbassadorsTables } = require('./_ambassadorAuth');

function newToken() {

  return crypto.randomBytes(24).toString('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod && event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const admin = requireAdminToken(event);
  if (!admin.ok) return admin.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const email = String(body.email || '').trim().toLowerCase();
  const name = body.name == null ? null : String(body.name).slice(0, 120);
  const notes = body.notes == null ? null : String(body.notes).slice(0, 300);
  const monthly = Number(body.monthly_price_cents || 0);
  const yearly = Number(body.yearly_price_cents || 0);
  const currency = String(body.currency || 'usd').trim().toLowerCase();

  if (!email) return json(400, { error: 'email is required' });
  if (!Number.isFinite(monthly) || monthly <= 0) return json(400, { error: 'monthly_price_cents must be > 0' });
  if (!Number.isFinite(yearly) || yearly <= 0) return json(400, { error: 'yearly_price_cents must be > 0' });

  try {
    await ensureAmbassadorsTables();
    const existing = await query(`select email from admin_ambassadors where lower(email)=lower($1) limit 1`, [email]);
    let token = null;
    if (!existing.rows[0]) {
      token = newToken();
      await query(
        `insert into admin_ambassadors(email, referral_code, name, notes, token_hash, monthly_price_cents, yearly_price_cents, currency)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [email, newRefCode(), name, notes, sha256Hex(token), Math.round(monthly), Math.round(yearly), currency || 'usd']
      );
    } else {
      await query(
        `update admin_ambassadors
         set name=$2,
             notes=$3,
             monthly_price_cents=$4,
             yearly_price_cents=$5,
             currency=$6,
             updated_at=now()
         where lower(email)=lower($1)`,
        [email, name, notes, Math.round(monthly), Math.round(yearly), currency || 'usd']
      );
    }

    // Ensure existing ambassadors have a referral_code for attribution links.
    try {
      const rc = await query(`select referral_code from admin_ambassadors where lower(email)=lower($1) limit 1`, [email]);
      if (!rc.rows[0]?.referral_code) {
        await query(`update admin_ambassadors set referral_code=$2, updated_at=now() where lower(email)=lower($1)`, [email, newRefCode()]);
      }
    } catch (e) {}

    return json(200, { ok: true, email, token });
  } catch (e) {
    return json(500, { error: 'Could not upsert ambassador' });
  }
};
