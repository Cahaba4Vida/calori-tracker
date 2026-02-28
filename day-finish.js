const { json, getDenverDateISO } = require("./_util");
const { requireUser } = require("./_auth");
const { query, ensureUserProfile } = require("./_db");
const { enforceAiActionLimit, enforceFoodEntryLimit } = require("./_plan");
const { responsesCreate, outputText } = require("./_openai");

function daysBetweenISO(a, b) {
  const [ay, am, ad] = String(a).split("-").map(Number);
  const [by, bm, bd] = String(b).split("-").map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86400000);
}

function safeNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function clampInt(n, min, max) {
  const x = safeNum(n);
  if (x == null) return null;
  const r = Math.round(x);
  if (r < min) return min;
  if (r > max) return max;
  return r;
}

function clampStr(s, max = 220) {
  if (s == null) return null;
  return String(s).slice(0, max);
}

function isoToDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDaysISO(iso, days) {
  const dt = isoToDate(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function computeRollover(userId, dateISO, baseGoal) {
  // Returns {enabled, cap, delta, effective}
  let enabled = false;
  let cap = 500;
  try {
    const s = await query(
      `select coalesce(rollover_enabled,false) as rollover_enabled,
              coalesce(rollover_cap,500) as rollover_cap
         from user_profiles where user_id=$1`,
      [userId]
    );
    enabled = !!s.rows[0]?.rollover_enabled;
    cap = Number(s.rows[0]?.rollover_cap ?? 500);
  } catch (e) {
    if (!(e && e.code === "42703")) throw e;
    enabled = false;
    cap = 500;
  }

  if (!enabled || !baseGoal) return { enabled, cap, delta: 0, effective: baseGoal };

  const yday = addDaysISO(dateISO, -1);
  const r = await query(
    `select sum(calories)::int as total
       from food_entries
      where user_id=$1 and entry_date=$2`,
    [userId, yday]
  );
  const total = r.rows[0]?.total;
  if (total == null) return { enabled, cap, delta: 0, effective: baseGoal };

  let delta = baseGoal - total;
  const lim = Math.max(0, Math.min(2000, Number(cap) || 500));
  if (delta > lim) delta = lim;
  if (delta < -lim) delta = -lim;
  return { enabled, cap: lim, delta, effective: baseGoal + delta };
}

exports.handler = async (event, context) => {
  const auth = await requireUser(event, context);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.user;
  await ensureUserProfile(userId, email);

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { body = {}; }
  const intent = String(body.intent || "").trim();
  const recentPromptIds = Array.isArray(body.recent_prompt_ids) ? body.recent_prompt_ids.map(x => String(x)).filter(Boolean).slice(-12) : [];
  const message = String(body.message || "").trim();
  if (!message) return json(400, { error: "message is required" });

  const pending = (body.pending_food_log && typeof body.pending_food_log === "object") ? body.pending_food_log : null;
  const pendingOriginal = pending && typeof pending.original_message === "string" ? pending.original_message.trim() : null;
  const pendingDate = pending && /^\d{4}-\d{2}-\d{2}$/.test(String(pending.date || "")) ? String(pending.date) : null;

  const date = body.date || pendingDate || getDenverDateISO(new Date());
  const aiLimit = await enforceAiActionLimit(userId, getDenverDateISO(new Date()), 'chat');
  if (!aiLimit.ok) return aiLimit.response;

  const effectiveMessage = pendingOriginal
    ? `The user previously asked you to LOG FOOD:\n${pendingOriginal}\n\nThey are now answering your follow-up question with details:\n${message}\n\nPlease proceed to log the food now if possible.`
    : message;

  // ---- Pull user context (source of truth = DB) ----

  // Profile / goals / autopilot config
  const pr = await query(
    `select
       email,
       onboarding_completed,
       macro_protein_g,
       macro_carbs_g,
       macro_fat_g,
       goal_weight_lbs,
       goal_date,
       activity_level,
       autopilot_enabled,
       autopilot_mode
     from user_profiles
     where user_id=$1`,
    [userId]
  );
  const p = pr.rows[0] || {};

  // Current calorie goal (+ server-truth rollover, if enabled)
  const goalR = await query("select daily_calories from calorie_goals where user_id=$1", [userId]);
  const baseGoal = goalR.rows[0]?.daily_calories ?? null;
  const roll = await computeRollover(userId, date, baseGoal);
  const goal = roll.effective;

  // Today's entries (requested date)
  const entries = await query(
    `select calories, protein_g, carbs_g, fat_g, taken_at
     from food_entries where user_id=$1 and entry_date=$2
     order by taken_at asc`,
    [userId, date]
  );

  const totalCalories = entries.rows.reduce((s, x) => s + (x.calories || 0), 0);
  const totalProtein = entries.rows.reduce((s, x) => s + (x.protein_g || 0), 0);
  const totalCarbs   = entries.rows.reduce((s, x) => s + (x.carbs_g || 0), 0);
  const totalFat     = entries.rows.reduce((s, x) => s + (x.fat_g || 0), 0);

  // Last 7 days calorie + macro totals (for trend + "all data" chat grounding)
  const from7 = (() => {
    const [y, m, d] = String(date).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 6);
    return dt.toISOString().slice(0, 10);
  })();

  const weekAgg = await query(
    `select
       entry_date::text as entry_date,
       sum(calories)::float8 as calories,
       sum(protein_g)::float8 as protein_g,
       sum(carbs_g)::float8 as carbs_g,
       sum(fat_g)::float8 as fat_g,
       count(*)::int as entries
     from food_entries
     where user_id=$1 and entry_date between $2 and $3
     group by entry_date
     order by entry_date asc`,
    [userId, from7, date]
  );

  let foodDays7 = 0;
  let calSum7 = 0;
  let pSum7 = 0, cSum7 = 0, fSum7 = 0;
  for (const r of weekAgg.rows) {
    const cals = safeNum(r.calories) || 0;
    if (cals > 0) {
      foodDays7 += 1;
      calSum7 += cals;
      pSum7 += safeNum(r.protein_g) || 0;
      cSum7 += safeNum(r.carbs_g) || 0;
      fSum7 += safeNum(r.fat_g) || 0;
    }
  }
  const avgCalories7 = foodDays7 ? Math.round(calSum7 / foodDays7) : null;
  const avgProtein7  = foodDays7 ? Math.round(pSum7 / foodDays7) : null;
  const avgCarbs7    = foodDays7 ? Math.round(cSum7 / foodDays7) : null;
  const avgFat7      = foodDays7 ? Math.round(fSum7 / foodDays7) : null;

  // Weights last 14 days for trend
  const from14 = (() => {
    const [y, m, d] = String(date).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 13);
    return dt.toISOString().slice(0, 10);
  })();

  const wt = await query(
    `select entry_date::text as entry_date, weight_lbs::float8 as weight_lbs
     from daily_weights
     where user_id=$1 and entry_date between $2 and $3
     order by entry_date asc`,
    [userId, from14, date]
  );

  const weights = wt.rows
    .filter(r => r.weight_lbs != null)
    .map(r => ({ entry_date: r.entry_date, weight_lbs: Number(r.weight_lbs) }));

  const latestWeight = weights.length ? weights[weights.length - 1] : null;

  let observedLbsPerWeek14 = null;
  if (weights.length >= 2) {
    const first = weights[0];
    const last = weights[weights.length - 1];
    const spanDays = Math.max(1, daysBetweenISO(first.entry_date, last.entry_date));
    if (spanDays >= 6) {
      observedLbsPerWeek14 = Number((((last.weight_lbs - first.weight_lbs) / spanDays) * 7).toFixed(2));
    }
  }



  // ---- Build model prompt ----
  const contextLines = [];
  contextLines.push(`Date (America/Denver): ${date}`);

  contextLines.push("PROFILE:");
  contextLines.push(`- Activity level: ${p.activity_level || "unknown"}`);
  contextLines.push(`- Goal weight (lbs): ${p.goal_weight_lbs == null ? "not set" : Number(p.goal_weight_lbs)}`);
  contextLines.push(`- Goal date: ${p.goal_date || "not set"}`);
  contextLines.push(`- Autopilot: ${p.autopilot_enabled ? "enabled" : "disabled"} (${p.autopilot_mode || "weight"})`);

  contextLines.push("TARGETS:");
  if (roll.enabled && baseGoal != null) {
    const sign = roll.delta > 0 ? "+" : "";
    contextLines.push(`- Daily calorie goal (effective): ${goal} (base ${baseGoal}, ${sign}${roll.delta} rollover, cap ±${roll.cap})`);
  } else {
    contextLines.push(`- Daily calorie goal: ${baseGoal ?? "not set"}`);
  }
  contextLines.push(`- Macro targets (g/day): P${p.macro_protein_g ?? "?"} C${p.macro_carbs_g ?? "?"} F${p.macro_fat_g ?? "?"}`);

  contextLines.push("RECENT TRENDS:");
  contextLines.push(`- Avg logged calories (last 7 logged days window): ${avgCalories7 ?? "insufficient data"} (${foodDays7} day(s) with food)`);
  contextLines.push(`- Avg logged macros (last 7 logged days window): P${avgProtein7 ?? "?"} C${avgCarbs7 ?? "?"} F${avgFat7 ?? "?"}`);
  contextLines.push(`- Latest weight: ${latestWeight ? `${latestWeight.weight_lbs} lbs on ${latestWeight.entry_date}` : "no weigh-ins"}`);
  contextLines.push(`- Weight trend (approx lbs/week over last ~14d): ${observedLbsPerWeek14 == null ? "insufficient data" : observedLbsPerWeek14}`);

  contextLines.push("TODAY'S LOG:");
  contextLines.push(`- Calories: ${totalCalories}`);
  contextLines.push(`- Macros: P${totalProtein} C${totalCarbs} F${totalFat}`);
  contextLines.push("Food entries (chronological):");
  for (const e of entries.rows) {
    contextLines.push(`- ${e.calories} cal` + (e.protein_g != null ? ` (P${e.protein_g} C${e.carbs_g} F${e.fat_g})` : ""));
  }

// ---- Coach quick prompts (AI-generated) ----
if (intent === "coach_prompts") {
  // Build a few candidate prompt ideas from data to keep suggestions relevant.
  const candidates = [];
  const add = (id, label, query) => {
    if (!id || recentPromptIds.includes(id)) return;
    candidates.push({ id, label, query });
  };

  if ((entries?.rows?.length || 0) === 0) {
    add("log_food_today", "🍽 Log what I ate today", "I haven't logged food yet today. Ask me what I ate and log it.");
  } else {
    add("day_checkin", "📊 How am I doing today?", "Based on today's log so far, how am I doing vs my targets?");
  }

  if (p.macro_protein_g != null && avgProtein7 != null && avgProtein7 < (Number(p.macro_protein_g) * 0.8)) {
    add("protein_boost", "💪 Raise my protein", "My protein has been low lately. Give me 3 easy high-protein meal ideas that fit my calories.");
  } else {
    add("meal_ideas", "🍽 Meal ideas", "Give me 3 meal ideas for my goals (with estimated calories and protein).");
  }

  if (observedLbsPerWeek14 != null && Math.abs(observedLbsPerWeek14) < 0.25 && p.goal_weight_lbs != null) {
    add("plateau", "🧠 Why am I plateauing?", "My weight trend looks flat. What should I change this week?");
  } else {
    add("trend_review", "📉 Review my weight trend", "How is my weight trend looking lately and what should I focus on?");
  }

  add("workout", "🏋 Suggest a workout", "Suggest a workout for me today based on my activity level (include sets/reps or duration).");

  if (p.autopilot_enabled) {
    add("autopilot_check", "🔁 Autopilot check-in", "Should we adjust my calories this week? Explain your reasoning briefly.");
  }

  // Keep at most 6 candidates.
  const candidateLines = candidates.slice(0, 6).map(x => `- ${x.id} | ${x.label} | ${x.query}`).join("\n");

  const systemPrompts = [
    "You are Aethon Coach.",
    "Your task: produce 2 short, personal, non-repetitive quick prompts to help the user get value fast.",
    "You MUST ground any references to their behavior in DATA (no inventions).",
    "You MUST avoid repeating prompt ids listed in RECENT_PROMPT_IDS.",
    "Pick prompts that are MOST relevant based on DATA and the candidate ideas list.",
    "Output ONLY valid JSON with schema:",
    "{\n  \"title\": string,\n  \"prompts\": [\n    {\"id\": string, \"label\": string, \"query\": string}\n  ]\n}",
    "Constraints:",
    "- title: <= 90 chars, friendly, personal.",
    "- prompts length: 2 (exactly).",
    "- label: <= 32 chars, starts with an emoji.",
    "- query: a full sentence user message that, when sent, gets the intended help."
  ].join("\n");

  const prompt = [
    systemPrompts,
    "",
    "RECENT_PROMPT_IDS:",
    recentPromptIds.join(", ") || "(none)",
    "",
    "CANDIDATE_IDEAS:",
    candidateLines || "(none)",
    "",
    "DATA:",
    contextLines.join("\n")
  ].join("\n");

  const resp = await responsesCreate({
    model: "gpt-5.2",
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
  });
  const text = outputText(resp) || "";
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.prompts)) {
    // Safe fallback: deterministic prompts
    const fallback = candidates.slice(0, 2);
    return json(200, { title: "Quick ideas for you:", prompts: fallback });
  }
  const title = String(parsed.title || "Quick ideas for you:").slice(0, 90);
  const prompts = parsed.prompts.slice(0, 2).map(p => ({
    id: clampStr(p.id || "", 60),
    label: clampStr(p.label || "", 60),
    query: clampStr(p.query || "", 220)
  })).filter(p => p.id && p.label && p.query);

  if (prompts.length < 2) {
    const fallback = candidates.slice(0, 2);
    return json(200, { title, prompts: fallback });
  }
  return json(200, { title, prompts });
}

  const system = [
    "You are Aethon Coach: a practical nutrition + training coach.",
    "You MUST ground statements about what the user DID in the provided DATA. Do not invent logs or weigh-ins.",
    "You MAY suggest meals and workouts; clearly label suggestions/estimates as suggestions (not logged facts).",
    "You can ALSO log a food entry IF the user explicitly asks you to log/add/track what they ate.",
    "If asked to log food, you MUST output JSON with action=\"log_food\" and a best-effort estimate of calories and optional macros.",
    "If details are too vague to estimate, output action=\"log_food_followup\" and ask ONE follow-up question.",
    "Otherwise output action=\"none\".",
    "When suggesting meals: aim to fit the user's calorie goal and macro targets if present. Give 2-3 options with estimated calories and protein.",
    "When suggesting workouts: tailor to activity level; give 1-2 options with sets/reps or duration; include a safety note for pain/injury.",
    "Avoid medical claims; general wellness guidance only.",
    "If a key detail is missing (dietary restrictions, equipment, time available), ask ONE clarifying question at the end.",
    "Keep replies action-oriented and reasonably concise (usually 6 bullets max).",
    "Return ONLY valid JSON. No markdown.",
    "JSON schema:",
    "{\n  \"reply\": string,\n  \"action\": \"none\"|\"log_food\"|\"log_food_followup\",\n  \"food_entry\": {\n    \"date\": \"YYYY-MM-DD\"|null,\n    \"calories\": number,\n    \"protein_g\": number|null,\n    \"carbs_g\": number|null,\n    \"fat_g\": number|null,\n    \"notes\": string|null\n  }|null,\n  \"follow_up_question\": string|null\n}"
  ].join("\n");

  const prompt = [
    system,
    "",
    "DATA:",
    contextLines.join("\n"),
    "",
    "USER MESSAGE:",
    effectiveMessage
  ].join("\n");

  const resp = await responsesCreate({
    model: "gpt-5.2",
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }]
  });

  const text = outputText(resp) || "";
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }

  // Fallback: if model didn't return JSON, treat as plain reply.
  if (!parsed || typeof parsed !== "object") {
    const reply = text.trim() || "I couldn't generate a reply.";
    return json(200, { reply });
  }

  let reply = String(parsed.reply || "").trim() || "I can help with that.";
  const action = String(parsed.action || "none").trim();

  if (action === "log_food_followup") {
    const q = String(parsed.follow_up_question || "Can you share portion sizes or what exactly was included?").trim();
    if (!reply.toLowerCase().includes("?")) reply = `${reply}\n\n${q}`;
    return json(200, { reply, pending_food_log: { original_message: pendingOriginal || message, date } });
  }

  if (action === "log_food") {
    const fe = parsed.food_entry || {};
    const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(String(fe.date || "")) ? String(fe.date) : date;

    const foodLimit = await enforceFoodEntryLimit(userId, entryDate);
    if (!foodLimit.ok) return foodLimit.response;

    const calories = clampInt(fe.calories, 1, 3000);
    const protein_g = fe.protein_g == null ? null : clampInt(fe.protein_g, 0, 250);
    const carbs_g   = fe.carbs_g == null ? null : clampInt(fe.carbs_g, 0, 250);
    const fat_g     = fe.fat_g == null ? null : clampInt(fe.fat_g, 0, 250);

    if (calories == null || calories <= 0) {
      return json(400, { error: "Coach could not estimate calories to log." });
    }

    const raw_extraction = {
      source: "coach_chat",
      confidence: "medium",
      estimated: true,
      notes: clampStr(fe.notes || "Logged via coach chat", 180)
    };

    const ins = await query(
      `insert into food_entries(user_id, taken_at, entry_date, calories, protein_g, carbs_g, fat_g, raw_extraction)
       values ($1, now(), $2, $3, $4, $5, $6, $7)
       returning id, taken_at, entry_date, calories, protein_g, carbs_g, fat_g`,
      [userId, entryDate, calories, protein_g, carbs_g, fat_g, raw_extraction]
    );

    const logged = ins.rows[0];
    const macroStr = (logged.protein_g != null || logged.carbs_g != null || logged.fat_g != null)
      ? ` (P${logged.protein_g ?? "?"} C${logged.carbs_g ?? "?"} F${logged.fat_g ?? "?"})`
      : "";

    reply = `${reply}\n\n✅ Logged: ${logged.calories} kcal${macroStr} for ${logged.entry_date}.`;
    return json(200, { reply, logged_entry: logged });
  }

  return json(200, { reply });
};