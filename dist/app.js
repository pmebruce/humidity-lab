import { calculate, PROPERTY_ROWS } from './psychrometrics.js';
import { chartSvg } from './chart.js';
import { deriveProcess, evaluateCondensation } from './process.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'humidity-lab.settings.v2';
const initial = () => ({
  active: 'A', compare: true, focus: false, enthalpy: true, wetbulb: false, dew: true,
  A: { t: '30', rh: '60', tw: '23.9', p: '100', v: '1', mode: 'rh' },
  B: { t: '20', rh: '100', tw: '20', p: '100', v: '0.97', mode: 'rh' },
  condensation: { surfaceT: '20', margin: '2' },
  process: { mode: 'temperature', targetT: '20', targetRh: '50' }
});
let settings = initial(), states, processResult, condensationResult, lastWidth = 0, toastTimer, deferredPrompt, swRegistration;
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (stored && typeof stored === 'object') {
    for (const id of ['A', 'B']) {
      if (stored[id]) for (const field of ['t', 'rh', 'tw', 'p', 'v']) if (typeof stored[id][field] === 'string' && stored[id][field].length < 40) settings[id][field] = stored[id][field];
      if (stored[id]?.mode === 'wb') settings[id].mode = 'wb';
    }
    for (const key of ['compare', 'focus', 'enthalpy', 'wetbulb', 'dew']) if (typeof stored[key] === 'boolean') settings[key] = stored[key];
    for (const field of ['surfaceT', 'margin']) if (typeof stored.condensation?.[field] === 'string' && stored.condensation[field].length < 40) settings.condensation[field] = stored.condensation[field];
    for (const field of ['targetT', 'targetRh']) if (typeof stored.process?.[field] === 'string' && stored.process[field].length < 40) settings.process[field] = stored.process[field];
    if (['independent', 'temperature', 'moisture'].includes(stored.process?.mode)) settings.process.mode = stored.process.mode;
    settings.active = settings.compare && stored.active === 'B' ? 'B' : 'A';
  }
} catch { /* Storage can be unavailable in private browsing. */ }

const fmt = (value, decimals = 2) => {
  if (value === null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 10000 || (Math.abs(value) > 0 && Math.abs(value) < 10 ** (-decimals - 1))) return value.toExponential(2);
  return (Math.abs(value) < 0.5 * 10 ** -decimals ? 0 : value).toFixed(decimals);
};
const diff = (a, b, d) => a == null || b == null ? '—' : `${b - a > 0 ? '+' : ''}${fmt(b - a, d)}`;
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {} }
function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}

function raw(value, decimals = 8) {
  if (value === null || !Number.isFinite(value)) return '';
  return String(Number(value.toFixed(decimals)));
}

function inputFromState(state) {
  return { t: raw(state.t, 6), rh: raw(state.rh, 6), tw: raw(state.tw, 6), p: raw(state.p, 6), v: raw(state.v, 8), mode: 'rh' };
}

function syncInputs() {
  const input = settings[settings.active];
  const processActive = settings.process.mode !== 'independent';
  const generatedB = processActive && settings.active === 'B';
  for (const key of ['t', 'rh', 'tw', 'p', 'v']) $('input-' + key).value = input[key];
  document.querySelectorAll('[name="input-mode"]').forEach(el => { el.checked = el.value === input.mode; el.disabled = generatedB; });
  document.querySelectorAll('[data-field],[data-sign]').forEach(el => { el.disabled = generatedB; });
  $('rh-slider').disabled = generatedB;
  $('rh-field').hidden = input.mode === 'wb';
  $('tw-field').hidden = input.mode !== 'wb';
  $('rh-slider-wrap').hidden = input.mode === 'wb';
  $('compare-toggle').checked = settings.compare;
  $('compare-toggle').disabled = processActive;
  $('condition-tabs').hidden = !settings.compare;
  $('generated-b-note').hidden = !generatedB;
  $('conditions').classList.toggle('is-generated', generatedB);
  document.querySelectorAll('#condition-tabs button').forEach(el => { el.setAttribute('aria-pressed', String(el.dataset.condition === settings.active)); });
  $('enthalpy-toggle').checked = settings.enthalpy;
  $('wetbulb-toggle').checked = settings.wetbulb;
  $('dewline-toggle').checked = settings.dew;
  $('focus-button').setAttribute('aria-pressed', String(settings.focus));
  $('focus-button').lastChild.textContent = settings.focus ? '恢復全圖' : '聚焦狀態點';
  $('surface-t').value = settings.condensation.surfaceT;
  $('safety-margin').value = settings.condensation.margin;
  $('process-target-t').value = settings.process.targetT;
  $('process-target-rh').value = settings.process.targetRh;
  document.querySelectorAll('[name="process-mode"]').forEach(el => { el.checked = el.value === settings.process.mode; });
  $('process-target-rh-wrap').hidden = settings.process.mode !== 'moisture';
  document.querySelector('.process-card').classList.toggle('is-independent', !processActive);
}

