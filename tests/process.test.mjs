import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../dist/psychrometrics.js';
import { deriveProcess, evaluateCondensation } from '../dist/process.js';
import { chartSvg } from '../dist/chart.js';

const source = () => calculate({ mode: 'rh', t: '30', rh: '60', p: '100', v: '1' });
const near = (a, b, tolerance, message = '') => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} ≠ ${b} (±${tolerance})`);

test('surface check separates condensation, insufficient margin and safe conditions', () => {
  const a = source();
  const risk = evaluateCondensation(a, '20', '2');
  const caution = evaluateCondensation(a, '22', '2');
  const safe = evaluateCondensation(a, '25', '2');
  assert.equal(risk.status, 'risk');
  assert.equal(caution.status, 'caution');
  assert.equal(safe.status, 'safe');
  near(risk.dewMargin, -1.38799, 1e-5);
  near(risk.requiredT, a.dp + 2, 1e-10);
  assert.ok(risk.surfaceRh > 100);
  assert.ok(caution.surfaceRh < 100);
});

test('sensible heating preserves humidity ratio, dew point, water and dry-air mass', () => {
  const a = source(), result = deriveProcess(a, { mode: 'temperature', targetT: '40' });
  assert.equal(result.ok, true);
  assert.equal(result.crossedDewPoint, false);
  near(result.final.w, a.w, 1e-12);
  near(result.final.dp, a.dp, 1e-9);
  near(result.final.waterMass, a.waterMass, 1e-9);
  near(result.final.dryMass, a.dryMass, 1e-12);
  assert.ok(result.final.rh < a.rh);
  assert.ok(result.final.v > a.v);
  assert.deepEqual(result.segments.map(s => s.type), ['line']);
  const lowPressure = calculate({ mode: 'rh', t: '20', rh: '10', p: '20', v: '1' });
  const hot = deriveProcess(lowPressure, { mode: 'temperature', targetT: '80' });
  assert.equal(hot.ok, true);
  near(hot.final.w, lowPressure.w, 1e-12);
});

test('cooling below the dew point follows saturation and reports condensate', () => {
  const a = source(), result = deriveProcess(a, { mode: 'temperature', targetT: '20' });
  assert.equal(result.ok, true);
  assert.equal(result.crossedDewPoint, true);
  near(result.final.rh, 100, 1e-10);
  assert.ok(result.final.w < a.w);
  near(result.condensedG, a.waterMass - result.final.waterMass, 1e-9);
  assert.deepEqual(result.segments.map(s => s.type), ['line', 'saturation']);
  near(result.segments[0].to.t, a.dp, 1e-10);
});

test('target temperature and RH calculate explicit humidification or dehumidification', () => {
  const a = source();
  const dry = deriveProcess(a, { mode: 'moisture', targetT: '30', targetRh: '40' });
  const humid = deriveProcess(a, { mode: 'moisture', targetT: '35', targetRh: '80' });
  assert.equal(dry.ok, true); assert.equal(humid.ok, true);
  assert.ok(dry.stageWaterG < 0); assert.ok(humid.stageWaterG > 0);
  near(dry.final.rh, 40, 1e-10); near(humid.final.rh, 80, 1e-10);
  near(dry.final.dryMass, a.dryMass, 1e-12); near(humid.final.dryMass, a.dryMass, 1e-12);
  assert.equal(dry.segments.at(-1).label, '除濕');
  assert.equal(humid.segments.at(-1).label, '加濕');
});

test('invalid engineering inputs fail explicitly and dry air has no finite dew point', () => {
  const a = source();
  for (const config of [
    { mode: 'temperature', targetT: '' },
    { mode: 'temperature', targetT: '81' },
    { mode: 'moisture', targetT: '20', targetRh: '101' }
  ]) assert.equal(deriveProcess(a, config).ok, false);
  assert.equal(evaluateCondensation(a, 'bad', '2').ok, false);
  assert.equal(evaluateCondensation(a, '20', '-1').ok, false);
  const dry = calculate({ mode: 'rh', t: '30', rh: '0', p: '100', v: '1' });
  assert.equal(evaluateCondensation(dry, '-20', '2').status, 'dry');
});

test('chart includes directional process, saturation segment and surface warning without invalid coordinates', () => {
  const a = source();
  const process = deriveProcess(a, { mode: 'temperature', targetT: '20' });
  const condensation = evaluateCondensation(a, '20', '2');
  const { svg } = chartSvg({ A: a, B: process.final }, {
    active: 'A', compare: true, focus: false, enthalpy: true, wetbulb: false, dew: true, process, condensation
  }, 850);
  assert.match(svg, /marker-end="url\(#process-arrow\)"/);
  assert.match(svg, /data-process-segment="saturation"/);
  assert.match(svg, /data-surface-temperature/);
  assert.match(svg, /判斷為結露風險/);
  assert.ok(!/NaN|Infinity|undefined/.test(svg));
});
