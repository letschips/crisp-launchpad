const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

if (typeof window === "undefined") {
  global.window = global;
}

let mockObsidian;
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
    class Platform {}
    Platform.isMobile = false;
    mockObsidian = {
      Plugin,
      ItemView,
      PluginSettingTab,
      Setting,
      Notice,
      Modal,
      TFile,
      TFolder,
      Platform,
      setIcon() {},
      addIcon() {},
    };
    return mockObsidian;
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

test("quick capture note carries ANKS raw inbox metadata and CAP stable id", () => {
  const note = launchpad.buildInboxNote(
    "测试一条灵感\n第二行",
    "idea",
    new Date("2026-09-19T08:00:00+08:00"),
    "main-business",
  );
  assert.equal(note.folder, "Topics/main-business/raw/inbox/ideas");
  assert.match(note.content, /^---\nid: "CAP-20260919-\d{9}-[0-9A-F]{4}"/m);
  assert.match(note.content, /type: raw/);
  assert.match(note.content, /topic: "main-business"/);
  assert.match(note.content, /owner: "topic:main-business"/);
  assert.match(note.content, /inbox_type: idea/);
  assert.match(note.content, /routing_status: "needs-classification"/);
  assert.match(note.content, /routing_confidence: 0/);
  assert.match(note.content, /created_at: "2026-09-19 08:00"/);
  assert.match(note.content, /updated_at: "2026-09-19 08:00"/);
});

test("topic inference keeps cross-topic captures in their source topic", () => {
  assert.equal(
    launchpad.inferTopicFromPath("Topics/main-business/raw/inbox/scratch/a.md"),
    "main-business",
  );
  assert.equal(launchpad.inferTopicFromPath("Now/行动.md"), "self-media");
});

