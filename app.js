console.log("APP_VERSION v12");
let currentUser = null;
let skipOnboardingAfterLogin = false;
const QUERY = new URLSearchParams(window.location.search);
const MOCK_MODE = QUERY.get('mock') === '1';
const USE_MOCK_API = QUERY.get('mockApi') === '1';
const MOCK_STORAGE_KEY = 'caloriTrackerMockStateV1';
const mockStorage = window.localStorage;

const DEVICE_ID_STORAGE_KEY = 'caloriTrackerDeviceIdV1';
const DEVICE_AUTO_LOGIN_STORAGE_KEY = 'caloriTrackerAutoLoginV1';
const VIEW_SPAN_ENABLED_KEY = 'caloriTrackerViewSpanEnabledV1';
const VIEW_SPAN_PAST_DAYS_KEY = 'caloriTrackerViewSpanPastDaysV1';
const VIEW_SPAN_FUTURE_DAYS_KEY = 'caloriTrackerViewSpanFutureDaysV1';

function generateDeviceId() {
  try {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID().replace(/-/g, '');
  } catch {}
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

function getOrCreateDeviceId() {
  const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;
  const next = generateDeviceId();
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, next);
  return next;
}

function defaultMockState() {
  return {
    profile: {
      onboarding_completed: false,
      macro_protein_g: null,
      macro_carbs_g: null,
      macro_fat_g: null,
      goal_weight_lbs: null,
      activity_level: null,
      goal_date: null,
      quick_fills: []
    },
    daily_calories: 2200,
    plan_tier: 'free',
    subscription_status: 'inactive',
    entries: [],
    ai_usage_events: [],
    weights: [],
    feedback_submitted: false
  };
}

function mockIsPremium() {
  const tier = String(mockState.plan_tier || 'free');
  const status = String(mockState.subscription_status || 'inactive');
  return tier === 'premium' && (status === 'active' || status === 'trialing');
}

function mockAiActionsUsedToday() {
  const today = isoToday();
  return (mockState.ai_usage_events || []).filter((e) => e.entry_date === today).length;
}

function enforceMockAiLimit(actionType = 'unknown') {
  if (mockIsPremium()) return;
  const limit = 5;
  const used = mockAiActionsUsedToday();
  if (used >= limit) {
    throw new Error(`Free tier allows up to ${limit} AI actions per day. Upgrade to Premium for unlimited AI.`);
  }
  mockState.ai_usage_events = Array.isArray(mockState.ai_usage_events) ? mockState.ai_usage_events : [];
  mockState.ai_usage_events.push({
    entry_date: isoToday(),
    action_type: String(actionType).slice(0, 48),
    created_at: new Date().toISOString()
  });
  persistMockState();
}

function loadMockState() {
  try {
    const parsed = JSON.parse(mockStorage.getItem(MOCK_STORAGE_KEY) || '{}');
    return {
      ...defaultMockState(),
      ...parsed,
      profile: { ...defaultMockState().profile, ...(parsed.profile || {}) }
    };
  } catch {
    return defaultMockState();
  }
}

let mockState = loadMockState();
function persistMockState() {
  mockStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(mockState));
}

function resetMockState() {
  mockState = defaultMockState();
  persistMockState();
}

function todayEntries() {
  const today = isoToday();
  return mockState.entries.filter((e) => e.entry_date === today);
}

function buildMockCoachContext() {
  const entries = todayEntries();
  const totalCalories = entries.reduce((sum, e) => sum + (Number(e.calories) || 0), 0);
  const totalProtein = entries.reduce((sum, e) => sum + (Number(e.protein_g) || 0), 0);
  const totalCarbs = entries.reduce((sum, e) => sum + (Number(e.carbs_g) || 0), 0);
  const totalFat = entries.reduce((sum, e) => sum + (Number(e.fat_g) || 0), 0);
  const today = isoToday();
  const todayWeight = (mockState.weights || []).find((w) => w.entry_date === today) || null;
  const trackedDaysThisWeek = new Set((mockState.entries || []).map((e) => e.entry_date)).size;

  return {
    date: today,
    daily_goal_calories: mockState.daily_calories,
    macro_goals: {
      protein_g: mockState.profile?.macro_protein_g ?? null,
      carbs_g: mockState.profile?.macro_carbs_g ?? null,
      fat_g: mockState.profile?.macro_fat_g ?? null
    },
    today_totals: {
      calories: totalCalories,
      protein_g: Math.round(totalProtein),
      carbs_g: Math.round(totalCarbs),
      fat_g: Math.round(totalFat),
      entries_count: entries.length
    },
    today_weight_lbs: todayWeight ? Number(todayWeight.weight_lbs) : null,
    tracked_days_total: new Set((mockState.entries || []).map((e) => e.entry_date)).size,
    tracked_days_this_week: trackedDaysThisWeek,
    recent_entries: entries.slice(-10)
  };
}

function parseApiPath(path) {
  const [route, query = ''] = String(path || '').split('?');
  return { route, params: new URLSearchParams(query) };
}

async function mockAi(task, payload = {}) {
  const r = await fetch('/api/demo-openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, payload })
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!r.ok) {
    const msg = (body && (body.error || body.message)) ? (body.error || body.message) : ('Request failed: ' + r.status);
    throw new Error(msg);
  }
  try { if (typeof _apSyncFromApi === 'function') _apSyncFromApi(path, body); } catch (e) {}
  return body;
}