function drawChart() {
  if (!states) return;
  const width = Math.round($('psych-chart').clientWidth) || 800;
  lastWidth = width;
  const { svg, geometry } = chartSvg(states, { ...settings, process: processResult, condensation: condensationResult }, width);
  $('psych-chart').innerHTML = svg;
  const generated = processResult?.ok && processResult.generated;
  $('chart-pressure').textContent = `總壓力 ${fmt(geometry.p, 3)} kPa${generated ? ' · A → B 定壓過程' : settings.compare ? (states[settings.active].ok ? ` · 以條件 ${settings.active} 檢視` : ' · 參考圖') : ''}`;
  const samePressure = states.A.ok && states.B.ok && Math.abs(states.A.p - states.B.p) <= 1e-8;
  $('process-legend').hidden = !(settings.compare && samePressure);
  $('process-legend-label').textContent = generated ? 'A → B 過程' : 'A–B 比較線';
  $('surface-legend').hidden = !(condensationResult?.ok && states.A.ok && Math.abs(states.A.p - geometry.p) <= 1e-8);
  $('chart-help').textContent = generated
    ? '橫軸為乾球溫度，縱軸為含濕量。紫色箭線是 A → B 工程過程；冷卻越過露點時，路徑會轉沿 100% 飽和線並顯示冷凝水。'
    : settings.compare ? '橫軸為乾球溫度，縱軸為含濕量。灰色虛線只連接兩個獨立狀態供比較，不代表實際設備過程。' : '橫軸為乾球溫度，縱軸為含濕量；露點沿同一含濕量水平找到 100% 飽和線。';
  const notices = [];
  if (settings.compare && states.A.ok && states.B.ok && Math.abs(states.A.p - states.B.p) > 1e-8) notices.push(`A、B 的壓力不同，此圖只顯示 ${settings.active} 點。點選條件 A／B，可切換對應壓力的圖。`);
  if (settings.process.mode !== 'independent' && !processResult?.ok) notices.push('A → B 過程尚無有效結果，請修正工程評估輸入。');
  if (!states[settings.active].ok) notices.push(`條件 ${settings.active} 尚無有效結果，請修正輸入。`);
  else if (settings.dew && states[settings.active].dp !== null && states[settings.active].dp < geometry.min) notices.push(`露／霜點 ${fmt(states[settings.active].dp)} °C 位於目前圖框左側；可使用「聚焦狀態點」查看，低於 −45 °C 的點請參照數值。`);
  if (condensationResult?.ok && (condensationResult.surfaceT < geometry.min || condensationResult.surfaceT > geometry.max)) notices.push(`表面溫度 ${fmt(condensationResult.surfaceT)} °C 位於目前圖框外；可使用「聚焦狀態點」查看。`);
  $('chart-notice').textContent = notices.join(' ');
  $('chart-notice').hidden = !notices.length;
}

