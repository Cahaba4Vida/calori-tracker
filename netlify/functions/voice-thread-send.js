const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { ensureUserProfile, query } = require("./_db");
const { enforceAiActionLimit, enforceFoodEntryLimit } = require("./_plan");
const { responsesCreate, outputText } = require("./_openai");
const { maybeGrantReferralReward } = require('./_referrals');
const crypto = require("crypto");

const OPENAI_AUDIO_URL = "https://api.openai.com/v1/audio/speech";

const FOOD_MODEL = process.env.OPENAI_FOOD_MODEL || "gpt-4.1";
const FOOD_SEARCH_MODEL = process.env.OPENAI_FOOD_SEARCH_MODEL || FOOD_MODEL;

function countRecentAssistantFoodFollowUps(history) {
  const recent = Array.isArray(history) ? history.slice(-8) : [];
  let count = 0;
  for (const h of recent) {
    if (!h || h.role !== "assistant") continue;
    const t = String(h.text || "").trim().toLowerCase();
    if (!t) continue;
    if (
      t.endsWith("?") ||
      t.includes("how many") ||
      t.includes("what size") ||
      t.includes("which one") ||
      t.includes("what brand") ||
      t.includes("what restaurant") ||
      t.includes("how much") ||
      t.includes("ounces") ||
      t.includes("servings")
    ) {
      count += 1;
    }
  }
  return count;
}

function shouldTrySearchForFood(message, history) {
  const text = String(message || "").trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  const recent = Array.isArray(history) ? history.slice(-6).map(h => String(h.text || "").toLowerCase()).join(" ") : "";

  const brandish =
    /\b(from|at)\s+[a-z]/i.test(text) ||
    /\b(chipotle|starbucks|subway|mcdonald'?s|taco bell|wendy'?s|burger king|chick-fil-a|fairlife|core power|quest|gatorade|powerade|protein bar|protein shake|premier protein|muscle milk|celsius|monster|red bull|panera|costa vida|mo'?betta|cafe rio)\b/i.test(text) ||
    /\b(menu|restaurant|packaged|bottle|can|bar|shake|drink|latte|frappuccino|burrito bowl|sandwich)\b/i.test(text);

  const enoughSpecificity =
    text.split(/\s+/).length >= 3 ||
    /\d/.test(text) ||
    /\b(small|medium|large|venti|grande|tall|oz|ounce|ounces|gram|grams|serving|servings|scoop|scoops)\b/i.test(text);

  // Don't web-search the tiny answer itself if it's clearly just answering a quantity follow-up.
  const looksLikeFollowupAnswerOnly =
    text.split(/\s+/).length <= 4 &&
    !brandish &&
    recent.includes("how many");

  return brandish && enoughSpecificity && !looksLikeFollowupAnswerOnly;
}

async function runFoodExtraction({ prompt, history, message, useSearch = false }) {
  const input = [
    { role: "system", content: prompt },
    ...history.map(h => ({ role: h.role, content: h.text }))
  ];

  const payload = {
    model: useSearch ? FOOD_SEARCH_MODEL : FOOD_MODEL,
    input,
    text: { format: { type: "json_object" } }
  };

  // Optional search-assisted pass for branded / restaurant items.
  if (useSearch) {
    payload.tools = [{ type: "web_search_preview" }];
    payload.tool_choice = "auto";
  }

  const resp = await responsesCreate(payload);
  const raw = outputText(resp);
  return JSON.parse(raw);
}


function hoursBetween(a, b) {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60);
}

async function createVoiceAudio(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text) return null;
  const r = await fetch(OPENAI_AUDIO_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      format: "mp3",
      input: text.slice(0, 800)
    })
  });
  if (!r.ok) return null;
  const arr = await r.arrayBuffer();
  return Buffer.from(arr).toString("base64");
}

async function getThreadForUser(userId, threadId) {
  if (!threadId) return null;
  const r = await query(
    `select id, last_active_at
     from voice_threads
     where id = $1 and user_id = $2
     limit 1`,
    [threadId, userId]
  );
  return r.rows[0] || null;
}

async function getLatestThread(userId) {
  const r = await query(
    `select id, last_active_at
     from voice_threads
     where user_id = $1
     order by last_active_at desc
     limit 1`,
    [userId]
  );
  return r.rows[0] || null;
}

async function createThread(userId) {
  const id = crypto.randomUUID();
  await query(
    `insert into voice_threads(id, user_id, created_at, last_active_at)
     values ($1, $2, now(), now())`,
    [id, userId]
  );
  return id;
}