async function mockApi(path, opts = {}) {
  const { route, params } = parseApiPath(path);
  const method = String(opts.method || 'GET').toUpperCase();
  let payload = {};
  try { payload = opts.body ? JSON.parse(opts.body) : {}; } catch {}

  if (route === 'profile-get') return { ...mockState.profile };
  if (route === 'profile-set' && method === 'POST') {
    mockState.profile = { ...mockState.profile, ...payload };
    persistMockState();
    return { ok: true };
  }
  if (route === 'goal-get') return { daily_calories: mockState.daily_calories };
  if (route === 'goal-set' && method === 'POST') {
    mockState.daily_calories = Number(payload.daily_calories) || 0;
    persistMockState();
    return { ok: true };
  }
  if (route === 'entries-add' && method === 'POST') {
    const entry = {
      id: `e_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      entry_date: payload.date || isoToday(),
      taken_at: new Date().toISOString(),
      calories: Math.round(Number(payload.calories) || 0),
      protein_g: payload.protein_g == null ? null : Number(payload.protein_g),
      carbs_g: payload.carbs_g == null ? null : Number(payload.carbs_g),
      fat_g: payload.fat_g == null ? null : Number(payload.fat_g),
      raw_extraction: payload.raw_extraction_meta || null
    };
    mockState.entries.push(entry);
    persistMockState();
    return { ok: true, id: entry.id };
  }
  if (route === 'entries-list-day') {
    const targetDate = params.get('date') || isoToday();
    const entries = (mockState.entries || []).filter((e) => e.entry_date === targetDate);
    return { entry_date: targetDate, entries, total_calories: entries.reduce((s, e) => s + (Number(e.calories) || 0), 0) };
  }
  if (route === 'entry-update' && method === 'POST') {
    mockState.entries = mockState.entries.map((e) => (e.id === payload.id ? { ...e, ...payload } : e));
    persistMockState();
    return { ok: true };
  }
  if (route === 'entry-delete') {
    const id = params.get('id');
    mockState.entries = mockState.entries.filter((e) => e.id !== id);
    persistMockState();
    return { ok: true };
  }
  if (route === 'weight-get') {
    const targetDate = params.get('date') || isoToday();
    const row = mockState.weights.find((w) => w.entry_date === targetDate);
    return { entry_date: targetDate, weight_lbs: row ? row.weight_lbs : null };
  }
  if (route === 'weight-set' && method === 'POST') {
    const targetDate = payload.date || isoToday();
    mockState.weights = mockState.weights.filter((w) => w.entry_date !== targetDate);
    mockState.weights.push({ entry_date: targetDate, weight_lbs: Number(payload.weight_lbs) });
    persistMockState();
    return { ok: true };
  }
  if (route === 'weights-list') {
    const days = Number(params.get('days') || 14);
    return { weights: [...mockState.weights].sort((a, b) => b.entry_date.localeCompare(a.entry_date)).slice(0, days) };
  }
  if (route === 'week-summary') {
    const days = Number(params.get('days') || 7);
    const series = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      const entries = mockState.entries.filter((e) => e.entry_date === date);
      const weight = mockState.weights.find((w) => w.entry_date === date);
      series.push({ entry_date: date, total_calories: entries.reduce((s, e) => s + (e.calories || 0), 0), weight_lbs: weight ? weight.weight_lbs : null });
    }
    return { series };
  }
  if (route === 'ai-goals-suggest' && method === 'POST') {
    enforceMockAiLimit('ai-goals-suggest');
    return mockAi('ai-goals-suggest', payload);
  }
  if (route === 'entries-add-image' && method === 'POST') {
    enforceMockAiLimit('entries-add-image');
    return mockAi('entries-add-image', payload);
  }
  if (route === 'entries-estimate-plate-image' && method === 'POST') {
    enforceMockAiLimit('entries-estimate-plate-image');
    return mockAi('entries-estimate-plate-image', payload);
  }
  if (route === 'day-finish' && method === 'POST') {
    enforceMockAiLimit('day-finish');
    return mockAi('day-finish', {
      entries: todayEntries(),
      daily_calories_goal: mockState.daily_calories,
      macro_goals: {
        protein_g: mockState.profile?.macro_protein_g,
        carbs_g: mockState.profile?.macro_carbs_g,
        fat_g: mockState.profile?.macro_fat_g
      }
    });
  }
  if (route === 'chat' && method === 'POST') {
    enforceMockAiLimit('chat');
    return mockAi('chat', { ...payload, coach_context: buildMockCoachContext() });
  }
  if (route === 'feedback-status') return { required: false, campaign: null };
  if (route === 'feedback-submit') return { ok: true };
  if (route === 'billing-status') {
    const isPremium = mockIsPremium();
    const foodUsed = todayEntries().length;
    const aiUsed = mockAiActionsUsedToday();
    const aiLimit = isPremium ? null : 5;
    return {
      is_premium: isPremium,
      plan_tier: isPremium ? 'premium' : 'free',
      monthly_price_usd: 5,
      yearly_price_usd: 50,
      limits: { food_entries_per_day: 9999, ai_actions_per_day: aiLimit, history_days: 9999 },
      usage_today: { food_entries_today: foodUsed, ai_actions_today: aiUsed }
    };
  }
  if (route === 'create-checkout-session' || route === 'manage-subscription') return { url: 'https://example.com' };
  if (route === 'export-data') return { profile: mockState.profile, goal: { daily_calories: mockState.daily_calories }, entries: mockState.entries, weights: mockState.weights };
  if (route === 'track-event') return { ok: true };
  if (route === 'voice-food-add' && method === 'POST') {
    enforceMockAiLimit('voice-food-add');
    return mockAi('voice-food-add', payload);
  }
  if (route === 'devices-list') {
    const currentDeviceId = getOrCreateDeviceId();
    const existing = Array.isArray(mockState.devices) ? mockState.devices : [];
    const hasCurrent = existing.some((d) => d && d.device_id === currentDeviceId);
    const devices = hasCurrent ? existing : [{ device_id: currentDeviceId, device_name: 'This device', is_enabled: true, last_seen_at: new Date().toISOString() }, ...existing];
    mockState.devices = devices;
    persistMockState();
    return { current_device_id: currentDeviceId, devices };
  }
  if (route === 'device-update' && method === 'POST') {
    const deviceId = String(payload.device_id || '').trim();
    if (!deviceId) throw new Error('device_id is required');
    const devices = Array.isArray(mockState.devices) ? mockState.devices : [];
    const idx = devices.findIndex((d) => d && d.device_id === deviceId);
    if (idx < 0) throw new Error('Device not found');
    devices[idx] = {
      ...devices[idx],
      ...(Object.prototype.hasOwnProperty.call(payload, 'device_name') ? { device_name: payload.device_name || null } : {}),
      ...(Object.prototype.hasOwnProperty.call(payload, 'is_enabled') ? { is_enabled: !!payload.is_enabled } : {}),
      last_seen_at: devices[idx].last_seen_at || new Date().toISOString()
    };
    mockState.devices = devices;
    persistMockState();
    return { ok: true };
  }
  if (route === 'device-delete' && method === 'POST') {
    const deviceId = String(payload.device_id || '').trim();
    if (!deviceId) throw new Error('device_id is required');
    const currentDeviceId = getOrCreateDeviceId();
    if (deviceId === currentDeviceId) throw new Error('You cannot delete the current device from itself.');
    const devices = Array.isArray(mockState.devices) ? mockState.devices : [];
    const next = devices.filter((d) => d && d.device_id !== deviceId);
    if (next.length === devices.length) throw new Error('Device not found');
    mockState.devices = next;
    persistMockState();
    return { ok: true };
  }



  throw new Error(`Mock API route not implemented: ${route}`);
}

let weightUnit = (localStorage.getItem('weightUnit') || 'lbs'); // 'lbs' or 'kg'
let darkModeEnabled = localStorage.getItem('darkMode') === 'true';
let appFontSizePct = Number(localStorage.getItem('appFontSizePct') || '100');
let deviceAutoLoginEnabled = localStorage.getItem(DEVICE_AUTO_LOGIN_STORAGE_KEY) === 'true';
let viewSpanEnabled = localStorage.getItem(VIEW_SPAN_ENABLED_KEY) === 'true';
let viewSpanPastDays = Math.max(0, Math.min(6, Number(localStorage.getItem(VIEW_SPAN_PAST_DAYS_KEY) || '3') || 3));
let viewSpanFutureDays = Math.max(0, Math.min(7, Number(localStorage.getItem(VIEW_SPAN_FUTURE_DAYS_KEY) || '2') || 2));
let selectedDayOffset = 0;
let linkedDevicesState = [];


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
let aiGoalInputs = null;
let aiGoalThread = [];
let feedbackGateState = { required: false, campaign: null };
let billingController = null;
let activeAddFoodPanel = null;
let activePhotoMode = 'plate';

let voiceFoodHistory = [];
let voiceRecognition = null;
let voiceFollowUpCount = 0;
let voiceIsListening = false;
let voiceAutoSendPending = false;

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function dateWithOffset(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + Number(offsetDays || 0));
  return d.toISOString().slice(0, 10);
}

function activeEntryDateISO() {
  return viewSpanEnabled ? dateWithOffset(selectedDayOffset) : isoToday();
}

function formatDayLabel(offset) {
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  if (offset === 1) return 'Tomorrow';
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderTodayDateNavigator() {
  const nav = el('todayDateNav');
  const chips = el('todayDateChips');
  const viewing = el('todayViewingLabel');
  if (!nav || !chips || !viewing) return;

  if (!viewSpanEnabled) {
    nav.classList.add('hidden');
    selectedDayOffset = 0;
    syncTodayCardTitle();
    return;
  }

  selectedDayOffset = Math.max(-viewSpanPastDays, Math.min(viewSpanFutureDays, selectedDayOffset));
  nav.classList.remove('hidden');
  chips.innerHTML = '';
  for (let offset = -viewSpanPastDays; offset <= viewSpanFutureDays; offset += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'todayDateChip' + (offset === selectedDayOffset ? ' active' : '');
    btn.innerText = formatDayLabel(offset);
    btn.onclick = () => {
      selectedDayOffset = offset;
      renderTodayDateNavigator();
      refresh().catch((e) => setStatus(e.message));
    };
    chips.appendChild(btn);
  }

  const activeDate = activeEntryDateISO();
  viewing.innerText = `Viewing: ${formatDayLabel(selectedDayOffset)} (${activeDate})`;

  const prev = el('todayPrevBtn');
  const next = el('todayNextBtn');
  if (prev) prev.disabled = selectedDayOffset <= -viewSpanPastDays;
  if (next) next.disabled = selectedDayOffset >= viewSpanFutureDays;
  syncTodayCardTitle();
}

function syncTodayCardTitle() {
  const node = el('todayCardTitle');
  if (!node) return;
  node.innerText = formatDayLabel(selectedDayOffset);
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

function maybePromptUpgradeForAiLimit(message) {
  const m = String(message || '');
  if (!/AI actions per day/i.test(m)) return;
  const goToUpgrade = window.confirm('You reached your 5 free AI uses for this day. Want to upgrade?');
  if (!goToUpgrade) return;
  const settingsBtn = el('tabSettingsBtn');
  if (settingsBtn) settingsBtn.click();
  const planCard = el('planCard');
  if (planCard) planCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


function setThinking(isThinking) {
  const thinking = el('aiThinking');
  if (!thinking) return;
  thinking.classList.toggle('hidden', !isThinking);
}

async function withThinking(work) {
  setThinking(true);
  try {
    return await work();
  } finally {
    setThinking(false);
  }
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

  // Hard-disable the overlay when hidden so it can never "ghost block" clicks.
  if (visible) {
    overlay.style.display = 'flex';
    overlay.style.pointerEvents = 'auto';
    overlay.style.opacity = '1';
  } else {
    overlay.style.display = 'none';
    overlay.style.pointerEvents = 'none';
    overlay.style.opacity = '0';
    hideAllBlockingOverlays();
  }
}


function showLoggedOutOnboarding() {
  // Logged-out users start the onboarding welcome flow.
  openAiGoalFlow('onboarding');
}

function showOnboardingScreen(which) {
  el('onboardingWelcomeScreen').classList.toggle('hidden', which !== 'welcome');
  el('onboardingInputScreen').classList.toggle('hidden', which !== 'inputs');
  el('onboardingSuggestScreen').classList.toggle('hidden', which !== 'suggestion');
  const onboardingModal = document.querySelector('#onboardingOverlay .onboardingModal');
  if (onboardingModal) onboardingModal.classList.toggle('welcomeMode', which === 'welcome');
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
  const editBlock = el('aiEditPlanBlock');
  if (editBlock) editBlock.classList.add('hidden');
  const editInput = el('aiEditPlanInput');
  if (editInput) editInput.value = '';
  clearAiInputErrors();
  setAiGoalLoading(false);
  aiGoalSuggestion = null;
  aiGoalInputs = null;
  aiGoalThread = [];
}

async function loadProfile() {
  const p = await api('profile-get');
  profileState = { ...profileState, ...p, quick_fills: Array.isArray(p.quick_fills) ? p.quick_fills : [] };
  renderQuickFillButtons();
  renderQuickFillSettings();
  return p;
}

function formatDeviceDate(raw) {
  if (!raw) return '—';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function updateDeviceSettingsStatus(msg = '') {
  const node = el('deviceSettingsStatus');
  if (node) node.innerText = msg;
}

function renderDeviceSettings() {
  const list = el('deviceList');
  if (!list) return;
  if (!linkedDevicesState.length) {
    list.innerHTML = '<div class="muted">No linked devices yet.</div>';
    return;
  }

  list.innerHTML = '';
  linkedDevicesState.forEach((device) => {
    const row = document.createElement('div');
    row.className = 'deviceRow';

    const top = document.createElement('div');
    top.className = 'deviceRowTop';

    const title = document.createElement('div');
    title.innerHTML = `<strong>${device.device_name || 'Unnamed device'}</strong>${device.is_current ? ' <span class="muted">(This device)</span>' : ''}`;

    const switchWrap = document.createElement('label');
    switchWrap.className = 'switch';
    switchWrap.innerHTML = `<input type="checkbox" ${device.is_enabled ? 'checked' : ''} /><span class="slider"></span>`;
    const toggle = switchWrap.querySelector('input');
    if (toggle) {
      toggle.onchange = async () => {
        try {
          await api('device-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: device.device_id, is_enabled: !!toggle.checked })
          });
          device.is_enabled = !!toggle.checked;
          updateDeviceSettingsStatus(`Updated ${device.device_name || 'device'} access.`);
          renderDeviceSettings();
        } catch (e) {
          toggle.checked = !!device.is_enabled;
          updateDeviceSettingsStatus(e.message || String(e));
        }
      };
    }

    top.appendChild(title);
    top.appendChild(switchWrap);

    const nameRow = document.createElement('div');
    nameRow.className = 'row';
    const nameInput = document.createElement('input');
    nameInput.className = 'deviceNameInput';
    nameInput.type = 'text';
    nameInput.maxLength = 80;
    nameInput.placeholder = 'Name this device';
    nameInput.value = device.device_name || '';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.innerText = 'Save name';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'dangerBtn';
    deleteBtn.innerText = 'Delete device';
    if (device.is_current) {
      deleteBtn.disabled = true;
      deleteBtn.title = 'You can’t delete the current device from itself.';
    }
    deleteBtn.onclick = async () => {
      if (device.is_current) return;
      const ok = window.confirm(`Delete "${device.device_name || 'Unnamed device'}" from this identity? This will disconnect it.`);
      if (!ok) return;
      try {
        await api('device-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: device.device_id })
        });
        linkedDevicesState = linkedDevicesState.filter((d) => d.device_id !== device.device_id);
        updateDeviceSettingsStatus('Device deleted.');
        renderDeviceSettings();
      } catch (e) {
        updateDeviceSettingsStatus(e.message || String(e));
      }
    };

    saveBtn.onclick = async () => {
      try {
        await api('device-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: device.device_id, device_name: nameInput.value.trim() || null })
        });
        device.device_name = nameInput.value.trim() || null;
        updateDeviceSettingsStatus('Saved device name.');
        renderDeviceSettings();
      } catch (e) {
        updateDeviceSettingsStatus(e.message || String(e));
      }
    };
    nameRow.appendChild(nameInput);
    nameRow.appendChild(saveBtn);
    nameRow.appendChild(deleteBtn);

    const meta = document.createElement('div');
    meta.className = 'muted deviceMeta';
    meta.innerText = `Last seen: ${formatDeviceDate(device.last_seen_at)} • ID: ${device.device_id.slice(0, 10)}…`;

    row.appendChild(top);
    row.appendChild(nameRow);
    row.appendChild(meta);
    list.appendChild(row);
  });
}

async function loadLinkedDevices() {
  const list = el('deviceList');
  if (!list) return;
  list.innerHTML = '<div class="muted">Loading devices…</div>';
  try {
    const data = await api('devices-list');
    linkedDevicesState = Array.isArray(data.devices) ? data.devices : [];
    renderDeviceSettings();
  } catch (e) {
    list.innerHTML = '<div class="muted">Could not load linked devices.</div>';
    updateDeviceSettingsStatus(e.message || String(e));
  }
}

function shouldAttachDeviceIdHeader() {
  // Always attach device id so logged-out users retain a device session.
  return true;
}

async function authHeaders() {
  const headers = {};
  if (shouldAttachDeviceIdHeader()) {
    headers['X-Device-Id'] = getOrCreateDeviceId();
  }

  // Netlify Identity: prefer a fresh JWT (handles refresh/expiry).
  if (currentUser) {
    try {
      if (typeof currentUser.jwt === 'function') {
        const token = await currentUser.jwt();
        if (token) headers.Authorization = 'Bearer ' + token;
        return headers;
      }
    } catch {}
    // Fallbacks for older widget shapes
    const token = currentUser?.token?.access_token || currentUser?.token?.id_token;
    if (token) headers.Authorization = 'Bearer ' + token;
  }

  return headers;
}


async function api(path, opts = {}) {
  if (USE_MOCK_API) {
    try {
      return await mockApi(path, opts);
    } catch (e) {
      maybePromptUpgradeForAiLimit(e?.message || String(e));
      throw e;
    }
  }
  const r = await fetch('/api/' + path, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(await authHeaders()) }
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!r.ok) {
    const msg = (body && (body.error || body.message)) ? (body.error || body.message) : ('Request failed: ' + r.status);
    maybePromptUpgradeForAiLimit(msg);
    throw new Error(msg);
  }
  try { if (typeof _apSyncFromApi === 'function') _apSyncFromApi(path, body); } catch (e) {}
  return body;
}


function setFeedbackOverlay(required, campaign) {
  const overlay = el('feedbackOverlay');
  if (!overlay) return;

  overlay.classList.toggle('hidden', !required);
  feedbackGateState = {
    required: !!required,
    campaign: campaign || null
  };

  if (!required || !campaign) return;

  const title = el('feedbackTitle');
  const question = el('feedbackQuestion');
  const input = el('feedbackInput');
  const submitBtn = el('feedbackSubmitBtn');
  const err = el('feedbackError');

  if (title) title.innerText = campaign.title || 'Quick feedback request';
  if (question) question.innerText = campaign.question || 'What should we improve?';
  if (input) input.placeholder = campaign.placeholder || 'Share your feedback';
  if (submitBtn) submitBtn.innerText = campaign.submit_label || 'Submit feedback';
  if (err) err.innerText = '';
}

async function ensureFeedbackGate() {
  if (!currentUser) {
    setFeedbackOverlay(false, null);
    return;
  }
  const status = await api('feedback-status');
  setFeedbackOverlay(!!status.required, status.campaign || null);
}

async function submitFeedbackResponse() {
  if (!feedbackGateState.required || !feedbackGateState.campaign) return;

  const input = el('feedbackInput');
  const err = el('feedbackError');
  const submitBtn = el('feedbackSubmitBtn');
  const responseText = (input?.value || '').trim();

  if (responseText.length < 5) {
    if (err) err.innerText = 'Please add at least a short response before submitting.';
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (err) err.innerText = '';

  try {
    await api('feedback-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaign_id: feedbackGateState.campaign.id,
        response_text: responseText
      })
    });
    if (input) input.value = '';
    setFeedbackOverlay(false, null);
    setStatus('Thanks for your feedback.');
  } catch (e) {
    if (err) err.innerText = e.message || String(e);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}


let pendingExtraction = null;
let pendingPlateEstimate = null;


function openSheet() {
  el('sheetError').innerText = '';
  const overlayEl = el('sheetOverlay');
  const sheetEl = el('servingsSheet');

  // Some boot-time cleanup sets inline styles (display/pointer-events/opacity) on overlays.
  // Ensure we undo that here so the sheet can actually appear.
  overlayEl.classList.remove('hidden');
  sheetEl.classList.remove('hidden');
  overlayEl.hidden = false;
  sheetEl.hidden = false;
  overlayEl.style.display = 'block';
  overlayEl.style.pointerEvents = 'auto';
  overlayEl.style.opacity = '1';
  sheetEl.style.display = 'block';
}

function closeSheet() {
  const overlay = el('sheetOverlay');
  const sheet = el('servingsSheet');
  if (sheet) {
    sheet.classList.add('hidden');
    sheet.setAttribute('hidden', 'true');
    sheet.style.display = 'none';
  }
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.setAttribute('hidden', 'true');
    overlay.style.display = 'none';
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
  }
  document.body.style.overflow = '';

}

function openEstimateSheet() {
  el('estimateError').innerText = '';
  const overlayEl = el('estimateOverlay');
  const sheetEl = el('plateEstimateSheet');

  overlayEl.classList.remove('hidden');
  sheetEl.classList.remove('hidden');

  // Undo boot-time inline-hiding applied by hideAllBlockingOverlays().
  overlayEl.hidden = false;
  sheetEl.hidden = false;
  overlayEl.style.display = 'block';
  overlayEl.style.pointerEvents = 'auto';
  overlayEl.style.opacity = '1';
  sheetEl.style.display = 'block';

  // Bind handlers after the estimate sheet is rendered/visible.
  const overlay = el('estimateOverlay');
  const closeBtn = el('estimateCloseBtn');
  const cancelBtn = el('estimateCancelBtn');
  const saveBtn = el('estimateSaveBtn');

  if (overlay) {
    overlay.onclick = (e) => { if (e && e.target === overlay) closeEstimateSheet(); };
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
  const overlay = el('estimateOverlay');
  const sheet = el('plateEstimateSheet');
  if (sheet) {
    sheet.classList.add('hidden');
    sheet.setAttribute('hidden', 'true');
    sheet.style.display = 'none';
  }
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.setAttribute('hidden', 'true');
    overlay.style.display = 'none';
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
  }
  // Restore page scroll lock state
  document.body.style.overflow = '';

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
  // Prevent duplicate writes when the button is tapped twice or multiple listeners exist.
  if (window.__plateEstimateSaveInFlight) return;
  window.__plateEstimateSaveInFlight = true;
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
        raw_extraction_meta: meta,
        date: activeEntryDateISO()
      })
    });
    setStatus('');
    closeEstimateSheet();
    await refresh();
  } catch (e) {
    setStatus('');
    try { el('estimateError').innerText = e.message; } catch {}
  } finally {
    window.__plateEstimateSaveInFlight = false;
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
        extracted: pendingExtraction,
        date: activeEntryDateISO()
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
  if (billingController) await billingController.loadBillingStatus();
  await refresh();
}



function renderAiSuggestion(result) {
  aiGoalSuggestion = { ...result, goal_weight_lbs: aiGoalInputs.goal_weight_lbs, activity_level: aiGoalInputs.activity_level, goal_date: aiGoalInputs.goal_date };
  el('aiSuggestedCalories').innerText = String(result.daily_calories);
  el('aiSuggestedProtein').innerText = String(result.protein_g);
  el('aiSuggestedCarbs').innerText = String(result.carbs_g);
  el('aiSuggestedFat').innerText = String(result.fat_g);

  const ul = el('aiRationaleList');
  ul.innerHTML = '';
  (result.rationale_bullets || []).forEach((b) => {
    const li = document.createElement('li');
    li.innerText = b;
    ul.appendChild(li);
  });
}

async function requestAiGoalSuggestion(editRequest = null) {
  if (!aiGoalInputs) throw new Error('Set goal inputs first.');
  const result = await withThinking(async () => api('ai-goals-suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...aiGoalInputs,
      edit_request: editRequest,
      messages: aiGoalThread
    })
  }));

  const summary = `Plan: ${result.daily_calories} cal, P${result.protein_g} C${result.carbs_g} F${result.fat_g}. Rationale: ${(result.rationale_bullets || []).join(' | ')}`;
  if (editRequest) aiGoalThread.push({ role: 'user', content: editRequest });
  aiGoalThread.push({ role: 'assistant', content: summary });

  renderAiSuggestion(result);
  showOnboardingScreen('suggestion');
}


async function submitAiGoalInputs() {
  const activity = el('aiActivityLevelInput').value;
  const validation = validateAiGoalFields();
  if (!validation.ok) throw new Error('Please fix the highlighted fields.');

  aiGoalInputs = {
    current_weight_lbs: validation.currentLbs,
    goal_weight_lbs: validation.goalLbs,
    activity_level: activity,
    goal_date: validation.goalDate
  };
  aiGoalThread = [
    { role: 'user', content: `Create an initial plan for current ${validation.currentLbs} lbs, goal ${validation.goalLbs} lbs, activity ${activity}, goal date ${validation.goalDate}.` }
  ];

  setAiGoalLoading(true);
  el('aiGoalFlowError').innerText = '';
  try {
    await requestAiGoalSuggestion(null);
  } finally {
    setAiGoalLoading(false);
  }
}


async function submitAiPlanEdit() {
  if (!aiGoalInputs) throw new Error('Generate a plan first.');
  const request = (el('aiEditPlanInput')?.value || '').trim();
  if (!request) throw new Error('Please describe what you want to change.');
  setAiGoalLoading(true);
  el('aiSuggestionError').innerText = '';
  try {
    await requestAiGoalSuggestion(request);
    el('aiEditPlanInput').value = '';
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
  hideAllBlockingOverlays();
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
  hideAllBlockingOverlays();
}

function openAiGoalFlow(mode) {
  aiGoalFlowMode = mode;
  resetAiGoalFlowForm();
  document.querySelectorAll('.aiInputUnitText').forEach(n => { n.innerText = unitSuffix(); });
  el('aiGoalDateInput').min = isoToday();
  const showWelcome = mode === 'onboarding';
  el('onboardingTitle').innerText = showWelcome ? 'Welcome to Aethon Calorie Tracker' : 'Generate AI calorie & macro goals';
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

async function uploadFoodFromInput(inputId = 'photoInput') {
  const input = el(inputId);
  const file = input.files && input.files[0];
  if (!file) return;

  setStatus('Extracting nutrition info…');
  const imageDataUrl = await fileToDataUrl(file);

  // Extract only (do not insert yet)
  const j = await withThinking(async () => api('entries-add-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, extract_only: true })
  }));

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

async function uploadPlateFromInput(inputId = 'plateInput') {
  const input = el(inputId);
  const file = input.files && input.files[0];
  if (!file) return;

  setStatus('Estimating…');
  const imageDataUrl = await fileToDataUrl(file);

  const servings_eaten = 1.0;

  const j = await withThinking(async () => api('entries-estimate-plate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, servings_eaten, portion_hint: null })
  }));

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


async function uploadUnifiedPhotoFromInput(inputId = 'photoModeCameraInput') {
  const input = el(inputId);
  const file = input && input.files && input.files[0];
  if (!file) return;
  const imageDataUrl = await fileToDataUrl(file);
  input.value = '';

  // Close the Add Food modal before showing any sheet (prevents stacking issues)
  showAddFoodPanel(null);

  if (activePhotoMode === 'label') {
    try {
      setStatus('Analyzing label…');
      const j = await withThinking(async () => api('entries-add-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl, extract_only: true })
      }));
      setStatus('');
      pendingExtraction = j.extracted;
      el('servingsEatenInput').value = '1.0';
      el('calPerServingInput').value = (pendingExtraction.calories_per_serving ?? '').toString();
      el('proteinPerServingInput').value = pendingExtraction.protein_g_per_serving == null ? '' : String(pendingExtraction.protein_g_per_serving);
      el('servingsEatenInput').oninput = computeTotalsPreview;
      el('calPerServingInput').oninput = computeTotalsPreview;
      el('proteinPerServingInput').oninput = computeTotalsPreview;
      computeTotalsPreview();
      openSheet();
      return;
    } catch (e) {
      setStatus('');
      setStatus('Could not read a nutrition label from that photo. Try Plate mode or retake the photo.');
      return;
    }
  }

  // Plate mode
  setStatus('Estimating plate…');
  const j = await withThinking(async () => api('entries-estimate-plate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, servings_eaten: 1.0, portion_hint: null })
  }));
  setStatus('');

  pendingPlateEstimate = j;
  el('estimateServingsInput').value = '1';
  el('estimateCaloriesInput').value = j.calories ?? '';
  el('estimateProteinInput').value = (j.protein_g == null ? '' : String(Math.round(j.protein_g)));
  el('estimateCarbsInput').value = (j.carbs_g == null ? '' : String(Math.round(j.carbs_g)));
  el('estimateFatInput').value = (j.fat_g == null ? '' : String(Math.round(j.fat_g)));
  setBadge(j.confidence || 'low');

  const ul = el('estimateAssumptions');
  ul.innerHTML = '';
  (j.assumptions || []).forEach((a) => {
    const li = document.createElement('li');
    li.innerText = a;
    ul.appendChild(li);
  });
  el('estimateNotes').innerText = j.notes ? j.notes : '';
  openEstimateSheet();
}

function showAddFoodPanel(panelId = null) {
  const ids = ['addFoodPhotoPanel', 'addFoodVoicePanel', 'addFoodQuickFillPanel', 'addFoodManualPanel'];
  ids.forEach((id) => {
    const node = el(id);
    if (!node) return;
    const active = !!panelId && id === panelId;
    node.classList.toggle('hidden', !active);
    node.classList.toggle('modalActive', active);
  });

  const overlay = el('addFoodOverlay');
  if (overlay) overlay.classList.toggle('hidden', !panelId);

  // Keep the active panel centered/visible on mobile by preventing page scroll
  // and resetting scroll position each time a modal is opened.
  if (panelId) {
    document.body.style.overflow = 'hidden';
    try {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch {
      window.scrollTo(0, 0);
    }
  } else {
    document.body.style.overflow = '';
  }

  activeAddFoodPanel = panelId;
}

function stopVoiceRecognition() {
  if (!voiceRecognition) return;
  voiceIsListening = false;
  updateVoiceToggleLabel();
  try { voiceRecognition.stop(); } catch {}
}

function updateVoiceToggleLabel() {
  const btn = el('voiceToggleBtn');
  if (btn) btn.innerText = voiceIsListening ? '■ Stop Voice Input' : '🎤 Start Voice Input';
}

function ensureVoiceRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  if (voiceRecognition) return voiceRecognition;
  voiceRecognition = new SR();
  voiceRecognition.continuous = false;
  voiceRecognition.interimResults = false;
  voiceRecognition.lang = 'en-US';
  voiceRecognition.onresult = (event) => {
    const text = Array.from(event.results || []).map((r) => r[0]?.transcript || '').join(' ').trim();
    if (!text) return;
    const field = el('voiceFoodInput');
    field.value = [field.value, text].filter(Boolean).join(' ').trim();
  };
  voiceRecognition.onend = () => {
    voiceIsListening = false;
    updateVoiceToggleLabel();
    setStatus('');
    const msg = (el('voiceFoodInput')?.value || '').trim();
    if (voiceAutoSendPending && msg) sendVoiceFoodMessage().catch((e) => setStatus(e.message));
    voiceAutoSendPending = false;
  };
  voiceRecognition.onerror = () => {
    voiceIsListening = false;
    updateVoiceToggleLabel();
    setStatus('Voice input error. You can type your meal details instead.');
  };
  return voiceRecognition;
}

async function sendVoiceFoodMessage() {
  const input = el('voiceFoodInput');
  const message = (input?.value || '').trim();
  if (!message) return;
  const out = el('voiceFoodOutput');
  out.innerText = `${out.innerText ? `${out.innerText}\n\n` : ''}You: ${message}`;
  input.value = '';
  setStatus('Asking voice nutrition assistant…');
  const j = await withThinking(async () => api('voice-food-add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history: voiceFoodHistory, followups_used: voiceFollowUpCount, followups_limit: 2 })
  }));
  setStatus('');
  voiceFoodHistory.push({ role: 'user', text: message });
  voiceFoodHistory.push({ role: 'assistant', text: j.reply || '' });
  out.innerText = `${out.innerText}\nAssistant: ${j.reply || ''}`;

  if (j.needs_follow_up) {
    voiceFollowUpCount += 1;
  }

  if (j.suggested_entry) {
    el('manualCaloriesInput').value = j.suggested_entry.calories ?? '';
    el('manualProteinInput').value = j.suggested_entry.protein_g ?? '';
    el('manualCarbsInput').value = j.suggested_entry.carbs_g ?? '';
    el('manualFatInput').value = j.suggested_entry.fat_g ?? '';
    el('manualNotesInput').value = j.suggested_entry.notes || 'Voice estimate';
    voiceFollowUpCount = 0;
    showAddFoodPanel('addFoodManualPanel');
  }

  if (j.audio_base64) {
    const audio = new Audio(`data:${j.audio_mime_type || 'audio/mp3'};base64,${j.audio_base64}`);
    audio.play().catch(() => {});
  } else if ('speechSynthesis' in window && j.reply) {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(j.reply));
  }
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
      const name = entryFriendlyName(e);
      text.innerText = `${ts} — ${name} • ${e.calories} cal` + suffix + tag;
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
  const dateISO = activeEntryDateISO();
  const j = await api('entries-list-day?date=' + encodeURIComponent(dateISO));
  const entries = j.entries || [];

  const totalProtein = entries.reduce((sum, e) => sum + (Number(e.protein_g) || 0), 0);
  const totalCarbs = entries.reduce((sum, e) => sum + (Number(e.carbs_g) || 0), 0);
  const totalFat = entries.reduce((sum, e) => sum + (Number(e.fat_g) || 0), 0);

  el('todayCalories').innerText = j.total_calories ?? 0;
  el('todayProtein').innerText = Math.round(totalProtein);
  el('todayCarbs').innerText = Math.round(totalCarbs);
  el('todayFat').innerText = Math.round(totalFat);
  const entriesCountNode = el('todayEntriesCount');
  if (entriesCountNode) entriesCountNode.innerText = String(entries.length);

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

  const proteinProgressText = el('proteinProgressText');
  if (proteinProgressText) proteinProgressText.innerText = proteinPercent == null ? 'No goal set' : `${Math.round(totalProtein)} / ${Math.round(pGoal)}g`;
  const carbsProgressText = el('carbsProgressText');
  if (carbsProgressText) carbsProgressText.innerText = carbsPercent == null ? 'No goal set' : `${Math.round(totalCarbs)} / ${Math.round(cGoal)}g`;
  const fatProgressText = el('fatProgressText');
  if (fatProgressText) fatProgressText.innerText = fatPercent == null ? 'No goal set' : `${Math.round(totalFat)} / ${Math.round(fGoal)}g`;

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

// ===============================
// QUICK FILL AUTO LOG (v42)
// ===============================
async function applyQuickFillAndLog(presetId) {
  // Fill the manual inputs from the preset, then immediately save the entry.
  applyManualPreset(presetId);
  // Ensure notes defaults to the preset name if empty
  const p = (profileState.quick_fills || []).find((x) => x.id === presetId);
  const notesEl = el('manualNotesInput');
  if (notesEl && (!notesEl.value || !String(notesEl.value).trim()) && p?.name) {
    notesEl.value = p.name;
  }
  try {
    await saveManualEntry();
  } catch (e) {
    // saveManualEntry already sets status; keep console for debugging
    console.error('Quick Fill save failed', e);
  }
}



function renderQuickFillButtons() {
  const row = el('quickFillsRow');
  const block = el('quickAddsBlock');
  const ctaRow = el('quickFillsCtaRow');
  if (!row || !block) return;
  row.innerHTML = '';
  const active = (profileState.quick_fills || []).filter((q) => q.enabled);
  block.classList.toggle('empty', active.length === 0);
  if (ctaRow) ctaRow.classList.toggle('hidden', active.length > 0);

  for (const q of active) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quickFillBtn';
    btn.dataset.preset = q.id;
    btn.innerText = q.name;
    btn.onclick = () => applyQuickFillAndLog(q.id);
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
  const dateISO = activeEntryDateISO();
  const j = await api('weight-get?date=' + encodeURIComponent(dateISO));
  const dayLabel = formatDayLabel(selectedDayOffset);
  el('weightDisplay').innerText = j.weight_lbs != null ? (`${dayLabel}: ` + displayWeight(j.weight_lbs) + ' ' + unitSuffix()) : `No weight logged for ${dayLabel.toLowerCase()}`;
}

async function saveWeight() {
  const wLbs = inputToLbs(el('weightInput').value);
  await api('weight-set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weight_lbs: wLbs, date: activeEntryDateISO() })
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
  const j = await api('day-finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: activeEntryDateISO() }) });
  const rawScore = Number(j.score);
  const maxScore = Number.isFinite(rawScore) && rawScore > 10 ? 100 : 10;
  const scoreText = Number.isFinite(rawScore) ? `${Math.round(rawScore)}/${maxScore}` : '—';
  el('scoreOutput').innerText = `Score: ${scoreText}\n\n${j.tips}`;
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
  await ensureFeedbackGate();
  if (feedbackGateState.required) return;
  const goal = await loadGoal();
  await loadToday();
  await loadWeight();
  if (billingController) await billingController.loadBillingStatus();
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
      date: activeEntryDateISO(),
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
  const loginBtn = el('loginBtn');
  const logoutBtn = el('logoutBtn');
  if (loginBtn) loginBtn.onclick = () => openIdentityModal('login');
  if (logoutBtn) logoutBtn.onclick = () => { if (typeof netlifyIdentity !== 'undefined') netlifyIdentity.logout(); };
  const enterMockBtn = el('enterMockBtn');
  const resetMockBtn = el('resetMockBtn');
  if (enterMockBtn) enterMockBtn.onclick = () => initAuthedSession().catch(e => setStatus(e.message));
  if (resetMockBtn) resetMockBtn.onclick = () => { resetMockState(); setStatus('Local demo data reset. Starting fresh onboarding…'); initAuthedSession().catch(e => setStatus(e.message)); };
  el('saveGoalBtn').onclick = () => saveGoal().catch(e => setStatus(e.message));
  const unifiedPhotoInputIds = ['photoModeCameraInput'];
  unifiedPhotoInputIds.forEach((id) => {
    const node = el(id);
    if (!node) return;
    node.onchange = () => uploadUnifiedPhotoFromInput(id).catch((e) => setStatus(e.message));
  });
  el('saveWeightBtn').onclick = () => saveWeight().catch(e => setStatus(e.message));
  el('finishDayBtn').onclick = () => finishDay().catch(e => setStatus(e.message));
  el('sendChatBtn').onclick = () => sendChat().catch(e => setStatus(e.message));
  el('feedbackSubmitBtn').onclick = () => submitFeedbackResponse();

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
    if (!isDash) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
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

  const autoLoginToggle = el('autoLoginToggle');
  const autoLoginLabel = el('autoLoginLabel');
  if (autoLoginToggle) autoLoginToggle.checked = deviceAutoLoginEnabled;
  if (autoLoginLabel) autoLoginLabel.innerText = deviceAutoLoginEnabled ? 'On' : 'Off';

  const viewSpanToggle = el('viewSpanToggle');
  const viewSpanLabel = el('viewSpanLabel');
  const viewSpanConfig = el('viewSpanConfig');
  const viewSpanPastInput = el('viewSpanPastInput');
  const viewSpanFutureInput = el('viewSpanFutureInput');
  if (viewSpanToggle) viewSpanToggle.checked = viewSpanEnabled;
  if (viewSpanLabel) viewSpanLabel.innerText = viewSpanEnabled ? 'On' : 'Off';
  if (viewSpanConfig) viewSpanConfig.classList.toggle('hidden', !viewSpanEnabled);
  if (viewSpanPastInput) viewSpanPastInput.value = String(viewSpanPastDays);
  if (viewSpanFutureInput) viewSpanFutureInput.value = String(viewSpanFutureDays);

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

  if (autoLoginToggle) {
    autoLoginToggle.onchange = () => {
      deviceAutoLoginEnabled = !!autoLoginToggle.checked;
      localStorage.setItem(DEVICE_AUTO_LOGIN_STORAGE_KEY, String(deviceAutoLoginEnabled));
      if (autoLoginLabel) autoLoginLabel.innerText = deviceAutoLoginEnabled ? 'On' : 'Off';
      if (!USE_MOCK_API && !currentUser) {
        if (deviceAutoLoginEnabled) {
          initAuthedSession().catch((e) => setStatus(e.message));
        } else {
          setStatus('Auto log in disabled for this device. You will be asked to sign in next time.');
        }
      }
    };
  }

  if (viewSpanToggle) {
    viewSpanToggle.onchange = () => {
      viewSpanEnabled = !!viewSpanToggle.checked;
      localStorage.setItem(VIEW_SPAN_ENABLED_KEY, String(viewSpanEnabled));
      if (viewSpanLabel) viewSpanLabel.innerText = viewSpanEnabled ? 'On' : 'Off';
      if (viewSpanConfig) viewSpanConfig.classList.toggle('hidden', !viewSpanEnabled);
      if (!viewSpanEnabled) selectedDayOffset = 0;
      renderTodayDateNavigator();
      refresh().catch((e) => setStatus(e.message));
    };
  }
  if (viewSpanPastInput) {
    viewSpanPastInput.onchange = () => {
      const next = Math.max(0, Math.min(6, Number(viewSpanPastInput.value) || 0));
      viewSpanPastDays = next;
      viewSpanPastInput.value = String(next);
      localStorage.setItem(VIEW_SPAN_PAST_DAYS_KEY, String(next));
      renderTodayDateNavigator();
      refresh().catch((e) => setStatus(e.message));
    };
  }
  if (viewSpanFutureInput) {
    viewSpanFutureInput.onchange = () => {
      const next = Math.max(0, Math.min(7, Number(viewSpanFutureInput.value) || 0));
      viewSpanFutureDays = next;
      viewSpanFutureInput.value = String(next);
      localStorage.setItem(VIEW_SPAN_FUTURE_DAYS_KEY, String(next));
      renderTodayDateNavigator();
      refresh().catch((e) => setStatus(e.message));
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
  const onboardingSignInBtn = el('onboardingSignInBtn');
  if (onboardingSignInBtn) onboardingSignInBtn.onclick = () => {
    skipOnboardingAfterLogin = true;
    setOnboardingVisible(false);
    openIdentityModal('login');
  };
  ['aiCurrentWeightInput','aiGoalWeightInput','aiGoalDateInput'].forEach((id) => {
    const node = el(id);
    if (!node) return;
    node.onblur = () => { validateAiGoalFields(); };
  });
  el('aiGetPlanBtn').onclick = () => submitAiGoalInputs().catch(e => { el('aiGoalFlowError').innerText = e.message + ' Try again.'; });
  el('aiAcceptPlanBtn').onclick = () => acceptAiPlan().catch(e => { el('aiSuggestionError').innerText = e.message; });
  el('aiDeclinePlanBtn').onclick = () => declineAiPlan().catch(e => { el('aiSuggestionError').innerText = e.message; });
  el('aiEditPlanBtn').onclick = () => { const b = el('aiEditPlanBlock'); if (b) b.classList.toggle('hidden'); };
  el('aiEditPlanSubmitBtn').onclick = () => submitAiPlanEdit().catch(e => { el('aiSuggestionError').innerText = e.message; });
  el('settingsAiGoalBtn').onclick = () => openAiGoalFlow('settings');

  // Initialize UI state
  el('weightInput').placeholder = unitSuffix();
  activateTab('dashboard');
  showAddFoodPanel(null);
  updateVoiceToggleLabel();
  renderTodayDateNavigator();

  // Click bindings that may not exist until a sheet/modal is rendered
  const bindClick = (id, handler) => {
    const node = el(id);
    if (node) { node.onclick = handler; node.__aethonSaveBound = true; }
  };

  // Servings sheet
  // Backdrop click should only close when clicking the backdrop itself (not inside the sheet)
(function() {
  const ov = el('sheetOverlay');
  if (!ov) return;
  ov.addEventListener('click', (e) => {
    if (e.target === ov) closeSheet();
  });
})();
  bindClick('sheetCloseBtn', () => closeSheet());
  bindClick('sheetCancelBtn', () => closeSheet());
  bindClick('sheetSaveBtn', () => saveFromSheet());

  // Manual entry
  bindClick('manualSaveBtn', () => saveManualEntry());
  bindClick('saveQuickFillBtn', () => addQuickFill());
  bindClick('addQuickFillsCtaBtn', () => {
    const sBtn = el('tabSettingsBtn');
    if (sBtn) sBtn.click();
    const sec = el('quickFillSettingsSection');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  bindClick('settingsSignUpBtn', () => openIdentityModal('signup'));
  bindClick('settingsSignInBtn', () => openIdentityModal('login'));

  bindClick('addFoodPhotoBtn', () => showAddFoodPanel('addFoodPhotoPanel'));
  bindClick('addFoodVoiceBtn', () => { voiceFollowUpCount = 0; showAddFoodPanel('addFoodVoicePanel'); });
  bindClick('addFoodQuickFillBtn', () => showAddFoodPanel('addFoodQuickFillPanel'));
  bindClick('addFoodManualBtn', () => showAddFoodPanel('addFoodManualPanel'));
  bindClick('addFoodOverlay', () => showAddFoodPanel(null));
  document.querySelectorAll('.addFoodModalCloseBtn').forEach((n) => { n.onclick = () => showAddFoodPanel(null); });

  bindClick('todayPrevBtn', () => { if (!viewSpanEnabled) return; selectedDayOffset = Math.max(-viewSpanPastDays, selectedDayOffset - 1); renderTodayDateNavigator(); refresh().catch(e => setStatus(e.message)); });
  bindClick('todayNextBtn', () => { if (!viewSpanEnabled) return; selectedDayOffset = Math.min(viewSpanFutureDays, selectedDayOffset + 1); renderTodayDateNavigator(); refresh().catch(e => setStatus(e.message)); });
  bindClick('photoLabelBtn', () => { activePhotoMode = 'label'; const n = el('photoModeCameraInput'); if (n) n.click(); });
  bindClick('photoPlateBtn', () => { activePhotoMode = 'plate'; const n = el('photoModeCameraInput'); if (n) n.click(); });

  bindClick('voiceToggleBtn', () => {
    const recognition = ensureVoiceRecognition();
    if (!recognition) {
      setStatus('Voice recognition is not available on this browser. Type your meal details instead.');
      return;
    }
    if (voiceIsListening) {
      stopVoiceRecognition();
      return;
    }
    voiceIsListening = true;
    voiceAutoSendPending = true;
    updateVoiceToggleLabel();
    setStatus('Listening…');
    recognition.start();
  });

  bindClick('toggleDailyGoalsBtn', () => toggleSection('dailyGoalsBody', 'toggleDailyGoalsBtn'));
  bindClick('toggleAddFoodBtn', () => toggleSection('addFoodBody', 'toggleAddFoodBtn'));
  // Coach chat is now opened/closed via a floating button (bottom-right).
  // Keep the existing "Hide" button as a close control.
  bindClick('chatToggleBtn', () => {
    const card = el('coachChatCard');
    if (card) card.classList.remove('open');
    const fab = el('coachFab');
    if (fab) fab.setAttribute('aria-expanded', 'false');
  });
  bindClick('upgradeMonthlyBtn', () => billingController && billingController.startUpgradeCheckout('monthly'));
  bindClick('upgradeYearlyBtn', () => billingController && billingController.startUpgradeCheckout('yearly'));
  bindClick('manageSubscriptionBtn', () => billingController && billingController.openManageSubscription());
  bindClick('exportDataBtn', () => billingController && billingController.exportMyData());

  // Floating coach button toggles the chat window.
  const coachFab = el('coachFab');
  if (coachFab) {
    coachFab.onclick = () => {
      const card = el('coachChatCard');
      if (!card) return;
      const isOpen = card.classList.contains('open');
      if (isOpen) {
        card.classList.remove('open');
        coachFab.setAttribute('aria-expanded', 'false');
      } else {
        card.classList.add('open');
        coachFab.setAttribute('aria-expanded', 'true');
        // focus input for fast typing
        const input = el('chatInput');
        if (input) input.focus();
      }
    };
  }

  // Close coach chat with Escape
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const card = el('coachChatCard');
    if (card) card.classList.remove('open');
    if (coachFab) coachFab.setAttribute('aria-expanded', 'false');
  });
}



function hideNetlifyIdentityOverlays() {
  // Netlify Identity injects overlays/modals with varying selectors depending on version.
  const selectors = [
    '#netlify-identity-overlay',
    '#netlify-identity-modal',
    '#netlify-identity-widget',
    '.netlify-identity-overlay',
    '.netlify-identity-modal',
    '.netlify-identity-widget',
    '[data-netlify-identity-widget]'
  ];
  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((node) => {
      try {
        node.style.display = 'none';
        node.style.pointerEvents = 'none';
      } catch {}
    });
  });
  try { document.body.classList.remove('netlify-identity-open'); } catch {}
}

function hideAllBlockingOverlays() {
  // Make sure no full-screen overlay can linger and dim/block the UI.
  const ids = [
    'onboardingOverlay',
    'feedbackOverlay',
    'sheetOverlay',
    'addFoodOverlay',
    'estimateOverlay'
  ];
  ids.forEach((id) => {
    const node = el(id);
    if (!node) return;
    node.classList.add('hidden');
    node.style.display = 'none';
    node.style.pointerEvents = 'none';
    node.style.opacity = '0';
    // Some overlays also use the HTML hidden attribute.
    try { node.hidden = true; } catch {}
  });

  // Hide sheets/panels if they exist.
  const sheetIds = ['servingsSheet', 'plateEstimateSheet'];
  sheetIds.forEach((id) => {
    const node = el(id);
    if (!node) return;
    node.classList.add('hidden');
    node.style.display = 'none';
    try { node.hidden = true; } catch {}
  });

  // Restore scrolling if any modal previously disabled it.
  try { document.body.style.overflow = ''; } catch {}
}


function openIdentityModal(mode = 'login') {
  if (typeof netlifyIdentity === 'undefined') {
    setStatus('Sign in is not available in this environment yet.');
    return;
  }

  const onboardingVisible = !el('onboardingOverlay')?.classList.contains('hidden');
  if (onboardingVisible) setOnboardingVisible(false);

  const raiseIdentityWidget = () => {
    setTimeout(() => {
      const widget = document.querySelector('.netlify-identity-widget');
      if (widget) widget.style.zIndex = '20000';
      const modal = document.querySelector('.netlify-identity-widget .modal');
      if (modal) modal.style.zIndex = '20001';
    }, 0);
  };

  try {
    netlifyIdentity.open(mode === 'signup' ? 'signup' : 'login');
    raiseIdentityWidget();
  } catch {
    netlifyIdentity.open();
    raiseIdentityWidget();
  }
}

async function initAuthedSession(opts = {}) {
  const { skipOnboarding = false, onboardingMode = 'onboarding' } = opts;
  const landing = el('mockLanding');
  if (landing) landing.classList.add('hidden');
  showApp(true);
  await loadProfile();
  await loadLinkedDevices();
  await ensureFeedbackGate();
  if (feedbackGateState.required) return;
  if (!skipOnboarding && !profileState.onboarding_completed) {
    openAiGoalFlow(onboardingMode);
    return;
  }
  setOnboardingVisible(false);
  await refresh();
}

if (typeof netlifyIdentity !== 'undefined') {
  netlifyIdentity.on('init', user => {
    currentUser = user;

    if (user) {
      // Logged-in: go straight into the app.
      showApp(true);
      setOnboardingVisible(false);
      setFeedbackOverlay(false, null);
      initAuthedSession({ skipOnboarding: true }).catch(e => setStatus(e.message));
      return;
    }

    // Logged-out: continue as a device session. If onboarding isn't complete for this device,
    // initAuthedSession will open the AI goal flow (settings mode).
    setFeedbackOverlay(false, null);
    initAuthedSession({ skipOnboarding: false, onboardingMode: 'onboarding' }).catch(e => setStatus(e.message));
  });
  netlifyIdentity.on('login', (user) => {
  currentUser = user;
  // Always unlock UI after identity login.
  setOnboardingVisible(false);
  hideNetlifyIdentityOverlays();
  hideAllBlockingOverlays();
  showApp(true);
  setFeedbackOverlay(false, null);

  // Skip onboarding after a paid user logs in.
  initAuthedSession({ skipOnboarding: true }).catch(e => setStatus(e.message));

  try { netlifyIdentity.close(); } catch {}
  setStatus('Logged in.');
});
  netlifyIdentity.on('logout', () => {
    currentUser = null;
    setFeedbackOverlay(false, null);
    linkedDevicesState = [];
    renderDeviceSettings();

    // After logout, fall back to a device session (same-device relogin without identity).
    initAuthedSession({ skipOnboarding: false, onboardingMode: 'onboarding' }).catch(e => setStatus(e.message));
    setStatus('Logged out.');
  });
  netlifyIdentity.on('close', () => {
  // Ensure no stale overlay keeps the app dim/blocked.
  hideNetlifyIdentityOverlays();
  hideAllBlockingOverlays();
});
}

if (window.AppBilling && typeof window.AppBilling.createBillingController === 'function') {
  billingController = window.AppBilling.createBillingController({
    api,
    authHeaders,
    el,
    setStatus,
    getCurrentUser: () => currentUser
  });
}

applyDarkModeUI();
applyFontSizeUI();
bindUI();
const mockModeBadge = el('mockModeBadge');
if (mockModeBadge) {
  mockModeBadge.classList.toggle('hidden', !MOCK_MODE);
  mockModeBadge.innerText = 'Mock Mode';
}

if (MOCK_MODE) {
  showApp(true);
  const landing = el('mockLanding');
  if (landing) landing.classList.add('hidden');
  initAuthedSession().catch(e => setStatus(e.message));
  if (typeof netlifyIdentity !== 'undefined') netlifyIdentity.init();
} else if (typeof netlifyIdentity !== 'undefined') {
  netlifyIdentity.init();
} else if (deviceAutoLoginEnabled) {
  setOnboardingVisible(false);
  initAuthedSession({ skipOnboarding: true }).catch(e => setStatus(e.message));
} else {
  showApp(false);
  showLoggedOutOnboarding();
}

// Ensure Coach Chat is a true viewport overlay on mobile.
// If it's nested inside a scroll container in some builds/browsers, move it to <body>.
(() => {
  try {
    const coachCard = document.getElementById('coachChatCard');
    if (coachCard && coachCard.parentElement && coachCard.parentElement !== document.body) {
      document.body.appendChild(coachCard);
    }
  } catch (_) {}
})();

// v27: ensure estimate sheet closes on cancel/x/save
(function(){
  const closeIds = ['estimateCancelBtn','estimateCloseBtn','plateEstimateCancelBtn','plateEstimateCloseBtn','plateEstimateCancel','plateEstimateClose'];
  closeIds.forEach((id)=>{
    const b = el(id);
    if (!b) return;
    b.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); closeEstimateSheet(); });
  });
  const saveIds = ['estimateSaveBtn','plateEstimateSaveBtn','plateEstimateSave'];
  saveIds.forEach((id)=>{
    const b = el(id);
    if (!b) return;
    if (b.__aethonSaveBound) return;
    if (typeof b.onclick === 'function') return;
    b.__aethonSaveBound = true;
    b.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const p = (typeof savePlateEstimateFromSheet === 'function') ? savePlateEstimateFromSheet() : null;
      Promise.resolve(p).finally(()=> closeEstimateSheet());
    });
  });
})();

// v27: ensure servings sheet closes on cancel/x/save
(function(){
  const closeIds = ['sheetCancelBtn','sheetCloseBtn','servingsCancelBtn','servingsCloseBtn','servingsCancel','servingsClose'];
  closeIds.forEach((id)=>{
    const b = el(id);
    if (!b) return;
    b.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); closeSheet(); });
  });
  const saveIds = ['sheetSaveBtn','servingsSaveBtn','servingsSave'];
  saveIds.forEach((id)=>{
    const b = el(id);
    if (!b) return;
    if (b.__aethonSaveBound) return;
    if (typeof b.onclick === 'function') return;
    b.__aethonSaveBound = true;
    b.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const p = (typeof saveFromSheet === 'function') ? saveFromSheet() : null;
      Promise.resolve(p).finally(()=> closeSheet());
    });
  });
})();

// v29: ensure nutrition label estimate sheet closes on cancel/x/save
(function(){
  const closeIds = [
    'sheetCancelBtn','sheetCloseBtn',
    'servingsCancelBtn','servingsCloseBtn',
    'labelEstimateCancel','labelEstimateClose'
  ];
  closeIds.forEach((id)=>{
    const b = el(id);
    if (!b) return;
    b.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      closeSheet();
    });
  });

  const saveIds = ['labelEstimateSave','labelEstimateSaveBtn'];
  saveIds.forEach((id)=>{
    const b = el(id);
    if (!b) return;
    if (b.__aethonSaveBound) return;
    if (typeof b.onclick === 'function') return;
    b.__aethonSaveBound = true;
    b.addEventListener('click', (e)=>{
      e.preventDefault();
      e.stopPropagation();
      const p = (typeof saveFromSheet === 'function') ? saveFromSheet() : null;
      Promise.resolve(p).finally(()=> closeSheet());
    });
  });
})();


// ===============================
// CHEAT DAY (v35)
// ===============================
function getCheatDayConfig() {
  return {
    enabled: localStorage.getItem('cheat_day_enabled') === '1',
    dow: parseInt(localStorage.getItem('cheat_day_dow') || '6', 10), // default Saturday
    extra: parseInt(localStorage.getItem('cheat_day_extra') || '0', 10),
  };
}

function getBaseDailyCalorieGoal() {
  // Base daily target set by goals/autopilot (stored as "calorie_goal")
  const base = parseInt(localStorage.getItem('calorie_goal') || '0', 10) || 0;
  return base;
}

function getEffectiveDailyCalorieGoal(date) {
  const base = getBaseDailyCalorieGoal();
  const cfg = getCheatDayConfig();
  if (!base || !cfg.enabled || !cfg.extra) return base;

  const d = date ? new Date(date) : new Date();
  const dow = d.getDay(); // 0=Sun..6=Sat
  const deltaOther = Math.round(cfg.extra / 6);

  let adjusted = base;
  if (dow === cfg.dow) adjusted = base + cfg.extra;
  else adjusted = base - deltaOther;

  const minFloor = 1200;
  if (adjusted < minFloor) adjusted = minFloor;
  return adjusted;
}



// Returns today's adjusted calorie goal (cheat day pulls calories from other days)
function getTodaysCalorieGoal() {
  return getEffectiveDailyCalorieGoal(new Date());
}

function getWeeklyCaloriePlanText() {
  const base = getBaseDailyCalorieGoal();
  const cfg = getCheatDayConfig();
  if (!base) return '';
  if (!cfg.enabled || !cfg.extra) return `Daily goal: ${base} kcal`;
  const other = Math.max(0, base - Math.round(cfg.extra / 6));
  const cheat = base + cfg.extra;
  return `Cheat day: ${cheat} kcal • Other days: ${other} kcal`;
}

function wireCheatDaySettings() {
  const toggle = document.getElementById('cheatDayToggle');
  const select = document.getElementById('cheatDaySelect');
  const extraInput = document.getElementById('cheatDayExtraInput');
  const status = document.getElementById('cheatDayStatus');
  const saveBtn = document.getElementById('cheatDaySaveBtn');

  if (!toggle || !select || !extraInput) return;

  const cfg = getCheatDayConfig();
  toggle.checked = cfg.enabled;
  select.value = String(isNaN(cfg.dow) ? 6 : cfg.dow);
  extraInput.value = String(isNaN(cfg.extra) ? 0 : cfg.extra);

  function refreshStatus() {
    if (!status) return;
    status.textContent = getWeeklyCaloriePlanText();
  }
  function applyCheatDayNow() {
    // Persist current UI values (even if the user hasn't blurred an input yet)
    localStorage.setItem('cheat_day_enabled', toggle.checked ? '1' : '0');
    localStorage.setItem('cheat_day_dow', String(parseInt(select.value, 10)));
    const v = Math.max(0, parseInt(extraInput.value || '0', 10) || 0);
    localStorage.setItem('cheat_day_extra', String(v));
    refreshStatus();
    if (typeof renderAll === 'function') renderAll();
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      applyCheatDayNow();
    });
  }


  toggle.addEventListener('change', () => {
    localStorage.setItem('cheat_day_enabled', toggle.checked ? '1' : '0');
    refreshStatus();
    if (typeof renderAll === 'function') renderAll();
  });

  select.addEventListener('change', () => {
    localStorage.setItem('cheat_day_dow', String(parseInt(select.value, 10)));
    refreshStatus();
    if (typeof renderAll === 'function') renderAll();
  });

  extraInput.addEventListener('change', () => {
    const v = Math.max(0, parseInt(extraInput.value || '0', 10) || 0);
    localStorage.setItem('cheat_day_extra', String(v));
    refreshStatus();
    if (typeof renderAll === 'function') renderAll();
  });

  refreshStatus();
}

document.addEventListener('DOMContentLoaded', ()=>{ try { wireCheatDaySettings(); } catch(e) {} });


// ===============================
// CHEAT DAY MACROS (v36)
// ===============================
function getBaseMacroGoals() {
  // Base macro targets stored on the profile (not cheat-day adjusted).
  // IMPORTANT: Do not call getTodaysMacroGoals() here (would cause recursion).
  const p = Number(profileState?.macro_protein_g ?? 0) || 0;
  const c = Number(profileState?.macro_carbs_g ?? 0) || 0;
  const f = Number(profileState?.macro_fat_g ?? 0) || 0;
  return { protein_g: p, carbs_g: c, fat_g: f };
}
function macroCalories(macros) {
  return (macros.protein_g * 4) + (macros.carbs_g * 4) + (macros.fat_g * 9);
}
function getTodaysMacroGoals() {
  const baseCals = getBaseDailyCalorieGoal();
  const todayCals = getTodaysCalorieGoal();
  const base = getBaseMacroGoals();
  if (!base.protein_g && !base.carbs_g && !base.fat_g) return base;
  const baseMacroCals = macroCalories(base);
  if (!baseMacroCals || !baseCals) return base;

  const scale = todayCals / baseCals;
  let p = Math.round(base.protein_g * scale);
  let c = Math.round(base.carbs_g * scale);
  let f = Math.round(base.fat_g * scale);

  const cfg = getCheatDayConfig();
  const todayDow = new Date().getDay();
  const isCheat = cfg.enabled && cfg.extra && (todayDow === cfg.dow);
  if (isCheat && base.protein_g) p = Math.max(p, base.protein_g);

  const target = todayCals;
  const c0 = Math.round(base.carbs_g * scale);
  const f0 = Math.round(base.fat_g * scale);
  const cMin = Math.max(0, Math.floor(c0 * 0.95));
  const cMax = Math.ceil(c0 * 1.05);
  const fMin = Math.max(0, Math.floor(f0 * 0.95));
  const fMax = Math.ceil(f0 * 1.05);

  function current() { return (p*4)+(c*4)+(f*9); }

  let iter = 0;
  while (iter < 500) {
    const diff = target - current();
    if (Math.abs(diff) <= 15) break;
    if (diff > 0) {
      if (c < cMax) c += 1;
      else if (f < fMax) f += 1;
      else break;
    } else {
      if (c > cMin) c -= 1;
      else if (f > fMin) f -= 1;
      else break;
    }
    iter += 1;
  }
  return { protein_g: p, carbs_g: c, fat_g: f };
}

function initSettingsTabs_v37() {
  const tabs = document.querySelectorAll('.settingsTab');
  const panes = document.querySelectorAll('.settingsTabPane');
  tabs.forEach(tab=>{
    tab.addEventListener('click', ()=>{
      tabs.forEach(t=>t.classList.remove('active'));
      panes.forEach(p=>p.classList.add('hidden'));
      tab.classList.add('active');
      const target = tab.getAttribute('data-tab');
      document.querySelector('[data-tab-content="'+target+'"]').classList.remove('hidden');
    });
  });

  const sections = document.querySelectorAll('.settingsSection');
  sections.forEach(section=>{
    if(section.id === "cheatDaySettings") {
      document.querySelector('[data-tab-content="nutrition"]').appendChild(section);
    }
    else if(section.innerText && section.innerText.includes("Autopilot")) {
      document.querySelector('[data-tab-content="autopilot"]').appendChild(section);
    }
    else {
      document.querySelector('[data-tab-content="profile"]').appendChild(section);
    }
  });
}
document.addEventListener("DOMContentLoaded", ()=>{
  try { initSettingsTabs_v37(); } catch(e) {}
});


// ===============================
// AUTOPILOT READINESS + PLAN GRAPH (v38)
// ===============================
function _apParseDate(d){try{if(!d)return null;if(typeof d==='number')return new Date(d);if(typeof d==='string'){const dt=new Date(d);if(!isNaN(dt.getTime()))return dt;}if(typeof d==='object'&&d.ts)return new Date(d.ts);}catch(e){}return null;}
function _apStartOfDay(dt){const d=new Date(dt.getTime());d.setHours(0,0,0,0);return d;}
function _apIsoYmd(dt){const d=_apStartOfDay(dt);const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`;}
function _apGetLastNDaysKeys(n){const keys=[];const today=_apStartOfDay(new Date());for(let i=n-1;i>=0;i--){const d=new Date(today.getTime()-i*86400000);keys.push(_apIsoYmd(d));}return keys;}
function _apLoadEntries(){try{return JSON.parse(localStorage.getItem('entries')||'[]');}catch(e){return [];}} 
function _apLoadWeights(){try{return JSON.parse(localStorage.getItem('weights')||'[]');}catch(e){return [];}} 
function _apFoodDaysLast7(){const entries=_apLoadEntries();const keys=new Set(_apGetLastNDaysKeys(7));const days=new Set();entries.forEach(e=>{const dt=_apParseDate(e.date||e.ts||e.created_at||e.createdAt);if(!dt)return;const k=_apIsoYmd(dt);if(keys.has(k))days.add(k);});return days.size;}
function _apWeightsLast14(){const weights=_apLoadWeights();const keys=new Set(_apGetLastNDaysKeys(14));const points=[];weights.forEach(w=>{const dt=_apParseDate(w.date||w.ts||w.created_at||w.createdAt);if(!dt)return;const k=_apIsoYmd(dt);if(keys.has(k))points.push({k,dt,w:(w.weight??w.value??w.lbs??w.kg)});});points.sort((a,b)=>a.dt-b.dt);return points;}
function _apHasGoalConfigured(){const gw=parseFloat(localStorage.getItem('goal_weight')||localStorage.getItem('goal_weight_lbs')||'');const gd=localStorage.getItem('goal_date')||localStorage.getItem('goalDate')||'';const okW=!isNaN(gw)&&gw>0;const okD=!!gd&&!isNaN(new Date(gd).getTime());return okW&&okD;}
function computeAutopilotReadiness_v38(){const foodDays=_apFoodDaysLast7();const weightPts=_apWeightsLast14();const hasGoal=_apHasGoalConfigured();const foodScore=Math.min(1,foodDays/4)*40;let weightScore=0;if(weightPts.length>=2){let ok=false;for(let i=0;i<weightPts.length;i++){for(let j=i+1;j<weightPts.length;j++){const days=Math.abs((weightPts[j].dt-weightPts[i].dt)/86400000);if(days>=6){ok=true;break;}}if(ok)break;}weightScore=ok?40:25;}else if(weightPts.length===1){weightScore=15;}const goalScore=hasGoal?20:0;const score=Math.round(foodScore+weightScore+goalScore);const missing=[];if(foodDays<4)missing.push(`${4-foodDays} more food days`);if(weightPts.length<2)missing.push(`${2-weightPts.length} weigh-in(s)`);if(weightPts.length>=2){let ok=false;for(let i=0;i<weightPts.length;i++){for(let j=i+1;j<weightPts.length;j++){const days=Math.abs((weightPts[j].dt-weightPts[i].dt)/86400000);if(days>=6){ok=true;break;}}if(ok)break;}if(!ok)missing.push(`weigh-ins need 6+ days apart`);}if(!hasGoal)missing.push(`target weight + goal date`);let label='Ready';if(score<40)label='Not ready';else if(score<70)label='Almost ready';else if(score<90)label='Ready';else label='Very ready';return {score,label,missing,foodDays,weightPtsCount:weightPts.length};}
function renderAutopilotReadiness_v38(){const s=computeAutopilotReadiness_v38();const badge=document.getElementById('apReadinessScore');const fill=document.getElementById('apReadinessFill');const label=document.getElementById('apReadinessLabel');const sub=document.getElementById('apReadinessSub');if(!badge||!fill||!label)return;badge.textContent=String(s.score);fill.style.width=`${Math.max(0,Math.min(100,s.score))}%`;label.textContent=`Readiness: ${s.label}`;if(sub){sub.textContent=s.missing.length?`To enable weekly reviews: log ${s.missing.join(', ')}.`:`You have enough data for weekly Autopilot reviews.`;}}
function getPlannedCaloriesForDow_v38(dow){const base=parseInt(localStorage.getItem('calorie_goal')||'0',10)||0;if(!base)return 0;let cfg=null;try{cfg=(typeof getCheatDayConfig==='function')?getCheatDayConfig():null;}catch(e){}if(!cfg||!cfg.enabled||!cfg.extra)return base;const deltaOther=Math.round(cfg.extra/6);const isCheat=dow===cfg.dow;const minFloor=1200;const v=isCheat?(base+cfg.extra):(base-deltaOther);return Math.max(minFloor,v);}
function _apActualCaloriesByDayKeyLast7(){const entries=_apLoadEntries();const keys=_apGetLastNDaysKeys(7);const map={};keys.forEach(k=>map[k]=0);entries.forEach(e=>{const dt=_apParseDate(e.date||e.ts||e.created_at||e.createdAt);if(!dt)return;const k=_apIsoYmd(dt);if(!(k in map))return;const cals=(e.calories??e.kcal??e.cals??e.totalCalories);const n=parseFloat(cals);if(!isNaN(n))map[k]+=n;});return {keys,map};}
function drawCaloriePlanGraph_v38(){const canvas=document.getElementById('apPlanCanvas');if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;const rect=canvas.getBoundingClientRect();const dpr=window.devicePixelRatio||1;canvas.width=Math.max(300,Math.floor(rect.width*dpr));canvas.height=Math.floor(180*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);const W=rect.width;const H=180;ctx.clearRect(0,0,W,H);const padding=14;const chartTop=10;const chartBottom=H-24;const chartH=chartBottom-chartTop;const keys=_apGetLastNDaysKeys(7);const data=_apActualCaloriesByDayKeyLast7();const planned=keys.map(k=>{const dt=new Date(k+'T00:00:00');return getPlannedCaloriesForDow_v38(dt.getDay());});const actual=keys.map(k=>data.map[k]||0);const maxV=Math.max(1,...planned,...actual);const barGap=8;const barW=(W-padding*2-barGap*6)/7;ctx.fillStyle='rgba(255,255,255,0.06)';ctx.fillRect(padding,chartTop+chartH*0.5,W-padding*2,1);for(let i=0;i<7;i++){const x=padding+i*(barW+barGap);const pv=planned[i]||0;const av=actual[i]||0;const ph=(pv/maxV)*chartH;const ah=(av/maxV)*chartH;ctx.fillStyle='rgba(255,255,255,0.20)';ctx.fillRect(x,chartBottom-ph,barW,ph);ctx.strokeStyle='rgba(255,255,255,0.35)';ctx.lineWidth=2;const inset=3;ctx.strokeRect(x+inset,chartBottom-ah,barW-inset*2,ah);const dt=new Date(keys[i]+'T00:00:00');const lbl=dt.toLocaleDateString(undefined,{weekday:'short'}).slice(0,3);ctx.fillStyle='rgba(255,255,255,0.75)';ctx.font='12px system-ui, -apple-system, Segoe UI, Roboto, Arial';ctx.textAlign='center';ctx.fillText(lbl,x+barW/2,H-8);}const sub=document.getElementById('apPlanSub');if(sub){const base=parseInt(localStorage.getItem('calorie_goal')||'0',10)||0;sub.textContent=base?'Planned vs. logged (last 7 days)':'Set a base calorie goal to see the preview.';}}
function initAutopilotWidgets_v38(){renderAutopilotReadiness_v38();drawCaloriePlanGraph_v38();const btn=document.getElementById('apPlanRefreshBtn');if(btn&&!btn.__apBound){btn.__apBound=true;btn.addEventListener('click',()=>{renderAutopilotReadiness_v38();drawCaloriePlanGraph_v38();});}if(!window.__apResizeBound){window.__apResizeBound=true;window.addEventListener('resize',()=>{try{drawCaloriePlanGraph_v38();}catch(e){}});}if(typeof window.renderAll==='function'&&!window.renderAll.__apWrapped){const _orig=window.renderAll;const wrapped=function(){const r=_orig.apply(this,arguments);try{renderAutopilotReadiness_v38();drawCaloriePlanGraph_v38();}catch(e){}return r;};wrapped.__apWrapped=true;window.renderAll=wrapped;}}
document.addEventListener('DOMContentLoaded',()=>{try{initAutopilotWidgets_v38();}catch(e){}});


// ===============================
// GLOBAL AI LOADING (v39)
// ===============================
function showAiLoading(message) {
  const ov = document.getElementById('aiGlobalLoading');
  const txt = document.getElementById('aiGlobalLoadingText');
  if (txt) txt.textContent = message || 'AI is working…';
  if (!ov) return;
  ov.classList.remove('hidden');
  ov.removeAttribute('hidden');
}
function hideAiLoading() {
  const ov = document.getElementById('aiGlobalLoading');
  if (!ov) return;
  ov.classList.add('hidden');
  ov.setAttribute('hidden','true');
}

// Wrap fetch so AI endpoints show loader
(function(){
  if (window.__aiFetchWrapped) return;
  window.__aiFetchWrapped = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    try {
      const url = (typeof input === 'string') ? input : (input && input.url) || '';
      const isAi = /entries-(estimate-plate-image|add-image|chat|coach|analyze|estimate|label)/i.test(url)
        || /\/.netlify\/functions\//i.test(url) && /entries-/.test(url);
      if (isAi) showAiLoading('AI is working…');
      const res = await origFetch(input, init);
      return res;
    } finally {
      // Only hide if we showed it. If multiple AI calls overlap, keep it simple:
      // hide after each completes; if another starts, it will re-show.
      hideAiLoading();
    }
  };
})();


// ===============================
// LABEL SUBMIT LOCK (v41)
// ===============================
let __labelSubmitInProgress = false;

document.addEventListener('click', function(e){
  const btn = e.target.closest('#saveLabelEntryBtn, .saveLabelEntryBtn');
  if(!btn) return;

  if(__labelSubmitInProgress){
    e.preventDefault();
    return;
  }

  __labelSubmitInProgress = true;
  btn.disabled = true;

  // auto-unlock after short delay as safety
  setTimeout(function(){
    __labelSubmitInProgress = false;
    btn.disabled = false;
  }, 2000);
}, true);


// ===============================
// ENTRY FRIENDLY NAME (v43)
// ===============================
function entryFriendlyName(e) {
  try {
    // 1) Explicit notes (best)
    if (e?.notes && String(e.notes).trim()) return String(e.notes).trim();

    // 2) Nutrition label extraction
    const ex = e?.extracted || null;
    if (ex) {
      const name = ex.product_name || ex.food_name || ex.name || ex.title;
      if (name && String(name).trim()) return String(name).trim();
      if (ex.brand && String(ex.brand).trim()) return String(ex.brand).trim() + ' (label)';
      return 'Nutrition label';
    }

    // 3) Plate photo estimate
    const rx = e?.raw_extraction || null;
    const meta = e?.raw_extraction_meta || null;

    if (meta?.notes && String(meta.notes).trim()) return String(meta.notes).trim();
    if (meta?.assumptions && Array.isArray(meta.assumptions) && meta.assumptions.length) {
      // Use first 1–2 assumptions, cleaned
      const a = meta.assumptions.slice(0,2).map(s => String(s).replace(/^assumed\s*/i,'').trim()).filter(Boolean);
      if (a.length) return a.join(' + ');
    }

    if (rx && (rx.source === 'plate_photo' || rx.estimated === true)) return 'Plate estimate';

    // 4) Manual quick add
    if (rx && rx.source === 'manual') return 'Quick add';

    return 'Food entry';
  } catch (err) {
    return 'Food entry';
  }
}


// ===============================
// AUTOPILOT DATA SYNC (v58)
// Keeps localStorage caches ("entries", "weights") in sync with API data so
// readiness + weekly review logic works even when the UI is DB-driven.
// ===============================
function _apSafeJsonParse(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || ''); } catch { return fallback; }
}
function _apSafeJsonWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function _apMergeById(existing, incoming) {
  const map = new Map();
  (existing || []).forEach(x => { if (x && (x.id || x.entry_id)) map.set(String(x.id || x.entry_id), x); });
  (incoming || []).forEach(x => { if (x && (x.id || x.entry_id)) map.set(String(x.id || x.entry_id), x); });
  return Array.from(map.values());
}
function _apSyncFromApi(path, body) {
  try {
    // weights-list
    if (path === 'weights-list' && body && Array.isArray(body.weights)) {
      _apSafeJsonWrite('weights', body.weights);
      return;
    }

    // week-summary (store daily totals as synthetic entries so we can count "food days")
    if (path.startsWith('week-summary') && body) {
      const days = body.days || body.week || body.data || null;
      if (Array.isArray(days)) {
        const synthetic = days
          .filter(d => d && (d.date || d.day))
          .map(d => ({
            id: 'syn_' + String(d.date || d.day),
            date: d.date || d.day,
            calories: d.calories || d.kcal || d.total_calories || 0,
            raw_extraction: { source: 'week_summary' },
          }));
        const cur = _apSafeJsonParse('entries', []);
        const merged = _apMergeById(cur.filter(e => !String(e.id||'').startsWith('syn_')), synthetic).concat(
          cur.filter(e => String(e.id||'').startsWith('syn_') && !synthetic.find(s => s.id === e.id))
        );
        // Above keeps real entries plus latest synthetic per day
        _apSafeJsonWrite('entries', merged);
      }
      return;
    }

    // entries-list-day: merge entries into local cache
    if (path.startsWith('entries-list-day') && body && Array.isArray(body.entries)) {
      const cur = _apSafeJsonParse('entries', []);
      const merged = _apMergeById(cur, body.entries);
      _apSafeJsonWrite('entries', merged);
      return;
    }

    // entries-add / entries-add-image: add returned entry
    if ((path === 'entries-add' || path === 'entries-add-image') && body && body.entry) {
      const cur = _apSafeJsonParse('entries', []);
      const merged = _apMergeById(cur, [body.entry]);
      _apSafeJsonWrite('entries', merged);
      return;
    }

    // weight-set: update weights cache if weight returned
    if (path === 'weight-set' && body && body.weight) {
      const cur = _apSafeJsonParse('weights', []);
      const merged = _apMergeById(cur, [body.weight]);
      _apSafeJsonWrite('weights', merged);
      return;
    }
  } catch (e) {
    // no-op
  }
}