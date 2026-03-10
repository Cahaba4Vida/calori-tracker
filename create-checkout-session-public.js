const { json } = require("./_util");
const { requireUser } = require("./_auth");
const { ensureUserProfile } = require("./_db");

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;

  await ensureUserProfile(auth.user.userId, auth.user.email);
  return json(200, { user_id: auth.user.userId, email: auth.user.email });
};