function renderMetrics(current) {
  $('result-rh').textContent = fmt(current.rh, 1);
  $('result-dp').textContent = fmt(current.dp, 2);
  $('result-w').textContent = fmt(current.w * 1000, 2);
  $('result-h').textContent = fmt(current.h, 2);
  for (const id of ['result-rh', 'result-dp', 'result-w', 'result-h']) $(id).classList.toggle('compact-number', $(id).textContent.length > 6);
  document.querySelector('.active-tag').textContent = settings.active;
  $('dew-metric-label').textContent = current.ok && current.dp < 0 && current.dp !== null ? '霜點溫度' : '露點溫度';
  $('result-rh-caption').textContent = current.ok ? `濕球 ${current.tw === null ? '近冰點相變區' : fmt(current.tw, 2) + ' °C'}` : '請完成有效輸入';
  if (!current.ok) {
    $('dew-insight').innerHTML = '<span class="insight-label">結露參考</span><p>完成有效輸入後，顯示露點與結露參考。</p>';
  } else if (current.dp === null) {
    $('dew-insight').innerHTML = `<span class="insight-label">結露參考</span><p>${current.w === 0 ? 'RH 為 0%，無水蒸氣，沒有有限的露點。' : '露／霜點低於 −100 °C，超出飽和壓力公式範圍。'}</p>`;
  } else {
    const frozen = current.dp < 0;
    $('dew-insight').innerHTML = `<span class="insight-label">${frozen ? '結霜' : '結露'}參考</span><p>表面溫度低於 <strong>${fmt(current.dp, 2)} °C</strong> 時，可能開始${frozen ? '結霜' : '結露'}。</p><span>${frozen ? '此數值為冰面飽和的霜點；低溫 RH 也以冰面為基準。' : '在相同壓力與含濕量下冷卻，抵達露點時 RH 會升至 100%。'}</span>`;
  }
}

function setStatus(element, type, label) {
  element.className = `status-pill ${type}`;
  element.querySelector('span').textContent = label;
}

