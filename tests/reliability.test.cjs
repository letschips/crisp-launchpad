// Failure modes are listed before the fixtures: publication history overwritten;
// partial project writes; rollback overwriting outside edits; same-title source collision;
// missing completed history; swallowed/truncated/blocked settings writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
class Base { async saveData() {} }
class TFile { constructor(path) { this.path = path; } }
Module._load = function(id, ...args) {
  if (id === 'obsidian') return { Plugin: Base, ItemView: Base, Modal: Base, PluginSettingTab: Base, Setting: Base, Notice: Base, TFile, TFolder: Base, Platform: { isMobile: false }, setIcon() {}, addIcon() {} };
  return originalLoad.call(this, id, ...args);
};
const P = require('../main.js');
Module._load = originalLoad;
const root = 'Topics/example/content-projects/P-1';
function projectFixture(initial, failAt = '') {
  const data = new Map(['project.yaml', 'article.md', 'publish.md'].map(n => [root + '/' + n, initial]));
  const plugin = Object.assign(Object.create(P.prototype), {
    canRunAnks: () => false, refreshViews() {},
    app: { vault: {
      getAbstractFileByPath: p => data.has(p) ? new TFile(p) : null,
      read: async f => data.get(f.path),
      modify: async (f, s) => { if (f.path.endsWith(failAt) && failAt) throw Error('disk full'); data.set(f.path, s); },
      process: async (f, fn) => { if (f.path.endsWith(failAt) && failAt) throw Error('disk full'); data.set(f.path, fn(data.get(f.path))); },
    } },
  });
  return { plugin, data };
}
test('advancing an already published project retains its original publication date', async () => {
  const {plugin, data} = projectFixture('---\nstage: reviewing\nstatus: published\npublished_at: "2026-09-01"\n---\n');
  await plugin.updateContentProject(root, {stage: 'distilled', status: 'published'});
  assert.equal(P.projectField(data.get(root + '/publish.md'), 'published_at'), '2026-09-01');
});
test('first publication fills a missing date and later edits preserve it', async () => {
  const {plugin, data} = projectFixture('---\nstage: drafting\nstatus: draft\npublished_at: ""\n---\n');
  await plugin.updateContentProject(root, {stage: 'reviewing', status: 'published'});
  const date = P.projectField(data.get(root + '/publish.md'), 'published_at');
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  await plugin.updateContentProject(root, {stage: 'distilled', status: 'published'});
  assert.equal(P.projectField(data.get(root + '/publish.md'), 'published_at'), date);
});
test('a later file failure restores earlier project bytes', async () => {
  const initial = '---\nstage: drafting\nstatus: draft\n---\noriginal body\n';
  const {plugin, data} = projectFixture(initial, 'article.md');
  await assert.rejects(plugin.updateContentProject(root, {stage:'reviewing',status:'published'}));
  assert.ok([...data.values()].every(s => s === initial));
});
test('rollback preserves an outside edit and reports incomplete rollback', async () => {
  const {plugin, data} = projectFixture('---\nstage: drafting\nstatus: draft\n---\n');
  const process = plugin.app.vault.process;
  plugin.app.vault.process = async (f, fn) => {
    if (f.path.endsWith('article.md')) { data.set(root+'/project.yaml','outside edit'); throw Error('disk full'); }
    return process(f, fn);
  };
  await assert.rejects(plugin.updateContentProject(root,{stage:'reviewing',status:'published'}), /外部|并发|恢复/);
  assert.equal(data.get(root+'/project.yaml'), 'outside edit');
});
test('same-title notes produce distinct tasks while retries reuse the source identity', async () => {
  const tasks = new Map();
  const plugin = Object.assign(Object.create(P.prototype), {tempoApi: () => ({createTaskFromSource: async input => {
    if (!tasks.has(input.sourceId)) tasks.set(input.sourceId, input);
    return tasks.get(input.sourceId);
  }})});
  await plugin.createAction({text:'处理材料',link:'Topics/example/raw/inbox/a.md'});
  await plugin.createAction({text:'处理材料',link:'Topics/example/raw/inbox/b.md'});
  await plugin.createAction({text:'处理材料',link:'Topics/example/raw/inbox/a.md'});
  assert.equal(tasks.size, 2);
  assert.deepEqual([...tasks.values()].map(t=>t.notePath).sort(), ['Topics/example/raw/inbox/a.md','Topics/example/raw/inbox/b.md']);
});
test('review excludes yesterday completed work without adding it to today counts', async () => {
  const today = new Date(2026,10,3,12);
  const plugin = Object.assign(Object.create(P.prototype), {readActions: async () => [], tempoApi: () => ({
    getActionOverview: async () => ({licensed:true,tasks:[]}),
    getCompletedOn: async date => ({date,tasks:date==='2026-11-02'?[{id:'done',title:'整理积压收件箱：材料',completedAt:new Date(2026,10,2,12).getTime()}]:[]}),
  })});
  const history = await plugin.readReviewTasks(today);
  const suggestions = P.suggestReviewActions({tasks:history,today,health:{findings:[{code:'STALE_INBOX',path:'Topics/example/raw/inbox/材料.md'}]}});
  assert.ok(!suggestions.some(x=>x.text==='整理积压收件箱：材料'));
  assert.deepEqual(await plugin.readActions(), []);
});
test('review fails closed if completed history is unavailable', async () => {
  for (const tempo of [{}, {getCompletedOn:async()=>{throw Error('offline');}}]) {
    const plugin = Object.assign(Object.create(P.prototype), {readActions:async()=>[],tempoApi:()=>tempo});
    await assert.rejects(plugin.readReviewTasks());
  }
});
test('settings writes expose errors, truncation and blocked writes', async () => {
  for (const mode of ['reject','truncate','blocked']) {
    let bytes='original';
    const plugin = Object.assign(Object.create(P.prototype), {manifest:{dir:'.obsidian/plugins/crisp-launchpad'},dataWriteBlocked:mode==='blocked',app:{vault:{adapter:{
      write:async(p,s)=>{if(mode==='reject')throw Error('disk full');bytes=s.slice(0,4);},read:async()=>bytes,
    }}}});
    await assert.rejects(plugin.saveData({openOnStartup:false}));
    if(mode==='blocked')assert.equal(bytes,'original');
  }
});