test("action tasks and processed markers preserve markdown content and supply canonical raw frontmatter", () => {
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

  // When note has no frontmatter, it should be wrapped with canonical raw frontmatter
  const plainNote = launchpad.markProcessedContent("# 纯文本笔记\n内容行", new Date(), "self-media");
  assert.match(plainNote, /^---\ntype: raw/m);
  assert.match(plainNote, /title: "纯文本笔记"/);
  assert.match(plainNote, /routing_status: processed/);
  assert.match(plainNote, /launchpad_processed_at:/);

  // When note has incomplete frontmatter, it should supplement missing canonical fields
  const incompleteNote = launchpad.markProcessedContent("---\ncreated: 2026-09-20\n---\n# 残缺笔记\n内容", new Date(), "self-media");
  assert.match(incompleteNote, /type: raw/);
  assert.match(incompleteNote, /topic: self-media/);
  assert.match(incompleteNote, /owner: "topic:self-media"/);
  assert.match(incompleteNote, /title: "残缺笔记"/);
  assert.match(incompleteNote, /routing_status: processed/);

  // When note has frontmatter but lacks type, type: raw should be injected
  const missingType = launchpad.markProcessedContent("---\nowner: topic:self-media\n---\n\n正文");
  assert.match(missingType, /type: raw/);
  assert.match(missingType, /routing_status: processed/);
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

test("command errors are reduced to a short actionable notice", () => {
  const message = launchpad.compactCommandError(
    "",
    'snapshot build failed: health: command failed (1): {"status":"error","counts":{"blocking":1},"finding_codes":{"CONTRACT_ERROR":1},"findings":[{"severity":"blocking","code":"CONTRACT_ERROR"}]}',
  );
  assert.equal(message, "失败：1 blocking · CONTRACT_ERROR");
  assert.equal(launchpad.compactCommandError("", "plain failure\nmore", ""), "plain failure");
  assert.equal(
    launchpad.compactCommandError('{"valid":false,"errors":["ASSET_NOT_PRODUCED: cover"]}', "", ""),
    "校验未通过 · 1 项 · ASSET_NOT_PRODUCED: cover",
  );
});

test("content project identifiers and YAML updates stay canonical", () => {
  const when = new Date("2026-09-19T08:00:00+08:00");
  assert.equal(launchpad.contentSlug("Agent OS：底层反转"), "AGENT-OS");
  assert.equal(
    launchpad.contentProjectId("Agent OS：底层反转", when),
    "WECHAT-20260919-AGENT-OS",
  );
  const updated = launchpad.updateProjectField(
    "profile: standard-essay\nstage: intake\n",
    "stage",
    "drafting",
  );
  assert.equal(launchpad.projectField(updated, "stage"), "drafting");
  assert.match(updated, /profile: standard-essay/);
});

test("event bridge only classifies ANKS knowledge and Now paths", () => {
  assert.equal(launchpad.eventBridgeKind("Topics/self-media/raw/inbox/a.md"), "knowledge");
  assert.equal(launchpad.eventBridgeKind("Topics/self-media/knowledge/a.md"), "knowledge");
  assert.equal(launchpad.eventBridgeKind("Now/行动.md"), "actions");
  assert.equal(launchpad.eventBridgeKind(".runtime/snapshot/health.json"), "");
  assert.equal(launchpad.eventBridgeKind("Sidecar/bin/anks"), "");
  assert.equal(
    launchpad.eventBridgeKind("Topics/self-media/content-projects/X/project.yaml"),
    "snapshot",
  );
  assert.equal(launchpad.eventBridgeKind("Core/System/system.yaml"), "snapshot");
});

test("收窄: 路由已忽略的前缀只重建快照，不再空跑 route fix", () => {
  // 路由 ignore_prefixes 覆盖的路径 → snapshot
  assert.equal(launchpad.eventBridgeKind("Core/System/a.md"), "snapshot");
  assert.equal(launchpad.eventBridgeKind("Core/System/audits/2026-09-20-x.md"), "snapshot");
  assert.equal(launchpad.eventBridgeKind("Core/Indexes/MOCs/x.md"), "snapshot");
  assert.equal(
    launchpad.eventBridgeKind("Topics/self-media/content-projects/WECHAT-20260920-X/article.md"),
    "snapshot",
  );
  assert.equal(
    launchpad.eventBridgeKind("Topics/main-business/content-projects/X/article.md"),
    "snapshot",
  );
  assert.equal(launchpad.isRouterIgnoredPath("Core/System/a.md"), true);
  assert.equal(launchpad.isRouterIgnoredPath("Topics/self-media/raw/inbox/a.md"), false);
  // 路由真正处理的路径 → knowledge
  assert.equal(launchpad.eventBridgeKind("Topics/self-media/raw/inbox/a.md"), "knowledge");
  assert.equal(launchpad.eventBridgeKind("Core/Concepts/a.md"), "knowledge");
});

test("收窄: snapshot 类变更只重建 content/index，health 合并延后", async () => {
  const calls = [];
  const plugin = {
    settings: { autoRouteEnabled: true },
    canRunAnks: () => true,
    unloaded: false,
    autoSyncRunning: false,
    autoSyncDirty: { actions: false, knowledge: false, snapshot: true },
    autoSyncIgnoreUntil: 0,
    autoSyncLastError: "",
    autoSyncLastErrorAt: 0,
    healthRebuildTimer: null,
    runAnks: async (args) => {
      calls.push(args.join(" "));
    },
    refreshViews: () => {},
    reportAutoSyncError: () => {},
    runEventBridgeSync: launchpad.prototype.runEventBridgeSync,
    scheduleHealthRebuild: launchpad.prototype.scheduleHealthRebuild,
    cancelHealthRebuild: launchpad.prototype.cancelHealthRebuild,
  };

  await plugin.runEventBridgeSync();
  assert.deepEqual(
    calls,
    ["snapshot build --only content,index"],
    "内容项目编辑不应再触发 route fix 或全量重建",
  );
  assert.ok(plugin.healthRebuildTimer, "health 应合并到停顿后再补一次");
  clearTimeout(plugin.healthRebuildTimer);

  // knowledge 类变更：route fix + 同样只重建 content/index
  calls.length = 0;
  plugin.autoSyncDirty = { actions: false, knowledge: true, snapshot: false };
  await plugin.runEventBridgeSync();
  assert.deepEqual(calls, ["route fix --min-confidence 1", "snapshot build --only content,index"]);
  assert.ok(plugin.healthRebuildTimer, "health 仍然延后补，不阻塞主路径");
  clearTimeout(plugin.healthRebuildTimer);
});

test("F3: 自动事件桥的组件成功不能清除另一组件的错误", async () => {
  const calls = [];
  const plugin = Object.assign(Object.create(launchpad.prototype), {
    settings: { autoRouteEnabled: true },
    canRunAnks: () => true,
    unloaded: false,
    autoSyncRunning: false,
    autoSyncDirty: { actions: true, knowledge: false, snapshot: true },
    autoSyncIgnoreUntil: 0,
    ignoreNowChangeUntil: 0,
    autoSyncLastError: "",
    autoSyncLastErrorAt: 0,
    healthRebuildTimer: null,
    runAnks: async (args) => {
      calls.push(args.join(" "));
      if (args[0] === "snapshot") throw new Error("index collector failed");
    },
    refreshViews: () => {},
  });

  await plugin.runEventBridgeSync();

  assert.deepEqual(calls, ["snapshot build --only content,index", "actions snapshot"]);
  assert.match(plugin.autoSyncLastError, /index collector failed/);
  assert.match(plugin.autoSyncLastError, /快照|snapshot/);
  assert.equal(plugin.autoSyncStatus.snapshot.error, "index collector failed");
  assert.equal(plugin.autoSyncStatus.actions.error, "");
});

test("content project labels use the article record, not sibling templates", () => {
  const pages = [
    { folder: "Topics/self-media/content-projects/P", content_role: "title", title: "titles" },
    { folder: "Topics/self-media/content-projects/P", content_role: "article", title: "真实标题" },
  ];
  assert.equal(
    launchpad.contentProjectArticle(pages, "Topics/self-media/content-projects/P").title,
    "真实标题",
  );
  assert.equal(
    launchpad.contentProjectLabel(
      [{ folder: "Topics/self-media/content-projects/P", content_role: "article", title: "article" }],
      { dir: "Topics/self-media/content-projects/P", content_id: "WECHAT-20260919-FALLBACK" },
    ),
    "20260919 FALLBACK",
  );
});

test("review suggestions are bounded and deduplicated against Now actions", () => {
  const suggestions = launchpad.suggestReviewActions({
    tasks: [
      { title: "复盘并重排当前逾期行动", done: false, bucket: "overdue" },
      { title: "跟进等待中的行动", done: false, bucket: "waiting" },
    ],
    health: {
      data: {
        findings: [
          { code: "CONTRACT_ERROR", severity: "blocking", path: "Core/System/a.md" },
          { code: "PENDING_WRITEBACK", severity: "operational", path: "Topics/a.md" },
          { code: "PENDING_WRITEBACK", severity: "operational", path: "Topics/b.md" },
          { code: "STALE_INBOX", severity: "operational", path: "Topics/c.md" },
          { code: "STALE_INBOX", severity: "operational", path: "Topics/d.md" },
        ],
      },
    },
    contentProjects: [{ stage: "reviewing", content_id: "WECHAT-20260919-TEST" }],
    pages: [{ folder: "", title: "测试项目" }],
    max: 5,
  });
  assert.equal(suggestions.length, 5);
  assert.equal(suggestions[0].text, "处理系统阻塞：CONTRACT_ERROR");
  assert.equal(
    suggestions.some((item) => item.text === "复盘并重排当前逾期行动"),
    false,
  );
  assert.equal(
    suggestions.some((item) => item.text === "跟进等待中的行动"),
    false,
  );
  assert.equal(
    new Set(suggestions.map((item) => item.text)).size,
    suggestions.length,
  );
});

test("formatYamlScalar quotes strings with colons, hashes, and brackets while preserving simple scalars", () => {
  assert.equal(launchpad.formatYamlScalar("intake"), "intake");
  assert.equal(launchpad.formatYamlScalar("drafting"), "drafting");
  assert.equal(launchpad.formatYamlScalar(true), "true");
  assert.equal(launchpad.formatYamlScalar(42), "42");
  assert.equal(launchpad.formatYamlScalar('""'), '""');
  assert.equal(launchpad.formatYamlScalar(""), '""');
  assert.equal(launchpad.formatYamlScalar("跟进: 接口对齐"), '"跟进: 接口对齐"');
  assert.equal(launchpad.formatYamlScalar("修复 #123 问题"), '"修复 #123 问题"');
  assert.equal(launchpad.formatYamlScalar("包含[中括号]"), '"包含[中括号]"');

  const updatedYaml = launchpad.updateProjectField(
    "stage: intake\nnext_action: 待办\n",
    "next_action",
    "跟进: 接口联调与测试",
  );
  assert.match(updatedYaml, /next_action: "跟进: 接口联调与测试"/);
  assert.equal(launchpad.projectField(updatedYaml, "next_action"), "跟进: 接口联调与测试");
});

test("article.md title injection updates frontmatter and replaces empty H1 heading", () => {
  const templateArticle = [
    "---",
    "type: output",
    'title: ""',
    "track: ai-frontiers",
    "status: draft",
    "stage: drafting",
    "---",
    "",
    "# ",
    "",
    "> 导语内容",
  ].join("\n");

  const title = "下一代企业 Agentic OS 底层秘密";
  let content = launchpad.updateProjectField(templateArticle, "track", "obsidian");
  content = launchpad.updateProjectField(content, "title", title);
  content = content.replace(/^# \s*$/m, `# ${title}`);

  assert.match(content, /track: obsidian/);
  assert.match(content, /title: 下一代企业 Agentic OS 底层秘密/);
  assert.match(content, /# 下一代企业 Agentic OS 底层秘密\n/);
  assert.equal(launchpad.projectField(content, "title"), title);
});

test("updateProjectField synchronizes stage and status across project.yaml and article.md", () => {
  const articleFrontmatter = [
    "---",
    "type: output",
    'title: "测试文章"',
    "stage: drafting",
    "status: draft",
    "---",
  ].join("\n");

  let updatedArticle = launchpad.updateProjectField(articleFrontmatter, "stage", "reviewing");
  updatedArticle = launchpad.updateProjectField(updatedArticle, "status", "published");

  assert.equal(launchpad.projectField(updatedArticle, "stage"), "reviewing");
  assert.equal(launchpad.projectField(updatedArticle, "status"), "published");
});

test("Now task parser preserves emojis and cleans zero-width characters", () => {
  const line = "- [ ] 🥔 推进 Crisp 核心插件 🚀 📅 2026-09-20 #project/ANKS";
  const task = launchpad.parseNowTaskLine(line, "Now/行动.md", 1, new Date("2026-09-20T08:00:00+08:00"));
  assert.equal(task.title, "🥔 推进 Crisp 核心插件 🚀");
  assert.equal(task.bucket, "today");
  assert.equal(task.due, "2026-09-20");
  assert.equal(task.project, "ANKS");
});

test("Now taskLine correctly manages #waiting tag and removes it when waiting is false", () => {
  const waitingTask = {
    title: "等待联调",
    due: "",
    scheduled: "",
    tags: ["feature"],
    project: "ANKS",
    done: false,
    waiting: true,
  };
  const lineWithWaiting = launchpad.taskLine(waitingTask);
  assert.match(lineWithWaiting, /#waiting/);
  assert.match(lineWithWaiting, /#feature/);
  assert.match(lineWithWaiting, /#project\/ANKS/);

  // When waiting is toggled to false, #waiting should be eliminated
  const clearedWaitingTask = {
    ...waitingTask,
    tags: ["waiting", "feature"],
    waiting: false,
  };
  const lineWithoutWaiting = launchpad.taskLine(clearedWaitingTask);
  assert.equal(lineWithoutWaiting.includes("#waiting"), false);
  assert.match(lineWithoutWaiting, /#feature/);
});

test("Now task parser utilizes scheduled date as fallback for bucket determination", () => {
  const line = "- [ ] 准备技术分享 ⏳ 2026-09-21 #project/Dev";
  const task = launchpad.parseNowTaskLine(line, "Now/行动.md", 1, new Date("2026-09-20T08:00:00+08:00"));
  assert.equal(task.scheduled, "2026-09-21");
  assert.equal(task.bucket, "upcoming");
});

test("Now task round-trip preserves created dates, blocked tags, and inline hash tokens", () => {
  const today = new Date("2026-09-22T08:00:00+08:00");
  const line = "- [ ] 修复 #123 的 bug ➕ 2026-09-20 📅 2026-09-22 #blocked";
  const task = launchpad.parseNowTaskLine(line, "Now/行动.md", 1, today);
  assert.equal(task.created, "2026-09-20");
  assert.equal(task.title, "修复 #123 的 bug");
  assert.equal(task.bucket, "waiting");
  const written = launchpad.taskLine(task);
  assert.match(written, /#blocked/);
  assert.match(written, /➕ 2026-09-20/);
  assert.match(written, /#123/);
  const roundTrip = launchpad.parseNowTaskLine(written, "Now/行动.md", 1, today);
  assert.equal(roundTrip.created, "2026-09-20");
  assert.equal(roundTrip.title, "修复 #123 的 bug");
  assert.equal(roundTrip.tags.includes("blocked"), true);
});

test("published output collection includes canonical project articles and prefers them over legacy duplicates", () => {
  const pages = [
    {
      path: "Topics/self-media/outputs/content/published/old.md",
      content_id: "WECHAT-20260920-X",
      title: "旧归档",
      mtime: 200,
    },
    {
      path: "Topics/self-media/content-projects/WECHAT-20260920-X/article.md",
      content_role: "article",
      status: "published",
      content_id: "WECHAT-20260920-X",
      title: "正式文章",
      published_at: "2026-09-20T09:00:00+08:00",
      mtime: 100,
    },
    {
      path: "Topics/self-media/content-projects/WECHAT-20260919-Y/article.md",
      content_role: "article",
      status: "published",
      content_id: "WECHAT-20260919-Y",
      title: "另一篇正式文章",
      published_at: "2026-09-19T09:00:00+08:00",
      mtime: 300,
    },
  ];
  const published = launchpad.publishedOutputPages(pages);
  assert.deepEqual(published.map((page) => page.title), ["正式文章", "另一篇正式文章"]);
});

test("F1: review suggestions do not deadlock when top candidate findings already exist in Now", () => {
  const suggestions = launchpad.suggestReviewActions({
    tasks: [
      // Top 2 writebacks and top 2 stale inboxes already exist as active actions
      { title: "回写待提炼的发布内容：writeback-1", done: false, bucket: "today" },
      { title: "回写待提炼的发布内容：writeback-2", done: false, bucket: "today" },
      { title: "整理积压收件箱：stale-1", done: false, bucket: "today" },
      { title: "整理积压收件箱：stale-2", done: false, bucket: "today" },
    ],
    health: {
      data: {
        findings: [
          { code: "PENDING_WRITEBACK", severity: "operational", path: "Topics/self-media/writeback-1.md" },
          { code: "PENDING_WRITEBACK", severity: "operational", path: "Topics/self-media/writeback-2.md" },
          { code: "PENDING_WRITEBACK", severity: "operational", path: "Topics/self-media/writeback-3.md" },
          { code: "STALE_INBOX", severity: "operational", path: "Topics/self-media/stale-1.md" },
          { code: "STALE_INBOX", severity: "operational", path: "Topics/self-media/stale-2.md" },
          { code: "STALE_INBOX", severity: "operational", path: "Topics/self-media/stale-3.md" },
        ],
      },
    },
    contentProjects: [],
    pages: [],
    max: 10,
  });

  // Old code would have 0 writebacks and 0 stale inboxes because it sliced(0,2) before checking duplicates.
  // New code must successfully advance to the 3rd candidate!
  assert.ok(
    suggestions.some((item) => item.text === "回写待提炼：writeback-3"),
    "Should suggest the 3rd pending writeback",
  );
  assert.ok(
    suggestions.some((item) => item.text === "整理积压收件箱：stale-3"),
    "Should suggest the 3rd stale inbox item",
  );
});

test("F12: STAGE_ORDER and STAGE_LABEL cover all 13 canonical content stages", () => {
  assert.equal(launchpad.STAGE_ORDER.length, 15); // 13 canonical + done + archived
  assert.equal(launchpad.STAGE_LABEL.intake, "选题输入");
  assert.equal(launchpad.STAGE_LABEL.brief, "简报");
  assert.equal(launchpad.STAGE_LABEL.research, "事实调研");
  assert.equal(launchpad.STAGE_LABEL.outline, "大纲");
  assert.equal(launchpad.STAGE_LABEL.drafting, "起草中");
  assert.equal(launchpad.STAGE_LABEL["fact-check"], "事实核验");
  assert.equal(launchpad.STAGE_LABEL["style-check"], "风格质检");
  assert.equal(launchpad.STAGE_LABEL.visual, "配图/视觉");
  assert.equal(launchpad.STAGE_LABEL["mobile-preview"], "移动预览");
  assert.equal(launchpad.STAGE_LABEL["draft-box"], "草稿箱");
  assert.equal(launchpad.STAGE_LABEL["publish-ready"], "准备发布");
  assert.equal(launchpad.STAGE_LABEL.reviewing, "待复盘");
  assert.equal(launchpad.STAGE_LABEL.distilled, "已提炼");

  const buckets = launchpad.buildStageBuckets([
    { stage: "distilled" },
    { stage: "intake" },
    { stage: "mobile-preview" },
    { stage: "drafting" },
  ]);
  assert.deepEqual(
    buckets.map(([stage]) => stage),
    ["intake", "drafting", "mobile-preview", "distilled"],
  );
});

test("NEW-1: formatDateTime safely formats timestamps (numbers, Dates, strings) without getFullYear errors", () => {
  const timestamp = 1726804800000; // number mtime
  const formatted = launchpad.formatDateTime(timestamp);
  assert.match(formatted, /^\d{1,2}-\d{2} \d{2}:\d{2}$/);

  const dateObj = new Date(timestamp);
  assert.equal(launchpad.formatDateTime(dateObj), formatted);

  const strTime = dateObj.toISOString();
  assert.equal(launchpad.formatDateTime(strTime), formatted);

  assert.equal(launchpad.formatDateTime(null), "–");
  assert.equal(launchpad.formatDateTime(undefined), "–");

  const full = launchpad.formatFullDateTime(timestamp);
  assert.match(full, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

  // N5: Verify formatFullDateTime fallback on invalid inputs
  const todayKey = new Date().toISOString().slice(0, 10);
  assert.equal(launchpad.formatFullDateTime("not-a-date"), todayKey);
  assert.equal(launchpad.formatFullDateTime(NaN), todayKey);
});

test("NEW-2: mutateNowTask protects against line shift and recovers target line by title", async () => {
  let fileContent = [
    "- [ ] 任务一 📅 2026-09-20",
    "- [ ] 任务二 📅 2026-09-21",
    "- [ ] 任务三 📅 2026-09-22",
  ].join("\n");

  const mockFile = Object.assign(new mockObsidian.TFile(), { path: "Now/行动.md" });
  const mockPlugin = {
    app: {
      vault: {
        getAbstractFileByPath: (path) => (path === "Now/行动.md" ? mockFile : null),
        read: async () => fileContent,
        modify: async (_, content) => {
          fileContent = content;
        },
      },
    },
    refreshActionSnapshots: async () => {},
  };

  // Bind mutateNowTask method from CrispLaunchpadPlugin prototype
  const mutateNowTask = launchpad.prototype.mutateNowTask.bind(mockPlugin);

  // 1. Normal mutation when line matches exactly
  await mutateNowTask("Now/行动.md:2", (task) => ({ ...task, done: true }), "任务二");
  assert.ok(fileContent.includes("- [x] 任务二 📅 2026-09-21"));

  // Reset file content and simulate an external edit inserting 2 new lines at the top
  fileContent = [
    "## 新段落",
    "- [ ] 外部插入的任务 📅 2026-09-19",
    "- [ ] 任务一 📅 2026-09-20",
    "- [ ] 任务二 📅 2026-09-21",
    "- [ ] 任务三 📅 2026-09-22",
  ].join("\n");

  // Client still holds old id "Now/行动.md:2" (which is now "外部插入的任务")
  // But client specifies expectedTitle "任务二".
  // mutateNowTask should detect mismatch and auto-recover to line 4!
  await mutateNowTask("Now/行动.md:2", (task) => ({ ...task, done: true }), "任务二");

  // Verify that "任务二" was completed, NOT "外部插入的任务"
  assert.ok(fileContent.includes("- [ ] 外部插入的任务 📅 2026-09-19"), "外部插入的任务 must NOT be corrupted");
  assert.ok(fileContent.includes("- [x] 任务二 📅 2026-09-21"), "任务二 must be accurately targeted and completed");

  // 2. If expected title cannot be found anywhere, safely reject
  await assert.rejects(
    async () => {
      await mutateNowTask("Now/行动.md:2", (task) => ({ ...task, done: true }), "已经不存在的任务");
    },
    /行动已被外部移动或修改/
  );
});

test("F2: duplicate task titles use the original line identity after an external insertion", async () => {
  const originalLine = "- [ ] 跟进 #project/A";
  let fileContent = originalLine;
  const oldTask = launchpad.parseNowTaskLine(originalLine, "Now/行动.md", 1, new Date("2026-09-22T08:00:00+08:00"));
  const mockFile = Object.assign(new mockObsidian.TFile(), { path: "Now/行动.md" });
  const mockPlugin = {
    app: {
      vault: {
        getAbstractFileByPath: () => mockFile,
        read: async () => fileContent,
        modify: async (_, content) => {
          fileContent = content;
        },
      },
    },
    refreshActionSnapshots: async () => {},
  };
  const mutateNowTask = launchpad.prototype.mutateNowTask.bind(mockPlugin);

  fileContent = [
    "- [ ] 跟进 #project/B",
    originalLine,
  ].join("\n");

  await mutateNowTask(
    "Now/行动.md:1",
    (task) => ({ ...task, done: true }),
    oldTask,
  );

  assert.match(fileContent, /^- \[ \] 跟进 #project\/B$/m);
  assert.match(fileContent, /^- \[x\] 跟进 #project\/A$/m);
});

test("N1 / F11: handleAutoRouteCandidate sets dirty flag without scheduling immediate timer when autoSyncRunning is true", () => {
  const plugin = {
    settings: { autoRouteEnabled: true },
    canRunAnks: () => true,
    autoSyncRunning: true,
    autoSyncDirty: { actions: false, knowledge: false },
    autoSyncIgnoreUntil: 0,
    ignoreNowChangeUntil: 0,
    handleAutoRouteCandidate: launchpad.prototype.handleAutoRouteCandidate,
    runEventBridgeSync: () => {},
  };

  plugin.handleAutoRouteCandidate({ path: "Topics/self-media/raw/inbox/test.md" });
  // N1: Dirty flag must be recorded so event is never discarded
  assert.equal(plugin.autoSyncDirty.knowledge, true, "Must record dirty flag so edits during sync are not lost");
  // But timer must NOT be scheduled while running
  assert.equal(plugin.autoSyncTimer, undefined, "Must defer scheduling until current sync completes");

  // When not running and outside cooldown, timer is scheduled
  plugin.autoSyncRunning = false;
  plugin.handleAutoRouteCandidate({ path: "Topics/self-media/raw/inbox/test.md" });
  assert.ok(plugin.autoSyncTimer, "Should schedule debounce timer when idle");
  clearTimeout(plugin.autoSyncTimer);
  clearTimeout(plugin.refreshTimer);

  // R3: When not running but within cooldown, timer is scheduled for remaining cooldown period
  plugin.autoSyncTimer = undefined;
  plugin.autoSyncIgnoreUntil = Date.now() + 2000;
  plugin.handleAutoRouteCandidate({ path: "Topics/self-media/raw/inbox/test.md" });
  assert.ok(plugin.autoSyncTimer, "Should schedule remaining cooldown timer when idle in cooldown");
  clearTimeout(plugin.autoSyncTimer);
  clearTimeout(plugin.refreshTimer);
});

test("NEW-P1 / F16: moveTaskToBucket handles target buckets and propagates taskTitle without ReferenceError", async () => {
  const calls = [];
  const fakePlugin = {
    updateNowTask: async (id, updates, expectedTitle) => {
      calls.push({ id, updates, expectedTitle });
      return updates;
    },
  };

  const fakeContainer = {
    children: [],
    querySelectorAll: (selector) => {
      if (selector === ".now-board") return fakeContainer.children.filter((c) => c.className === "now-board");
      return [];
    },
    createDiv: (opts) => {
      const el = {
        className: opts?.cls || "",
        remove: () => {
          const idx = fakeContainer.children.indexOf(el);
          if (idx !== -1) fakeContainer.children.splice(idx, 1);
        },
      };
      fakeContainer.children.push(el);
      return el;
    },
  };

  const fakeView = {
    plugin: fakePlugin,
    app: {},
    contentEl: fakeContainer,
  };

  // 1. Initial construction creates 1 board
  const renderer1 = new launchpad.NowBoardRenderer(fakeView, []);
  assert.equal(fakeContainer.children.length, 1);

  // 2. Second construction cleans up existing board to prevent duplicate NOW views
  const renderer2 = new launchpad.NowBoardRenderer(fakeView, []);
  assert.equal(fakeContainer.children.length, 1, "Must clean up existing now-board elements to avoid double views");

  // 3. Test moveTaskToBucket for all buckets with taskTitle
  const todayStr = new Date().toISOString().slice(0, 10);
  await renderer2.moveTaskToBucket("Now/行动.md:2", "today", "测试任务");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "Now/行动.md:2");
  assert.equal(calls[0].expectedTitle, "测试任务");
  assert.equal(calls[0].updates.due, todayStr);
  assert.equal(calls[0].updates.waiting, false);

  await renderer2.moveTaskToBucket("Now/行动.md:2", "waiting", "测试等待");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].expectedTitle, "测试等待");
  assert.equal(calls[1].updates.due, "");
  assert.equal(calls[1].updates.waiting, true);

  // 4. Test moveTaskToBucket without passing taskTitle (default param, must NOT throw ReferenceError)
  await renderer2.moveTaskToBucket("Now/行动.md:2", "anytime");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].expectedTitle, "");
  assert.equal(calls[2].updates.due, "");
  assert.equal(calls[2].updates.waiting, false);
});

test("NEW-P2-C: snapshotAge and date helpers handle invalid inputs and snapshot objects gracefully", () => {
  const now = Date.now();
  const twoHoursAgo = new Date(now - 7200000).toISOString();

  // 1. Accepts ISO string
  const ageStr = launchpad.snapshotAge(twoHoursAgo);
  assert.ok(ageStr !== null && Math.abs(ageStr - 2.0) < 0.05);

  // 2. Accepts snapshot object with generated_at
  const ageObj = launchpad.snapshotAge({ generated_at: twoHoursAgo });
  assert.ok(ageObj !== null && Math.abs(ageObj - 2.0) < 0.05);

  // 3. Fallback safely on invalid inputs without throwing
  assert.equal(launchpad.snapshotAge(null), null);
  assert.equal(launchpad.snapshotAge(undefined), null);
  assert.equal(launchpad.snapshotAge("invalid-date-string"), null);
  assert.equal(launchpad.snapshotAge({}), null);

  // 4. formatShortDate defensive
  assert.equal(launchpad.formatShortDate(null), "–");
  assert.equal(launchpad.formatShortDate("invalid"), "–");
  assert.match(launchpad.formatShortDate(now), /^\d{1,2}-\d{2}$/);

  // 5. daysBetween：未知时间返回 null，不返回 0
  //    （0 天前等于「就是今天」，对未知时间是另一种撒谎；旧契约返回 0 已废弃）
  assert.equal(launchpad.daysBetween("invalid", "invalid"), null);
  assert.equal(launchpad.daysBetween(new Date(), null), null);
  assert.equal(launchpad.daysBetween(new Date(), 0), null);
  assert.equal(launchpad.daysBetween(new Date(), new Date(now - 86400000 * 3)), 3);

  // 6. 哨兵规则：mtime 的 0 是「未知」，不是 1970-01-01
  //    四个时间辅助必须口径一致 —— 未知就是未知，不能有的当今天、有的当 1970。
  assert.equal(launchpad.knownTimestamp(0), null);
  assert.equal(launchpad.knownTimestamp(undefined), null);
  assert.equal(launchpad.knownTimestamp(""), null);
  assert.equal(launchpad.knownTimestamp(NaN), null);
  assert.ok(launchpad.knownTimestamp(now) > 0);

  // dateKeyFromTimestamp：未知返回空串（空串不等于任何一天，因此不会被算作今天有活动）
  assert.equal(launchpad.dateKeyFromTimestamp("invalid"), "");
  assert.equal(launchpad.dateKeyFromTimestamp(0), "");
  assert.match(launchpad.dateKeyFromTimestamp(now), /^\d{4}-\d{2}-\d{2}$/);
});

test("NEW-P1-B: NowTaskEditModal preserves initialTitle allowing action renaming and safe deletion", async () => {
  const fileContent = "- [ ] 旧任务名称 📅 2026-09-20 #project/工作\n";
  let savedContent = "";

  const fakeFile = Object.assign(new mockObsidian.TFile(), { path: "Now/行动.md" });
  const fakeVault = {
    getAbstractFileByPath: () => fakeFile,
    read: async () => fileContent,
    modify: async (f, content) => { savedContent = content; },
  };

  const plugin = new launchpad();
  plugin.app = { vault: fakeVault };
  plugin.refreshActionSnapshots = async () => {};

  const task = {
    id: "Now/行动.md:1",
    title: "旧任务名称",
    due: "2026-09-20",
    project: "工作",
    waiting: false,
    done: false,
    path: "Now/行动.md",
    line: 1,
  };

  // 1. Initial modal captures initialTitle
  const modal = new launchpad.NowTaskEditModal({}, plugin, {}, task);
  assert.equal(modal.initialTitle, "旧任务名称");

  // 2. User renames task to "全新任务名称"
  modal.task.title = "全新任务名称";

  // 3. Simulating save using initialTitle must succeed and mutate line
  await plugin.updateNowTask(modal.task.id, modal.task, modal.initialTitle);
  assert.match(savedContent, /- \[ \] 全新任务名称 📅 2026-09-20 #project\/工作/);

  // 4. If someone wrongfully used the mutated title as expectedTitle, mutateNowTask must reject
  await assert.rejects(
    async () => {
      await plugin.updateNowTask(modal.task.id, modal.task, "全新任务名称");
    },
    /行动已被外部移动或修改/,
  );
});

test("R5 & R6: findingBasename qualifies generic doc names with parent folder and suggests unique actions", () => {
  // 1. findingBasename qualification
  assert.equal(
    launchpad.findingBasename({ path: "Topics/self-media/content-projects/WECHAT-20260904-GPT6-ASTRA/article.md" }),
    "GPT6-ASTRA · article",
  );
  assert.equal(
    launchpad.findingBasename({ path: "Topics/self-media/content-projects/PLATFORM-20260901-DEMO/index.md" }),
    "DEMO · index",
  );
  assert.equal(
    launchpad.findingBasename({ path: "Topics/self-media/raw/inbox/regular-note.md" }),
    "regular-note",
  );

  // 2. suggestReviewActions with multiple generic doc findings does not collapse into 1
  const findings = [
    { code: "PENDING_WRITEBACK", severity: "operational", path: "Topics/self-media/content-projects/WECHAT-20260901-PROJ-A/article.md" },
    { code: "PENDING_WRITEBACK", severity: "operational", path: "Topics/self-media/content-projects/WECHAT-20260902-PROJ-B/article.md" },
    { code: "PENDING_WRITEBACK", severity: "operational", path: "Topics/self-media/content-projects/WECHAT-20260903-PROJ-C/article.md" },
  ];
  const suggestions = launchpad.suggestReviewActions({
    tasks: [],
    health: { data: { findings } },
    contentProjects: [],
    pages: [],
    max: 10,
  });
  // Should suggest the first 2 writebacks without being collapsed as duplicates, plus fallback action
  assert.equal(suggestions.length, 3);
  assert.equal(suggestions[0].text, "回写待提炼：PROJ-A · article");
  assert.equal(suggestions[1].text, "回写待提炼：PROJ-B · article");
  assert.equal(suggestions[2].text, "完成本周复盘并生成下一批行动");

  // 3. R6 backward compatibility in normalizeActionKey
  assert.equal(
    launchpad.normalizeActionKey("回写待提炼的发布内容：PROJ-A · article"),
    launchpad.normalizeActionKey("回写待提炼：PROJ-A · article"),
  );
});

test("Custom SVG icons are defined and registered for Crisp Launchpad and Crisp Now", () => {
  assert.equal(launchpad.CRISP_LAUNCHPAD_ICON_ID, "crisp-launchpad");
  assert.equal(launchpad.CRISP_NOW_ICON_ID, "crisp-now");
  assert.match(launchpad.CRISP_LAUNCHPAD_ICON_SVG, /fill="currentColor"/);
  assert.match(launchpad.CRISP_LAUNCHPAD_ICON_SVG, /repeatCount="indefinite"/);
  assert.match(launchpad.CRISP_NOW_ICON_SVG, /animateTransform/);
  assert.match(launchpad.CRISP_NOW_ICON_SVG, /fill="currentColor"/);
});

test("Brand icons keep a persistent base shape so they never render blank", () => {
  for (const [name, svg] of [
    ["launchpad", launchpad.CRISP_LAUNCHPAD_ICON_SVG],
    ["now", launchpad.CRISP_NOW_ICON_SVG],
  ]) {
    const body = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    const base = body.match(/^<circle[^>]*?>/);
    assert.ok(base, `${name} icon should start with a persistent base circle`);
    assert.ok(!/r="0"/.test(base[0]), `${name} base circle must not be zero-radius`);
    assert.ok(!base[0].includes("<animate"), `${name} base circle must be static`);
  }
  assert.ok(
    !/begin="[^"]*\.end"/.test(launchpad.CRISP_LAUNCHPAD_ICON_SVG),
    "launchpad ripple must not wait for an animation end before restarting",
  );
});

test("Static icon variants exist and are selected when reduced motion is requested", () => {
  for (const [name, svg] of [
    ["launchpad", launchpad.CRISP_LAUNCHPAD_ICON_STATIC],
    ["now", launchpad.CRISP_NOW_ICON_STATIC],
  ]) {
    assert.ok(svg.startsWith("<svg"), `${name} static icon must be an svg`);
    assert.ok(!svg.includes("<animate"), `${name} static icon must not animate`);
    assert.match(svg, /fill="currentColor"/);
  }
  assert.equal(launchpad.crispIconVariant("launchpad", true), launchpad.CRISP_LAUNCHPAD_ICON_STATIC);
  assert.equal(launchpad.crispIconVariant("now", true), launchpad.CRISP_NOW_ICON_STATIC);
  assert.equal(launchpad.crispIconVariant("launchpad", false), launchpad.CRISP_LAUNCHPAD_ICON_SVG);
  assert.equal(launchpad.crispIconVariant("now", false), launchpad.CRISP_NOW_ICON_SVG);
});

test("T1: task lines carry start / scheduled / due / time and round-trip without loss", () => {
  const today = new Date("2026-09-20T08:00:00+08:00");
  const line =
    "- [ ] 写周报 🛫 2026-09-20 ⏳ 2026-09-21 📅 2026-09-22 ⏰ 09:30 #project/ANKS";
  const task = launchpad.parseNowTaskLine(line, "Now/行动.md", 1, today);
  assert.equal(task.start, "2026-09-20");
  assert.equal(task.scheduled, "2026-09-21");
  assert.equal(task.due, "2026-09-22");
  assert.equal(task.time, "09:30");
  assert.equal(task.doneAt, "");
  assert.equal(task.title, "写周报");
  assert.equal(task.bucket, "upcoming");

  const roundTrip = launchpad.parseNowTaskLine(
    launchpad.taskLine(task),
    "Now/行动.md",
    1,
    today,
  );
  assert.equal(roundTrip.start, "2026-09-20");
  assert.equal(roundTrip.scheduled, "2026-09-21");
  assert.equal(roundTrip.due, "2026-09-22");
  assert.equal(roundTrip.time, "09:30");
  assert.equal(roundTrip.title, "写周报");
  assert.equal(roundTrip.project, "ANKS");
  assert.equal(launchpad.taskLine(roundTrip), launchpad.taskLine(task));
  assert.match(launchpad.taskLine(task), /⏰ 09:30/);
});

test("T1: invalid dates and times are dropped instead of entering the task model", () => {
  const today = new Date("2026-09-20T08:00:00+08:00");
  const bad = launchpad.parseNowTaskLine(
    "- [ ] 坏日期 📅 2026-02-30 ⏰ 25:99 #project/ANKS",
    "Now/行动.md",
    1,
    today,
  );
  assert.equal(bad.due, "");
  assert.equal(bad.time, "");
  assert.equal(bad.bucket, "anytime");
  assert.equal(bad.title, "坏日期");

  assert.equal(launchpad.isDateKey("2026-02-30"), false);
  assert.equal(launchpad.isDateKey("2024-02-29"), true);
  assert.equal(launchpad.isDateKey("2026-9-20"), false);
  assert.equal(launchpad.isTimeKey("23:59"), true);
  assert.equal(launchpad.isTimeKey("24:00"), false);
  assert.equal(launchpad.isTimeKey("7:5"), false);
  assert.equal(launchpad.normalizeTimeKey("7:05"), "07:05");
  assert.equal(launchpad.normalizeTimeKey("9:30"), "09:30");
});

test("T1: a start date can move a task out of anytime while due still wins", () => {
  const today = new Date("2026-09-20T08:00:00+08:00");
  assert.equal(
    launchpad.parseNowTaskLine("- [ ] 以后再做 🛫 2026-09-25", "Now/行动.md", 1, today).bucket,
    "upcoming",
  );
  assert.equal(
    launchpad.parseNowTaskLine("- [ ] 今天开始 🛫 2026-09-20", "Now/行动.md", 1, today).bucket,
    "today",
  );
  assert.equal(
    launchpad.parseNowTaskLine("- [ ] 冲突 🛫 2026-09-01 📅 2026-09-30", "Now/行动.md", 1, today)
      .bucket,
    "upcoming",
  );
  assert.equal(
    launchpad.parseNowTaskLine("- [ ] 没日期", "Now/行动.md", 1, today).bucket,
    "anytime",
  );
});

test("T2: toggleNowTask stamps a completion date and clears it when restored", async () => {
  const todayKey = launchpad.dateKeyFromTimestamp(new Date());
  let fileContent = `- [ ] 写周报 📅 ${todayKey} #project/ANKS\n`;
  const fakeFile = Object.assign(new mockObsidian.TFile(), { path: "Now/行动.md" });
  const plugin = new launchpad();
  plugin.app = {
    vault: {
      getAbstractFileByPath: () => fakeFile,
      read: async () => fileContent,
      modify: async (file, content) => {
        fileContent = content;
      },
    },
  };
  plugin.refreshActionSnapshots = async () => {};

  await plugin.toggleNowTask("Now/行动.md:1", "写周报");
  assert.match(fileContent, new RegExp(`- \\[x\\] 写周报 📅 ${todayKey} ✅ \\d{4}-\\d{2}-\\d{2} #project\\/ANKS`));

  const completed = launchpad.parseNowTaskLine(fileContent.split("\n")[0], "Now/行动.md", 1, new Date());
  assert.equal(completed.done, true);
  assert.equal(completed.bucket, "done");
  assert.equal(launchpad.isDateKey(completed.doneAt), true, "completion stamp must be a real date");
  assert.equal(completed.title, "写周报");

  await plugin.toggleNowTask("Now/行动.md:1", "写周报");
  assert.equal(fileContent.includes("✅"), false);
  assert.match(fileContent, new RegExp(`- \\[ \\] 写周报 📅 ${todayKey} #project\\/ANKS`));
  const reopened = launchpad.parseNowTaskLine(fileContent.split("\n")[0], "Now/行动.md", 1, new Date());
  assert.equal(reopened.doneAt, "");
  assert.equal(reopened.bucket, "today");
});

test("T2: dragging onto the done bucket completes the task with a completion date", async () => {
  const calls = [];
  const fakePlugin = {
    updateNowTask: async (id, updates, expectedTitle) => {
      calls.push({ id, updates, expectedTitle });
    },
  };
  const fakeContainer = {
    children: [],
    querySelectorAll: () => [],
    createDiv: (opts) => {
      const el = { className: opts?.cls || "", remove: () => {} };
      fakeContainer.children.push(el);
      return el;
    },
  };
  const renderer = new launchpad.NowBoardRenderer(
    { plugin: fakePlugin, app: {}, contentEl: fakeContainer },
    [],
  );
  await renderer.moveTaskToBucket("Now/行动.md:1", "done", "写周报");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].updates.done, true);
  assert.equal(launchpad.isDateKey(calls[0].updates.doneAt), true);
  assert.equal(calls[0].expectedTitle, "写周报");
});

test("T3: reminderMoment only fires for open tasks that carry both a date and a time", () => {
  const base = { path: "Now/行动.md", title: "到点行动", done: false };
  assert.equal(launchpad.reminderMoment({ ...base, due: "2026-09-20", time: "" }), null);
  assert.equal(launchpad.reminderMoment({ ...base, due: "", scheduled: "", start: "", time: "09:30" }), null);
  assert.equal(launchpad.reminderMoment({ ...base, done: true, due: "2026-09-20", time: "09:30" }), null);
  assert.equal(launchpad.reminderMoment({ ...base, due: "2026-02-30", time: "09:30" }), null);

  const moment = launchpad.reminderMoment({ ...base, due: "2026-09-20", time: "09:30" });
  assert.equal(moment.date, "2026-09-20");
  assert.equal(moment.time, "09:30");
  assert.equal(moment.at.getHours(), 9);
  assert.equal(moment.at.getMinutes(), 30);
  assert.match(moment.key, /到点行动/);

  // Anchor priority: due beats scheduled beats start.
  assert.equal(
    launchpad.reminderMoment({
      ...base,
      due: "2026-09-22",
      scheduled: "2026-09-21",
      start: "2026-09-20",
      time: "09:30",
    }).date,
    "2026-09-22",
  );
  assert.equal(
    launchpad.reminderMoment({ ...base, scheduled: "2026-09-21", start: "2026-09-20", time: "09:30" })
      .date,
    "2026-09-21",
  );
});

test("T3: checkNowReminders notifies each due action once and skips stale or finished ones", async () => {
  const pad = (value) => String(value).padStart(2, "0");
  const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const dueDate = keyOf(fiveMinutesAgo);
  const dueTime = `${pad(fiveMinutesAgo.getHours())}:${pad(fiveMinutesAgo.getMinutes())}`;
  const staleDate = keyOf(new Date(now.getTime() - 48 * 60 * 60 * 1000));

  const plugin = new launchpad();
  plugin.settings = { remindersEnabled: true, remindedKeys: [] };
  plugin.saveSettings = async () => {};
  plugin.readNowTasks = async () => [
    { path: "Now/行动.md", title: "到点行动", due: dueDate, time: dueTime, done: false },
    { path: "Now/行动.md", title: "已完成行动", due: dueDate, time: dueTime, done: true },
    { path: "Now/行动.md", title: "没有时间", due: dueDate, time: "", done: false },
    { path: "Now/行动.md", title: "过期太久", due: staleDate, time: "08:00", done: false },
  ];
  const notified = [];
  plugin.notifyNowReminder = async (task, moment) => {
    notified.push(`${task.title}@${moment.time}`);
    return true;
  };

  const first = await plugin.checkNowReminders({ silent: true });
  assert.equal(first, 1, "only the single actionable timed task should fire");
  assert.deepEqual(notified, [`到点行动@${dueTime}`]);
  assert.equal(plugin.settings.remindedKeys.length, 1);

  const second = await plugin.checkNowReminders({ silent: true });
  assert.equal(second, 0, "the same reminder must not fire twice");
  assert.equal(notified.length, 1);

  plugin.settings.remindersEnabled = false;
  assert.equal(await plugin.checkNowReminders({ silent: true }), 0);
});

test("统一入口: 启动台默认落在「今天」，旧标签 id 自动迁移", () => {
  assert.equal(launchpad.PAGES[0].id, "today");
  assert.equal(launchpad.PAGES[0].name, "今天");

  const hadLocalStorage = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const originalStorage = globalThis.localStorage;
  const store = { "crisp-launchpad-tab": "overview" };
  globalThis.localStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
  };
  try {
    const view = { app: { plugins: { enabledPlugins: new Set() } }, plugin: {}, contentEl: {} };
    assert.equal(
      new launchpad.LaunchpadRenderer(view, {}, {}, []).activeTab,
      "today",
      "legacy overview id must migrate to today",
    );
    store["crisp-launchpad-tab"] = "system";
    assert.equal(
      new launchpad.LaunchpadRenderer(view, {}, {}, []).activeTab,
      "system",
      "a valid stored tab must be preserved",
    );
  } finally {
    if (hadLocalStorage) globalThis.localStorage = originalStorage;
    else delete globalThis.localStorage;
  }
});

test("移动端 NOW 在可用时打开到右侧叶片，保留中央视图", async (t) => {
  const previousMobile = mockObsidian.Platform.isMobile;
  mockObsidian.Platform.isMobile = true;
  t.after(() => { mockObsidian.Platform.isMobile = previousMobile; });
  const calls = [];
  const rightLeaf = {
    async setViewState(state) { calls.push(["set-right", state]); },
  };
  const centerLeaf = {
    async setViewState(state) { calls.push(["set-center", state]); },
  };
  let revealed = null;
  const plugin = new launchpad();
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [],
      getRightLeaf: (split) => {
        calls.push(["right-leaf", split]);
        return rightLeaf;
      },
      getLeaf: (kind) => {
        calls.push(["center-leaf", kind]);
        return centerLeaf;
      },
      revealLeaf: (leaf) => { revealed = leaf; },
    },
  };

  await plugin.activateNowView();

  assert.equal(revealed, rightLeaf);
  assert.ok(calls.some(([name, split]) => name === "right-leaf" && split === false));
  assert.ok(calls.some(([name, state]) => name === "set-right" && state.type === "crisp-now-view"));
  assert.ok(!calls.some(([name]) => name === "center-leaf" || name === "set-center"));
});

test("移动端 NOW 已在中间视图时会迁到右侧并释放旧叶片", async (t) => {
  const previousMobile = mockObsidian.Platform.isMobile;
  mockObsidian.Platform.isMobile = true;
  t.after(() => { mockObsidian.Platform.isMobile = previousMobile; });
  const calls = [];
  const existing = {
    getViewState: () => ({ type: "crisp-now-view", state: { filter: "today" } }),
    detach: () => calls.push("detach-center"),
  };
  const rightLeaf = {
    async setViewState(state) { calls.push(["set-right", state]); },
  };
  let revealed = null;
  const plugin = new launchpad();
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [existing],
      getRightLeaf: () => rightLeaf,
      getLeaf: () => { throw new Error("不应再新建中间叶片"); },
      revealLeaf: (leaf) => { revealed = leaf; },
    },
  };

  await plugin.activateNowView();

  assert.equal(revealed, rightLeaf);
  assert.ok(calls.some(([name, state]) => name === "set-right" && state.state.filter === "today"));
  assert.ok(calls.includes("detach-center"));
});

test("移动端 NOW 在 getRightLeaf 不可用时使用 Obsidian 侧栏叶片 API", async (t) => {
  const previousMobile = mockObsidian.Platform.isMobile;
  mockObsidian.Platform.isMobile = true;
  t.after(() => { mockObsidian.Platform.isMobile = previousMobile; });
  const calls = [];
  const rightLeaf = {
    async setViewState(state) { calls.push(["set-right", state]); },
  };
  let revealed = null;
  const plugin = new launchpad();
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [],
      getRightLeaf: () => null,
      ensureSideLeaf: async (type, side, options) => {
        calls.push(["ensure-side", type, side, options]);
        return rightLeaf;
      },
      getLeaf: () => { throw new Error("有侧栏 API 时不应占用中间叶片"); },
      revealLeaf: (leaf) => { revealed = leaf; },
    },
  };

  await plugin.activateNowView();

  assert.equal(revealed, rightLeaf);
  assert.deepEqual(calls[0], ["ensure-side", "crisp-now-view", "right", { active: true }]);
  assert.ok(calls.some(([name, state]) => name === "set-right" && state.type === "crisp-now-view"));
});

