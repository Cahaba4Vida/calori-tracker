console.log("APP_VERSION v11");
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

function authHeaders() {
  const headers = {};
  if (shouldAttachDeviceIdHeader()) {
    headers['X-Device-Id'] = getOrCreateDeviceId();
  }
  if (currentUser?.token?.access_token) {
    headers.Authorization = 'Bearer ' + currentUser.token.access_token;
  }
  return headers;
}

async function api(path, opts = {}) {
  if (USE_MOCK_API) {
  initAuthedSession().catch(e => setStatus(e.message));
  if (typeof netlifyIdentity !== 'undefined') netlifyIdentity.init();
} else if (typeof netlifyIdentity !== 'undefined') {
  // Netlify Identity present: let its init/login/logout events drive the flow.
  netlifyIdentity.init();
} else {
  // No Netlify Identity (e.g., local dev): fall back to device session.
  showApp(false);
  initAuthedSession({ skipOnboarding: false, onboardingMode: 'onboarding' }).catch(e => setStatus(e.message));
}
