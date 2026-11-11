// 内容项目的计划发布日进 Tempo（0.11.0，需要 Crisp Tempo 0.17.0 的 sourceTasksApiVersion 2）。失败模式：
// - 日期写到了 article.md / publish.md，或追加到 Markdown 正文后面；手写控制卡 project.md 没跟着加字段，ANKS 报控制卡过期；
// - 没填日期的旧项目被塞进一个空字段；日期格式不对也写了进去；
// - 没改日期只是推进阶段，也去 Tempo 建任务（用户在 Tempo 删掉的行动又回来了）；
// - 改期时盖掉用户在 Tempo 里自己改过的截止日期（必须带上原日期让 Tempo 判断）；
// - Tempo 没装、太旧或报错时，连项目状态也没保存；
// - 已发布的项目还在倒计时。
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

const root = 'Topics/example/content-projects/WECHAT-20261111-DEMO';
const SOURCE = 'crisp-launchpad:publish-WECHAT-20261111-DEMO';
function fixture(files, tempo = null) {
  const data = new Map(Object.entries(files).map(([n, s]) => [`${root}/${n}`, s]));
  const plugin = Object.assign(Object.create(P.prototype), {
    canRunAnks: () => false, refreshViews() {}, tempoApi: () => tempo,
    app: { vault: {
      getAbstractFileByPath: p => data.has(p) ? new TFile(p) : null,
      read: async f => data.get(f.path),
      process: async (f, fn) => { data.set(f.path, fn(data.get(f.path))); },
    } },
  });
  return { plugin, data, get: n => data.get(`${root}/${n}`) };
}
function fakeTempo({ version = 2, existing = null, fail = null } = {}) {
  const calls = [];
  let task = existing;
  return {
    calls,
    sourceTasksApiVersion: version,
    async createTaskFromSource(input) {
      calls.push(['create', input]);
      if (fail) throw new Error(fail);
      task ||= { id: 't1', sourceId: input.sourceId, title: input.title, status: 'todo', ...(input.dueDate ? { dueDate: input.dueDate } : {}) };
      return task;
    },
    async rescheduleSourceTask(input) {
      calls.push(['reschedule', input]);
      if (!task) return { status: 'missing' };
      if ((task.dueDate ?? null) !== input.ifDueDate) return { status: 'kept', task };
      task = { ...task }; if (input.dueDate) task.dueDate = input.dueDate; else delete task.dueDate;
      return { status: 'updated', task };
    },
    async getTasksBySource(ids) { return task && ids.includes(task.sourceId) ? { [task.sourceId]: task } : {}; },
  };
}
const frontmatterOf = text => /^---\n([\s\S]*?)\n---/.exec(text)[1];
const base = { stage: 'drafting', status: 'draft', nextAction: '写初稿', title: '示例文章' };
const files = (yamlExtra = '') => ({
  'project.yaml': `stage: drafting\nstatus: draft\n${yamlExtra}`,
  'project.md': '---\nstage: drafting\nstatus: draft\nnext_action: x\n---\n\n# 手写的控制卡\n\n正文一行\n',
  'article.md': '---\nstage: drafting\nstatus: draft\n---\n\n正文\n',
  'publish.md': '---\nstatus: draft\n---\n\n# 发布记录\n',
});

test('the planned date goes to project.yaml and the control card only, quoted, inside frontmatter', async () => {
  const f = fixture(files());
  await f.plugin.updateContentProject(root, { ...base, plannedPublishAt: '2026-11-20' });
  assert.match(f.get('project.yaml'), /^planned_publish_at: "2026-11-20"$/m);
  assert.match(frontmatterOf(f.get('project.md')), /^planned_publish_at: "2026-11-20"$/m);
  assert.ok(f.get('project.md').endsWith('\n# 手写的控制卡\n\n正文一行\n'));
  assert.doesNotMatch(f.get('article.md'), /planned_publish_at/);
  assert.doesNotMatch(f.get('publish.md'), /planned_publish_at/);
});

test('projects that never had a date are not given an empty field; a set date can be cleared', async () => {
  const untouched = fixture(files());
  await untouched.plugin.updateContentProject(root, base);
  await untouched.plugin.updateContentProject(root, { ...base, plannedPublishAt: '' });
  assert.doesNotMatch(untouched.get('project.yaml'), /planned_publish_at/);
  assert.doesNotMatch(untouched.get('project.md'), /planned_publish_at/);

  const dated = fixture(files('planned_publish_at: "2026-11-20"\n'));
  await dated.plugin.updateContentProject(root, base);
  assert.match(dated.get('project.yaml'), /^planned_publish_at: "2026-11-20"$/m, '没传就不动');
  await dated.plugin.updateContentProject(root, { ...base, plannedPublishAt: '' });
  assert.match(dated.get('project.yaml'), /^planned_publish_at: ""$/m);
});

test('a malformed date is refused before anything is written', async () => {
  for (const bad of ['11/20', '2026-13-40', '2026-11-20T08:00']) {
    const f = fixture(files());
    const before = f.get('project.yaml');
    await assert.rejects(() => f.plugin.updateContentProject(root, { ...base, stage: 'visual', plannedPublishAt: bad }), /计划发布日/);
    assert.equal(f.get('project.yaml'), before);
  }
});

test('a new date creates one dated Tempo action that points back at the article', async () => {
  const tempo = fakeTempo();
  const f = fixture(files(), tempo);
  const result = await f.plugin.updateContentProject(root, { ...base, plannedPublishAt: '2026-11-20' });
  assert.deepEqual(tempo.calls, [['create', { sourceId: SOURCE, title: '发布：示例文章', notePath: `${root}/article.md`, dueDate: '2026-11-20' }]]);
  assert.equal(result.publishAction.status, 'synced');
});

