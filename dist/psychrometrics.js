// SI psychrometric relations, ASHRAE Fundamentals 2017 chapter 1.
// Equations cross-checked against the published PsychroLib implementation.
// Pressure: kPa; temperature: °C; humidity ratio: kg water/kg dry air.
export const MOLECULAR_RATIO = 0.621945;
export const R_DRY_AIR = 0.287042;

export function saturationPressure(t) {
  const k = t + 273.15;
  if (!Number.isFinite(t) || t < -100 || t > 200) return NaN;
  const logP = t <= 0.01
    ? -5674.5359 / k + 6.3925247 - 0.009677843 * k + 6.2215701e-7 * k ** 2 + 2.0747825e-9 * k ** 3 - 9.484024e-13 * k ** 4 + 4.1635019 * Math.log(k)
    : -5800.2206 / k + 1.3914993 - 0.048640239 * k + 4.1764768e-5 * k ** 2 - 1.4452093e-8 * k ** 3 + 6.5459673 * Math.log(k);
  return Math.exp(logP) / 1000;
}

export function humidityRatio(t, rh, pressure) {
  const pv = rh / 100 * saturationPressure(t);
  return pv >= pressure || pv < 0 ? NaN : MOLECULAR_RATIO * pv / (pressure - pv);
}

export function vaporPressure(w, pressure) {
  return pressure * w / (MOLECULAR_RATIO + w);
}

export function dewPoint(pv) {
  if (pv <= 0) return null;
  if (pv < saturationPressure(-100)) return null;
  let low = -100, high = 200;
  for (let i = 0; i < 70; i++) {
    const mid = (low + high) / 2;
    if (saturationPressure(mid) < pv) low = mid; else high = mid;
  }
  return (low + high) / 2;
}

export function ratioFromWetBulb(t, tw, pressure) {
  const ws = humidityRatio(tw, 100, pressure);
  if (!Number.isFinite(ws)) return NaN;
  // Keep negative results here so impossible input is reported, not clamped.
  return tw >= 0
    ? ((2501 - 2.326 * tw) * ws - 1.006 * (t - tw)) / (2501 + 1.86 * t - 4.186 * tw)
    : ((2830 - 0.24 * tw) * ws - 1.006 * (t - tw)) / (2830 + 1.86 * t - 2.1 * tw);
}

