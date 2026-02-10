console.log("APP_VERSION v11");
let currentUser = null;

let weightUnit = (localStorage.getItem('weightUnit') || 'lbs'); // 'lbs' or 'kg'
let darkModeEnabled = localStorage.getItem('darkMode') === 'true';
let appFontSizePct = Number(localStorage.getItem('appFontSizePct') || '100');

function lbsToKg(lbs) { return lbs / 2.2046226218; }
function kgToLbs(kg) { return kg * 2.2046226218; }

function displayWeight(lbs) {
  if (lbs == null) return null;
  return weightUnit === 'kg' ? Math.round(lbsToKg(lbs) * 10) / 10 : Math.round(lbs * 10) / 10;
}

function inputToLbs(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return NaN;
  return weightUnit === 'kg' ? kgToLbs(n) : n;
}

function unitSuffix() { return weightUnit === 'kg' ? 'kg' : 'lbs'; }

let profileState = {
  onboarding_completed: false,
  macro_protein_g: null,
  macro_carbs_g: null,
  macro_fat_g: null,
  goal_weight_lbs: null,
  activity_level: null,
  goal_date: null,
  quick_fills: []
};
let aiGoalFlowMode = null;
let aiGoalSuggestion = null;

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function fmtGoal(v) {
  return v == null ? '—' : String(v);
}

function macroPct(total, goal) {
  if (!Number.isFinite(goal) || goal <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((total / goal) * 100)));
}


const el = (id) => document.getElementById(id);

function setStatus(msg) { el('status').innerText = msg || ''; }
function setThinking(isThinking) {
  const thinking = el('aiThinking');
  if (!thinking) return;
  thinking.classList.toggle('hidden', !isThinking);
}
function showApp(isAuthed) { el('app').classList.toggle('hidden', !isAuthed); el('tabs').classList.toggle('hidden', !isAuthed); }

function applyDarkModeUI() {
  document.body.classList.toggle('invertedTheme', darkModeEnabled);
  const darkModeLabel = el('darkModeLabel');
  if (darkModeLabel) darkModeLabel.innerText = darkModeEnabled ? 'On' : 'Off';
}

function clampFontSizePct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 100;
  return Math.max(85, Math.min(125, Math.round(n / 5) * 5));
}

function applyFontSizeUI() {
  appFontSizePct = clampFontSizePct(appFontSizePct);
  document.documentElement.style.fontSize = `${appFontSizePct}%`;
  const label = el('fontSizeLabel');
  if (label) label.innerText = `${appFontSizePct}%`;
  const slider = el('fontSizeRange');
  if (slider) slider.value = String(appFontSizePct);
}

