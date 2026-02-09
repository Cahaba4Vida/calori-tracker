console.log("APP_VERSION v8");
let currentUser = null;

let weightUnit = (localStorage.getItem('weightUnit') || 'lbs'); // 'lbs' or 'kg'

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

function loadMacroGoals() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('macroGoals') || '{}') || {};
  } catch {}
  return {
    protein_g: Number.isFinite(Number(saved.protein_g)) ? Number(saved.protein_g) : null,
    carbs_g: Number.isFinite(Number(saved.carbs_g)) ? Number(saved.carbs_g) : null,
    fat_g: Number.isFinite(Number(saved.fat_g)) ? Number(saved.fat_g) : null
  };
}

function saveMacroGoals(goals) {
  localStorage.setItem('macroGoals', JSON.stringify(goals));
}

function fmtGoal(v) {
  return v == null ? '—' : String(v);
}


const el = (id) => document.getElementById(id);

function setStatus(msg) { el('status').innerText = msg || ''; }
function setThinking(isThinking) {
  const thinking = el('aiThinking');
  if (!thinking) return;
  thinking.classList.toggle('hidden', !isThinking);
}
function showApp(isAuthed) { el('app').classList.toggle('hidden', !isAuthed); el('tabs').classList.toggle('hidden', !isAuthed); }

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
  const macroGoals = loadMacroGoals();

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

  saveMacroGoals({
    protein_g: asOptional('proteinGoalInput'),
    carbs_g: asOptional('carbsGoalInput'),
    fat_g: asOptional('fatGoalInput')
  });

  await refresh();
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
    li.innerText = 'No entries yet.';
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

  const goal = Number(el('todayGoal').innerText);
  const p = pct(j.total_calories ?? 0, isFinite(goal) ? goal : 0);
  el('progressBar').style.width = p + '%';

  renderEntries(entries);
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
  setStatus('Generating score + tips…');
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
        assumptions: [],
        portion_hint: null,
        servings_eaten: null,
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
}

netlifyIdentity.on('init', user => {
  currentUser = user;
  showApp(!!user);
  if (user) refresh().catch(e => setStatus(e.message));
});
netlifyIdentity.on('login', user => {
  currentUser = user;
  netlifyIdentity.close();
  showApp(true);
  refresh().catch(e => setStatus(e.message));
});
netlifyIdentity.on('logout', () => {
  currentUser = null;
  showApp(false);
  setStatus('Logged out.');
});

bindUI();
netlifyIdentity.init();
