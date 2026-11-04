// Failure modes from the 2026-11-04 ANKS × Launchpad audit, listed before the fixtures:
// publish fields appended below the Markdown body; article.md never gets published_at;
// processed inbox notes stay UNROUTABLE because routing_confidence: 0 survives;
// processed root inbox notes lack inbox_type; project aux files inflate the output count.
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
function projectFixture(files) {
  const data = new Map(Object.entries(files).map(([n, s]) => [`${root}/${n}`, s]));
  const plugin = Object.assign(Object.create(P.prototype), {
    canRunAnks: () => false, refreshViews() {},
    app: { vault: {
      getAbstractFileByPath: p => data.has(p) ? new TFile(p) : null,
      read: async f => data.get(f.path),
      process: async (f, fn) => { data.set(f.path, fn(data.get(f.path))); },
    } },
  });
  return { plugin, data };
}
const frontmatterOf = text => /^---\n([\s\S]*?)\n---/.exec(text)[1];

test('publishing keeps publication fields inside publish.md frontmatter, body untouched', async () => {
  const body = '\n# 发布记录\n\n## 授权存证\n\n- 无\n';
  const { plugin, data } = projectFixture({
    'project.yaml': 'stage: reviewing\nstatus: draft\n',
    'article.md': '---\nstage: reviewing\nstatus: draft\n---\n\n正文\n',
    'publish.md': `---\ntype: output\nstatus: draft\n---\n${body}`,
  });
  await plugin.updateContentProject(root, { stage: 'reviewing', status: 'published' });
  const publish = data.get(`${root}/publish.md`);
  assert.ok(publish.endsWith(body), 'Markdown body must stay exactly as it was');
  assert.match(frontmatterOf(publish), /^publication_status: live$/m);
  assert.match(frontmatterOf(publish), /^published_at: \d{4}-\d{2}-\d{2}$/m);
});

test('publishing also records published_at on article.md when it is missing', async () => {
  const { plugin, data } = projectFixture({
    'project.yaml': 'stage: reviewing\nstatus: draft\n',
    'article.md': '---\nstage: reviewing\nstatus: draft\n---\n\n正文\n',
    'publish.md': '---\nstatus: draft\npublished_at: "2026-09-01"\n---\n',
  });
  await plugin.updateContentProject(root, { stage: 'reviewing', status: 'published' });
  const article = data.get(`${root}/article.md`);
  assert.match(frontmatterOf(article), /^published_at: \d{4}-\d{2}-\d{2}$/m);
  assert.ok(article.endsWith('\n正文\n'));
  assert.equal(P.projectField(data.get(`${root}/publish.md`), 'published_at'), '2026-09-01');
});

test('a stage key missing from article.md is added inside frontmatter, not after the body', async () => {
  const { plugin, data } = projectFixture({
    'project.yaml': 'stage: drafting\nstatus: draft\n',
    'article.md': '---\ntitle: x\n---\n\nstatus: 这是正文里的一句\n',
  });
  await plugin.updateContentProject(root, { stage: 'visual', status: 'draft' });
  const article = data.get(`${root}/article.md`);
  assert.match(frontmatterOf(article), /^stage: visual$/m);
  assert.ok(article.endsWith('\nstatus: 这是正文里的一句\n'));
});

test('marking processed drops the low-confidence routing markers', () => {
  const note = P.buildInboxNote('一个想法', 'idea', new Date('2026-11-04T10:00:00'), 'self-media');
  const out = P.markProcessedContent(note.content, new Date(), 'self-media');
  assert.doesNotMatch(out, /routing_confidence/);
  assert.doesNotMatch(out, /routing_reason/);
  assert.match(out, /^routing_status: processed$/m);
  assert.match(out, /^inbox_type: idea$/m);
});

test('marking a bare root inbox note processed adds the inbox_type its position implies', () => {
  const out = P.markProcessedContent('随手一句\n', new Date(), 'self-media', 'scratch');
  assert.match(frontmatterOf(out), /^inbox_type: scratch$/m);
  const kept = P.markProcessedContent('---\ninbox_type: link\n---\nx\n', new Date(), 'self-media', 'scratch');
  assert.match(kept, /^inbox_type: link$/m);
  assert.doesNotMatch(kept, /^inbox_type: scratch$/m);
});

test('project control, publish, title, qa and health files are not counted as outputs', () => {
  const page = (path, extra = {}) => ({ path, type: 'output', mtime: 0, ...extra });
  const pages = [
    page('Topics/t/content-projects/A/article.md', { content_role: 'article', content_id: 'A' }),
    page('Topics/t/content-projects/A/project.md', { content_role: 'project-control', content_id: 'A' }),
    page('Topics/t/content-projects/A/publish.md', { content_role: 'publish-record', content_id: 'A' }),
    page('Topics/t/content-projects/A/titles.md', { content_role: 'title-candidates', content_id: 'A' }),
    page('Topics/t/content-projects/A/qa.md', { content_role: 'qa', content_id: 'A' }),
    page('Topics/t/outputs/health/2026-11-04.md', { artifact_type: 'health_report' }),
    page('Topics/t/outputs/xhs/note.md'),
  ];
  const { outputs } = P.summarizePages(pages);
  assert.deepEqual(outputs.map(p => p.path).sort(), [
    'Topics/t/content-projects/A/article.md',
    'Topics/t/outputs/xhs/note.md',
  ]);
});
