const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") {
    class Plugin {}
    class ItemView {}
    class PluginSettingTab {}
    class Setting {}
    class Notice {}
    class Modal {}
    class TFile {}
    class TFolder {}
    return {
      Plugin,
      ItemView,
      PluginSettingTab,
      Setting,
      Notice,
      Modal,
      TFile,
      TFolder,
      setIcon() {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const launchpad = require("../main.js");
Module._load = originalLoad;

test("action metadata does not duplicate the project badge", () => {
  assert.equal(
    launchpad.actionItemMeta({ bucket: "waiting", project: "协作", due: null }),
    "等待",
  );
  assert.equal(
    launchpad.actionItemMeta({ bucket: "today", due: "2026-09-19" }),
    "09-19",
  );
});

test("stage buckets follow the canonical content order", () => {
  const buckets = launchpad.buildStageBuckets([
    { stage: "reviewing" },
    { stage: "drafting" },
    { stage: "visual" },
  ]);
  assert.deepEqual(
    buckets.map(([stage]) => stage),
    ["drafting", "visual", "reviewing"],
  );
});

test("page summary keeps ANKS object layers separate", () => {
  const pages = [
    { type: "raw", path: "Topics/self-media/raw/a.md", mtime: Date.now() },
    { type: "source", path: "Topics/self-media/sources/a.md", mtime: Date.now() },
    { type: "output", path: "Topics/self-media/outputs/a.md", mtime: Date.now() },
    { type: "raw", path: "Topics/self-media/raw/inbox/a.md", mtime: Date.now() },
    {
      type: "content",
      content_role: "article",
      path: "Topics/self-media/content-projects/p/article.md",
      mtime: Date.now(),
    },
  ];
  const summary = launchpad.summarizePages(pages);
  assert.equal(summary.raw.length, 2);
  assert.equal(summary.knowledge.length, 1);
  assert.equal(summary.outputs.length, 1);
  assert.equal(summary.inbox.length, 1);
  assert.equal(summary.articles.length, 1);
});

test("heat levels and snapshot age are deterministic", () => {
  assert.deepEqual([0, 1, 3, 8, 15, 30].map(launchpad.heatLevel), [0, 1, 2, 3, 4, 5]);
  assert.equal(launchpad.snapshotAgeLabel(null), "时间未知");
  assert.equal(launchpad.snapshotAgeLabel(0.5), "刚刚检查");
});

test("rhythm range only accepts supported week windows", () => {
  assert.equal(launchpad.normalizeRhythmWeeks("4"), 4);
  assert.equal(launchpad.normalizeRhythmWeeks("52"), 52);
  assert.equal(launchpad.normalizeRhythmWeeks("17"), 13);
  assert.equal(launchpad.normalizeRhythmWeeks("bad"), 13);
  assert.equal(launchpad.TOTAL_HEATMAP_WEEKS, 53);
});

test("quick capture note carries ANKS raw inbox metadata", () => {
  const note = launchpad.buildInboxNote(
    "测试一条灵感\n第二行",
    "idea",
    new Date("2026-09-19T08:00:00+08:00"),
    "main-business",
  );
  assert.equal(note.folder, "Topics/main-business/raw/inbox/ideas");
  assert.match(note.content, /^---\ntype: raw/m);
  assert.match(note.content, /topic: main-business/);
  assert.match(note.content, /inbox_type: idea/);
  assert.match(note.content, /capture_contract: anks-capture-v1/);
});

test("topic inference keeps cross-topic captures in their source topic", () => {
  assert.equal(
    launchpad.inferTopicFromPath("Topics/main-business/raw/inbox/scratch/a.md"),
    "main-business",
  );
  assert.equal(launchpad.inferTopicFromPath("Now/行动.md"), "self-media");
});

test("action tasks and processed markers preserve markdown content", () => {
  const appended = launchpad.appendActionTask("# 行动\n", "处理收件箱", "2026-09-20", "收件箱");
  assert.match(appended, /- \[ \] 处理收件箱 📅 2026-09-20 #project\/收件箱/);
  const processed = launchpad.markProcessedContent("---\ntype: raw\nowner: topic:self-media\n---\n\n# 标题\n");
  assert.match(processed, /routing_status: processed/);
  assert.match(processed, /# 标题/);
  const processedCrlf = launchpad.markProcessedContent(
    "---\r\ntype: raw\r\nowner: topic:self-media\r\n---\r\n\r\n# 标题\r\n",
  );
  assert.match(processedCrlf, /routing_status: processed/);
  assert.match(processedCrlf, /# 标题/);
  assert.equal((processedCrlf.match(/---/g) || []).length, 2);
});

test("Now board parser keeps task buckets, metadata and stable ids", () => {
  const tasks = launchpad.parseNowTasks(
    [
      {
        path: "Now/行动.md",
        content: [
          "# 行动",
          "- [ ] 今天完成 📅 2026-09-19 #project/ANKS",
          "- [ ] 等回复 #waiting #project/协作",
          "- [x] 已完成",
        ].join("\n"),
      },
    ],
    new Date("2026-09-19T08:00:00+08:00"),
  );
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].bucket, "today");
  assert.equal(tasks[0].title, "今天完成");
  assert.equal(tasks[0].project, "ANKS");
  assert.equal(tasks[1].bucket, "waiting");
  assert.equal(tasks[2].done, true);
  assert.equal(tasks[0].id, "Now/行动.md:2");
  assert.match(launchpad.taskLine(tasks[1]), /#waiting/);
  assert.match(launchpad.taskLine(tasks[1]), /#project\/协作/);
});