test('saving without changing the date never touches Tempo', async () => {
  const tempo = fakeTempo();
  const f = fixture(files('planned_publish_at: "2026-11-20"\n'), tempo);
  await f.plugin.updateContentProject(root, { ...base, stage: 'visual', plannedPublishAt: '2026-11-20' });
  await f.plugin.updateContentProject(root, { ...base, stage: 'research' });
  assert.deepEqual(tempo.calls, []);
});

test('moving the date reschedules with the old date as the condition, so a date edited in Tempo stays', async () => {
  const inSync = fakeTempo({ existing: { id: 't1', sourceId: SOURCE, title: '发布：示例文章', status: 'todo', dueDate: '2026-11-20' } });
  const a = fixture(files('planned_publish_at: "2026-11-20"\n'), inSync);
  const moved = await a.plugin.updateContentProject(root, { ...base, plannedPublishAt: '2026-11-25' });
  assert.deepEqual(inSync.calls.at(-1), ['reschedule', { sourceId: SOURCE, dueDate: '2026-11-25', ifDueDate: '2026-11-20' }]);
  assert.equal(moved.publishAction.status, 'synced');

  const userEdited = fakeTempo({ existing: { id: 't1', sourceId: SOURCE, title: '发布：示例文章', status: 'todo', dueDate: '2026-11-22' } });
  const b = fixture(files('planned_publish_at: "2026-11-20"\n'), userEdited);
  const kept = await b.plugin.updateContentProject(root, { ...base, plannedPublishAt: '2026-11-25' });
  assert.equal(kept.publishAction.status, 'kept');
  assert.match(b.get('project.yaml'), /^planned_publish_at: "2026-11-25"$/m, '项目里的日期照常保存');
});

test('clearing the date clears the action date through the same condition, without creating anything', async () => {
  const tempo = fakeTempo({ existing: { id: 't1', sourceId: SOURCE, title: 'x', status: 'todo', dueDate: '2026-11-20' } });
  const f = fixture(files('planned_publish_at: "2026-11-20"\n'), tempo);
  const result = await f.plugin.updateContentProject(root, { ...base, plannedPublishAt: '' });
  assert.deepEqual(tempo.calls, [['reschedule', { sourceId: SOURCE, dueDate: null, ifDueDate: '2026-11-20' }]]);
  assert.equal(result.publishAction.status, 'synced');
});

test('no Tempo, an older Tempo or a failing Tempo still saves the project and says what happened', async () => {
  const none = fixture(files());
  assert.equal((await none.plugin.updateContentProject(root, { ...base, plannedPublishAt: '2026-11-20' })).publishAction.status, 'no-tempo');
  assert.match(none.get('project.yaml'), /^planned_publish_at: "2026-11-20"$/m);

  const old = fakeTempo({ version: 1 });
  const o = fixture(files(), old);
  assert.equal((await o.plugin.updateContentProject(root, { ...base, plannedPublishAt: '2026-11-20' })).publishAction.status, 'old-tempo');
  assert.deepEqual(old.calls, [], '旧版 Tempo 不认截止日期，不建一条没日期的行动');

  const broken = fakeTempo({ fail: '新建任务需要先激活 Crisp Tempo' });
  const b = fixture(files(), broken);
  const result = await b.plugin.updateContentProject(root, { ...base, plannedPublishAt: '2026-11-20' });
  assert.equal(result.publishAction.status, 'failed');
  assert.match(result.publishAction.message, /激活/);
  assert.match(b.get('project.yaml'), /^planned_publish_at: "2026-11-20"$/m);
});

test('publishing points out a publish action that is still open in Tempo', async () => {
  const open = fakeTempo({ existing: { id: 't1', sourceId: SOURCE, title: '发布：示例文章', status: 'todo', dueDate: '2026-11-20' } });
  const f = fixture(files('planned_publish_at: "2026-11-20"\n'), open);
  const result = await f.plugin.updateContentProject(root, { ...base, stage: 'reviewing', status: 'published' });
  assert.equal(result.publishAction.status, 'open-after-publish');
  const done = fakeTempo({ existing: { id: 't1', sourceId: SOURCE, title: 'x', status: 'done', dueDate: '2026-11-20' } });
  const g = fixture(files('planned_publish_at: "2026-11-20"\n'), done);
  assert.equal((await g.plugin.updateContentProject(root, { ...base, stage: 'reviewing', status: 'published' })).publishAction.status, 'none');
});

test('the project row counts down to the planned date until the project is published', () => {
  const T = '2026-11-11';
  const row = (planned, extra = {}) => P.publishCountdown({ planned_publish_at: planned, status: 'draft', publication_status: 'not-published', ...extra }, T);
  assert.deepEqual(row('2026-11-14'), { text: '距发布 3 天', tone: 'is-soon' });
  assert.deepEqual(row('2026-11-30'), { text: '距发布 19 天', tone: '' });
  assert.deepEqual(row('2026-11-12'), { text: '明天发布', tone: 'is-soon' });
  assert.deepEqual(row('2026-11-11'), { text: '今天发布', tone: 'is-soon' });
  assert.deepEqual(row('2026-11-09'), { text: '已过计划发布日 2 天', tone: 'is-overdue' });
  assert.equal(row('2026-11-14', { status: 'published' }), null);
  assert.equal(row('2026-11-14', { publication_status: 'live' }), null);
  assert.equal(row(''), null);
  assert.equal(row('soon'), null);
  assert.equal(P.contentPublishSourceId('WECHAT-20261111-DEMO'), SOURCE);
  assert.equal(P.contentPublishSourceId('有中文的目录'), '');
});