function toggleSection(bodyId, buttonId, collapseText = 'Collapse', expandText = 'Expand') {
  const body = el(bodyId);
  const btn = el(buttonId);
  if (!body || !btn) return;
  const willCollapse = !body.classList.contains('hidden');
  body.classList.toggle('hidden', willCollapse);
  btn.innerText = willCollapse ? expandText : collapseText;
  btn.setAttribute('aria-expanded', willCollapse ? 'false' : 'true');
}
function setOnboardingVisible(visible) {
  const overlay = el('onboardingOverlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !visible);
}

function showOnboardingScreen(which) {
  el('onboardingWelcomeScreen').classList.toggle('hidden', which !== 'welcome');
  el('onboardingInputScreen').classList.toggle('hidden', which !== 'inputs');
  el('onboardingSuggestScreen').classList.toggle('hidden', which !== 'suggestion');
  const step = which === 'welcome' ? '1' : (which === 'inputs' ? '2' : '3');
  const stepEl = el('onboardingStepNum');
  if (stepEl) stepEl.innerText = step;
}

function setAiGoalLoading(isLoading) {
  const btn = el('aiGetPlanBtn');
  const loading = el('aiGoalLoading');
  if (btn) {
    btn.disabled = isLoading;
    btn.innerText = isLoading ? 'Generating…' : 'Get AI Plan';
  }
  if (loading) loading.classList.toggle('hidden', !isLoading);
}

function clearAiInputErrors() {
  ['aiCurrentWeightError','aiGoalWeightError','aiGoalDateError'].forEach((id) => {
    const n = el(id);
    if (n) n.innerText = '';
  });
}

function validateAiGoalFields() {
  clearAiInputErrors();
  const current = Number(el('aiCurrentWeightInput').value);
  const goalWeightInput = Number(el('aiGoalWeightInput').value);
  const goalDate = el('aiGoalDateInput').value;
  const currentLbs = weightUnit === 'kg' ? kgToLbs(current) : current;
  const goalLbs = weightUnit === 'kg' ? kgToLbs(goalWeightInput) : goalWeightInput;

  let ok = true;
  if (!Number.isFinite(currentLbs) || currentLbs <= 0) {
    el('aiCurrentWeightError').innerText = 'Enter a valid current weight greater than 0.';
    ok = false;
  }
  if (!Number.isFinite(goalLbs) || goalLbs <= 0) {
    el('aiGoalWeightError').innerText = 'Enter a valid goal weight greater than 0.';
    ok = false;
  }
  if (!goalDate || goalDate <= isoToday()) {
    el('aiGoalDateError').innerText = 'Date must be after today.';
    ok = false;
  }
  return { ok, currentLbs, goalLbs, goalDate };
}

function renderAiPlanSummary() {
  const cals = el('todayGoal')?.innerText;
  const calories = (cals && cals !== '—') ? cals : 'Not set';
  el('aiPlanSummaryCalories').innerText = calories === 'Not set' ? calories : `${calories} cal/day`;

  const p = profileState.macro_protein_g;
  const c = profileState.macro_carbs_g;
  const f = profileState.macro_fat_g;
  const macroBits = [];
  if (p != null) macroBits.push(`Protein ${p}g`);
  if (c != null) macroBits.push(`Carbs ${c}g`);
  if (f != null) macroBits.push(`Fat ${f}g`);
  el('aiPlanSummaryMacros').innerText = `Macros: ${macroBits.length ? macroBits.join(' • ') : '—'}`;

  el('aiPlanSummaryMeta').innerText = `Goal date: ${profileState.goal_date || '—'} • Activity: ${profileState.activity_level || '—'}`;
}

function resetAiGoalFlowForm() {
  el('aiCurrentWeightInput').value = '';
  el('aiGoalWeightInput').value = '';
  el('aiActivityLevelInput').value = 'moderate';
  el('aiGoalDateInput').value = '';
  el('aiGoalFlowError').innerText = '';
  el('aiSuggestionError').innerText = '';
  el('aiDeclineHint').innerText = '';
  el('aiRationaleList').innerHTML = '';
  clearAiInputErrors();
  setAiGoalLoading(false);
  aiGoalSuggestion = null;
}

async function loadProfile() {
  const p = await api('profile-get');
  profileState = { ...profileState, ...p, quick_fills: Array.isArray(p.quick_fills) ? p.quick_fills : [] };
  renderQuickFillButtons();
  renderQuickFillSettings();
  return p;
}


function authHeaders() {
  if (!currentUser) return {};
  return { Authorization: 'Bearer ' + currentUser.token.access_token };
}

async function api(path, opts = {}) {
  const r = await fetch('/api/' + path, {
    ...opts,
    headers: { ...(opts.headers || {}), ...authHeaders() }
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!r.ok) {
    const msg = (body && (body.error || body.message)) ? (body.error || body.message) : ('Request failed: ' + r.status);
    throw new Error(msg);
  }
  return body;
}


let pendingExtraction = null;
let pendingPlateEstimate = null;


function openSheet() {
  el('sheetError').innerText = '';
  el('sheetOverlay').classList.remove('hidden');
  el('servingsSheet').classList.remove('hidden');
}

function closeSheet() {
  el('sheetOverlay').classList.add('hidden');
  el('servingsSheet').classList.add('hidden');
  pendingExtraction = null;
}

function openEstimateSheet() {
  el('estimateError').innerText = '';
  el('estimateOverlay').classList.remove('hidden');
  el('plateEstimateSheet').classList.remove('hidden');

  // Bind handlers after the estimate sheet is rendered/visible.
  const overlay = el('estimateOverlay');
  const closeBtn = el('estimateCloseBtn');
  const cancelBtn = el('estimateCancelBtn');
  const saveBtn = el('estimateSaveBtn');

  if (overlay) {
    overlay.onclick = () => closeEstimateSheet();
  }
  if (closeBtn) {
    closeBtn.onclick = () => closeEstimateSheet();
  }
  if (cancelBtn) {
    cancelBtn.onclick = () => closeEstimateSheet();
  }
  if (saveBtn) {
    saveBtn.onclick = () => savePlateEstimateFromSheet();
  }
}
function closeEstimateSheet() {
  el('estimateOverlay').classList.add('hidden');
  el('plateEstimateSheet').classList.add('hidden');
  el('estimateOverlay').onclick = null;
  pendingPlateEstimate = null;
}
function setBadge(conf) {
  const b = el('estimateBadge');
  b.innerText = conf;
  b.classList.remove('high','medium','low');
  if (conf === 'high') b.classList.add('high');
  else if (conf === 'medium') b.classList.add('medium');
  else b.classList.add('low');
}

async function savePlateEstimateFromSheet() {
  const saveBtn = el('estimateSaveBtn');
  const prevText = saveBtn ? saveBtn.innerText : '';
  try {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerText = 'Saving...';
    }
    el('estimateError').innerText = '';
    if (!pendingPlateEstimate) throw new Error('No estimate available.');

    const servings = Number(el('estimateServingsInput').value);
    if (!isFinite(servings) || servings <= 0) throw new Error('Servings eaten must be > 0.');

    const calories = Number(el('estimateCaloriesInput').value);
    if (!isFinite(calories) || calories <= 0) throw new Error('Calories must be > 0.');

    const protein_g = el('estimateProteinInput').value === '' ? null : Number(el('estimateProteinInput').value);
    const carbs_g = el('estimateCarbsInput').value === '' ? null : Number(el('estimateCarbsInput').value);
    const fat_g = el('estimateFatInput').value === '' ? null : Number(el('estimateFatInput').value);

    const meta = {
      confidence: pendingPlateEstimate.confidence,
      assumptions: pendingPlateEstimate.assumptions || [],
      portion_hint: pendingPlateEstimate.portion_hint || null,
      servings_eaten: servings,
      notes: pendingPlateEstimate.notes || null
    };

    setStatus('Saving entry…');
    await api('entries-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calories,
        protein_g,
        carbs_g,
        fat_g,
        raw_extraction_meta: meta
      })
    });
    setStatus('');
    closeEstimateSheet();
    await refresh();
  } catch (e) {
    setStatus('');
    try { el('estimateError').innerText = e.message; } catch {}
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerText = prevText || 'Save Entry'; }
  }
}