function renderEngineering() {
  const condensationInputs = [$('surface-t'), $('safety-margin')];
  condensationInputs.forEach(input => input.parentElement.classList.remove('invalid'));
  $('condensation-error').hidden = Boolean(condensationResult?.ok);
  $('condensation-error').textContent = condensationResult?.error || '';
  if (!condensationResult?.ok) {
    if (condensationResult?.field === 'surfaceT') $('surface-t').parentElement.classList.add('invalid');
    if (condensationResult?.field === 'margin') $('safety-margin').parentElement.classList.add('invalid');
    setStatus($('condensation-status'), 'neutral', '等待有效輸入');
    $('dew-margin-result').textContent = '—';
    $('surface-rh-result').textContent = '—';
    $('required-surface-result').textContent = '—';
    $('condensation-note').textContent = '完成條件 A、表面溫度與安全裕量後，即時顯示結露判斷。';
  } else {
    setStatus($('condensation-status'), condensationResult.status === 'dry' ? 'neutral' : condensationResult.status, condensationResult.label);
    $('dew-margin-result').textContent = condensationResult.dewMargin === null ? '—' : `${condensationResult.dewMargin > 0 ? '+' : ''}${fmt(condensationResult.dewMargin, 2)}`;
    $('surface-rh-result').textContent = condensationResult.surfaceRh === null ? '—' : condensationResult.surfaceRh >= 100 ? '≥100%' : `${fmt(condensationResult.surfaceRh, 1)}%`;
    $('required-surface-result').textContent = condensationResult.requiredT === null ? '—' : fmt(condensationResult.requiredT, 2);
    if (condensationResult.status === 'risk') {
      $('condensation-note').textContent = `表面已低於${condensationResult.frost ? '霜點' : '露點'}；圖中紅色區段表示冷卻跨入${condensationResult.frost ? '結霜' : '結露'}範圍。請以最冷表面實測值判斷。`;
    } else if (condensationResult.status === 'caution') {
      $('condensation-note').textContent = `目前尚未飽和，但未達設定的 ${fmt(condensationResult.safetyMargin, 1)} °C 安全裕量。感測誤差與表面冷點可能使實際狀況較不利。`;
    } else if (condensationResult.status === 'safe') {
      $('condensation-note').textContent = `表面高於露／霜點 ${fmt(condensationResult.dewMargin, 2)} °C，且達到設定裕量。仍應量測可能最冷的表面。`;
    } else {
      $('condensation-note').textContent = '條件 A 無有限露／霜點；目前模型下不會形成水氣凝結。';
    }
  }

  const independent = settings.process.mode === 'independent';
  const valid = processResult?.ok && processResult.generated;
  document.querySelector('.process-card').classList.toggle('is-independent', independent);
  document.querySelector('.process-card').classList.toggle('is-invalid', !independent && !valid);
  $('process-target-t').parentElement.classList.toggle('invalid', !independent && !valid && processResult?.field === 'targetT');
  $('process-target-rh').parentElement.classList.toggle('invalid', settings.process.mode === 'moisture' && !valid && processResult?.field === 'targetRh');
  $('process-error').hidden = independent || Boolean(processResult?.ok);
  $('process-error').textContent = processResult?.error || '';
  if (independent) {
    $('process-model-note').textContent = '條件 A、B 可各自輸入；圖上的虛線只連接兩個狀態供比較，不代表實際設備過程。';
    return;
  }
  $('process-model-note').textContent = '模型採定壓且保持條件 A 的乾空氣質量；密閉定容容器需改用定容模型。';
  if (!valid) {
    setStatus($('process-status'), 'neutral', '等待有效輸入');
    $('process-status-detail').textContent = '請修正條件 A 或目標值';
    for (const id of ['process-rh-result', 'process-water-result', 'process-volume-result']) $(id).textContent = '—';
    $('process-stage-note').textContent = '';
    return;
  }

  setStatus($('process-status'), 'process', 'A → B 已建立');
  $('process-rh-result').textContent = fmt(processResult.final.rh, 1);
  $('process-volume-result').textContent = fmt(processResult.final.v, 3);
  if (settings.process.mode === 'temperature') {
    $('process-status-detail').textContent = processResult.crossedDewPoint ? '定壓冷卻 · 越過露／霜點' : '定壓升／降溫 · W 不變';
    $('process-water-label').textContent = '冷凝水預估';
    $('process-water-result').textContent = fmt(processResult.condensedG, 2);
    $('process-stage-note').textContent = processResult.crossedDewPoint
      ? `先水平冷卻至 ${fmt(states.A.dp, 2)} °C，再沿飽和線到 B；析出約 ${fmt(processResult.condensedG, 2)} g。`
      : `A 到 B 的含濕量保持 ${fmt(states.A.w * 1000, 2)} g/kg；露／霜點不變。`;
  } else {
    const amount = processResult.stageWaterG;
    $('process-status-detail').textContent = '先調溫，再於 B 溫度調濕';
    $('process-water-label').textContent = Math.abs(amount) < 0.005 ? '調濕需求' : amount > 0 ? '需加濕' : '需除濕';
    $('process-water-result').textContent = fmt(Math.abs(amount), 2);
    const action = Math.abs(amount) < 0.005 ? '不需額外調濕' : `${amount > 0 ? '加入' : '移除'} ${fmt(Math.abs(amount), 2)} g 水`;
    const cooling = processResult.condensedG > 0.005 ? `調溫階段先凝結 ${fmt(processResult.condensedG, 2)} g；` : '';
    const net = Math.abs(processResult.netWaterG) < 0.005 ? 'A 到 B 淨水量不變' : `A 到 B 淨${processResult.netWaterG > 0 ? '增加' : '減少'} ${fmt(Math.abs(processResult.netWaterG), 2)} g`;
    $('process-stage-note').textContent = `${cooling}調濕階段${action}；${net}。`;
  }
}

function renderProperties() {
  $('comparison-label').hidden = !settings.compare;
  const processName = settings.process.mode === 'temperature' ? '升／降溫' : '目標溫濕度';
  $('comparison-note').textContent = settings.compare
    ? processResult?.generated ? `B 由「${processName}」過程產生；定壓且乾空氣質量不變，差值 = B − A。` : settings.process.mode !== 'independent' ? 'B 尚無有效過程結果；請修正條件 A 或工程目標值。' : '兩組為獨立條件；差值 = B − A，RH 差值為百分點。'
    : '焓、比容與含濕量以每 kg 乾空氣為基準。';
  $('property-head').innerHTML = `<tr><th scope="col">物性</th><th scope="col">條件 A</th>${settings.compare ? '<th scope="col">條件 B</th><th scope="col">差值</th>' : ''}<th scope="col" class="unit-head">單位</th></tr>`;
  $('property-body').innerHTML = PROPERTY_ROWS.map(([key, label, symbol, unit, d]) => {
    const a = states.A.ok ? states.A[key] : null, b = states.B.ok ? states.B[key] : null;
    return `<tr${['rh', 'dp', 'w', 'h'].includes(key) ? ' class="key-property"' : ''}><th scope="row">${label}<small>${symbol}</small></th><td class="column-a">${fmt(a, d)}</td>${settings.compare ? `<td class="column-b">${fmt(b, d)}</td><td class="delta">${diff(a, b, d)}</td>` : ''}<td class="unit">${unit}</td></tr>`;
  }).join('');
}

