import { calculate, humidityRatio, parseNumeric, saturationPressure, vaporPressure } from './psychrometrics.js';

const point = state => ({ t: state.t, w: state.w });

function targetError(message, field = null) {
  return { ok: false, error: message, field, segments: [] };
}

function stateAtRh(t, rh, pressure, dryMass) {
  const draft = calculate({ mode: 'rh', t: String(t), rh: String(rh), p: String(pressure), v: '1' });
  if (!draft.ok) return draft;
  const volume = dryMass / draft.rhoDry;
  return calculate({ mode: 'rh', t: String(t), rh: String(rh), p: String(pressure), v: String(volume) });
}

function coolOrHeatAtConstantRatio(source, targetT) {
  const crossedDewPoint = source.dp !== null && targetT < source.dp - 1e-8 && source.w > 0;
  const saturatedW = crossedDewPoint ? humidityRatio(targetT, 100, source.p) : source.w;
  if (!Number.isFinite(saturatedW)) return targetError('目標溫度與壓力無法形成有效空氣狀態。', 'targetT');
  const finalW = crossedDewPoint ? Math.min(source.w, saturatedW) : source.w;
  const pv = vaporPressure(finalW, source.p);
  const rh = Math.min(100, pv / saturationPressure(targetT) * 100);
  const state = stateAtRh(targetT, rh, source.p, source.dryMass);
  if (!state.ok) return targetError(Object.values(state.errors).join(' '), 'targetT');

  const segments = [];
  const start = point(source);
  const end = point(state);
  if (crossedDewPoint) {
    const dew = { t: source.dp, w: source.w };
    if (Math.abs(source.t - source.dp) > 1e-8) segments.push({ type: 'line', from: start, to: dew, label: 'W 不變' });
    segments.push({ type: 'saturation', from: dew, to: end, label: source.dp < 0 ? '冷卻結霜' : '冷卻結露' });
  } else if (Math.abs(source.t - targetT) > 1e-8 || Math.abs(source.w - state.w) > 1e-10) {
    segments.push({ type: 'line', from: start, to: end, label: 'W 不變' });
  }
  return {
    ok: true,
    state,
    segments,
    condensedG: Math.max(0, source.dryMass * (source.w - state.w) * 1000),
    crossedDewPoint
  };
}

export function deriveProcess(source, config = {}) {
  const mode = config.mode || 'independent';
  if (mode === 'independent') return { ok: true, mode, generated: false, segments: [] };
  if (!source?.ok) return targetError('請先完成有效的條件 A。', 'source');

  const targetT = parseNumeric(config.targetT);
  if (!Number.isFinite(targetT) || targetT < -20 || targetT > 80) {
    return targetError('B 點乾球溫度請輸入 −20～80 °C。', 'targetT');
  }
  const temperatureStage = coolOrHeatAtConstantRatio(source, targetT);
  if (!temperatureStage.ok) return temperatureStage;

  if (mode === 'temperature') {
    return {
      ...temperatureStage,
      mode,
      generated: true,
      targetT,
      final: temperatureStage.state,
      stageWaterG: -temperatureStage.condensedG,
      netWaterG: -temperatureStage.condensedG
    };
  }
  if (mode !== 'moisture') return targetError('未知的 A → B 過程模式。', 'mode');

  const targetRh = parseNumeric(config.targetRh);
  if (!Number.isFinite(targetRh) || targetRh < 0 || targetRh > 100) {
    return targetError('B 點相對濕度請輸入 0～100%。', 'targetRh');
  }
  const final = stateAtRh(targetT, targetRh, source.p, source.dryMass);
  if (!final.ok) return targetError(Object.values(final.errors).join(' '), 'targetRh');
  const segments = [...temperatureStage.segments];
  if (Math.abs(final.w - temperatureStage.state.w) > 1e-10) {
    segments.push({ type: 'line', from: point(temperatureStage.state), to: point(final), label: final.w > temperatureStage.state.w ? '加濕' : '除濕' });
  }
  return {
    ok: true,
    mode,
    generated: true,
    targetT,
    targetRh,
    final,
    intermediate: temperatureStage.state,
    segments,
    crossedDewPoint: temperatureStage.crossedDewPoint,
    condensedG: temperatureStage.condensedG,
    stageWaterG: source.dryMass * (final.w - temperatureStage.state.w) * 1000,
    netWaterG: source.dryMass * (final.w - source.w) * 1000
  };
}

export function evaluateCondensation(source, rawSurfaceT, rawMargin) {
  if (!source?.ok) return { ok: false, error: '請先完成有效的條件 A。', field: 'source' };
  const surfaceT = parseNumeric(rawSurfaceT), safetyMargin = parseNumeric(rawMargin);
  if (!Number.isFinite(surfaceT) || surfaceT < -50 || surfaceT > 100) {
    return { ok: false, error: '表面溫度請輸入 −50～100 °C。', field: 'surfaceT' };
  }
  if (!Number.isFinite(safetyMargin) || safetyMargin < 0 || safetyMargin > 30) {
    return { ok: false, error: '安全裕量請輸入 0～30 °C。', field: 'margin' };
  }
  if (source.dp === null) {
    return {
      ok: true,
      status: 'dry',
      label: '無有限露／霜點',
      surfaceT,
      safetyMargin,
      surfaceRh: source.pv <= 0 ? 0 : null,
      dewMargin: null,
      requiredT: null,
      frost: false
    };
  }
  const dewMargin = surfaceT - source.dp;
  const surfaceRh = source.pv / saturationPressure(surfaceT) * 100;
  const frost = source.dp < 0;
  let status = 'safe', label = '有安全裕量';
  if (dewMargin <= 0) {
    status = 'risk';
    label = frost ? '結霜風險' : '結露風險';
  } else if (dewMargin < safetyMargin) {
    status = 'caution';
    label = '安全裕量不足';
  }
  return {
    ok: true,
    status,
    label,
    surfaceT,
    safetyMargin,
    surfaceRh,
    dewMargin,
    requiredT: source.dp + safetyMargin,
    frost
  };
}
