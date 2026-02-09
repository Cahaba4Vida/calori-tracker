const { json } = require("./_util");

function getNetlifyUser(context) {
  try {
    const raw = context?.clientContext?.custom?.netlify;
    if (!raw) return null;
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    // parsed: { identity, user }
    return parsed?.user || null;
  } catch {
    return null;
  }
}

async function requireUser(event, context) {
  // Netlify populates clientContext.user when Authorization: Bearer <token> is valid. citeturn3view0
  const user = getNetlifyUser(context);
  if (!user) {
    return { ok: false, response: json(401, { error: "Unauthorized" }) };
  }
  // Netlify Identity uses "sub" for user id in JWT claims.
  const userId = user.sub || user.id || user.user_id;
  const email = user.email || null;
  if (!userId) return { ok: false, response: json(401, { error: "Unauthorized" }) };
  return { ok: true, user: { userId, email, claims: user } };
}

module.exports = { requireUser };
