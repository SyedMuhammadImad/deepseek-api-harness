'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {spawnSync} = require('node:child_process');
const {DeepSeekHarness,configFromEnv,readSource,projectTree,main} = require('./index.js');
const env = {DEEPSEEK_API_KEY:'unit-test-placeholder',DEEPSEEK_MODEL:'mock-model'};
function response(content = 'Mock answer', finish = 'stop', extras = {}) {
  return new Response(JSON.stringify({choices:[{finish_reason:finish,message:{role:'assistant',content,...extras}}]}));
}
function setup(t, transport = async () => response()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'harness-test-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'sum.js'),'module.exports = (a,b) => a+b;');
  return {root,h:new DeepSeekHarness({root,config:configFromEnv(env),transport})};
}
test('configuration preserves zero temperature and rejects malformed values', () => {
  assert.equal(configFromEnv({...env,DEEPSEEK_TEMPERATURE:'0'}).temperature,0);
  for (const value of ['','NaN','Infinity','-1','2.1']) assert.throws(() => configFromEnv({...env,DEEPSEEK_TEMPERATURE:value}));
  for (const value of ['0','1.5','8193']) assert.throws(() => configFromEnv({...env,DEEPSEEK_MAX_TOKENS:value}));
  assert.throws(() => configFromEnv({}));
});
test('help and imports need no credentials or network', async () => {
  let text;await main(['--help'],{env:{},write:value=>text=value});assert.match(text,/Commands/);
  const p=spawnSync(process.execPath,['-e','require("./index.js")'],{cwd:__dirname,encoding:'utf8',env:{...process.env,DEEPSEEK_API_KEY:'',DEEPSEEK_MODEL:''}});
  assert.equal(p.status,0);assert.equal(p.stdout,'');assert.equal(p.stderr,'');
});
test('API request uses fixed HTTPS, disables redirects, sends correct payload', async t => {
  const {h} = setup(t,async (url, options) => {
    assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.redirect,'error');
    const body=JSON.parse(options.body);assert.equal(body.model,'mock-model');assert.equal(body.stream,false);
    assert.equal(body.messages.at(-1).content,'Explain sorting');assert.equal(options.headers.Authorization,'Bearer '+env.DEEPSEEK_API_KEY);
    return response();
  });
  assert.equal(await h.query('Explain sorting'),'Mock answer');assert.equal(h.history.length,2);
});
test('history has at most ten exchanges and can be cleared', async t => {
  const {h}=setup(t);for(let i=0;i<35;i++) await h.query('Question '+i);
  assert.equal(h.history.length,20);assert.equal(h.history[0].content,'Question 25');h.clear();assert.equal(h.history.length,0);
});
test('rejected responses do not enter history', async t => {
  for (const r of [response('partial','length'),response('bad','stop',{refusal:'refused'}),response('','stop'),response('x','stop',{tool_calls:[]}),new Response('{}'),new Response('broken')]) {
    const {h}=setup(t,async()=>r);await assert.rejects(h.query('Hi'));assert.equal(h.history.length,0);assert.equal(h.busy,false);
  }
});
test('HTTP and transport failures never expose the supplied key or response body', async t => {
  for(const transport of [async()=>new Response(env.DEEPSEEK_API_KEY,{status:429}),async()=>{throw new Error('Authorization: '+env.DEEPSEEK_API_KEY);}]) {
    const {h}=setup(t,transport);await assert.rejects(h.query('Hi'),error=>!error.message.includes(env.DEEPSEEK_API_KEY));
  }
});
test('timeout aborts request and resets busy state', async t => {
  const {h}=setup(t,(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')))));
  h.config.timeout=100;await assert.rejects(h.query('Hi'),/timed out/);assert.equal(h.busy,false);
});
test('concurrent requests are rejected without corrupting history', async t => {
  let finish;const {h}=setup(t,()=>new Promise(resolve=>finish=resolve));const pending=h.query('First');
  await assert.rejects(h.query('Second'),/already running/);finish(response());await pending;assert.equal(h.history.length,2);
});
test('oversized response is rejected', async t => {
  const {h}=setup(t,async()=>new Response('x'.repeat(1024*1024+1)));
  await assert.rejects(h.query('Hi'));assert.equal(h.history.length,0);
});
test('input and returned secrets are blocked before they are printed', async t => {
  let calls=0;const {h}=setup(t,async()=>{calls++;return response(env.DEEPSEEK_API_KEY);});
  await assert.rejects(h.query('The key is '+env.DEEPSEEK_API_KEY));assert.equal(calls,0);
  await assert.rejects(h.query('password = "dummy-secret-value"'));assert.equal(calls,0);
  await assert.rejects(h.query('Hi'),/echoed/);assert.equal(h.history.length,0);
});
test('source guard rejects traversal, binary content, secrets and unsupported types', t => {
  const {root}=setup(t);
  fs.writeFileSync(path.join(root,'config.js'),'password = "dummy-secret-value"');
  fs.writeFileSync(path.join(root,'bad.js'),Buffer.from([255,254,0]));
  fs.writeFileSync(path.join(root,'large.js'),'x'.repeat(64001));
  fs.writeFileSync(path.join(root,'.env'),'not used');
  for(const file of ['../outside.js','.env','config.js','bad.js','large.js','sum.js/other.js','data.csv']) assert.throws(()=>readSource(root,file));
  assert.match(readSource(root,'sum.js'),/module.exports/);
});
test('source guard rejects linked directories and files', t => {
  const {root}=setup(t);fs.mkdirSync(path.join(root,'real'));fs.writeFileSync(path.join(root,'real','test.js'),'let x=1;');
  fs.symlinkSync(path.join(root,'real'),path.join(root,'linked'),'junction');
  assert.throws(()=>readSource(root,'linked/test.js'),/links/);assert.doesNotMatch(projectTree(root),/linked/);
});
test('generated JavaScript is checked, saved exclusively, and never executed', async t => {
  const code='require("node:fs").writeFileSync("must-not-exist.txt","bad");';
  const {root,h}=setup(t,async()=>response('```javascript\n'+code+'\n```'));
  const before=fs.readFileSync(path.join(root,'sum.js'),'utf8');
  assert.match(await h.generateTests('sum.js','sum.test.js'),/has not been executed/);
  assert.equal(fs.readFileSync(path.join(root,'sum.test.js'),'utf8'),code+'\n');
  assert.equal(fs.existsSync(path.join(root,'must-not-exist.txt')),false);
  assert.equal(fs.readFileSync(path.join(root,'sum.js'),'utf8'),before);
  await assert.rejects(h.generateTests('sum.js','sum.test.js'),/new/);
});
test('malformed generated code/prose does not create files', async t => {
  for(const content of ['Here are tests','```js\nconst = broken;\n```','```js\nlet x=1;\n```\n```js\nlet y=2;\n```']) {
    const {root,h}=setup(t,async()=>response(content));await assert.rejects(h.generateTests('sum.js','sum.test.js'));
    assert.equal(fs.existsSync(path.join(root,'sum.test.js')),false);
  }
});
test('all noninteractive CLI modes and invalid arguments are checked', async t => {
  const {root}=setup(t);const text=[];
  for(const args of [['ask','Hello'],['review','sum.js'],['explain','sum.js']]) await main(args,{env,root,transport:async()=>response(),write:x=>text.push(x)});
  assert.equal(text.length,3);
  for(const args of [['review'],['test','sum.js'],['invalid'],['explain','sum.js','extra']]) await assert.rejects(main(args,{env,root}),/Invalid arguments/);
});