function renderFormula(current) {
  if (!current.ok) { $('formula-steps').innerHTML = '<p>完成有效輸入後，這裡會顯示代入數值的計算過程。</p>'; return; }
  const s = current, wbMode = settings[settings.active].mode === 'wb';
  const steps = [
    ['01　飽和壓力與水蒸氣分壓', 'pws = ASHRAE 飽和壓力關係式(T)；pv = (RH / 100) × pws', `pws(${fmt(s.t)} °C) = ${fmt(s.ps, 4)} kPa；pv = ${fmt(s.pv, 4)} kPa`],
    ['02　含濕量', 'W = 0.621945 × pv / (P − pv)', `W = 0.621945 × ${fmt(s.pv, 4)} / (${fmt(s.p, 3)} − ${fmt(s.pv, 4)}) = ${fmt(s.w, 5)} kg/kg`],
    ['03　露點／霜點', '反解 pws(Tdp) = pv', s.dp === null ? '無有限露點，或露／霜點低於 −100 °C。' : `pws(Tdp) = ${fmt(s.pv, 4)} kPa → Tdp = ${fmt(s.dp)} °C`],
    ['04　乾空氣與水蒸氣質量', 'ρda = (P − pv) / [0.287042 × (T + 273.15)]；mv = ρda × W × V × 1000', `ρda = ${fmt(s.rhoDry, 4)} kg/m³；mv = ${fmt(s.rhoDry, 4)} × ${fmt(s.w, 5)} × ${fmt(s.v, 3)} × 1000 = ${fmt(s.waterMass)} g`],
    ['05　濕空氣焓', 'h = 1.006 × T + W × (2501 + 1.86 × T)', `h = ${fmt(s.hAir)} + ${fmt(s.w, 5)} × ${fmt(s.hVapor)} = ${fmt(s.h)} kJ/kg 乾空氣`],
    ['06　濕空氣定壓比熱', 'cp,da = 1.006 + 1.86 × W；cp,ma = cp,da / (1 + W)', `cp,da = ${fmt(s.cpDryBasis, 4)} kJ/(kg 乾空氣·K)；cp,ma = ${fmt(s.cpMoistBasis, 4)} kJ/(kg 濕空氣·K)`],
    ['07　熱力學濕球溫度', s.tw !== null && s.tw < 0 ? 'Ws = 0.621945 × pws(Twb) / [P − pws(Twb)]；W = [(2830 − 0.24Twb)Ws − 1.006(T − Twb)] / (2830 + 1.86T − 2.1Twb)' : 'Ws = 0.621945 × pws(Twb) / [P − pws(Twb)]；W = [(2501 − 2.326Twb)Ws − 1.006(T − Twb)] / (2501 + 1.86T − 4.186Twb)', s.tw === null ? '此狀態接近 0 °C，位於理想水／冰濕球關係式的相變間隙，不顯示假精度數值。' : `${wbMode ? '以輸入濕球求 W，再求 RH' : '由已知 W 反解 Twb'}：Twb = ${fmt(s.tw)} °C；RH = ${fmt(s.rh)}%`],
    ['08　密度與比容', 'ρma = ρda × (1 + W)；vda = 1 / ρda；ρda,0 = P / [0.287042 × (T + 273.15)]', `ρma = ${fmt(s.rhoMoist, 4)} kg/m³；vda = ${fmt(s.specificVolume, 4)} m³/kg 乾空氣；ρda,0 = ${fmt(s.rhoDryOnly, 4)} kg/m³`]
  ];
  $('formula-steps').innerHTML = steps.map(([title, formula, value]) => `<article class="formula-step"><h3>${title}</h3><code>${formula}</code><p>${value}</p></article>`).join('');
}

