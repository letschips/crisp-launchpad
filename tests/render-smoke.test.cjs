/* ==========================================================================
   渲染冒烟测试 —— 用最小假 DOM + 与真实快照同形的 fixture，跑完三个视图的全部页签。

   为什么需要它：现有 57 条测试全部是纯函数。历史上两次 P0 都长在渲染路径上，
   而函数本身是对的 ——
     · `formatDateTime(page.mtime)` 传数字给只接受 Date 的重载 → renderKnowledge 抛异常，
       复盘页与系统页永不构建、showTab 不执行；
     · `snapshotAge(snapshot)` 传整个包装体 → 静默恒显「时间未知」。
   纯函数测试不可能发现这类问题。这里给渲染路径补一条最低门槛：不抛异常 + 结构合理。

   设计约束：
     · 零依赖（不引入 jsdom）；假 DOM 只实现 main.js 实际用到的 API；
     · 不读真实 Vault、不执行 CLI（假 adapter 不给 getBasePath 时 canRunAnks() 为 false）；
     · fixture 刻意包含危险形状：数字 mtime、mtime=0、缺 generated_at 的快照、
       含 blocking 的 findings、带 ✅/⏰/嵌套 project tag 的行动行。
   ========================================================================== */

const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

if (typeof window === "undefined") {
  global.window = global;
}

/* ---------- 最小假 DOM ---------- */
class FakeEl {
  constructor(tag = "div", opts = {}) {
    this.tagName = tag;
    this.children = [];
    this.parent = null;
    this.classes = new Set();
    this.dataset = {};
    this.style = {};
    this.attrs = {};
    this.listeners = {};
    this.textContent = "";
    this.tabIndex = -1;
    this.disabled = false;
    if (opts.cls) String(opts.cls).split(/\s+/).filter(Boolean).forEach((c) => this.classes.add(c));
    if (opts.text !== undefined) this.textContent = String(opts.text);
    if (opts.attr) Object.assign(this.attrs, opts.attr);
  }
  _append(child) { child.parent = this; this.children.push(child); return child; }
  createDiv(opts = {}) { return this._append(new FakeEl("div", opts)); }
  createSpan(opts = {}) { return this._append(new FakeEl("span", opts)); }
  createEl(tag, opts = {}) { return this._append(new FakeEl(tag, opts)); }
  empty() { this.children.length = 0; this.textContent = ""; return this; }
  addClass(c) { String(c).split(/\s+/).filter(Boolean).forEach((x) => this.classes.add(x)); return this; }
  removeClass(c) { this.classes.delete(c); return this; }
  toggleClass(c, on) { if (on === undefined ? !this.classes.has(c) : on) this.classes.add(c); else this.classes.delete(c); return this; }
  setText(t) { this.textContent = String(t); return this; }
  setAttribute(k, v) { this.attrs[k] = String(v); return this; }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); return this; }
  removeEventListener() { return this; }
  appendChild(child) { return this._append(child); }
  replaceChildren(...children) { this.empty(); children.forEach(child => this._append(child)); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  contains() { return false; }
  focus() {}
  /* 递归统计后代数量，供结构断言使用 */
  count() { return 1 + this.children.reduce((n, c) => n + c.count(), 0); }
  descendantsWithClass(cls) {
    let n = this.classes.has(cls) ? 1 : 0;
    this.children.forEach((c) => { n += c.descendantsWithClass(cls); });
    return n;
  }
  allText() {
    return [this.textContent, ...this.children.map((c) => c.allText())].join(" ").replace(/\s+/g, " ").trim();
  }
}