test("NOW 在缺少右侧 API 时保留原来的中间视图回退", async () => {
  const calls = [];
  const centerLeaf = {
    async setViewState(state) { calls.push(state); },
  };
  let revealed = null;
  const plugin = new launchpad();
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: (kind) => {
        calls.push(["get-center", kind]);
        return centerLeaf;
      },
      revealLeaf: (leaf) => { revealed = leaf; },
    },
  };

  await plugin.activateNowView();

  assert.equal(revealed, centerLeaf);
  assert.deepEqual(calls, [["get-center", "tab"], { type: "crisp-now-view", active: true }]);
});

test("统一入口: 收藏条目归一化、按类型标注并过滤无效项", () => {
  const entries = launchpad.normalizeBookmarkEntries(
    [
      { type: "file", path: "Core/System/policies/CONTENT - BRAND MANUAL.md", title: "品牌手册" },
      { type: "file", path: "Topics/self-media/自媒体内容总览.base" },
      { type: "url", url: "https://example.com" },
      { type: "search", query: "缺少 path/url" },
      null,
      { type: "file", path: "" },
    ],
    6,
  );
  assert.equal(entries.length, 3);
  assert.equal(entries[0].title, "品牌手册");
  assert.equal(entries[0].kind, "file");
  assert.equal(entries[0].kindLabel, "文件");
  assert.equal(entries[1].title, "自媒体内容总览.base");
  assert.equal(entries[2].kindLabel, "链接");
  assert.equal(entries[2].target, "https://example.com");
  assert.equal(launchpad.normalizeBookmarkEntries([], 6).length, 0);
  assert.equal(launchpad.normalizeBookmarkEntries(null, 6).length, 0);
  assert.equal(
    launchpad.normalizeBookmarkEntries(
      [
        { type: "file", path: "a.md" },
        { type: "file", path: "b.md" },
      ],
      1,
    ).length,
    1,
  );
});