async function upsertActiveThread(userId, incomingThreadId) {
  const now = new Date();

  const incoming = await getThreadForUser(userId, incomingThreadId);
  if (incoming && incoming.last_active_at) {
    const last = new Date(incoming.last_active_at);
    if (hoursBetween(now, last) <= 4) return incoming.id;
  }

  // try latest thread if incoming is missing/invalid/expired
  const latest = await getLatestThread(userId);
  if (latest && latest.last_active_at) {
    const last = new Date(latest.last_active_at);
    if (hoursBetween(now, last) <= 4) return latest.id;
  }

  return await createThread(userId);
}

async function appendMessage(threadId, role, content) {
  const id = crypto.randomUUID();
  await query(
    `insert into voice_messages(id, thread_id, role, content, created_at)
     values ($1, $2, $3, $4, now())`,
    [id, threadId, role, content]
  );
}

async function loadRecentMessages(threadId, limit) {
  const r = await query(
    `select role, content
     from voice_messages
     where thread_id = $1
     order by created_at desc
     limit $2`,
    [threadId, limit]
  );
  // reverse to chronological
  return r.rows.reverse().map(x => ({ role: x.role, text: x.content }));
}

async function getLastLoggedVoiceEntryToday(userId, entryDate) {
  try {
    const r = await query(
      `select calories, protein_g, carbs_g, fat_g, raw_extraction
       from food_entries
       where user_id = $1 and entry_date = $2
         and (raw_extraction->>'source') = 'voice'
       order by taken_at desc
       limit 1`,
      [userId, entryDate]
    );
    if (!r.rows || !r.rows[0]) return null;
    const row = r.rows[0];
    const notes = row.raw_extraction && typeof row.raw_extraction === "object"
      ? String(row.raw_extraction.notes || "").trim()
      : "";
    return {
      calories: row.calories ?? null,
      protein_g: row.protein_g ?? null,
      carbs_g: row.carbs_g ?? null,
      fat_g: row.fat_g ?? null,
      notes: notes || null
    };
  } catch {
    return null;
  }
}


