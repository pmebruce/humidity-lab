import { humidityRatio, ratioFromWetBulb } from './psychrometrics.js';

const BLUE = '#2149d8', ORANGE = '#c65c1b', PURPLE = '#7547d9', RED = '#cf3d35', AMBER = '#d49315', GREEN = '#2c8a5b';
const n = value => Number(value.toFixed(2));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function niceStep(span, count) {
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const f = raw / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * power;
}

export function chartGeometry(states, active, compare, focus, width, options = {}) {
  const current = states[active];
  const fallback = states.A.ok ? states.A : compare && states.B.ok ? states.B : null;
  const p = current.ok ? current.p : fallback?.p ?? 100;
  const shown = ['A', 'B'].filter(id => (id === 'A' || compare) && states[id].ok && Math.abs(states[id].p - p) < 1e-8);
  const values = shown.map(id => states[id]);
  const small = width < 540;
  const auxiliaryTemps = [];
  if (options.condensation?.ok && shown.includes('A')) {
    auxiliaryTemps.push(options.condensation.surfaceT);
    if (Number.isFinite(options.condensation.requiredT)) auxiliaryTemps.push(options.condensation.requiredT);
  }
  const minTemp = values.length ? Math.min(...values.map(v => v.t), ...auxiliaryTemps) : 30;
  const maxTemp = values.length ? Math.max(...values.map(v => v.t), ...auxiliaryTemps) : 30;
  const dewMin = Math.min(...values.map(v => v.dp ?? v.t), minTemp);
  let min = Math.min(0, Math.floor((minTemp - 5) / 10) * 10);
  let max = Math.max(50, Math.ceil((maxTemp + 5) / 10) * 10);
  let top = Math.max(30, ...values.map(v => v.w * 1000 * 1.28));
  if (focus && values.length) {
    min = Math.floor((Math.max(-40, dewMin) - 4) / 5) * 5;
    max = Math.ceil((maxTemp + 6) / 5) * 5;
    if (max - min < 15) min = max - 15;
    top = Math.max(5, ...values.map(v => v.w * 1000 * 1.5));
  }
  const yStep = niceStep(top, 6);
  const yMax = Math.ceil(top / yStep) * yStep;
  const xStep = niceStep(max - min, small ? 6 : 10);
  const height = small ? 380 : width < 740 ? 410 : 480;
  const left = small ? 24 : 35, right = small ? 53 : 67, upper = 34, lower = 52;
  const plotWidth = width - left - right, plotHeight = height - upper - lower;
  const x = t => left + (t - min) / (max - min) * plotWidth;
  const y = w => upper + plotHeight - w / yMax * plotHeight;
  return { p, shown, small, min, max, yMax, yStep, xStep, height, width, left, right, upper, lower, plotWidth, plotHeight, x, y };
}