test("面板: tab 覆盖 ANKS 的捕获 → 待整理 → 行动循环", () => {
  assert.deepEqual(
    launchpad.PANEL_TABS.map((tab) => tab.id),
    ["today", "capture", "triage", "bookmark"],
  );
  assert.equal(launchpad.PANEL_TABS[0].id, "today", "面板默认仍落在今天");
});

test("面板: 今天的捕获只取 raw/inbox 且 created_at 命中当天的条目", () => {
  const pages = [
    {
      path: "Topics/self-media/raw/inbox/scratch/a.md",
      mtime: 10,
      frontmatter: { created: "2026-09-20" },
    },
    {
      path: "Topics/self-media/raw/inbox/ideas/b.md",
      mtime: 20,
      frontmatter: { created_at: "2026-09-20 09:30" },
    },
    {
      path: "Topics/self-media/raw/inbox/scratch/c.md",
      mtime: 30,
      frontmatter: { created: "2026-09-19" },
    },
    {
      path: "Topics/self-media/knowledge/d.md",
      mtime: 40,
      frontmatter: { created: "2026-09-20" },
    },
    null,
  ];
  const out = launchpad.capturedToday(pages, new Date("2026-09-20T10:00:00+08:00"));
  assert.deepEqual(
    out.map((page) => page.path),
    ["Topics/self-media/raw/inbox/ideas/b.md", "Topics/self-media/raw/inbox/scratch/a.md"],
  );
  assert.equal(launchpad.capturedToday(null, new Date()).length, 0);
});