function computeTotalsPreview() {
  const servings = Number(el('servingsEatenInput').value);
  const cal = Number(el('calPerServingInput').value);
  const prot = el('proteinPerServingInput').value === '' ? null : Number(el('proteinPerServingInput').value);

  if (!isFinite(servings) || servings <= 0 || !isFinite(cal) || cal < 0) {
    el('totalCaloriesComputed').innerText = '—';
  } else {
    el('totalCaloriesComputed').innerText = String(Math.round(cal * servings));
  }

  if (prot == null || !isFinite(servings) || servings <= 0 || !isFinite(prot) || prot < 0) {
    el('totalProteinComputed').innerText = '—';
  } else {
    el('totalProteinComputed').innerText = String(Math.round(prot * servings));
  }
}

async function saveFromSheet() {
  try {
    el('sheetError').innerText = '';
    const servings_eaten = Number(el('servingsEatenInput').value);
    const calories_per_serving = Number(el('calPerServingInput').value);
    const protein_g_per_serving = el('proteinPerServingInput').value === '' ? null : Number(el('proteinPerServingInput').value);

    if (!pendingExtraction) throw new Error('No extracted data.');
    if (!isFinite(servings_eaten) || servings_eaten <= 0) throw new Error('Servings eaten must be > 0.');
    if (!isFinite(calories_per_serving) || calories_per_serving < 0) throw new Error('Calories per serving must be >= 0.');
    if (protein_g_per_serving != null && (!isFinite(protein_g_per_serving) || protein_g_per_serving < 0)) throw new Error('Protein per serving must be >= 0.');

    setStatus('Saving entry…');
    await api('entries-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        servings_eaten,
        calories_per_serving,
        protein_g_per_serving,
        carbs_g_per_serving: pendingExtraction.carbs_g_per_serving ?? null,
        fat_g_per_serving: pendingExtraction.fat_g_per_serving ?? null,
        serving_size: pendingExtraction.serving_size ?? null,
        servings_per_container: pendingExtraction.servings_per_container ?? null,
        notes: pendingExtraction.notes ?? null,
        extracted: pendingExtraction
      })
    });
    setStatus('');
    closeSheet();
    await refresh();
  } catch (e) {
    setStatus('');
    el('sheetError').innerText = e.message;
  }
}


function pct(n, d) {
  if (!d || d <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((n / d) * 100)));
}


function drawBarChart(canvasId, labels, values) {
  const c = el(canvasId);
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0,0,W,H);

  const padL = 40, padR = 10, padT = 10, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxV = Math.max(1, ...values);
  // axes
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + innerH);
  ctx.lineTo(padL + innerW, padT + innerH);
  ctx.stroke();

  const n = values.length;
  const gap = 6;
  const barW = Math.max(2, Math.floor((innerW - gap*(n-1)) / n));

  for (let i=0;i<n;i++) {
    const v = values[i];
    const h = Math.round((v / maxV) * innerH);
    const x = padL + i*(barW+gap);
    const y = padT + innerH - h;
    ctx.fillRect(x, y, barW, h);

    // label (MM-DD)
    ctx.save();
    ctx.translate(x + barW/2, padT + innerH + 14);
    ctx.rotate(-Math.PI/6);
    ctx.textAlign = 'center';
    ctx.font = '12px sans-serif';
    ctx.fillText(labels[i], 0, 0);
    ctx.restore();
  }

  // max label
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(String(maxV), padL - 6, padT + 10);
}

function drawLineChart(canvasId, labels, values) {
  const c = el(canvasId);
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0,0,W,H);

  const padL = 40, padR = 10, padT = 10, padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const finiteVals = values.filter(v => typeof v === 'number' && isFinite(v));
  const minV = finiteVals.length ? Math.min(...finiteVals) : 0;
  const maxV = finiteVals.length ? Math.max(...finiteVals) : 1;
  const span = Math.max(1e-6, maxV - minV);

  // axes
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + innerH);
  ctx.lineTo(padL + innerW, padT + innerH);
  ctx.stroke();

  const n = labels.length;
  const step = n > 1 ? innerW / (n-1) : innerW;

  // line (skip nulls)
  ctx.beginPath();
  let started = false;
  for (let i=0;i<n;i++) {
    const v = values[i];
    if (v == null || !isFinite(v)) { started = false; continue; }
    const x = padL + i*step;
    const y = padT + innerH - ((v - minV) / span) * innerH;
    if (!started) { ctx.moveTo(x,y); started = true; }
    else ctx.lineTo(x,y);
  }
  ctx.stroke();

  // points
  for (let i=0;i<n;i++) {
    const v = values[i];
    if (v == null || !isFinite(v)) continue;
    const x = padL + i*step;
    const y = padT + innerH - ((v - minV) / span) * innerH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI*2);
    ctx.fill();
  }

  // labels
  for (let i=0;i<n;i++) {
    const x = padL + i*step;
    ctx.save();
    ctx.translate(x, padT + innerH + 14);
    ctx.rotate(-Math.PI/6);
    ctx.textAlign = 'center';
    ctx.font = '12px sans-serif';
    ctx.fillText(labels[i], 0, 0);
    ctx.restore();
  }

  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(maxV.toFixed(1), padL - 6, padT + 10);
  ctx.fillText(minV.toFixed(1), padL - 6, padT + innerH);
}


