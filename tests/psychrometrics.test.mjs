import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, saturationPressure, humidityRatio, ratioFromWetBulb, parseNumeric } from '../dist/psychrometrics.js';
import { chartSvg, chartGeometry } from '../dist/chart.js';

const state = (values = {}) => calculate({mode:'rh',t:'30',rh:'60',p:'100',v:'1',...values});
const near = (a,b,tolerance,message='') => assert.ok(Math.abs(a-b) <= tolerance, `${message}: ${a} ≠ ${b} (±${tolerance})`);

test('SI saturation pressure agrees with rounded reference values over ice and water', () => {
  for (const [t,p,tol] of [[-20,.10326,.00002],[0,.61115,.00002],[20,2.3388,.0005],[30,4.2460,.0005],[50,12.3526,.003],[80,47.4145,.005]]) near(saturationPressure(t),p,tol,`pws(${t})`);
});

test('provided temperature/RH example gives expected W, dew point and enthalpy', () => {
  const s=state(); assert.equal(s.ok,true);
  near(s.w,.01626,.00001); near(s.dp,21.38,.02); near(s.h,71.8,.1);
  // Independent ideal-gas water-vapor density, not dry-air density times W.
  near(s.waterMass,2.547618146/(.461523*(30+273.15))*1000,.0002);
  near(s.cpDryBasis,1.03624,.00002);
  assert.ok(Math.abs(s.cpDryBasis-s.h/s.t)>1);
});

test('wet-bulb input, RH input and inverse temperatures describe the same state', () => {
  const wb=state({mode:'wb',tw:'23.9'});
  assert.equal(wb.ok,true); near(wb.rh,60.62654,.00002);
  const rh=state({rh:String(wb.rh)});
  near(rh.tw,23.9,1e-8); near(rh.w,wb.w,1e-10); near(rh.dp,wb.dp,1e-8);
});

test('pressure changes W and dry-air density, but not vapor mass or dew point at fixed T/RH/V', () => {
  const a=state({p:'80'}), b=state({p:'120'}), c=state({v:'3.5'});
  assert.ok(a.w>b.w); assert.ok(a.rhoDry<b.rhoDry);
  near(a.dp,b.dp,1e-8); near(a.waterMass,b.waterMass,1e-9);
  near(c.waterMass,state().waterMass*3.5,1e-9);
});

test('constant-W enthalpy derivative is cp on the dry-air mass basis', () => {
  const a=state();
  const b=state({t:'40',rh:String(a.pv/saturationPressure(40)*100)});
  near(b.w,a.w,1e-12); near((b.h-a.h)/10,a.cpDryBasis,1e-12);
});

test('edge cases remain physical; impossible and incomplete input never gives valid output', () => {
  const dry=state({rh:'0'}); assert.equal(dry.w,0); assert.equal(dry.waterMass,0); assert.equal(dry.dp,null);
  const sat=state({rh:'100'}); near(sat.dp,30,1e-8); near(sat.tw,30,1e-8);
  for (const override of [{t:''},{p:'0'},{v:'0'},{v:'-1'},{rh:'101'},{rh:'-1'},{t:'abc'},{mode:'wb',tw:'31'},{mode:'wb',tw:'-30'},{mode:'rh',t:'80',p:'20',rh:'100'}]) assert.equal(state(override).ok,false,JSON.stringify(override));
  assert.equal(parseNumeric('3.5'),3.5); assert.equal(parseNumeric('3.'),3); assert.equal(parseNumeric('.5'),.5); assert.equal(parseNumeric('−2.5'),-2.5); assert.ok(Number.isNaN(parseNumeric('')));
});

test('temperature, humidity and pressure sweep: wet-bulb inversion and vapor conservation', () => {
  let checked=0;
  for (const t of [-20,-10,0,5,25,30,50,80]) for (const rh of [0,5,30,60,100]) for (const p of [20,80,100,200]) {
    const s=state({t:String(t),rh:String(rh),p:String(p)});
    if (!s.ok) { assert.ok(rh/100*saturationPressure(t)>=p); continue; }
    assert.ok(s.w>=0); assert.ok(s.rhoDry>0); assert.ok(s.rhoMoist>=s.rhoDry);
    near(s.rhoVapor,s.pv/(.461523*(t+273.15)),1e-5);
    if (s.dp!==null) assert.ok(s.dp<=s.t+1e-7);
    if (s.tw!==null) { assert.ok(s.tw<=t+1e-7); near(ratioFromWetBulb(t,s.tw,p),s.w,1e-8); }
    checked++;
  }
  assert.ok(checked>140);
});

test('chart projects only valid points at the selected pressure and never emits invalid coordinates', () => {
  const pairs=[{A:state(),B:state({t:'25',rh:'50'})},{A:state(),B:state({p:'80'})},{A:state({rh:'0'}),B:state({rh:'100'})},{A:state({t:'-20',rh:'20'}),B:state({t:'80',rh:'80'})},{A:state({rh:'bad'}),B:state({rh:'bad'})}];
  for (const states of pairs) for (const width of [280,350,640,920]) for (const focus of [false,true]) {
    const options={active:'A',compare:true,focus,enthalpy:true,wetbulb:true,dew:true};
    const {svg,geometry:g}=chartSvg(states,options,width);
    assert.ok(!/NaN|Infinity|undefined/.test(svg));
    for (const id of g.shown) {
      assert.ok(Math.abs(states[id].p-g.p)<1e-8);
      assert.ok(g.x(states[id].t)>=g.left-1e-8 && g.x(states[id].t)<=width-g.right+1e-8);
      assert.ok(g.y(states[id].w*1000)>=g.upper-1e-8 && g.y(states[id].w*1000)<=g.height-g.lower+1e-8);
    }
  }
  const g=chartGeometry({A:state(),B:state({p:'80'})},'B',true,false,850);
  assert.deepEqual(g.shown,['B']); assert.equal(g.p,80);
});