test("面板: 待整理按 ANKS 口径过滤 processed 并按更新时间排序", () => {
  const pages = [
    {
      path: "Topics/self-media/raw/inbox/scratch/old.md",
      mtime: 10,
      routing_status: "needs-classification",
    },
    {
      path: "Topics/self-media/raw/inbox/scratch/done.md",
      mtime: 99,
      routing_status: "processed",
    },
    { path: "Topics/self-media/raw/inbox/ideas/new.md", mtime: 50, routing_status: "" },
    { path: "Topics/self-media/knowledge/k.md", mtime: 80, routing_status: "" },
  ];
  assert.deepEqual(
    launchpad.inboxTriageItems(pages).map((page) => page.path),
    ["Topics/self-media/raw/inbox/ideas/new.md", "Topics/self-media/raw/inbox/scratch/old.md"],
  );
  assert.equal(launchpad.inboxTriageItems(pages, 1).length, 1);
  assert.equal(launchpad.inboxTriageItems(null).length, 0);
});

test("打磨: 项目标签写回不再把嵌套标签的斜杠静默改成连字符", () => {
  const today = new Date("2026-09-20T08:00:00+08:00");
  const line = "- [ ] 嵌套标签 #project/知识/回写";
  const task = launchpad.parseNowTaskLine(line, "Now/行动.md", 1, today);
  assert.equal(task.project, "知识/回写");
  const written = launchpad.taskLine(task);
  assert.equal(written, line, "写回必须与读入一致，不能改写用户数据");
  assert.equal(
    launchpad.parseNowTaskLine(written, "Now/行动.md", 1, today).project,
    "知识/回写",
  );
  // 会破坏标签 token 的字符仍然被清理
  assert.equal(launchpad.safeProjectTag("知识 回写"), "知识-回写");
  assert.equal(launchpad.safeProjectTag("#project/A#B"), "A-B");
  assert.equal(launchpad.safeProjectTag("  #project/工作  "), "工作");
});