async function loadGoal() {
  const j = await api('goal-get');
  const macroGoals = {
    protein_g: profileState.macro_protein_g,
    carbs_g: profileState.macro_carbs_g,
    fat_g: profileState.macro_fat_g
  };

  el('todayGoal').innerText = j.daily_calories ?? '—';
  el('todayProteinGoal').innerText = fmtGoal(macroGoals.protein_g);
  el('todayCarbsGoal').innerText = fmtGoal(macroGoals.carbs_g);
  el('todayFatGoal').innerText = fmtGoal(macroGoals.fat_g);

  el('goalInput').value = j.daily_calories ?? '';
  el('proteinGoalInput').value = macroGoals.protein_g ?? '';
  el('carbsGoalInput').value = macroGoals.carbs_g ?? '';
  el('fatGoalInput').value = macroGoals.fat_g ?? '';

  const parts = [`Calories: ${j.daily_calories ?? '—'}`];
  if (macroGoals.protein_g != null) parts.push(`Protein: ${macroGoals.protein_g}g`);
  if (macroGoals.carbs_g != null) parts.push(`Carbs: ${macroGoals.carbs_g}g`);
  if (macroGoals.fat_g != null) parts.push(`Fat: ${macroGoals.fat_g}g`);
  el('goalDisplay').innerText = parts.join(' • ');
  renderAiPlanSummary();

  return j.daily_calories ?? null;
}

async function saveGoal() {
  const vRaw = el('goalInput').value;
  const v = Number(vRaw);
  if (!vRaw || !Number.isFinite(v) || v < 0) throw new Error('Calories goal must be a number >= 0.');

  const asOptional = (id) => {
    const raw = (el(id).value || '').trim();
    if (raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error('Macro goals must be numbers >= 0.');
    return Math.round(n);
  };

  await api('goal-set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_calories: Math.round(v) })
  });

  await api('profile-set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      macro_protein_g: asOptional('proteinGoalInput'),
      macro_carbs_g: asOptional('carbsGoalInput'),
      macro_fat_g: asOptional('fatGoalInput')
    })
  });

  await loadProfile();
  await refresh();
}



async function submitAiGoalInputs() {
  const activity = el('aiActivityLevelInput').value;
  const validation = validateAiGoalFields();
  if (!validation.ok) throw new Error('Please fix the highlighted fields.');

  setAiGoalLoading(true);
  el('aiGoalFlowError').innerText = '';
  try {
    const result = await api('ai-goals-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_weight_lbs: validation.currentLbs,
        goal_weight_lbs: validation.goalLbs,
        activity_level: activity,
        goal_date: validation.goalDate
      })
    });

    aiGoalSuggestion = { ...result, goal_weight_lbs: validation.goalLbs, activity_level: activity, goal_date: validation.goalDate };
    el('aiSuggestedCalories').innerText = String(result.daily_calories);
    el('aiSuggestedProtein').innerText = String(result.protein_g);
    el('aiSuggestedCarbs').innerText = String(result.carbs_g);
    el('aiSuggestedFat').innerText = String(result.fat_g);

    const ul = el('aiRationaleList');
    ul.innerHTML = '';
    (result.rationale_bullets || []).forEach(b => {
      const li = document.createElement('li');
      li.innerText = b;
      ul.appendChild(li);
    });
    showOnboardingScreen('suggestion');
  } finally {
    setAiGoalLoading(false);
  }
}

async function acceptAiPlan() {
  if (!aiGoalSuggestion) throw new Error('No suggestion available.');
  await api('goal-set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_calories: aiGoalSuggestion.daily_calories })
  });

  const payload = {
    macro_protein_g: aiGoalSuggestion.protein_g,
    macro_carbs_g: aiGoalSuggestion.carbs_g,
    macro_fat_g: aiGoalSuggestion.fat_g,
    goal_weight_lbs: aiGoalSuggestion.goal_weight_lbs,
    activity_level: aiGoalSuggestion.activity_level,
    goal_date: aiGoalSuggestion.goal_date
  };
  if (aiGoalFlowMode === 'onboarding') payload.onboarding_completed = true;

  await api('profile-set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  await loadProfile();
  setOnboardingVisible(false);
  await refresh();
}

async function declineAiPlan() {
  if (aiGoalFlowMode === 'onboarding') {
    await api('profile-set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboarding_completed: true })
    });
    await loadProfile();
    await refresh();
  }
  setOnboardingVisible(false);
}