function update() {
  const stateA = calculate(settings.A);
  processResult = deriveProcess(stateA, settings.process);
  let stateB;
  if (settings.process.mode !== 'independent') {
    settings.compare = true;
    if (processResult.ok && processResult.generated) {
      stateB = processResult.final;
      settings.B = inputFromState(stateB);
    } else {
      stateB = { ok: false, errors: { process: processResult.error || 'A → B 過程無有效結果。' } };
    }
  } else {
    stateB = calculate(settings.B);
  }
  states = { A: stateA, B: stateB };
  condensationResult = evaluateCondensation(stateA, settings.condensation.surfaceT, settings.condensation.margin);
  if (settings.active === 'B' && settings.process.mode !== 'independent' && stateB.ok) syncInputs();
  const current = states[settings.active];
  document.querySelectorAll('[data-field]').forEach(el => {
    const invalid = Boolean(current.errors?.[el.dataset.field]);
    el.setAttribute('aria-invalid', String(invalid));
    el.parentElement.classList.toggle('invalid', invalid);
  });
  $('input-errors').textContent = Object.values(current.errors || {}).join(' ');
  $('input-errors').hidden = current.ok;
  if (Number.isFinite(current.rh)) $('rh-slider').value = current.rh;
  renderMetrics(current); renderEngineering(); renderProperties(); renderFormula(current); drawChart();
  $('point-readouts').innerHTML = ['A', ...(settings.compare ? ['B'] : [])].map(id => {
    const s = states[id];
    return `<button class="point-readout ${settings.active === id ? 'active' : ''}" data-condition="${id}" aria-pressed="${settings.active === id}"><span class="point-letter">${id}</span><span class="readout-main">${s.ok ? `<strong>${fmt(s.t, 1)} °C</strong><span>${fmt(s.rh, 1)}% RH</span><small>W ${fmt(s.w * 1000, 2)} g/kg · ${fmt(s.p, 3)} kPa</small>` : '<span>請檢查輸入條件</span>'}</span></button>`;
  }).join('');
  save();
}

function selectCondition(id) {
  if (id !== 'A' && !(id === 'B' && settings.compare)) return;
  settings.active = id; syncInputs(); update();
}
document.querySelectorAll('[data-field]').forEach(el => el.addEventListener('input', () => {
  settings[settings.active][el.dataset.field] = el.value; update();
}));
document.querySelectorAll('[data-sign]').forEach(button => button.addEventListener('click', () => {
  const field = button.dataset.sign, input = $('input-' + field), raw = input.value.trim();
  const next = raw.startsWith('-') || raw.startsWith('−') ? raw.slice(1) : '-' + raw.replace(/^\+/, '');
  settings[settings.active][field] = next; input.value = next; update(); input.focus();
}));
document.querySelectorAll('[name="input-mode"]').forEach(el => el.addEventListener('change', () => {
  const input = settings[settings.active], current = states[settings.active];
  input.mode = el.value;
  if (current.ok) {
    if (el.value === 'rh') input.rh = current.rh.toFixed(6);
    else if (current.tw !== null) input.tw = current.tw.toFixed(6);
    else input.tw = '';
  }
  syncInputs(); update();
}));
for (const [id, field] of [['surface-t', 'surfaceT'], ['safety-margin', 'margin']]) {
  $(id).addEventListener('input', event => { settings.condensation[field] = event.target.value; update(); });
}
$('surface-sign').addEventListener('click', () => {
  const input = $('surface-t'), rawValue = input.value.trim();
  const next = rawValue.startsWith('-') || rawValue.startsWith('−') ? rawValue.slice(1) : '-' + rawValue.replace(/^\+/, '');
  settings.condensation.surfaceT = next; input.value = next; update(); input.focus();
});
for (const [id, field] of [['process-target-t', 'targetT'], ['process-target-rh', 'targetRh']]) {
  $(id).addEventListener('input', event => { settings.process[field] = event.target.value; update(); });
}
$('process-t-sign').addEventListener('click', () => {
  const input = $('process-target-t'), rawValue = input.value.trim();
  const next = rawValue.startsWith('-') || rawValue.startsWith('−') ? rawValue.slice(1) : '-' + rawValue.replace(/^\+/, '');
  settings.process.targetT = next; input.value = next; update(); input.focus();
});
document.querySelectorAll('[name="process-mode"]').forEach(el => el.addEventListener('change', () => {
  settings.process.mode = el.value;
  if (el.value !== 'independent') settings.compare = true;
  update(); syncInputs();
}));
$('compare-toggle').addEventListener('change', event => {
  settings.compare = event.target.checked;
  if (!settings.compare) settings.active = 'A';
  syncInputs(); update();
});
$('condition-tabs').addEventListener('click', event => { const id = event.target.closest('[data-condition]')?.dataset.condition; if (id) selectCondition(id); });
$('point-readouts').addEventListener('click', event => { const id = event.target.closest('[data-condition]')?.dataset.condition; if (id) selectCondition(id); });
$('rh-slider').addEventListener('input', event => {
  settings[settings.active].rh = event.target.value; $('input-rh').value = event.target.value; update();
});
$('example-button').addEventListener('click', () => {
  settings.A = { t: '30', rh: '60', tw: '23.9', p: '100', v: '1', mode: 'wb' };
  settings.B = { t: '30', rh: '60', tw: '23.9', p: '100', v: '1', mode: 'rh' };
  settings.process.mode = 'independent'; settings.compare = true; settings.active = 'A'; settings.focus = false;
  syncInputs(); update(); toast('已載入：A 為乾濕球範例，B 為 30 °C、60% RH 範例。');
});
$('reset-button').addEventListener('click', () => { settings = initial(); syncInputs(); update(); toast('已恢復預設值。'); });
$('focus-button').addEventListener('click', () => { settings.focus = !settings.focus; syncInputs(); drawChart(); save(); });
for (const [id, key] of [['enthalpy-toggle', 'enthalpy'], ['wetbulb-toggle', 'wetbulb'], ['dewline-toggle', 'dew']]) $(id).addEventListener('change', event => { settings[key] = event.target.checked; drawChart(); save(); });
if ('ResizeObserver' in window) new ResizeObserver(() => { if (Math.round($('psych-chart').clientWidth) !== lastWidth) drawChart(); }).observe($('psych-chart'));
else window.addEventListener('resize', drawChart);