test("打磨: 待整理口径与 ANKS sweeper 一致（processed / archived / done 都算已归位）", () => {
  for (const settled of ["processed", "archived", "done", " Processed ", "ARCHIVED"]) {
    assert.equal(launchpad.isSettledInboxStatus(settled), true, `${settled} 应算已归位`);
  }
  for (const open of ["needs-classification", "needs-review", "to-organize", "", null, undefined]) {
    assert.equal(launchpad.isSettledInboxStatus(open), false);
  }
  const pages = [
    { path: "Topics/x/raw/inbox/a.md", mtime: 3, routing_status: "archived" },
    { path: "Topics/x/raw/inbox/b.md", mtime: 2, routing_status: "done" },
    { path: "Topics/x/raw/inbox/c.md", mtime: 1, routing_status: "needs-classification" },
  ];
  assert.deepEqual(
    launchpad.inboxTriageItems(pages).map((page) => page.path),
    ["Topics/x/raw/inbox/c.md"],
  );
});

test("完整性: 并发勾选不会丢更新（Now 写入已串行化）", async () => {
  let fileContent = "- [ ] 甲\n- [ ] 乙\n";
  const mockFile = Object.assign(new mockObsidian.TFile(), { path: "Now/行动.md" });
  const delay = () => new Promise((resolve) => setTimeout(resolve, 5));
  const mockPlugin = {
    app: {
      vault: {
        getAbstractFileByPath: () => mockFile,
        read: async () => {
          await delay();
          return fileContent;
        },
        modify: async (_file, content) => {
          await delay();
          fileContent = content;
        },
      },
    },
    refreshActionSnapshots: async () => {},
  };
  const mutate = launchpad.prototype.mutateNowTask.bind(mockPlugin);

  // 读-改-写之间各有延时：没有队列时后一次写入会用旧快照覆盖前一次。
  await Promise.all([
    mutate("Now/行动.md:1", (task) => ({ ...task, done: true }), "甲"),
    mutate("Now/行动.md:2", (task) => ({ ...task, done: true }), "乙"),
  ]);

  assert.match(fileContent, /^- \[x\] 甲$/m, "第一条勾选不能被并发写覆盖");
  assert.match(fileContent, /^- \[x\] 乙$/m, "第二条勾选也不能丢");
});

test("完整性: 新建行动与其他 Now 写入共用同一串行队列", async () => {
  let fileContent = "# 行动\n";
  const mockFile = Object.assign(new mockObsidian.TFile(), { path: "Now/行动.md" });
  const delay = () => new Promise((resolve) => setTimeout(resolve, 5));
  const plugin = new launchpad();
  plugin.ensureActionFile = async () => "Now/行动.md";
  plugin.app = {
    vault: {
      getAbstractFileByPath: () => mockFile,
      read: async () => {
        await delay();
        return fileContent;
      },
      modify: async (_file, content) => {
        await delay();
        fileContent = content;
      },
    },
  };

  await Promise.all([
    plugin.createAction({ text: "新增 A" }),
    plugin.createAction({ text: "新增 B" }),
  ]);
  assert.match(fileContent, /新增 A/);
  assert.match(fileContent, /新增 B/);
});