function openAiGoalFlow(mode) {
  aiGoalFlowMode = mode;
  resetAiGoalFlowForm();
  document.querySelectorAll('.aiInputUnitText').forEach(n => { n.innerText = unitSuffix(); });
  el('aiGoalDateInput').min = isoToday();
  const showWelcome = mode === 'onboarding';
  el('onboardingTitle').innerText = showWelcome ? 'Welcome to Fitflow Calorie Tracker' : 'Generate AI calorie & macro goals';
  el('onboardingContinueBtn').classList.toggle('hidden', !showWelcome);
  el('aiDeclineHint').innerText = showWelcome ? 'If you decline, onboarding will be marked complete. You can still set goals later in Settings.' : 'Decline keeps your current goals unchanged.';
  showOnboardingScreen(showWelcome ? 'welcome' : 'inputs');
  setOnboardingVisible(true);
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

async function uploadFoodFromInput() {
  const input = el('photoInput');
  const file = input.files && input.files[0];
  if (!file) return;

  setStatus('Extracting nutrition info…');
  const imageDataUrl = await fileToDataUrl(file);

  // Extract only (do not insert yet)
  const j = await api('entries-add-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, extract_only: true })
  });

  input.value = '';
  setStatus('');

  pendingExtraction = j.extracted;

  // Prefill sheet fields
  el('servingsEatenInput').value = '1.0';
  el('calPerServingInput').value = (pendingExtraction.calories_per_serving ?? '').toString();
  el('proteinPerServingInput').value = pendingExtraction.protein_g_per_serving == null ? '' : String(pendingExtraction.protein_g_per_serving);

  // Wire live compute
  el('servingsEatenInput').oninput = computeTotalsPreview;
  el('calPerServingInput').oninput = computeTotalsPreview;
  el('proteinPerServingInput').oninput = computeTotalsPreview;

  computeTotalsPreview();
  openSheet();
}

async function uploadPlateFromInput() {
  const input = el('plateInput');
  const file = input.files && input.files[0];
  if (!file) return;

  setStatus('Estimating…');
  const imageDataUrl = await fileToDataUrl(file);

  const servings_eaten = 1.0;

  const j = await api('entries-estimate-plate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, servings_eaten, portion_hint: null })
  });

  input.value = '';
  setStatus('');

  pendingPlateEstimate = j;

  // Prefill sheet
  el('estimateServingsInput').value = String(servings_eaten);
  el('estimateCaloriesInput').value = j.calories ?? '';
  el('estimateProteinInput').value = (j.protein_g == null ? '' : String(Math.round(j.protein_g)));
  el('estimateCarbsInput').value = (j.carbs_g == null ? '' : String(Math.round(j.carbs_g)));
  el('estimateFatInput').value = (j.fat_g == null ? '' : String(Math.round(j.fat_g)));

  setBadge(j.confidence || 'low');

  const ul = el('estimateAssumptions');
  ul.innerHTML = '';
  (j.assumptions || []).forEach(a => {
    const li = document.createElement('li');
    li.innerText = a;
    ul.appendChild(li);
  });
  el('estimateNotes').innerText = j.notes ? j.notes : '';

  openEstimateSheet();
}


function renderEntries(entries) {
  const list = el('entriesList');
  list.innerHTML = '';
  if (!entries || entries.length === 0) {
    const li = document.createElement('li');
    li.innerText = 'No entries yet. Start by adding your first meal below to build momentum.';
    list.appendChild(li);
    return;
  }

  for (const e of entries) {
    const li = document.createElement('li');
    const ts = new Date(e.taken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const text = document.createElement('span');
    {
    let suffix = '';
    if (e.protein_g != null || e.carbs_g != null || e.fat_g != null) {
      const parts = [];
      if (e.protein_g != null) parts.push(`P${e.protein_g}`);
      if (e.carbs_g != null) parts.push(`C${e.carbs_g}`);
      if (e.fat_g != null) parts.push(`F${e.fat_g}`);
      suffix = ' (' + parts.join(' ') + ')';
    }
    {
      let tag = '';
      try {
        const rx = e.raw_extraction;
        if (rx && (rx.source === 'plate_photo' || rx.estimated === true)) tag = ' (est)';
      } catch {}
      text.innerText = `${ts} — ${e.calories} cal` + suffix + tag;
    }
  }

    const editBtn = document.createElement('button');
    editBtn.innerText = 'Edit';
    editBtn.onclick = async () => {
      const c = prompt('Calories (integer):', String(e.calories));
      if (c == null) return;
      const p = prompt('Protein g (optional):', e.protein_g ?? '');
      if (p == null) return;
      const cb = prompt('Carbs g (optional):', e.carbs_g ?? '');
      if (cb == null) return;
      const f = prompt('Fat g (optional):', e.fat_g ?? '');
      if (f == null) return;

      setStatus('Updating entry…');
      await api('entry-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: e.id,
          calories: Number(c),
          protein_g: p === '' ? null : Number(p),
          carbs_g: cb === '' ? null : Number(cb),
          fat_g: f === '' ? null : Number(f)
        })
      });
      setStatus('');
      await refresh();
    };

    const delBtn = document.createElement('button');
    delBtn.innerText = 'Delete';
    delBtn.onclick = async () => {
      if (!confirm('Delete this entry?')) return;
      setStatus('Deleting entry…');
      await api('entry-delete?id=' + encodeURIComponent(e.id));
      setStatus('');
      await refresh();
    };

    li.appendChild(text);
    li.appendChild(document.createTextNode(' '));
    li.appendChild(editBtn);
    li.appendChild(delBtn);
    list.appendChild(li);
  }
}