function offlineStatus(ready) {
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('offline-status').textContent = ready ? (navigator.onLine ? '離線可用' : '離線模式') : navigator.onLine ? '即時計算' : '離線模式';
  $('footer-offline').textContent = ready ? '離線可用 · 計算於此裝置完成' : '數值與圖表在裝置上計算';
  if (installed) $('install-button').hidden = true;
}
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event; });
window.addEventListener('appinstalled', () => { deferredPrompt = null; $('install-button').hidden = true; toast('已加入桌面。'); });
$('install-button').addEventListener('click', async () => {
  if (deferredPrompt) {
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') toast('正在加入桌面。');
    deferredPrompt = null;
  } else $('install-dialog').showModal();
});
for (const id of ['close-install', 'install-done']) $(id).addEventListener('click', () => $('install-dialog').close());
$('install-dialog').addEventListener('click', event => { if (event.target === $('install-dialog')) { const r = $('install-dialog').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('install-dialog').close(); } });
let offlineReady = false;
window.addEventListener('online', () => offlineStatus(offlineReady));
window.addEventListener('offline', () => offlineStatus(offlineReady));
$('update-button').addEventListener('click', () => { swRegistration?.waiting?.postMessage({ type: 'SKIP_WAITING' }); });
let reloading = false;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRegistration?.__hadController && !reloading) { reloading = true; window.location.reload(); }
  });
  window.addEventListener('load', async () => {
    try {
      const hadController = Boolean(navigator.serviceWorker.controller);
      swRegistration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
      swRegistration.__hadController = hadController;
      const showUpdate = () => { if (swRegistration.waiting && navigator.serviceWorker.controller) $('update-banner').hidden = false; };
      showUpdate();
      swRegistration.addEventListener('updatefound', () => {
        const worker = swRegistration.installing;
        worker?.addEventListener('statechange', () => { if (worker.state === 'installed') showUpdate(); });
      });
      await navigator.serviceWorker.ready;
      offlineReady = true; offlineStatus(true);
      swRegistration.update().catch(() => {});
    } catch { offlineStatus(false); }
  });
}
syncInputs(); update(); offlineStatus(false);