test("完整性: 外部编辑穿过读写窗口时拒绝覆盖", async () => {
  let fileContent = "# 行动\n";
  const mockFile = Object.assign(new mockObsidian.TFile(), {
    path: "Now/行动.md",
    stat: { mtime: 1 },
  });
  const plugin = new launchpad();
  plugin.ensureActionFile = async () => "Now/行动.md";
  plugin.app = {
    vault: {
      getAbstractFileByPath: () => mockFile,
      read: async () => {
        mockFile.stat.mtime = 2;
        return fileContent;
      },
      modify: async (_file, content) => {
        fileContent = content;
      },
    },
  };

  await assert.rejects(
    () => plugin.createAction({ text: "不应覆盖" }),
    /外部修改，请刷新看板/,
  );
  assert.equal(fileContent, "# 行动\n");
});

test("完整性: Now 写入优先使用 Vault.process 保护提交阶段", async () => {
  let fileContent = "# 行动\n";
  const mockFile = Object.assign(new mockObsidian.TFile(), { path: "Now/行动.md" });
  const plugin = new launchpad();
  plugin.ensureActionFile = async () => "Now/行动.md";
  plugin.app = {
    vault: {
      getAbstractFileByPath: () => mockFile,
      process: async (_file, transform) => {
        fileContent += "- [ ] 外部编辑\n";
        fileContent = transform(fileContent);
        return fileContent;
      },
    },
  };

  await plugin.createAction({ text: "插件行动" });

  assert.match(fileContent, /外部编辑/);
  assert.match(fileContent, /插件行动/);
});

test("完整性: 标题里的内联 #token 不会被当成标签搬走", () => {
  const today = new Date("2026-09-20T08:00:00+08:00");
  for (const line of [
    "- [ ] 修复 #123 的 bug",
    "- [ ] 修复 #123 的 bug #project/X",
    "- [ ] C# 迁移 📅 2026-09-21",
    "- [ ] 等回复 #waiting #project/X",
  ]) {
    const task = launchpad.parseNowTaskLine(line, "Now/行动.md", 1, today);
    assert.equal(launchpad.taskLine(task), line, `${line} 必须无损往返`);
  }
  // 托管标签（等待态）仍然由插件管理
  const cleared = launchpad.parseNowTaskLine("- [ ] 等回复 #waiting", "Now/行动.md", 1, today);
  assert.equal(launchpad.taskLine({ ...cleared, waiting: false }), "- [ ] 等回复");
});

test("完整性: 写回保留原文件换行风格，CRLF 不被改写成 LF", async () => {
  let fileContent = "- [ ] 甲\r\n- [ ] 乙\r\n";
  const mockFile = Object.assign(new mockObsidian.TFile(), { path: "Now/行动.md" });
  const mockPlugin = {
    app: {
      vault: {
        getAbstractFileByPath: () => mockFile,
        read: async () => fileContent,
        modify: async (_file, content) => {
          fileContent = content;
        },
      },
    },
    refreshActionSnapshots: async () => {},
  };
  const mutate = launchpad.prototype.mutateNowTask.bind(mockPlugin);
  await mutate("Now/行动.md:1", (task) => ({ ...task, done: true }), "甲");
  assert.equal(fileContent, "- [x] 甲\r\n- [ ] 乙\r\n");
});

test("节奏: 点某天能列出当天改动的文件（热力图的时间维度索引）", () => {
  const view = { app: { plugins: { enabledPlugins: new Set() } }, plugin: {}, contentEl: {} };
  const pages = [
    {
      path: "Topics/x/knowledge/a.md",
      name: "a",
      title: "A",
      type: "knowledge",
      mtime: Date.parse("2026-09-20T10:00:00+08:00"),
    },
    {
      path: "Topics/x/raw/inbox/b.md",
      name: "b",
      title: "B",
      type: "raw",
      mtime: Date.parse("2026-09-20T09:00:00+08:00"),
    },
    {
      path: "Topics/x/outputs/c.md",
      name: "c",
      title: "C",
      type: "output",
      mtime: Date.parse("2026-09-19T12:00:00+08:00"),
    },
  ];
  const renderer = new launchpad.LaunchpadRenderer(view, {}, {}, pages);
  const day = renderer.pagesChangedOn("2026-09-20");
  assert.deepEqual(day.map((page) => page.title), ["A", "B"], "同一天应按改动时间倒序");
  assert.equal(renderer.pagesChangedOn("2026-09-19").length, 1);
  assert.equal(renderer.pagesChangedOn("2026-09-18").length, 0, "没有改动的日子要返回空");
});

test("节奏: 通用文件名在列表里用父目录限定，不再一屏都是 project", () => {
  assert.equal(
    launchpad.pageLabel({
      title: "自媒体内容项目索引 (Content Projects Index)",
      name: "index",
      path: "Topics/self-media/content-projects/index.md",
    }),
    "自媒体内容项目索引 (Content Projects Index)",
  );
  assert.equal(
    launchpad.pageLabel({
      title: "project",
      name: "project",
      path: "Topics/self-media/content-projects/WECHAT-20260919-SUBSTRATE-SYNTHESIS-ANKS/project.md",
    }),
    "SUBSTRATE-SYNTHESIS-ANKS · project",
  );
  assert.equal(
    launchpad.pageLabel({
      title: "article",
      name: "article",
      path: "Topics/self-media/content-projects/WECHAT-20260916-CRISP-ASR/article.md",
    }),
    "CRISP-ASR · article",
  );
  assert.equal(
    launchpad.pageLabel({ title: "速记", name: "速记", path: "Topics/self-media/raw/inbox/速记.md" }),
    "速记",
    "非通用名保持原样",
  );
});

test("陌生库：捕获不再凭空造出 Topics/self-media", async () => {
  const withActive = (path) => ({ workspace: { getActiveFile: () => ({ path }) } });
  assert.equal(launchpad.captureTargetTopic(withActive("Notes/a.md"), []), "", "没有 Topic 时必须留空");
  assert.equal(
    launchpad.captureTargetTopic(withActive("Topics/main-business/x.md"), [
      "self-media",
      "main-business",
    ]),
    "main-business",
    "优先用当前文件所在的真实 Topic",
  );
  assert.equal(
    launchpad.captureTargetTopic(withActive("AGENTS.md"), ["main-business"]),
    "main-business",
    "当前文件不在 Topics 下时退回第一个真实 Topic，而不是 self-media",
  );

  const created = [];
  const plugin = new launchpad();
  plugin.app = {
    vault: {
      getAbstractFileByPath: (path) =>
        path === "Topics"
          ? Object.assign(new mockObsidian.TFolder(), { path: "Topics", children: [] })
          : null,
      createFolder: async (path) => {
        created.push(`dir:${path}`);
      },
      create: async (path) => {
        created.push(`file:${path}`);
      },
      adapter: { exists: async () => false },
    },
  };
  await assert.rejects(
    () => plugin.createInboxCapture({ text: "x", topic: "self-media" }),
    /不存在|尚未配置/,
  );
  assert.deepEqual(created, [], "被拒绝时不能创建任何目录或文件");
  await assert.rejects(
    () => plugin.createInboxCapture({ text: "x", topic: "  " }),
    /尚未配置 Topic/,
  );
  assert.deepEqual(created, [], "空 topic 同样不能落盘");
});

test("速记默认 Topic 跟随主工作区；当前文件所在 Topic 优先", () => {
  const withActive = (path) => ({ workspace: { getActiveFile: () => ({ path }) } });
  const topics = ["main-business", "self-media"];
  assert.equal(
    launchpad.captureTargetTopic(withActive("Start Here.md"), topics, "main-business"),
    "main-business",
    "没有 Topic 上下文时应使用工作区主 Topic",
  );
  assert.equal(
    launchpad.captureTargetTopic(withActive("Topics/main-business/notes/a.md"), topics, "self-media"),
    "main-business",
    "在 Topic 文档里速记时应跟随当前文档",
  );
});

test("速记表单按当前 Topic 或主工作区选择默认落点", () => {
  const withActive = (path) => ({ workspace: { getActiveFile: () => ({ path }) } });
  const plugin = {
    listTopics: () => ["main-business", "self-media"],
    lastCapabilities: { contentTopics: ["self-media"] },
  };
  const modal = new launchpad.QuickCaptureModal(withActive("Start Here.md"), plugin, {});
  assert.equal(modal.topic, "self-media", "列表排序不应覆盖工作区主 Topic");

  const contextual = new launchpad.QuickCaptureModal(
    withActive("Topics/main-business/knowledge/a.md"),
    plugin,
    {},
  );
  assert.equal(contextual.topic, "main-business", "当前 Topic 文档应覆盖主 Topic 默认值");
});

test("N1: 手动行动与系统快照刷新只清除对应组件的错误", async () => {
  const stale = (error) => ({ lastAttemptAt: 1, lastSuccessAt: 1, error, errorAt: 2 });
  const plugin = new launchpad();
  plugin.settings = { allowSnapshotRefresh: true };
  plugin.canRunAnks = () => true;
  plugin.autoSyncStatus = {
    route: stale("路由仍失败"),
    snapshot: stale("快照旧错误"),
    health: stale("健康旧错误"),
    actions: stale("行动旧错误"),
  };
  plugin.autoSyncLastError = "快照：快照旧错误 · 健康：健康旧错误 · 行动：行动旧错误 · 路由：路由仍失败";
  plugin.refreshViews = () => {};
  const calls = [];
  plugin.runAnks = async (args) => calls.push(args);

  await plugin.refreshActionSnapshots();
  assert.equal(plugin.autoSyncStatus.actions.error, "");
  assert.ok(plugin.autoSyncStatus.actions.lastSuccessAt > 1);
  assert.match(plugin.autoSyncLastError, /快照旧错误/);

  await plugin.refreshSystemSnapshots();
  assert.equal(plugin.autoSyncStatus.snapshot.error, "");
  assert.equal(plugin.autoSyncStatus.health.error, "");
  assert.ok(plugin.autoSyncStatus.snapshot.lastSuccessAt > 1);
  assert.ok(plugin.autoSyncStatus.health.lastSuccessAt > 1);
  assert.equal(plugin.autoSyncStatus.route.error, "路由仍失败", "无关的路由错误必须保留");
  assert.match(plugin.autoSyncLastError, /路由仍失败/);
  assert.doesNotMatch(plugin.autoSyncLastError, /快照旧错误|健康旧错误|行动旧错误/);
  assert.deepEqual(calls, [["actions", "snapshot"], ["snapshot", "build"]]);
});