async function loadToday() {
  const j = await api('entries-list-day');
  const entries = j.entries || [];

  const totalProtein = entries.reduce((sum, e) => sum + (Number(e.protein_g) || 0), 0);
  const totalCarbs = entries.reduce((sum, e) => sum + (Number(e.carbs_g) || 0), 0);
  const totalFat = entries.reduce((sum, e) => sum + (Number(e.fat_g) || 0), 0);

  el('todayCalories').innerText = j.total_calories ?? 0;
  el('todayProtein').innerText = Math.round(totalProtein);
  el('todayCarbs').innerText = Math.round(totalCarbs);
  el('todayFat').innerText = Math.round(totalFat);
  el('todayEntriesCount').innerText = String(entries.length);

  const goal = Number(el('todayGoal').innerText);
  const p = pct(j.total_calories ?? 0, isFinite(goal) ? goal : 0);
  el('progressBar').style.width = p + '%';

  const totalCalories = Number(j.total_calories ?? 0);
  if (Number.isFinite(goal) && goal > 0) {
    const remaining = Math.round(goal - totalCalories);
    el('todayRemaining').innerText = remaining >= 0 ? `${remaining} cal left` : `${Math.abs(remaining)} cal over`;
  } else {
    el('todayRemaining').innerText = 'Set a goal';
  }

  const pGoal = Number(el('todayProteinGoal').innerText);
  const cGoal = Number(el('todayCarbsGoal').innerText);
  const fGoal = Number(el('todayFatGoal').innerText);

  const proteinPercent = macroPct(totalProtein, pGoal);
  const carbsPercent = macroPct(totalCarbs, cGoal);
  const fatPercent = macroPct(totalFat, fGoal);

  el('proteinProgressText').innerText = proteinPercent == null ? 'No goal set' : `${Math.round(totalProtein)} / ${Math.round(pGoal)}g`;
  el('carbsProgressText').innerText = carbsPercent == null ? 'No goal set' : `${Math.round(totalCarbs)} / ${Math.round(cGoal)}g`;
  el('fatProgressText').innerText = fatPercent == null ? 'No goal set' : `${Math.round(totalFat)} / ${Math.round(fGoal)}g`;

  el('proteinProgressBar').style.width = `${proteinPercent ?? 0}%`;
  el('carbsProgressBar').style.width = `${carbsPercent ?? 0}%`;
  el('fatProgressBar').style.width = `${fatPercent ?? 0}%`;

  renderEntries(entries);
}

function applyManualPreset(preset) {
  const p = (profileState.quick_fills || []).find((x) => x.id === preset);
  if (!p) return;
  el('manualCaloriesInput').value = p.calories;
  el('manualProteinInput').value = p.protein_g ?? '';
  el('manualCarbsInput').value = p.carbs_g ?? '';
  el('manualFatInput').value = p.fat_g ?? '';
  el('manualNotesInput').value = p.name || '';
}

function renderQuickFillButtons() {
  const row = el('quickFillsRow');
  const block = el('quickAddsBlock');
  if (!row || !block) return;
  row.innerHTML = '';
  const active = (profileState.quick_fills || []).filter((q) => q.enabled);
  block.classList.toggle('hidden', active.length === 0);

  for (const q of active) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quickFillBtn';
    btn.dataset.preset = q.id;
    btn.innerText = q.name;
    btn.onclick = () => applyManualPreset(q.id);
    row.appendChild(btn);
  }
}

function renderQuickFillSettings() {
  const list = el('quickFillList');
  if (!list) return;
  list.innerHTML = '';
  const fills = profileState.quick_fills || [];

  if (fills.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.innerText = 'No quick fills yet.';
    list.appendChild(li);
    return;
  }

  for (const q of fills) {
    const li = document.createElement('li');
    li.innerText = `${q.name} — ${q.calories} cal${q.protein_g != null ? `, P${q.protein_g}` : ''}${q.carbs_g != null ? `, C${q.carbs_g}` : ''}${q.fat_g != null ? `, F${q.fat_g}` : ''} (${q.enabled ? 'shown' : 'hidden'})`;

    const toggleBtn = document.createElement('button');
    toggleBtn.innerText = q.enabled ? 'Hide' : 'Show';
    toggleBtn.onclick = () => updateQuickFill(q.id, { enabled: !q.enabled });

    const delBtn = document.createElement('button');
    delBtn.innerText = 'Delete';
    delBtn.onclick = () => deleteQuickFill(q.id);

    li.appendChild(document.createTextNode(' '));
    li.appendChild(toggleBtn);
    li.appendChild(delBtn);
    list.appendChild(li);
  }
}