export function wetBulb(t, w, pressure) {
  // Solve water and ice branches separately: the ideal wet-bulb relations
  // have a small phase-change gap at 0 °C. Do not return a false zero.
  const boiling = dewPoint(pressure);
  const upper = Math.min(t, (boiling ?? 200) - 1e-7);
  const ranges = upper >= 0 ? [[0, upper], [-100, -1e-9]] : [[-100, upper]];
  for (const bounds of ranges) {
    let [lo, hi] = bounds;
    const a = ratioFromWetBulb(t, lo, pressure), b = ratioFromWetBulb(t, hi, pressure);
    if (w < a - 1e-11 || w > b + 1e-11) continue;
    for (let i = 0; i < 70; i++) {
      const mid = (lo + hi) / 2;
      if (ratioFromWetBulb(t, mid, pressure) < w) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  return null;
}

export function parseNumeric(value) {
  const s = String(value ?? '').trim().replace(/\u2212/g, '-');
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s) ? Number(s) : NaN;
}

export function calculate(input) {
  const t = parseNumeric(input.t), p = parseNumeric(input.p), v = parseNumeric(input.v);
  const rhInput = parseNumeric(input.rh), twInput = parseNumeric(input.tw);
  const errors = {};
  if (!Number.isFinite(t) || t < -20 || t > 80) errors.t = '乾球溫度請輸入 −20～80 °C。';
  if (!Number.isFinite(p) || p < 20 || p > 200) errors.p = '絕對壓力請輸入 20～200 kPa。';
  if (!Number.isFinite(v) || v <= 0) errors.v = '空間體積必須大於 0 m³。';
  if (input.mode === 'wb') {
    if (!Number.isFinite(twInput) || twInput < -50 || twInput > 80) errors.tw = '濕球溫度請輸入 −50～80 °C。';
    else if (Number.isFinite(t) && twInput > t) errors.tw = '濕球溫度不可高於乾球溫度。';
  } else if (!Number.isFinite(rhInput) || rhInput < 0 || rhInput > 100) {
    errors.rh = '相對濕度請輸入 0～100%。';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  let w = input.mode === 'wb' ? ratioFromWetBulb(t, twInput, p) : humidityRatio(t, rhInput, p);
  if (!Number.isFinite(w) || w < -1e-10) {
    errors[input.mode === 'wb' ? 'tw' : 'rh'] = input.mode === 'wb'
      ? '此乾濕球與壓力組合無有效含濕量，請提高濕球溫度或檢查壓力。'
      : '水蒸氣分壓必須小於總壓力，請降低溫度／濕度或提高壓力。';
    return { ok: false, errors };
  }
  w = Math.max(0, w);
  const pv = vaporPressure(w, p), ps = saturationPressure(t);
  const rh = pv / ps * 100;
  if (rh > 100.0001) return { ok: false, errors: { tw: '此組合超過飽和狀態，請檢查乾濕球溫度。' } };
  const dp = dewPoint(pv);
  const tw = input.mode === 'wb' ? twInput : wetBulb(t, w, p);
  const rhoDry = (p - pv) / (R_DRY_AIR * (t + 273.15));
  const rhoVapor = rhoDry * w;
  if (!Number.isFinite(rhoVapor * v * 1000) || !Number.isFinite(rhoDry * v)) {
    return { ok: false, errors: { v: '空間體積過大，超出可計算範圍。' } };
  }
  const cpDryBasis = 1.006 + 1.86 * w;
  const hAir = 1.006 * t, hVapor = 2501 + 1.86 * t;
  return {
    ok: true, t, p, v, w, pv, ps, dp, tw, rh: Math.min(100, rh),
    rhoDry, rhoVapor, rhoMoist: rhoDry + rhoVapor,
    rhoDryOnly: p / (R_DRY_AIR * (t + 273.15)),
    waterMass: rhoVapor * v * 1000,
    absoluteHumidity: rhoVapor * 1000,
    dryMass: rhoDry * v,
    specificVolume: 1 / rhoDry,
    hAir, hVapor, h: hAir + w * hVapor,
    cpAir: 1.006, cpDryBasis, cpMoistBasis: cpDryBasis / (1 + w),
    errors: {}
  };
}

export const PROPERTY_ROWS = [
  ['t', '乾球溫度', 'Tdb', '°C', 2],
  ['tw', '濕球溫度', 'Twb', '°C', 2],
  ['rh', '相對濕度', 'RH', '%', 2],
  ['dp', '露點／霜點', 'Tdp', '°C', 2],
  ['w', '含濕量', 'W', 'kg 水 / kg 乾空氣', 5],
  ['p', '總絕對壓力', 'P', 'kPa', 3],
  ['v', '空間體積', 'V', 'm³', 3],
  ['pv', '水蒸氣分壓', 'pv', 'kPa', 4],
  ['ps', '飽和水蒸氣壓', 'pws', 'kPa', 4],
  ['absoluteHumidity', '絕對濕度', 'ρv', 'g 水 / m³', 2],
  ['waterMass', '空間水蒸氣質量', 'mv', 'g', 2],
  ['rhoDry', '乾空氣分量密度', 'ρda', 'kg 乾空氣 / m³', 4],
  ['rhoMoist', '濕空氣總密度', 'ρma', 'kg 濕空氣 / m³', 4],
  ['rhoDryOnly', '同溫同壓純乾空氣密度', 'ρda,0', 'kg / m³', 4],
  ['specificVolume', '濕空氣比容', 'vda', 'm³ / kg 乾空氣', 4],
  ['cpAir', '乾空氣定壓比熱', 'cp,a', 'kJ / (kg 乾空氣·K)', 3],
  ['hAir', '乾空氣焓', 'ha', 'kJ / kg 乾空氣', 2],
  ['hVapor', '水蒸氣焓', 'hv', 'kJ / kg 水蒸氣', 2],
  ['h', '濕空氣焓（乾空氣基準）', 'h', 'kJ / kg 乾空氣', 2],
  ['cpDryBasis', '濕空氣比熱（乾空氣基準）', 'cp,da', 'kJ / (kg 乾空氣·K)', 4],
  ['cpMoistBasis', '濕空氣比熱（濕空氣基準）', 'cp,ma', 'kJ / (kg 濕空氣·K)', 4]
];