test("N1: 手动系统快照失败要持续记录快照与健康错误", async () => {
  const plugin = new launchpad();
  plugin.settings = { allowSnapshotRefresh: true };
  plugin.canRunAnks = () => true;
  plugin.refreshViews = () => {};
  plugin.runAnks = async () => {
    throw new Error("manual collector failed");
  };

  await assert.rejects(() => plugin.refreshSystemSnapshots(), /manual collector failed/);
  assert.equal(plugin.autoSyncStatus.snapshot.error, "manual collector failed");
  assert.equal(plugin.autoSyncStatus.health.error, "manual collector failed");
  assert.ok(plugin.autoSyncStatus.snapshot.lastAttemptAt > 0);
  assert.ok(plugin.autoSyncStatus.health.lastAttemptAt > 0);
  assert.match(plugin.autoSyncLastError, /manual collector failed/);
});

test("N2: 移入随时会清除日期安排并保留行动身份", async () => {
  const line = "- [ ] 排期任务 ➕ 2026-09-20 🛫 2099-01-01 ⏳ 2099-01-02 📅 2099-01-03 ⏰ 09:30 #project/ANKS";
  let fileContent = `${line}\n`;
  const file = Object.assign(new mockObsidian.TFile(), { path: "Now/行动.md" });
  const plugin = new launchpad();
  plugin.app = {
    vault: {
      getAbstractFileByPath: () => file,
      read: async () => fileContent,
      modify: async (_file, content) => { fileContent = content; },
    },
  };
  plugin.refreshActionSnapshots = async () => true;
  const task = launchpad.parseNowTaskLine(line, "Now/行动.md", 1, new Date("2026-09-23T08:00:00"));
  assert.equal(task.bucket, "upcoming");
  const renderer = Object.create(launchpad.NowBoardRenderer.prototype);
  renderer.plugin = plugin;

  await renderer.moveTaskToBucket(task.id, "anytime", task);

  const moved = launchpad.parseNowTaskLine(fileContent.trim(), "Now/行动.md", 1, new Date("2026-09-23T08:00:00"));
  assert.equal(moved.bucket, "anytime");
  assert.equal(moved.due, "");
  assert.equal(moved.scheduled, "");
  assert.equal(moved.start, "");
  assert.equal(moved.time, "");
  assert.equal(moved.created, "2026-09-20");
  assert.equal(moved.project, "ANKS");
});

test("N3: 快照失败时已提交的行动仍报告为已保存", async () => {
  let fileContent = "- [ ] 重要行动\n";
  const file = Object.assign(new mockObsidian.TFile(), { path: "Now/行动.md" });
  const plugin = new launchpad();
  plugin.settings = { allowSnapshotRefresh: true };
  plugin.canRunAnks = () => true;
  plugin.app = {
    vault: {
      getAbstractFileByPath: () => file,
      process: async (_file, transform) => {
        fileContent = transform(fileContent);
        return fileContent;
      },
    },
    workspace: { getLeavesOfType: () => [] },
  };
  plugin.runAnks = async () => {
    throw new Error("snapshot unavailable");
  };
  const task = launchpad.parseNowTaskLine("- [ ] 重要行动", "Now/行动.md", 1);

  const result = await plugin.toggleNowTask(task.id, task);

  assert.match(fileContent.trimEnd(), /^- \[x\] 重要行动 ✅ \d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(result, { saved: true, snapshotUpdated: false, error: "snapshot unavailable" });
  assert.equal(plugin.autoSyncStatus.actions.error, "snapshot unavailable");
});

test("N4: 静默窗口内的其他 Now 文件事件仍会进入待刷新队列", () => {
  const plugin = Object.assign(Object.create(launchpad.prototype), {
    settings: { autoRouteEnabled: true },
    canRunAnks: () => true,
    autoSyncRunning: false,
    autoSyncDirty: { actions: false, knowledge: false, snapshot: false },
    autoSyncIgnoreUntil: 0,
    ignoreNowChangeUntil: Date.now() + 5000,
    runEventBridgeSync: () => {},
  });

  plugin.handleAutoRouteCandidate({ path: "Now/外部编辑.md" });

  assert.equal(plugin.autoSyncDirty.actions, true);
  assert.ok(plugin.autoSyncTimer, "变更事件必须排入合并刷新");
  clearTimeout(plugin.autoSyncTimer);
  clearTimeout(plugin.refreshTimer);
});

test("复盘建议：近期已完成的同名行动也参与去重，队列向后推进", () => {
  const health = {
    findings: [
      { code: "PENDING_WRITEBACK", severity: "operational", path: "Topics/t/outputs/a.md" },
      { code: "PENDING_WRITEBACK", severity: "operational", path: "Topics/t/outputs/b.md" },
      { code: "PENDING_WRITEBACK", severity: "operational", path: "Topics/t/outputs/c.md" },
      { code: "STALE_INBOX", severity: "operational", path: "Topics/t/raw/inbox/x.md" },
    ],
  };
  const today = new Date(2026, 8, 29);
  const texts = (tasks) =>
    launchpad.suggestReviewActions({ tasks, health, today }).map((item) => item.text);

  // 勾掉 a 并不会清掉 health 的 finding；两周内不应再生成同一条
  const recent = texts([{ title: "回写待提炼：a", done: true, doneAt: "2026-09-28" }]);
  assert.ok(!recent.includes("回写待提炼：a"));
  assert.deepEqual(recent.slice(0, 2), ["回写待提炼：b", "回写待提炼：c"]);

  // 旧标签「的发布内容」同样识别
  const legacy = texts([{ title: "回写待提炼的发布内容：a", done: true, doneAt: "2026-09-28" }]);
  assert.ok(!legacy.includes("回写待提炼：a"));

  // 超过冷却期、或完成日期未知的已完成行动不挡：finding 仍在就再提醒
  const old = texts([{ title: "回写待提炼：a", done: true, doneAt: "2026-09-01" }]);
  assert.equal(old[0], "回写待提炼：a");
  const undated = texts([{ title: "回写待提炼：a", done: true, doneAt: "" }]);
  assert.equal(undated[0], "回写待提炼：a");
});

test("内容索引：项目目录内的增删改才触发 index 重建，index.md 本身不自触发", () => {
  const topicOf = launchpad.contentIndexTopicForPath;
  assert.equal(topicOf("Topics/self-media/content-projects/WECHAT-1/project.yaml"), "self-media");
  assert.equal(topicOf("Topics/self-media/content-projects/WECHAT-1/assets/a.png"), "self-media");
  assert.equal(topicOf("Topics/studio/content-projects/P"), "studio", "删除整个目录时路径是文件夹");
  assert.equal(topicOf("Topics/self-media/content-projects/index.md"), "");
  assert.equal(topicOf("Topics/self-media/content-projects/README.md"), "");
  assert.equal(topicOf("Topics/self-media/knowledge/a.md"), "");
  assert.equal(topicOf(undefined), "");
});

test("事件桥：删除项目目录会先重建对应 Topic 的 content index，再建快照", async () => {
  const calls = [];
  const plugin = Object.assign(Object.create(launchpad.prototype), {
    settings: { autoRouteEnabled: true },
    canRunAnks: () => true,
    unloaded: false,
    autoSyncRunning: false,
    autoSyncDirty: { actions: false, knowledge: false, snapshot: false },
    autoSyncIgnoreUntil: 0,
    healthRebuildTimer: null,
    refreshViews: () => {},
    runAnks: async (args) => {
      calls.push(args.join(" "));
    },
  });
  plugin.handleAutoRouteCandidate({ path: "Topics/self-media/content-projects/OLD-PROJECT" });
  plugin.handleAutoRouteCandidate({ path: "Topics/self-media/content-projects/OLD-PROJECT/article.md" });
  plugin.handleAutoRouteCandidate({ path: "Topics/self-media/content-projects/index.md" });
  clearTimeout(plugin.autoSyncTimer);
  clearTimeout(plugin.refreshTimer);
  assert.equal(plugin.autoSyncDirty.snapshot, true);
  await plugin.runEventBridgeSync();
  clearTimeout(plugin.healthRebuildTimer);
  assert.deepEqual(calls, [
    "content index --topic self-media",
    "snapshot build --only content,index",
  ]);
  calls.length = 0;
  plugin.autoSyncDirty.snapshot = true;
  await plugin.runEventBridgeSync();
  clearTimeout(plugin.healthRebuildTimer);
  assert.deepEqual(calls, ["snapshot build --only content,index"], "index 队列消费后清空");
});

test("推进内容项目：先重新物化控制卡，再重建系统快照", async () => {
  const calls = [];
  const { TFile } = mockObsidian;
  const files = new Map();
  for (const name of ["project.yaml", "article.md", "publish.md"]) {
    const file = new TFile();
    file.path = `Topics/studio/content-projects/P-1/${name}`;
    files.set(file.path, { file, content: "---\nstage: drafting\nstatus: active\n---\n" });
  }
  const plugin = Object.assign(Object.create(launchpad.prototype), {
    settings: { allowSnapshotRefresh: true },
    canRunAnks: () => true,
    app: {
      vault: {
        getAbstractFileByPath: (path) => files.get(path)?.file || null,
        read: async (file) => files.get(file.path).content,
        modify: async (file, content) => {
          files.get(file.path).content = content;
        },
      },
    },
    refreshViews: () => {},
    runAnks: async (args) => {
      calls.push(args.join(" "));
    },
  });
  await plugin.updateContentProject("Topics/studio/content-projects/P-1", {
    stage: "reviewing",
    status: "published",
  });
  const card = calls.findIndex((call) => call.startsWith("content control-card P-1"));
  const snapshot = calls.indexOf("snapshot build");
  assert.ok(card >= 0 && snapshot >= 0, calls.join(" | "));
  assert.ok(card < snapshot, `控制卡须先于快照：${calls.join(" | ")}`);
});