/* ---------- obsidian 桩 ---------- */
let mock;
function installStub() {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "obsidian") {
      class Plugin {
        constructor() { this._views = new Map(); this._commands = []; this._ribbons = []; }
        async loadData() { return {}; }
        async saveData() {}
        registerView(type, factory) { this._views.set(type, factory); }
        registerEvent() { return {}; }
        registerInterval(id) { return id; }
        addCommand(cmd) { this._commands.push(cmd); return cmd; }
        addRibbonIcon() { this._ribbons.push(1); return new FakeEl("div"); }
        registerObsidianProtocolHandler() {}
        addSettingTab() {}
      }
      class ItemView {
        constructor(leaf) { this.leaf = leaf || {}; this.contentEl = new FakeEl("div"); this.app = null; }
      }
      class PluginSettingTab {}
      class Setting {
        setName() { return this; } setDesc() { return this; }
        addText(cb) { cb({ inputEl: {}, setValue() { return this; }, setPlaceholder() { return this; }, onChange() { return this; } }); return this; }
        addTextArea(cb) { cb({ inputEl: {}, setValue() { return this; }, setPlaceholder() { return this; }, onChange() { return this; } }); return this; }
        addDropdown(cb) { cb({ addOption() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
        addToggle(cb) { cb({ setValue() { return this; }, onChange() { return this; } }); return this; }
        addButton(cb) { cb({ setButtonText() { return this; }, onClick() { return this; } }); return this; }
      }
      class Notice { constructor(msg) { Notice.last = String(msg); } }
      class Modal {
        constructor(app) { this.app = app; this.contentEl = new FakeEl("div"); }
        open() {} close() {} onOpen() {} onClose() {}
      }
      class TFile {
        constructor(path = "", mtime = 0) {
          this.path = path;
          const seg = path.split("/");
          this.name = seg.pop();
          this.basename = this.name.replace(/\.md$/, "");
          this.parent = { path: seg.join("/") };
          this.stat = { mtime };
        }
      }
      class TFolder { constructor(path = "") { this.path = path; this.children = []; } }
      class Platform {}
      Platform.isMobile = false;
      mock = { Plugin, ItemView, PluginSettingTab, Setting, Notice, Modal, TFile, TFolder, Platform,
        setIcon() {}, addIcon() {} };
      return mock;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const api = require("../main.js");
  Module._load = originalLoad;
  return api;
}

const api = installStub();

/* ---------- fixture：与真实 .runtime/snapshot/*.json 同形 ---------- */

/* 危险形状：mtime 是数字；含 mtime=0 的兜底值 */
function page(path, frontmatter, mtime) {
  const name = path.split("/").pop().replace(/\.md$/, "");
  const folder = path.split("/").slice(0, -1).join("/");
  return {
    file: new mock.TFile(path, mtime), path, name, folder, mtime,
    frontmatter: { ...frontmatter },
    type: String(frontmatter.type ?? ""),
    content_role: String(frontmatter.content_role ?? ""),
    stage: String(frontmatter.stage ?? ""),
    status: String(frontmatter.status ?? ""),
    platform: String(frontmatter.platform ?? ""),
    knowledge_writeback: String(frontmatter.knowledge_writeback ?? ""),
    routing_status: String(frontmatter.routing_status ?? ""),
    title: String(frontmatter.title ?? name),
  };
}

const DAY = 86400000;
function makePages() {
  return [
    page("Core/System/policies/x.md", { type: "method", owner: "core" }, Date.now() - 2 * DAY),
    page("Topics/self-media/knowledge/a.md", { type: "knowledge", title: "知识甲" }, Date.now() - 1 * DAY),
    page("Topics/self-media/raw/inbox/scratch/未归档.md", { type: "raw", routing_status: "needs-classification" }, Date.now() - 5 * DAY),
    page("Topics/self-media/raw/inbox/scratch/已归档.md", { type: "raw", routing_status: "processed" }, Date.now() - 9 * DAY),
    page("Topics/self-media/outputs/content/published/公众号/x.md", { type: "output", title: "已发布甲", platform: "wechat", status: "published" }, Date.now() - 3 * DAY),
    page("Topics/self-media/content-projects/WECHAT-20260919-X/article.md", { type: "output", content_role: "article", title: "项目甲", stage: "reviewing", status: "published" }, Date.now() - 4 * DAY),
    page("Topics/self-media/content-projects/WECHAT-20260919-X/index.md", { type: "output", content_role: "article", title: "index" }, Date.now() - 4 * DAY),
    /* mtime=0 → 覆盖 formatDateTime / formatShortDate / dateKeyFromTimestamp 的兜底分支 */
    page("Topics/self-media/raw/inbox/无时间.md", { type: "raw" }, 0),
  ];
}

/* 行动只认 Crisp Tempo：这里是它 getActionOverview() 返回的条目形状。 */
const TEMPO_TASKS = [
  { id: "t1", title: "今天要做的", status: "todo", bucket: "today", focusDate: "2026-09-20", projectTitle: "ANKS" },
  { id: "t2", title: "等回复", status: "waiting", bucket: "waiting", projectTitle: "协作" },
  { id: "t3", title: "带截止", status: "todo", bucket: "upcoming", startDate: "2026-09-21", dueDate: "2026-09-25" },
  { id: "t4", title: "已完成", status: "done", bucket: "done", completedAt: Date.now() },
  { id: "t5", title: "内联 #123 的 bug", status: "todo", bucket: "anytime" },
  { id: "t6", title: "未整理", status: "todo", bucket: "inbox" },
];

function fakeTempo(tasks) {
  return {
    actionsApiVersion: 1,
    async getActionOverview() {
      return { apiVersion: 1, date: "2026-09-20", licensed: true, tasks };
    },
    async createTaskFromSource(input) {
      return { id: "new", sourceId: input.sourceId, title: input.title, status: "todo" };
    },
    async revealTask() {},
  };
}

function makeSnapshots({ withGeneratedAt = true } = {}) {
  const stamp = withGeneratedAt ? new Date(Date.now() - 2 * 3600000).toISOString() : undefined;
  const actions = {
    schema: "anks-actions-v1",
    generated_at: stamp,
    freshness: { state: "fresh", age_hours: 2 },
    source: { kind: "native", label: "Obsidian 原生清单" },
    counts: { overdue: 1, today: 1, upcoming: 1, waiting: 1, anytime: 1 },
    groups: [
      { id: "overdue", title: "逾期", items: [{ id: "native:Now/行动.md:2", title: "过期项", bucket: "overdue", due: "2026-09-18", overdue: true, project: "ANKS", status: "open", origin: { provider: "native", path: "Now/行动.md", line: 2 } }] },
      { id: "today", title: "今天", items: [{ id: "n1", title: "今天项", bucket: "today", due: "2026-09-20", project: "ANKS", origin: { path: "Now/行动.md" } }] },
      { id: "upcoming", title: "即将", items: [] },
      { id: "waiting", title: "等待", items: [{ id: "n2", title: "等待项", bucket: "waiting", project: "协作", origin: { path: "Now/行动.md" } }] },
      { id: "anytime", title: "随时", items: [] },
    ],
  };
  const health = {
    schema: "anks-system-snapshot-v1", kind: "health", generated_at: stamp,
    freshness: { state: "fresh" }, source: { command: "…" },
    data: {
      schema_version: "anks-health-report-v2", status: "warning",
      counts: { blocking: 1, operational: 82, informational: 8 },
      finding_codes: { BLOCKING_THING: 1, PENDING_WRITEBACK: 1, STALE_INBOX: 1, CONTRACT_ERROR: 1 },
      findings: [
        { code: "CONTRACT_ERROR", severity: "blocking", path: "Core/System/a.md" },
        { code: "PENDING_WRITEBACK", severity: "operational", path: "Topics/self-media/outputs/content/published/公众号/待回写甲.md" },
        { code: "PENDING_WRITEBACK", severity: "operational", path: "Topics/self-media/content-projects/WECHAT-20260919-X/article.md" },
        { code: "STALE_INBOX", severity: "operational", path: "Topics/self-media/raw/inbox/scratch/未归档.md" },
      ],
    },
  };
  const content = {
    schema: "anks-system-snapshot-v1", kind: "content", generated_at: stamp,
    data: [
      { content_id: "WECHAT-20260919-X", dir: "Topics/self-media/content-projects/WECHAT-20260919-X", stage: "reviewing", status: "published", profile: "standard-essay", updated_at: "2026-09-19" },
      { content_id: "WECHAT-20260916-Y", dir: "Topics/self-media/content-projects/WECHAT-20260916-Y", stage: "drafting", status: "draft", profile: "image-post", updated_at: "2026-09-16" },
    ],
  };
  const index = { schema: "anks-system-snapshot-v1", kind: "index", generated_at: stamp, data: { documents: 597, chunks: 5722 } };
  const tasks = TEMPO_TASKS.map(api.tempoSummaryToAction);
  return { actions, health, content, index, tasks };
}

function makeAdapter(store) {
  return {
    async exists(path) { return Object.prototype.hasOwnProperty.call(store, path); },
    async read(path) { return store[path]; },
    /* 不提供 getBasePath → canRunAnks() 为 false，渲染路径不会 spawn CLI */
    write() {}, writeBinary() {},
  };
}

function makeApp({ desktop = false, pages = makePages(), snapshots = makeSnapshots(), tempoTasks = TEMPO_TASKS } = {}) {
  const files = pages.map((p) => p.file);
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const store = {
    ".runtime/snapshot/actions.json": JSON.stringify(snapshots.actions),
    ".runtime/snapshot/health.json": JSON.stringify(snapshots.health),
    ".runtime/snapshot/content.json": JSON.stringify(snapshots.content),
    ".runtime/snapshot/index.json": JSON.stringify(snapshots.index),
    "Sidecar/bin/anks": "#!/bin/sh\n",
    "Start Here.md": "# Start Here\n",
    "AGENTS.md": "# AGENTS\n",
  };
  const vault = {
    getMarkdownFiles: () => files,
    getFiles: () => files,
    getAbstractFileByPath: (p) => byPath.get(p)?.file || null,
    read: async (file) => store[file.path] ?? "",
    modify: async () => {},
    create: async () => {},
    createFolder: async () => {},
    _events: {},
    on(event, callback) { this._events[event] = callback; return {}; },
    adapter: makeAdapter(store),
  };
  if (desktop) vault.adapter.getBasePath = () => "/tmp/fake-vault";
  return {
    vault,
    metadataCache: { getFileCache: (file) => ({ frontmatter: byPath.get(file.path)?.frontmatter || {} }), on: () => ({}), getFirstLinkpathDest: () => null },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: () => ({ setViewState: async () => {} }),
      getRightLeaf: () => ({ setViewState: async () => {} }),
      revealLeaf: () => {},
      detachLeavesOfType: () => {},
      getActiveFile: () => null,
      onLayoutReady: () => {},
      on: () => ({}),
    },
    commands: { executeCommandById: () => true, findCommand: () => ({}) },
    plugins: {
      enabledPlugins: new Set(["crisp-dsh", "crisp-launchpad", ...(tempoTasks ? ["crisp-tempo"] : [])]),
      plugins: tempoTasks ? { "crisp-tempo": fakeTempo(tempoTasks) } : {},
    },
    internalPlugins: { getEnabledPluginById: () => null },
  };
}

async function makePlugin({ desktop = false, mobile = false, pages, snapshots, tempoTasks } = {}) {
  mock.Platform.isMobile = mobile;
  const plugin = new api();
  plugin.app = makeApp({ desktop, pages, snapshots, tempoTasks });
  plugin.settings = { openOnStartup: false, allowSnapshotRefresh: true, autoRouteEnabled: false, hasCompletedOnboarding: true };
  await plugin.onload();
  return plugin;
}

function makeLeaf() {
  return { view: null, setViewState: async () => {}, app: null };
}

async function renderView(plugin, viewType) {
  const factory = plugin._views.get(viewType);
  assert.ok(factory, `视图 ${viewType} 未注册（registerView 没被调用？）`);
  const view = factory(makeLeaf());
  view.app = plugin.app;
  const out = await view.render();
  return { view, out };
}

/* ==========================================================================
   测试
   ========================================================================== */

test("冒烟：Crisp Launchpad 五个页签在桌面与移动端都能渲染且不抛异常", async () => {
  for (const mobile of [false, true]) {
    for (const desktop of [true, false]) {
      const plugin = await makePlugin({ desktop, mobile });
      const { view } = await renderView(plugin, api.VIEW_TYPE_LAUNCHPAD ?? "crisp-launchpad-view");
      const wrapper = view.contentEl.children[0];
      assert.ok(wrapper, `launchpad 渲染后应有根容器（mobile=${mobile} desktop=${desktop}）`);
      assert.ok(wrapper.count() > 50, `launchpad 渲染元素过少：${wrapper.count()}`);
      /* 每个页签的面板都必须被构建过（历史上 renderKnowledge 抛异常会让后两页为空） */
      const labels = wrapper.allText();
      ["今天", "创作", "知识", "复盘", "系统"].forEach((name) => {
        assert.ok(labels.includes(name), `页签「${name}」的文案缺失（mobile=${mobile} desktop=${desktop}）`);
      });
    }
  }
});

test("冒烟：缺 generated_at 的快照不能让行动台抛异常（覆盖「时间未知」分支）", async () => {
  const plugin = await makePlugin({ snapshots: makeSnapshots({ withGeneratedAt: false }) });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  assert.ok(view.contentEl.children[0].count() > 50);
});

test("冒烟：Crisp 行动面板四个页签都能渲染且不抛异常", async () => {
  const plugin = await makePlugin({});
  const { view } = await renderView(plugin, "crisp-launchpad-panel-view");
  assert.ok(view.contentEl.children[0], "面板渲染后应有根容器");
  assert.ok(api.PANEL_TABS.length >= 3, "面板页签应至少 3 个");
  for (const tab of api.PANEL_TABS) {
    assert.doesNotThrow(() => {
      view.activeTab = tab.id;
      view.renderPanelBody ? view.renderPanelBody() : null;
    }, `面板页签「${tab.name}」渲染抛异常`);
  }
});

test("冒烟：mtime 未知的页要显示为未知，不能被算成今天、也不能显示成 1970", async () => {
  /* fixture 里的 `无时间.md` 用 mtime=0 模拟「拿不到 stat.mtime」。
     0 是哨兵值而不是 1970-01-01 —— 这条断言把哨兵规则钉在渲染结果上：
     既不能显示 20776 天前（把 0 当 1970），也不能让热力图把它算作今天有活动。 */
  const plugin = await makePlugin({});
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  const text = view.contentEl.children[0].allText();
  assert.ok(text.includes("时间未知"), "待整理里未知时间的页应显示「时间未知」");
  assert.ok(!text.includes("20776"), "未知时间不能按 1970 计算天数");
  assert.ok(!/\b1970-/.test(text), "未知时间不能被格式化成 1970 年");
});

test("冒烟：工作台形态决定实际渲染出哪些页签", async () => {
  /* 同一份 fixture 数据，三种设置 → 三套页签。这条断言把「自动适配」钉在渲染结果上，
     而不只是钉在 launchpadPages() 的返回值上。 */
  const cases = [
    ["auto", ["今天", "创作", "知识", "复盘", "系统"], []],
    ["knowledge", ["今天", "知识", "复盘", "系统"], ["创作"]],
    ["actions-only", ["今天", "系统"], ["创作", "知识", "复盘"]],
  ];
  for (const [mode, expected, absent] of cases) {
    const plugin = await makePlugin({});
    plugin.settings.workspaceMode = mode;
    const { view } = await renderView(plugin, "crisp-launchpad-view");
    const root = view.contentEl.children[0];
    const labels = [...root.children]
      .filter((child) => child.classes.has("launchpad-tabs"))
      .flatMap((tabs) => tabs.children.map((button) => button.textContent));
    assert.deepEqual(labels, expected, `形态 ${mode} 的页签不符`);
    const text = root.allText();
    absent.forEach((name) => {
      assert.ok(!labels.includes(name), `形态 ${mode} 不应出现「${name}」页签`);
      /* 页签不存在时，该页特有的按钮/卡片也不该出现 */
      if (name === "创作") assert.ok(!text.includes("创作流水线"), "无创作页时不应渲染创作流水线");
    });
  }
});

test("冒烟：内核状态胶囊报告本机内核，而不是别的插件", async () => {
  /* 桌面 + 有内核 → 就绪 */
  const desktop = await makePlugin({ desktop: true });
  let text = (await renderView(desktop, "crisp-launchpad-view")).view.contentEl.children[0].allText();
  assert.ok(text.includes("内核就绪"), "桌面且有内核时应显示「内核就绪」");
  /* 「Crisp 工具」里可以有 DSH 入口；胶囊本身只报告 ANKS 内核，不能再写 DSH。 */
  const findPill = (el) => (el.classes?.has("launchpad-kernel-pill") ? el : (el.children || []).map(findPill).find(Boolean));
  const pill = findPill((await renderView(desktop, "crisp-launchpad-view")).view.contentEl);
  assert.ok(pill && !pill.allText().includes("DSH"), "内核胶囊不应出现 DSH 字样");

  /* 移动端 → 只读（不是「缺失」，因为移动端本来就不跑内核命令） */
  const mobile = await makePlugin({ mobile: true });
  text = (await renderView(mobile, "crisp-launchpad-view")).view.contentEl.children[0].allText();
  assert.ok(text.includes("移动端只读"), `移动端应显示「移动端只读」，实际：${text.slice(0, 80)}`);
  assert.ok(!text.includes("内核缺失"), "移动端不应被判为内核缺失");

  /* 桌面但库内没有内核文件 → 缺失 */
  const bare = await makePlugin({ desktop: true });
  delete bare.app.vault.adapter.exists;
  bare.app.vault.adapter.exists = async () => false;
  text = (await renderView(bare, "crisp-launchpad-view")).view.contentEl.children[0].allText();
  assert.ok(text.includes("内核缺失"), "库内无 Sidecar/bin/anks 时应显示「内核缺失」");

  /* 陌生库形态整条不渲染 */
  const stranger = await makePlugin({ desktop: true });
  stranger.settings.workspaceMode = "actions-only";
  text = (await renderView(stranger, "crisp-launchpad-view")).view.contentEl.children[0].allText();
  assert.ok(!text.includes("内核"), "仅行动形态不应出现内核胶囊");
});

test("冒烟：onload 的注册面齐全（视图 / 命令 / ribbon / 协议）", async () => {
  const plugin = await makePlugin({});
  assert.equal(plugin._views.size, 2, "应注册启动台与行动面板 2 个视图（Now 看板已删除）");
  assert.ok(plugin._commands.length >= 6, `命令数偏少：${plugin._commands.length}`);
  assert.equal(plugin._ribbons.length, 1, "应只注册启动台 1 个 ribbon 图标（Now 看板已删除）");
  plugin._commands.forEach((cmd) => {
    assert.ok(cmd.id && cmd.name, "命令必须有 id 与 name");
    assert.equal(typeof cmd.callback, "function", `命令 ${cmd.id} 缺少 callback`);
  });
});

// Failure modes: stale equal counts hide edits/date rollover; stale nonzero counts
// resurrect deleted tasks; CLI-off delete/rename never reaches a render.
test("实时行动链路：相同数量的旧快照不能覆盖 Tempo 的标题和分组", async () => {
  const snapshots = makeSnapshots();
  snapshots.actions.counts = { overdue: 1, today: 0, waiting: 0, upcoming: 0, anytime: 0 };
  snapshots.actions.groups = [{ id: "overdue", items: [{ title: "旧标题", bucket: "overdue" }] }];
  const plugin = await makePlugin({
    desktop: true,
    snapshots,
    tempoTasks: [{ id: "n", title: "新标题", status: "todo", bucket: "upcoming", dueDate: "2099-01-01" }],
  });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  const text = view.contentEl.allText();
  assert.ok(text.includes("新标题"));
  assert.ok(!text.includes("旧标题"));
  assert.ok(text.includes("实时活数据"));
});

// Failure mode: the load badge must follow live Tempo counts (not stale snapshot
// counts) while taking the limit from the snapshot's wip_limit-derived load.
test("行动台负荷：今天 + 逾期超过 wip 上限时显示警示徽章", async () => {
  const snapshots = makeSnapshots();
  snapshots.actions.load = { active: 0, overdue: 0, limit: 1, state: "ok" };
  const plugin = await makePlugin({
    desktop: true,
    snapshots,
    tempoTasks: [
      { id: "a", title: "甲", status: "todo", bucket: "overdue", dueDate: "2000-01-01" },
      { id: "b", title: "乙", status: "todo", bucket: "overdue", dueDate: "2000-01-02" },
      { id: "c", title: "以后", status: "todo", bucket: "upcoming", dueDate: "2099-01-01" },
    ],
  });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  const find = (el) => (el.textContent === "负荷 2/1" ? el : el.children.map(find).find(Boolean));
  const badge = find(view.contentEl);
  assert.ok(badge, "应显示「负荷 2/1」徽章");
  assert.ok(badge.classes.has("is-warning"), "超过上限时徽章应为警示态");
});

test("行动台负荷：快照没有 load 时按默认上限 5 显示", async () => {
  const plugin = await makePlugin({
    desktop: true,
    tempoTasks: [{ id: "a", title: "甲", status: "todo", bucket: "overdue", dueDate: "2000-01-01" }],
  });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  assert.ok(view.contentEl.allText().includes("负荷 1/5"));
});

// Failure mode: without Tempo the dashboard must explain where actions went instead of
// rendering an empty board (or throwing), and the panel must still render.
test("没有 Tempo 时行动台显示提示，启动台和面板都不抛异常", async () => {
  const plugin = await makePlugin({ desktop: true, tempoTasks: null });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  const text = view.contentEl.allText();
  assert.ok(text.includes("行动由 Crisp Tempo 管理"), "应提示启用并激活 Tempo");
  assert.ok(text.includes("未连接 Tempo"));
  const panel = await renderView(plugin, "crisp-launchpad-panel-view");
  assert.ok(panel.view.contentEl.children[0], "面板应能渲染");
});