export function chartSvg(states, options, suppliedWidth = 850) {
  const width = Math.max(280, Math.round(suppliedWidth));
  const g = chartGeometry(states, options.active, options.compare, options.focus, width, options);
  const { p, shown, small, min, max, yMax, yStep, xStep, height, left, right, upper, lower, x, y } = g;
  const baseY = height - lower, rightX = width - right;
  const axisFormat = v => Math.abs(v) >= 10000 ? v.toExponential(0) : String(n(v));
  const txt = (cx, cy, content, attrs = '') => `<text x="${n(cx)}" y="${n(cy)}" ${attrs}>${content}</text>`;
  const line = (x1, y1, x2, y2, attrs = '') => `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${attrs}/>`;
  const curve = (fn, floorT = min) => {
    let path = '', open = false;
    for (let i = 0; i <= 480; i++) {
      const t = min + (max - min) * i / 480, w = fn(t);
      if (t < floorT || !Number.isFinite(w) || w < -yMax * 0.04 || w > yMax * 1.04) { open = false; continue; }
      path += `${open ? 'L' : 'M'}${n(x(t))},${n(y(w))} `; open = true;
    }
    return path;
  };
  const segmentPath = segment => {
    if (!segment?.from || !segment?.to) return '';
    if (segment.type !== 'saturation') return `M${n(x(segment.from.t))},${n(y(segment.from.w * 1000))} L${n(x(segment.to.t))},${n(y(segment.to.w * 1000))}`;
    let path = '';
    for (let i = 0; i <= 80; i++) {
      const t = segment.from.t + (segment.to.t - segment.from.t) * i / 80;
      const w = humidityRatio(t, 100, p) * 1000;
      if (!Number.isFinite(w)) continue;
      path += `${path ? 'L' : 'M'}${n(x(t))},${n(y(w))} `;
    }
    return path;
  };
  let area = `M${n(x(min))},${n(baseY)} `;
  for (let i = 0; i <= 400; i++) {
    const t = min + (max - min) * i / 400;
    const ws = humidityRatio(t, 100, p) * 1000;
    area += `L${n(x(t))},${n(y(Number.isFinite(ws) ? Math.min(yMax, ws) : yMax))} `;
  }
  area += `L${n(rightX)},${n(baseY)} Z`;
  const processDescription = options.process?.ok && options.process.generated ? '圖中紫色箭線顯示條件 A 到 B 的工程過程。' : '';
  const surfaceDescription = options.condensation?.ok && shown.includes('A') ? `表面溫度 ${options.condensation.surfaceT.toFixed(2)} °C，判斷為${options.condensation.label}。` : '';
  let result = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-svg-title chart-svg-desc"><title id="chart-svg-title">濕空氣圖，總壓力 ${p.toFixed(3)} kPa</title><desc id="chart-svg-desc">橫軸乾球溫度 ${min} 至 ${max} °C，縱軸含濕量 0 至 ${axisFormat(yMax)} g 水每 kg 乾空氣。${shown.map(id => `條件 ${id}：${states[id].t.toFixed(2)} °C、相對濕度 ${states[id].rh.toFixed(2)}%、含濕量 ${(states[id].w * 1000).toFixed(2)}。`).join('')}${processDescription}${surfaceDescription}</desc><defs><clipPath id="chart-region"><path d="${area}"/></clipPath><clipPath id="chart-box"><rect x="${left}" y="${upper}" width="${g.plotWidth}" height="${g.plotHeight}"/></clipPath><marker id="process-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${PURPLE}"/></marker></defs>`;
  result += `<rect x="${left}" y="${upper}" width="${g.plotWidth}" height="${g.plotHeight}" fill="#fdfdff"/><path d="${area}" fill="#f5f8ff"/>`;
  result += txt(left, 18, small ? 'RH (%)' : 'RH 相對濕度', 'fill="#5e6b80" font-size="12"');
  result += txt(rightX, 18, small ? 'W · g/kg 乾空氣' : '含濕量 W · g / kg 乾空氣', 'fill="#5e6b80" font-size="12" text-anchor="end"');
  result += '<g clip-path="url(#chart-region)" fill="none">';
  for (let t = Math.ceil(min / xStep) * xStep; t <= max + 1e-8; t += xStep) result += line(x(t), upper, x(t), baseY, 'stroke="#dce4f3" stroke-width="1"');
  for (let w = 0; w <= yMax + 1e-8; w += yStep) result += line(left, y(w), rightX, y(w), 'stroke="#dce4f3" stroke-width="1"');
  if (options.enthalpy) {
    const hMin = 1.006 * min, hMax = 1.006 * max + yMax / 1000 * (2501 + 1.86 * max);
    const step = niceStep(hMax - hMin, small ? 8 : 14);
    for (let h = Math.ceil(hMin / step) * step; h < hMax; h += step) {
      result += `<path d="${curve(t => (h - 1.006 * t) / (2501 + 1.86 * t) * 1000)}" stroke="#c8bdd6" stroke-width="1" stroke-dasharray="4 5"/>`;
    }
  }
  if (options.wetbulb) {
    const step = niceStep(max - min, small ? 5 : 9);
    for (let tw = Math.ceil(min / step) * step; tw < max; tw += step) {
      result += `<path d="${curve(t => ratioFromWetBulb(t, tw, p) * 1000, tw)}" stroke="#75a99c" stroke-width="1" stroke-dasharray="6 4"/>`;
    }
  }
  for (let rh = 10; rh < 100; rh += 10) {
    result += `<path d="${curve(t => humidityRatio(t, rh, p) * 1000)}" stroke="${rh % 20 === 0 ? '#9aafe7' : '#c3cfee'}" stroke-width="${rh % 20 === 0 ? 1.2 : 0.9}"/>`;
  }
  result += '</g>';
  result += `<path d="${curve(t => humidityRatio(t, 100, p) * 1000)}" clip-path="url(#chart-box)" fill="none" stroke="${BLUE}" stroke-width="2.4"/>`;
  for (let rh = small ? 20 : 10; rh <= 100; rh += small ? 20 : 10) {
    const labelTop = yMax * (small && rh % 40 === 0 ? 0.78 : 0.91);
    let labelT = max - (max - min) * 0.027;
    let labelW = humidityRatio(labelT, rh, p) * 1000;
    if (!Number.isFinite(labelW) || labelW > labelTop) {
      let lo = min, hi = labelT;
      for (let i = 0; i < 55; i++) {
        const mid = (lo + hi) / 2, w = humidityRatio(mid, rh, p) * 1000;
        if (!Number.isFinite(w) || w > labelTop) hi = mid; else lo = mid;
      }
      labelT = (lo + hi) / 2; labelW = humidityRatio(labelT, rh, p) * 1000;
    }
    if (Number.isFinite(labelW) && labelW >= 0 && labelW < yMax) {
      result += txt(x(labelT) - 1, y(labelW) - 6, `${rh}%`, `text-anchor="end" font-size="${small ? 12 : 12}" font-weight="${rh === 100 ? 700 : 500}" fill="${rh === 100 ? BLUE : '#6c80af'}" paint-order="stroke" stroke="#f9fbff" stroke-width="4" stroke-linejoin="round"`);
    }
  }
  // Numeric labels for optional auxiliary line families, placed inside the valid region.
  if (options.enthalpy && !small) {
    const labelW = yMax * 0.19, step = niceStep((max - min) * 1.006, 4);
    const h0 = 1.006 * min + labelW / 1000 * (2501 + 1.86 * min);
    const h1 = 1.006 * max + labelW / 1000 * (2501 + 1.86 * max);
    for (let h = Math.ceil(h0 / step) * step; h < h1; h += step) {
      const t = (h - 2.501 * labelW) / (1.006 + 0.00186 * labelW);
      if (t > min + 3 && t < max - 3 && humidityRatio(t, 100, p) * 1000 > labelW) result += txt(x(t), y(labelW) - 4, `h ${axisFormat(h)}`, 'font-size="12" fill="#9b8cab" paint-order="stroke" stroke="#f8faff" stroke-width="3"');
    }
  }
  if (options.wetbulb) {
    const step = niceStep(max - min, small ? 5 : 9);
    for (let tw = Math.ceil(min / step) * step; tw < max; tw += step) {
      const t = Math.min(tw + (max - min) * 0.13, max - 1), w = ratioFromWetBulb(t, tw, p) * 1000;
      if (t > tw && Number.isFinite(w) && w > yMax * .08 && w < yMax * .85) result += txt(x(t), y(w) + 12, `wb ${axisFormat(tw)}°`, 'font-size="12" fill="#507e73" paint-order="stroke" stroke="#f8faff" stroke-width="3"');
    }
  }
  result += line(left, baseY, rightX, baseY, 'stroke="#8192b0" stroke-width="1.2"');
  result += line(rightX, upper, rightX, baseY, 'stroke="#8192b0" stroke-width="1.2"');
  for (let t = Math.ceil(min / xStep) * xStep; t <= max + 1e-8; t += xStep) {
    result += line(x(t), baseY, x(t), baseY + 5, 'stroke="#8192b0"');
    result += txt(x(t), baseY + 21, axisFormat(t), 'text-anchor="middle" font-size="12" fill="#5e6b80"');
  }
  for (let w = 0; w <= yMax + 1e-8; w += yStep) {
    result += line(rightX, y(w), rightX + 5, y(w), 'stroke="#8192b0"');
    result += txt(rightX + 10, y(w) + 4, axisFormat(w), 'font-size="12" fill="#5e6b80"');
  }
  result += txt((left + rightX) / 2, height - 4, '乾球溫度 Tdb · °C', 'text-anchor="middle" font-size="13" fill="#5e6b80"');

  // Surface-temperature cue and dew-point safety band for condition A.
  const condensation = options.condensation;
  if (condensation?.ok && shown.includes('A')) {
    const source = states.A, cy = y(source.w * 1000);
    const statusColor = condensation.status === 'risk' ? RED : condensation.status === 'caution' ? AMBER : condensation.status === 'safe' ? GREEN : '#8794a7';
    if (condensation.surfaceT >= min && condensation.surfaceT <= max) {
      const sx = x(condensation.surfaceT);
      result += `<g data-surface-temperature clip-path="url(#chart-box)">${line(sx, upper, sx, baseY, `stroke="${statusColor}" stroke-width="1.7" stroke-dasharray="5 5" opacity="0.85"`)}</g>`;
      result += txt(clamp(sx, left + 35, rightX - 35), upper + 15, `表面 ${condensation.surfaceT.toFixed(1)}°`, `text-anchor="middle" font-size="12" font-weight="650" fill="${statusColor}" paint-order="stroke" stroke="#fff" stroke-width="4"`);
      if (cy >= upper && cy <= baseY) {
        result += line(sx - 5, cy - 5, sx + 5, cy + 5, `stroke="${statusColor}" stroke-width="2" clip-path="url(#chart-box)"`);
        result += line(sx - 5, cy + 5, sx + 5, cy - 5, `stroke="${statusColor}" stroke-width="2" clip-path="url(#chart-box)"`);
      }
    }
    if (source.dp !== null && source.dp >= min && source.dp <= max && cy >= upper && cy <= baseY) {
      const dx = x(source.dp);
      if (Number.isFinite(condensation.requiredT) && condensation.safetyMargin > 0) {
        const requiredX = x(clamp(condensation.requiredT, min, max));
        result += line(dx, cy, requiredX, cy, `stroke="${AMBER}" stroke-width="7" opacity="0.18" clip-path="url(#chart-box)"`);
      }
      if (condensation.status === 'risk') {
        const sx = x(clamp(condensation.surfaceT, min, max));
        result += line(sx, cy, dx, cy, `stroke="${RED}" stroke-width="8" opacity="0.32" clip-path="url(#chart-box)"`);
        if (!small && Math.abs(dx - sx) > 58) result += txt((sx + dx) / 2, cy - 10, condensation.frost ? '結霜區段' : '結露區段', `text-anchor="middle" font-size="12" font-weight="700" fill="${RED}" paint-order="stroke" stroke="#fff" stroke-width="4"`);
      }
    }
  }

  // A generated process gets a directional path. Independent states only get a neutral comparison line.
  const generatedProcess = options.process?.ok && options.process.generated && shown.includes('A') && shown.includes('B');
  if (generatedProcess) {
    const segments = (options.process.segments || []).filter(segment => {
      const dx = segment.to.t - segment.from.t, dw = segment.to.w - segment.from.w;
      return [segment.from.t, segment.from.w, segment.to.t, segment.to.w].every(Number.isFinite) && (Math.abs(dx) > 1e-8 || Math.abs(dw) > 1e-10);
    });
    segments.forEach((segment, index) => {
      const path = segmentPath(segment);
      if (!path) return;
      const arrow = index === segments.length - 1 ? ' marker-end="url(#process-arrow)"' : '';
      result += `<path data-process-segment="${segment.type}" d="${path}" fill="none" stroke="${PURPLE}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"${arrow} clip-path="url(#chart-box)"/>`;
    });
    if (segments.length) {
      const labelSegment = segments.reduce((best, segment) => {
        const length = Math.hypot(x(segment.to.t) - x(segment.from.t), y(segment.to.w * 1000) - y(segment.from.w * 1000));
        return !best || length > best.length ? { segment, length } : best;
      }, null).segment;
      const midT = (labelSegment.from.t + labelSegment.to.t) / 2;
      const midW = labelSegment.type === 'saturation' ? humidityRatio(midT, 100, p) : (labelSegment.from.w + labelSegment.to.w) / 2;
      if (!small && Number.isFinite(midW)) result += txt(clamp(x(midT), left + 35, rightX - 35), clamp(y(midW * 1000) - 11, upper + 18, baseY - 9), labelSegment.label, `text-anchor="middle" font-size="12" font-weight="700" fill="${PURPLE}" paint-order="stroke" stroke="#fff" stroke-width="5"`);
    }
  } else if (options.compare && shown.includes('A') && shown.includes('B')) {
    const a = states.A, b = states.B;
    result += line(x(a.t), y(a.w * 1000), x(b.t), y(b.w * 1000), 'data-comparison-line stroke="#8290ab" stroke-width="1.8" stroke-dasharray="7 5" opacity="0.85" clip-path="url(#chart-box)"');
  }

  const current = states[options.active];
  if (current.ok && shown.includes(options.active)) {
    const cx = x(current.t), cy = y(current.w * 1000), color = options.active === 'A' ? BLUE : ORANGE;
    result += line(cx, cy, cx, baseY, `stroke="${color}" stroke-width="1.2" stroke-dasharray="3 4" opacity="0.65"`);
    result += line(cx, cy, rightX, cy, `stroke="${color}" stroke-width="1.2" stroke-dasharray="3 4" opacity="0.65"`);
    if (options.dew && current.dp !== null && current.dp >= min && current.dp <= max && current.w > 0) {
      const dx = x(current.dp);
      result += line(dx, cy, cx, cy, `stroke="${color}" stroke-dasharray="5 4" stroke-width="1.6"`);
      result += `<path d="M${n(dx)},${n(cy - 5)} l5,5 -5,5 -5,-5 Z" fill="#fff" stroke="${color}" stroke-width="1.6"/>`;
      if (!small && cx - dx > 55) result += txt(Math.max(left + 5, dx - 8), cy - 11, `${current.dp < 0 ? '霜' : '露'}點 ${current.dp.toFixed(1)}°`, `text-anchor="end" font-size="12" fill="${color}" paint-order="stroke" stroke="#fff" stroke-width="4"`);
    }
  }
  const order = shown.filter(id => id !== options.active).concat(shown.filter(id => id === options.active));
  for (const id of order) {
    const s = states[id], cx = x(s.t), cy = y(s.w * 1000), color = id === 'A' ? BLUE : ORANGE;
    const isActive = id === options.active;
    const overlaps = shown.some(other => other !== id && Math.abs(x(states[other].t) - cx) < 13 && Math.abs(y(states[other].w * 1000) - cy) < 13);
    const labelWidth = small ? 28 : 160;
    let labelX = cx + 14 + labelWidth > rightX ? cx - 14 - labelWidth : cx + 14;
    labelX = clamp(labelX, left + 2, rightX - labelWidth - 2);
    const labelY = clamp(cy + (id === 'B' && overlaps ? 14 : -39), upper + 2, baseY - 29);
    result += `<g data-point="${id}"><title>條件 ${id}：${s.t.toFixed(2)} °C，${s.rh.toFixed(2)}% RH，W ${(s.w * 1000).toFixed(2)} g/kg</title>`;
    if (isActive) result += `<circle cx="${n(cx)}" cy="${n(cy)}" r="16" fill="${color}" fill-opacity="0.10"/>`;
    result += `<circle cx="${n(cx)}" cy="${n(cy)}" r="${!isActive && overlaps ? 10 : 6.5}" fill="${isActive ? color : '#fff'}" stroke="${isActive ? '#fff' : color}" stroke-width="${isActive ? 2.5 : 2}"/>`;
    result += `<rect x="${n(labelX)}" y="${n(labelY)}" width="${labelWidth}" height="27" rx="6" fill="${color}"/>`;
    result += txt(labelX + (small ? 14 : 10), labelY + 18, small ? id : `${id} · ${s.t.toFixed(1)}°C / ${s.rh.toFixed(1)}%`, `font-size="12" font-weight="600" fill="#fff" ${small ? 'text-anchor="middle"' : ''}`);
    result += '</g>';
  }
  if (!shown.length) result += txt((left + rightX) / 2, upper + g.plotHeight * .55, '完成有效輸入後顯示狀態點', 'text-anchor="middle" font-size="14" fill="#5e6b80" paint-order="stroke" stroke="#fff" stroke-width="5"');
  if (options.enthalpy) result += txt(left, height - 4, small ? '' : 'h：kJ / kg 乾空氣', 'font-size="12" fill="#998aa7"');
  result += '</svg>';
  return { svg: result, geometry: g };
}