function deriveVoiceFoodLabel(message, se) {
  const candidates = [
    se && se.description,
    se && se.name,
    se && se.food_name,
    se && se.product_name,
    se && se.item,
    se && se.notes
  ].map(v => String(v || "").trim()).filter(Boolean);

  for (const c of candidates) {
    const lc = c.toLowerCase();
    if (lc && !["plate estimate", "meal", "food entry", "estimate", "snack", "drink"].includes(lc)) {
      return c.slice(0, 60);
    }
  }

  const raw = String(message || "").trim()
    .replace(/^(log|add|track|record)\s+/i, "")
    .replace(/^(i\s+(had|ate|drank)\s+)/i, "")
    .replace(/^(for\s+(breakfast|lunch|dinner|snack)\s*[,:-]?\s*)/i, "")
    .replace(/^(it\s+was\s+)/i, "")
    .replace(/[.?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return "Food entry";

  const clipped = raw.length > 60 ? raw.slice(0, 60).trim() : raw;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}


exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;

  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  const today = getDenverDateISO(new Date());
  const aiLimit = await enforceAiActionLimit(userId, today, "voice_thread_send");
  if (!aiLimit.ok) return aiLimit.response;

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }

  const message = String(body.message || "").trim();
  if (!message) return json(400, { error: "message is required" });

  const threadId = await upsertActiveThread(userId, String(body.thread_id || "").trim() || null);

  // persist user message
  await appendMessage(threadId, "user", message);

  const history = await loadRecentMessages(threadId, 20);

  // Help the model avoid re-logging prior items when the user restates them.
  const lastLogged = await getLastLoggedVoiceEntryToday(userId, today);
  const lastLoggedSummary = lastLogged
    ? `Recent logged entry today for context only (do NOT suppress intentional re-logs): ${JSON.stringify(lastLogged)}`
    : "Recent logged entry today for context only (do NOT suppress intentional re-logs): none";

  const followUpCount = countRecentAssistantFoodFollowUps(history);
  const allowMoreFollowUps = followUpCount < 2;

  const prompt = `You help users log food from voice descriptions.
Return ONLY JSON with this exact shape:
{
  "reply": "short conversational response",
  "needs_follow_up": boolean,
  "suggested_entry": {
    "calories": number|null,
    "protein_g": number|null,
    "carbs_g": number|null,
    "fat_g": number|null,
    "description": "short label",
    "notes": "brief assumptions or lookup basis"
  }|null
}

Context:
${lastLoggedSummary}
recent_follow_up_questions_asked=${followUpCount}

Rules:
- Main goal: accurately log the user's food with as little friction as possible.
- Ask a follow-up ONLY when the estimate would otherwise be too vague to trust.
- You may ask up to TWO follow-up questions total across this thread. If recent_follow_up_questions_asked >= 2, do NOT ask another follow-up; give your best estimate instead.
- Good reasons to ask a follow-up: unknown quantity, unknown size, unknown restaurant item choice, unknown brand when brand changes calories materially.
- Bad reasons to ask a follow-up: tiny uncertainty that does not materially change the estimate.
- If the food is branded, restaurant-specific, or packaged and the user gave enough specifics, use the available search/tooling if present to improve accuracy instead of guessing.
- VERY IMPORTANT: Do NOT suppress a food just because it appears similar to something logged earlier today or earlier in this conversation.
- Users often intentionally log the same item multiple times in a day. If the user clearly says they had, drank, logged, or want to add the item again, treat it as a NEW entry and include it in suggested_entry.
- If the user says another one, same as before, one more, or had it again, use the recent logged entry as context to create a new entry rather than rejecting it as already logged.
- Only avoid logging when the user explicitly says they are correcting, replacing, undoing, or referring to a previous entry without consuming it again.
- Keep reply <= 2 sentences.
- Follow-up questions should be short and highly specific.
- suggested_entry.description should be the ACTUAL food/item name the user ate or drank, not a generic label.
- Good examples: "Core Power Elite chocolate protein shake", "2 scrambled eggs", "Turkey sandwich".
- Bad examples: "Plate estimate", "Meal", "Food entry", "Estimate".
- suggested_entry.description should be <= 60 chars.
- If the item is branded or specific, preserve the specific name the user said.
- If unsure, use the closest real food name from the user message, never a generic placeholder.
- notes should be brief: brand / size / assumptions / search basis.
- Prefer being approximately right over confidently specific when evidence is weak.`;

  let data;
  try {
    const useSearch = shouldTrySearchForFood(message, history);
    data = await runFoodExtraction({ prompt, history, message, useSearch });
  } catch (e) {
    try {
      // Graceful fallback if the search tool/model is unavailable in this OpenAI project.
      data = await runFoodExtraction({ prompt, history, message, useSearch: false });
    } catch {
      return json(502, { error: "Model did not return valid JSON" });
    }
  }

  if (!allowMoreFollowUps && data && data.needs_follow_up) {
    data.needs_follow_up = false;
  }

  let logged_entry = null;
  const se = data && data.suggested_entry;

  const shouldLog =
    !data.needs_follow_up &&
    se &&
    Number.isFinite(Number(se.calories)) &&
    Number(se.calories) > 0;

  if (shouldLog) {
    const entry_date = getDenverDateISO(new Date());

    const limit = await enforceFoodEntryLimit(userId, entry_date);
    if (!limit.ok) return limit.response;

    const derived_label = deriveVoiceFoodLabel(message, se);

    const raw_extraction = {
      source: "voice",
      confidence: "low",
      estimated: true,
      description: derived_label,
      food_name: derived_label,
      item: derived_label,
      notes: String((se && (se.notes || se.description)) || derived_label).slice(0, 180),
      raw_user_message: String(message || "").slice(0, 180)
    };

    const ins = await query(
      `insert into food_entries(user_id, taken_at, entry_date, calories, protein_g, carbs_g, fat_g, raw_extraction)
       values ($1, now(), $2, $3, $4, $5, $6, $7)
       returning id, taken_at, entry_date, calories, protein_g, carbs_g, fat_g, raw_extraction`,
      [
        userId,
        entry_date,
        Math.round(Number(se.calories)),
        se.protein_g == null ? null : Math.round(Number(se.protein_g)),
        se.carbs_g == null ? null : Math.round(Number(se.carbs_g)),
        se.fat_g == null ? null : Math.round(Number(se.fat_g)),
        raw_extraction
      ]
    );

    logged_entry = ins.rows && ins.rows[0] ? ins.rows[0] : null;
    if (logged_entry && logged_entry.raw_extraction && typeof logged_entry.raw_extraction === 'object') {
      logged_entry.raw_extraction.description = logged_entry.raw_extraction.description || derived_label;
      logged_entry.raw_extraction.food_name = logged_entry.raw_extraction.food_name || derived_label;
      logged_entry.raw_extraction.item = logged_entry.raw_extraction.item || derived_label;
      logged_entry.raw_extraction.notes = logged_entry.raw_extraction.notes || derived_label;
    }

    // Referral reward: only for signed-in users.
    try {
      if (auth.user?.identity_type === 'user') {
        await maybeGrantReferralReward(userId);
      }
    } catch (e) {
      // Non-blocking.
    }
  }
  const reply = String(data.reply || "").trim();
  if (reply) await appendMessage(threadId, "assistant", reply);

  // keep thread active
  await query(`update voice_threads set last_active_at = now() where id = $1`, [threadId]);

  const audio_base64 = await createVoiceAudio(reply);

  return json(200, {
    thread_id: threadId,
    reply,
    needs_follow_up: !!data.needs_follow_up,
    suggested_entry: data.suggested_entry ? { ...data.suggested_entry, notes: data.suggested_entry.notes || data.suggested_entry.description || '' } : null,
    logged_entry,
    audio_base64,
    audio_mime_type: audio_base64 ? "audio/mpeg" : null
  });
};