function readQuickFillForm() {
  const name = (el('quickFillNameInput')?.value || '').trim();
  const calories = Number(el('quickFillCaloriesInput')?.value);
  const proteinRaw = el('quickFillProteinInput')?.value;
  const carbsRaw = el('quickFillCarbsInput')?.value;
  const fatRaw = el('quickFillFatInput')?.value;
  const enabled = String(el('quickFillEnabledInput')?.value || 'true') === 'true';

  if (!name) throw new Error('Quick fill name is required.');
  if (!Number.isFinite(calories) || calories <= 0) throw new Error('Quick fill calories must be > 0.');

  const protein = proteinRaw ? Number(proteinRaw) : null;
  const carbs = carbsRaw ? Number(carbsRaw) : null;
  const fat = fatRaw ? Number(fatRaw) : null;

  return {
    id: `qf_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    name: name.slice(0, 40),
    calories: Math.round(calories),
    protein_g: Number.isFinite(protein) ? Math.round(protein) : null,
    carbs_g: Number.isFinite(carbs) ? Math.round(carbs) : null,
    fat_g: Number.isFinite(fat) ? Math.round(fat) : null,
    enabled
  };
}

function clearQuickFillForm() {
  el('quickFillNameInput').value = '';
  el('quickFillCaloriesInput').value = '';
  el('quickFillProteinInput').value = '';
  el('quickFillCarbsInput').value = '';
  el('quickFillFatInput').value = '';
  el('quickFillEnabledInput').value = 'true';
}

async function saveQuickFills(next) {
  await api('profile-set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quick_fills: next })
  });
  profileState.quick_fills = next;
  renderQuickFillButtons();
  renderQuickFillSettings();
}

async function addQuickFill() {
  try {
    const item = readQuickFillForm();
    const next = [...(profileState.quick_fills || []), item];
    await saveQuickFills(next);
    clearQuickFillForm();
    el('quickFillStatus').innerText = 'Quick fill saved.';
  } catch (e) {
    el('quickFillStatus').innerText = e.message || String(e);
  }
}

async function updateQuickFill(id, patch) {
  const next = (profileState.quick_fills || []).map((q) => (q.id === id ? { ...q, ...patch } : q));
  await saveQuickFills(next);
}

async function deleteQuickFill(id) {
  const next = (profileState.quick_fills || []).filter((q) => q.id !== id);
  await saveQuickFills(next);
}

async function loadWeight() {
  const j = await api('weight-get');
  el('weightDisplay').innerText = j.weight_lbs != null ? ('Today: ' + displayWeight(j.weight_lbs) + ' ' + unitSuffix()) : 'No weight logged today';
}

async function saveWeight() {
  const wLbs = inputToLbs(el('weightInput').value);
  await api('weight-set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weight_lbs: wLbs })
  });
  el('weightInput').value = '';
  await refresh();
}

async function loadWeightsList() {
  const j = await api('weights-list?days=14');
  const list = el('weightsList');
  list.innerHTML = '';
  if (!j.weights || j.weights.length === 0) {
    const li = document.createElement('li');
    li.innerText = 'No weights yet.';
    list.appendChild(li);
    return;
  }
  for (const w of j.weights) {
    const li = document.createElement('li');
    li.innerText = `${w.entry_date}: ${displayWeight(w.weight_lbs)} ${unitSuffix()}`;
    list.appendChild(li);
  }
}

async function finishDay() {
  setStatus('Generating summary…');
  const j = await api('day-finish', { method: 'POST' });
  el('scoreOutput').innerText = `Score: ${j.score}\n\n${j.tips}`;
  setStatus('');
}

async function sendChat() {
  const msg = el('chatInput').value.trim();
  if (!msg) return;

  try {
    setThinking(true);
    setStatus('Thinking…');
    const j = await api('chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    el('chatOutput').innerText = j.reply;
  } finally {
    setThinking(false);
    setStatus('');
  }
}


async function loadWeekly() {
  const j = await api('week-summary?days=7');
  const labels = j.series.map(x => x.entry_date.slice(5)); // MM-DD
  const calories = j.series.map(x => x.total_calories ?? 0);
  drawBarChart('calChart', labels, calories);

  const weights = j.series.map(x => x.weight_lbs == null ? null : displayWeight(x.weight_lbs));
  drawLineChart('wtChart', labels, weights);
}


async function refresh() {
  const goal = await loadGoal();
  await loadToday();
  await loadWeight();
  await loadWeightsList();
  await loadWeekly();
}


async function saveManualEntry() {
  try {
    setStatus('');
    const caloriesRaw = el('manualCaloriesInput')?.value;
    const calories = Number(caloriesRaw);
    if (!Number.isFinite(calories) || calories <= 0) throw new Error('Calories must be a number > 0.');

    const proteinRaw = el('manualProteinInput')?.value;
    const carbsRaw = el('manualCarbsInput')?.value;
    const fatRaw = el('manualFatInput')?.value;

    const protein_g = proteinRaw ? Number(proteinRaw) : null;
    const carbs_g = carbsRaw ? Number(carbsRaw) : null;
    const fat_g = fatRaw ? Number(fatRaw) : null;

    const notes = (el('manualNotesInput')?.value || '').trim();

    const payload = {
      calories: Math.round(calories),
      protein_g: (protein_g == null || !Number.isFinite(protein_g)) ? null : protein_g,
      carbs_g: (carbs_g == null || !Number.isFinite(carbs_g)) ? null : carbs_g,
      fat_g: (fat_g == null || !Number.isFinite(fat_g)) ? null : fat_g,
      raw_extraction_meta: {
        source: 'manual',
        estimated: false,
        confidence: 'high',
        notes: notes || null
      }
    };

    el('manualSaveBtn').disabled = true;
    await api('entries-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // Clear inputs
    el('manualCaloriesInput').value = '';
    el('manualProteinInput').value = '';
    el('manualCarbsInput').value = '';
    el('manualFatInput').value = '';
    el('manualNotesInput').value = '';

    await refresh();
    setStatus('Manual entry saved.');
  } catch (e) {
    setStatus(e.message || String(e));
  } finally {
    const b = el('manualSaveBtn');
    if (b) b.disabled = false;
  }
}

function bindUI() {
  setThinking(false);
  el('loginBtn').onclick = () => netlifyIdentity.open();
  el('logoutBtn').onclick = () => netlifyIdentity.logout();
  el('saveGoalBtn').onclick = () => saveGoal().catch(e => setStatus(e.message));
  el('photoInput').onchange = () => uploadFoodFromInput().catch(e => setStatus(e.message));
  el('plateInput').onchange = () => uploadPlateFromInput().catch(e => setStatus(e.message));
  el('saveWeightBtn').onclick = () => saveWeight().catch(e => setStatus(e.message));
  el('finishDayBtn').onclick = () => finishDay().catch(e => setStatus(e.message));
  el('sendChatBtn').onclick = () => sendChat().catch(e => setStatus(e.message));

  // Tabs
  const tabs = el('tabs');
  const dashBtn = el('tabDashboardBtn');
  const setBtn = el('tabSettingsBtn');
  const panelDash = el('panelDashboard');
  const panelSet = el('panelSettings');

  function activateTab(which) {
    const isDash = which === 'dashboard';
    panelDash.classList.toggle('hidden', !isDash);
    panelSet.classList.toggle('hidden', isDash);
    dashBtn.classList.toggle('active', isDash);
    setBtn.classList.toggle('active', !isDash);
  }

  dashBtn.onclick = () => activateTab('dashboard');
  setBtn.onclick = () => activateTab('settings');

  // Settings: unit toggle
  const unitToggle = el('unitToggle');
  const unitLabel = el('unitLabel');
  unitToggle.checked = (weightUnit === 'kg');
  unitLabel.innerText = unitSuffix();

  const darkModeToggle = el('darkModeToggle');
  if (darkModeToggle) darkModeToggle.checked = darkModeEnabled;
  applyDarkModeUI();
  applyFontSizeUI();

  const fontSizeRange = el('fontSizeRange');

  function applyUnitUI() {
    unitLabel.innerText = unitSuffix();
    el('weightInput').placeholder = unitSuffix();
    // Re-render weight display/list if already present
    loadWeight().catch(() => {});
    loadWeightsList().catch(() => {});
  }

  unitToggle.onchange = () => {
    weightUnit = unitToggle.checked ? 'kg' : 'lbs';
    localStorage.setItem('weightUnit', weightUnit);
    applyUnitUI();
  };

  if (darkModeToggle) {
    darkModeToggle.onchange = () => {
      darkModeEnabled = darkModeToggle.checked;
      localStorage.setItem('darkMode', String(darkModeEnabled));
      applyDarkModeUI();
    };
  }

  if (fontSizeRange) {
    fontSizeRange.oninput = () => {
      appFontSizePct = clampFontSizePct(fontSizeRange.value);
      localStorage.setItem('appFontSizePct', String(appFontSizePct));
      applyFontSizeUI();
    };
  }

  el('onboardingContinueBtn').onclick = () => showOnboardingScreen('inputs');
  ['aiCurrentWeightInput','aiGoalWeightInput','aiGoalDateInput'].forEach((id) => {
    const node = el(id);
    if (!node) return;
    node.onblur = () => { validateAiGoalFields(); };
  });
  el('aiGetPlanBtn').onclick = () => submitAiGoalInputs().catch(e => { el('aiGoalFlowError').innerText = e.message + ' Try again.'; });
  el('aiAcceptPlanBtn').onclick = () => acceptAiPlan().catch(e => { el('aiSuggestionError').innerText = e.message; });
  el('aiDeclinePlanBtn').onclick = () => declineAiPlan().catch(e => { el('aiSuggestionError').innerText = e.message; });
  el('settingsAiGoalBtn').onclick = () => openAiGoalFlow('settings');

  // Initialize UI state
  el('weightInput').placeholder = unitSuffix();
  activateTab('dashboard');

  // Click bindings that may not exist until a sheet/modal is rendered
  const bindClick = (id, handler) => {
    const node = el(id);
    if (node) node.onclick = handler;
  };

  // Servings sheet
  bindClick('sheetOverlay', () => closeSheet());
  bindClick('sheetCloseBtn', () => closeSheet());
  bindClick('sheetCancelBtn', () => closeSheet());
  bindClick('sheetSaveBtn', () => saveFromSheet());

  // Manual entry
  bindClick('manualSaveBtn', () => saveManualEntry());
  bindClick('saveQuickFillBtn', () => addQuickFill());

  bindClick('toggleDailyGoalsBtn', () => toggleSection('dailyGoalsBody', 'toggleDailyGoalsBtn'));
  bindClick('toggleAddFoodBtn', () => toggleSection('addFoodBody', 'toggleAddFoodBtn'));
  bindClick('chatToggleBtn', () => toggleSection('coachChatBody', 'chatToggleBtn', 'Hide', 'Show'));
}

async function initAuthedSession() {
  showApp(true);
  await loadProfile();
  if (!profileState.onboarding_completed) {
    openAiGoalFlow('onboarding');
    return;
  }
  setOnboardingVisible(false);
  await refresh();
}

netlifyIdentity.on('init', user => {
  currentUser = user;
  showApp(!!user);
  if (user) initAuthedSession().catch(e => setStatus(e.message));
});
netlifyIdentity.on('login', user => {
  currentUser = user;
  netlifyIdentity.close();
  showApp(true);
  initAuthedSession().catch(e => setStatus(e.message));
});
netlifyIdentity.on('logout', () => {
  currentUser = null;
  showApp(false);
  setOnboardingVisible(false);
  setStatus('Logged out.');
});

applyDarkModeUI();
applyFontSizeUI();
bindUI();
netlifyIdentity.init();
