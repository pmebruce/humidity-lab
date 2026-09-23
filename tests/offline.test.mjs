import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
function harness(corruptScript=false) {
  const handlers={},storage=new Map();
  let offline=false,claimed=false,skipped=false,fetches=0;
  const caches={
    async open(name) {
      if(!storage.has(name)) storage.set(name,new Map());
      const items=storage.get(name);
      return {async put(url,response){items.set(url,response.clone());},async match(url){return items.get(url)?.clone();}};
    },
    async keys(){return [...storage.keys()];},
    async delete(name){return storage.delete(name);}
  };
  const fetch=async request=>{
    fetches++;
    if(offline) throw new Error('offline');
    const path=new URL(typeof request==='string'?request:request.url).pathname;
    const file=path==='/'?'index.html':path.slice(1);
    if(corruptScript && file==='app.js') return new Response('<html>Login</html>',{headers:{'content-type':'text/html'}});
    const bytes=await readFile(new URL('../dist/'+file,import.meta.url));
    const type=file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream';
    return new Response(bytes,{headers:{'content-type':type}});
  };
  const self={registration:{scope:'https://humidity.test/'},clients:{async claim(){claimed=true;}},async skipWaiting(){skipped=true;},addEventListener(name,fn){handlers[name]=fn;}};
  vm.runInNewContext(source,{self,caches,fetch,URL,Request,Response,Set,Promise,Error});
  return {
    handlers,storage,setOffline(){offline=true;},get claimed(){return claimed;},get skipped(){return skipped;},get fetches(){return fetches;},
    async lifecycle(name){let promise;handlers[name]({waitUntil(p){promise=p;}});await promise;},
    async request(url,method='GET'){let response;handlers.fetch({request:{url,method},respondWith(p){response=p;}});return response?await response:null;}
  };
}

test('complete app is cached and navigations/scripts remain available when the network fails',async()=>{
  const h=harness(); await h.lifecycle('install'); await h.lifecycle('activate'); assert.equal(h.claimed,true);
  assert.equal([...h.storage.values()][0].size,12);
  const networkCalls=h.fetches;h.setOffline();
  const html=await h.request('https://humidity.test/?installed=1');
  assert.ok((await html.text()).includes('id="psych-chart"'));
  const script=await h.request('https://humidity.test/app.js');
  assert.ok((await script.text()).includes('renderMetrics'));
  const processScript=await h.request('https://humidity.test/process.js');
  assert.ok((await processScript.text()).includes('deriveProcess'));
  assert.equal(h.fetches,networkCalls);
  assert.equal(await h.request('https://another.test/app.js'),null);
  assert.equal(await h.request('https://humidity.test/auth/callback'),null);
  assert.equal(await h.request('https://humidity.test/app.js','POST'),null);
});

test('a login document masquerading as a script cannot become an offline version',async()=>{
  const h=harness(true);await assert.rejects(h.lifecycle('install'),/Expected script/);
  assert.equal([...h.storage.values()][0].size,0);
});

test('worker replaces only its own prior caches and activates updates on request',async()=>{
  const h=harness();h.storage.set('other-app-v1',new Map());h.storage.set('humidity-lab-old',new Map());
  await h.lifecycle('install'); await h.lifecycle('activate');
  assert.ok(h.storage.has('other-app-v1'));assert.equal(h.storage.has('humidity-lab-old'),false);
  assert.equal(h.skipped,false);h.handlers.message({data:{type:'SKIP_WAITING'}});assert.equal(h.skipped,true);
});
