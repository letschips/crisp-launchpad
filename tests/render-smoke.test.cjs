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

function makeApp({ desktop = false, pages = makePages(), snapshots = makeSnapshots(), tempoTasks = TEMPO_TASKS, extraPlugins = {} } = {}) {
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
      _events: [],
      on(name) { this._events.push(name); return {}; },
    },
    commands: { executeCommandById: () => true, findCommand: () => ({}) },
    plugins: {
      enabledPlugins: new Set(["crisp-dsh", "crisp-launchpad", ...(tempoTasks ? ["crisp-tempo"] : []), ...Object.keys(extraPlugins)]),
      plugins: { ...(tempoTasks ? { "crisp-tempo": fakeTempo(tempoTasks) } : {}), ...extraPlugins },
    },
    internalPlugins: { getEnabledPluginById: () => null },
  };
}

async function makePlugin({ desktop = false, mobile = false, pages, snapshots, tempoTasks, extraPlugins } = {}) {
  mock.Platform.isMobile = mobile;
  const plugin = new api();
  plugin.app = makeApp({ desktop, pages, snapshots, tempoTasks, extraPlugins });
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
  // Visit each page: lazy tabs must still exercise every render path.
  if (viewType === "crisp-launchpad-view") {
    const root = view.contentEl.children[0];
    const tabs = root.children.find(child => child.classes.has("launchpad-tabs"));
    for (const button of tabs?.children || []) {
      for (const click of button.listeners.click || []) click();
    }
  }
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

test("冒烟：行动面板「今天」页签显示临近截止的倒计时，并标出 3 天内的", async () => {
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const plugin = await makePlugin({ tempoTasks: [
    { id: "a", title: "后天交", status: "todo", bucket: "upcoming", dueDate: day(2) },
    { id: "b", title: "下周交", status: "todo", bucket: "upcoming", dueDate: day(6) },
    { id: "c", title: "很久以后", status: "todo", bucket: "upcoming", dueDate: day(30) },
    { id: "d", title: "今天交", status: "todo", bucket: "today", dueDate: day(0) },
    { id: "e", title: "今天做明天交", status: "todo", bucket: "today", dueDate: day(1) },
    { id: "f", title: "拖了两天", status: "todo", bucket: "overdue", dueDate: day(-2) },
  ] });
  const { view } = await renderView(plugin, "crisp-launchpad-panel-view");
  const find = (el, cls) => (el.classes?.has(cls) ? [el] : []).concat(...(el.children || []).map((c) => find(c, cls)));
  const [section] = find(view.contentEl, "crisp-panel-deadlines");
  assert.ok(section, "今天页签应有「临近截止」分区");
  const text = section.allText();
  assert.match(text, /未来 7 天 · 2 条/);
  assert.ok(text.indexOf("后天交") < text.indexOf("下周交"), "按剩余天数排序");
  assert.ok(!text.includes("很久以后") && !text.includes("今天交"));
  const pills = find(section, "crisp-panel-countdown");
  assert.deepEqual(pills.map((p) => p.textContent), ["还剩 2 天", "还剩 6 天"]);
  assert.deepEqual(pills.map((p) => p.classes.has("is-soon")), [true, false]);
  /* 上面「今天要做」里的行动也带倒计时，逾期单独一种颜色；已经列在上面的不在「临近截止」里重复。 */
  assert.ok(!text.includes("今天做明天交"));
  const all = find(view.contentEl, "crisp-panel-countdown");
  const byText = Object.fromEntries(all.map((p) => [p.textContent, p]));
  assert.deepEqual(Object.keys(byText).sort(), ["今天截止", "明天截止", "还剩 2 天", "还剩 6 天", "逾期 2 天"].sort());
  assert.ok(byText["逾期 2 天"].classes.has("is-overdue") && !byText["逾期 2 天"].classes.has("is-soon"));
  assert.ok(byText["今天截止"].classes.has("is-soon"));
});

test("冒烟：没有临近截止的行动时，行动面板不留空分区", async () => {
  const plugin = await makePlugin({ tempoTasks: [{ id: "a", title: "随时做", status: "todo", bucket: "anytime" }] });
  const { view } = await renderView(plugin, "crisp-launchpad-panel-view");
  const find = (el, cls) => (el.classes?.has(cls) ? [el] : []).concat(...(el.children || []).map((c) => find(c, cls)));
  assert.equal(find(view.contentEl, "crisp-panel-deadlines").length, 0);
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
  // 0.6.0：读的是 Tempo 实时数据时不再挂「实时活数据」徽章，只在退回快照时提示。
  assert.ok(!text.includes("实时活数据"));
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

/* ==========================================================================
   0.6.0 第一期：卡片体系、今天一行、行动台分段、中文状态
   ========================================================================== */

function findAll(el, predicate, out = []) {
  if (predicate(el)) out.push(el);
  for (const child of el.children || []) findAll(child, predicate, out);
  return out;
}

function fakePulse(snapshot) {
  return {
    pulseStateApiVersion: 1,
    async getTodaySnapshot() {
      if (snapshot instanceof Error) throw snapshot;
      return snapshot;
    },
  };
}

function tempoWithCompleted(count) {
  return { ...fakeTempo(TEMPO_TASKS), async getCompletedToday() { return { date: "2026-09-20", count }; } };
}

function todayStrip(view) {
  return findAll(view.contentEl, (el) => el.classes?.has("launchpad-today-strip"))[0] || null;
}

function stripLabels(strip) {
  return findAll(strip, (el) => el.classes?.has("launchpad-today-label")).map((el) => el.textContent);
}

test("今天一行：Pulse 和 Tempo 都在时显示分数、连续、速记待处理和今天完成", async () => {
  const plugin = await makePlugin({
    desktop: true,
    extraPlugins: {
      "crisp-pulse": fakePulse({ apiVersion: 1, date: "2026-09-20", score: 42.5, streak: 3, active: true, memos: { today: 4, pending: 2 } }),
      "crisp-tempo": tempoWithCompleted(5),
    },
  });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  const strip = todayStrip(view);
  assert.ok(strip, "今天页应有今天一行");
  const labels = stripLabels(strip);
  for (const label of ["行动", "已完成", "贡献分", "连续", "速记待处理", "待整理"]) {
    assert.ok(labels.includes(label), `今天一行缺少「${label}」：${labels.join("、")}`);
  }
  const text = strip.allText();
  assert.ok(text.includes("42.5") && text.includes("5") && text.includes("2"), text);
});

// Failure mode: a missing or broken neighbour must not show up as a zero, and must not break the page.
test("今天一行：没有 Pulse、Pulse 抛错或速记读不到时不显示对应项，也不当成 0", async () => {
  const cases = [
    ["无 Pulse", {}],
    ["Pulse 抛错", { "crisp-pulse": fakePulse(new Error("boom")) }],
    ["速记为 null", { "crisp-pulse": fakePulse({ apiVersion: 1, score: 1, streak: 0, memos: null }) }],
  ];
  for (const [name, extraPlugins] of cases) {
    const plugin = await makePlugin({ desktop: true, extraPlugins });
    const { view } = await renderView(plugin, "crisp-launchpad-view");
    const labels = stripLabels(todayStrip(view));
    assert.ok(!labels.includes("速记待处理"), `${name}：不应显示速记待处理`);
    if (name !== "速记为 null") assert.ok(!labels.includes("贡献分"), `${name}：不应显示贡献分`);
    assert.ok(labels.includes("行动"), `${name}：Tempo 在时仍应显示行动`);
    assert.ok(!labels.includes("已完成"), `${name}：Tempo 没有 getCompletedToday 时不显示已完成`);
  }
  const noTempo = await makePlugin({ desktop: true, tempoTasks: null });
  const labels = stripLabels(todayStrip((await renderView(noTempo, "crisp-launchpad-view")).view));
  assert.ok(!labels.includes("行动"), "没有 Tempo 时不显示行动数");
});

test("卡片体系：每张卡片的内容都在内层面板里，卡片头之外不留散落元素", async () => {
  const plugin = await makePlugin({ desktop: true });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  const cards = findAll(view.contentEl, (el) => el.classes?.has("launchpad-card"));
  assert.ok(cards.length >= 10, `卡片数偏少：${cards.length}`);
  for (const card of cards) {
    const stray = card.children.filter((child) => !child.classes.has("launchpad-card-header") && !child.classes.has("launchpad-inset"));
    assert.equal(stray.length, 0, `卡片里有散落元素：${[...stray[0]?.classes || []].join(".")} ${card.allText().slice(0, 40)}`);
  }
});

test("中文状态：内容状态和系统问题级别在界面上显示中文", async () => {
  assert.equal(api.contentStatusLabel("draft"), "草稿");
  assert.equal(api.contentStatusLabel("parked"), "搁置");
  assert.equal(api.contentStatusLabel("Published"), "已发布");
  assert.equal(api.contentStatusLabel("deprecated"), "已废弃");
  assert.equal(api.contentStatusLabel("custom"), "custom");
  const plugin = await makePlugin({ desktop: true });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  const raw = findAll(view.contentEl, (el) => ["published", "draft", "reviewing", "blocking", "operational", "informational"].includes(el.textContent.trim()));
  assert.equal(raw.length, 0, `界面仍有英文状态：${raw.map((el) => el.textContent).join("、")}`);
  const text = view.contentEl.allText();
  assert.ok(!/\b(blocking|operational|informational)\b/.test(text), "系统级别不应显示英文");
});

test("行动台分段：默认看全部，点「等待」只列等待中的行动，数量和 Tempo 分桶一致", async () => {
  const plugin = await makePlugin({ desktop: true });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  const seg = findAll(view.contentEl, (el) => el.classes?.has("launchpad-action-seg"))[0];
  assert.ok(seg, "行动台应有分段控件");
  const buttons = seg.children;
  assert.equal(buttons[0].attrs["aria-selected"], "true", "默认选中「全部」");
  const waiting = buttons.find((button) => button.allText().startsWith("等待"));
  assert.ok(waiting && waiting.allText().includes("1"), `等待的数量应为 1：${waiting?.allText()}`);
  for (const click of waiting.listeners.click || []) click();
  assert.equal(waiting.attrs["aria-selected"], "true");
  const card = findAll(view.contentEl, (el) => el.classes?.has("launchpad-action-card"))[0];
  const text = findAll(card, (el) => el.classes?.has("launchpad-action-body-wrap"))[0].allText();
  assert.ok(text.includes("等回复") && !text.includes("今天要做的"), text);
  assert.equal(findAll(view.contentEl, (el) => el.classes?.has("launchpad-action-counts")).length, 0, "旧的六格计数应移除");
});

test("Pulse 状态变化时刷新视图", async () => {
  const plugin = await makePlugin({ desktop: true });
  assert.ok(plugin.app.workspace._events.includes("crisp-pulse:state"), "应监听 crisp-pulse:state");
});

/* ==========================================================================
   0.7.0 第二期：新建行动原地弹窗、计数口径、创作页、知识页
   ========================================================================== */

test("新建行动：Tempo 有 openQuickAddModal 时原地弹窗，不跳转；没有或返回 false 时退回命令", async () => {
  for (const [name, modal, expectCommand] of [
    ["新版 Tempo", async () => true, false],
    ["未激活", async () => false, true],
    ["旧版 Tempo", undefined, true],
  ]) {
    const tempo = { ...fakeTempo(TEMPO_TASKS), ...(modal ? { openQuickAddModal: modal } : {}) };
    let modalCalls = 0;
    if (modal) tempo.openQuickAddModal = async () => { modalCalls++; return modal(); };
    const plugin = await makePlugin({ desktop: true, extraPlugins: { "crisp-tempo": tempo } });
    const commands = [];
    plugin.app.commands.executeCommandById = (id) => { commands.push(id); return true; };
    await plugin.openNewAction();
    assert.equal(modalCalls, modal ? 1 : 0, `${name}：弹窗调用次数`);
    assert.deepEqual(commands, expectCommand ? ["crisp-tempo:quick-add-task"] : [], `${name}：命令`);
  }
});

function twoTopicPages() {
  return [
    ...makePages(),
    page("Topics/main-business/raw/inbox/scratch/客户需求.md", { type: "raw", routing_status: "needs-classification" }, Date.now() - 1 * DAY),
    page("Topics/main-business/knowledge/b.md", { type: "knowledge", title: "知识乙" }, Date.now() - 2 * DAY),
  ];
}

test("计数口径：待整理在今天一行、知识页 KPI 和待整理卡片是同一个全库数，KPI 写出各 Topic 分布", async () => {
  const plugin = await makePlugin({ desktop: true, pages: twoTopicPages() });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  const expected = api.summarizePages(twoTopicPages()).inbox.length;
  const stripItem = findAll(view.contentEl, (el) => el.classes?.has("launchpad-today-item") && el.allText().endsWith("待整理"))[0];
  assert.equal(stripItem.children[0].textContent, String(expected), "今天一行");
  const kpi = findAll(view.contentEl, (el) => el.classes?.has("launchpad-kpi-box") && el.children[0]?.textContent === "待整理")[0];
  assert.equal(kpi.children[1].textContent, String(expected), "知识页 KPI");
  assert.ok(kpi.children[2].textContent.includes("main-business") && kpi.children[2].textContent.includes("self-media"), kpi.children[2].textContent);
  const card = findAll(view.contentEl, (el) => el.classes?.has("launchpad-inbox-card"))[0];
  assert.ok(card, "知识页应有待整理卡片");
  assert.ok(card.allText().includes(`${expected} 条`), card.allText());
  assert.ok(card.allText().includes("客户需求"), "卡片应包含其他 Topic 的材料");
});

test("计数口径：超过 3 天的积压和待整理分开命名", async () => {
  const plugin = await makePlugin({ desktop: true });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  const text = view.contentEl.allText();
  assert.ok(text.includes("超过 3 天未整理"), "应使用「超过 3 天未整理」");
  assert.ok(!text.includes("收件箱待检查") && !text.includes("收件箱积压"), "旧标签应移除");
});

test("创作页：分段条每段带阶段名和数量，项目行显示几天未动，发布前阶段久未动标警示", async () => {
  const pages = [
    ...makePages(),
    page("Topics/self-media/content-projects/WECHAT-20260901-OLD/article.md", { type: "output", content_role: "article", title: "久未动", stage: "drafting", status: "draft" }, Date.now() - 30 * DAY),
  ];
  const plugin = await makePlugin({ desktop: true, pages });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  const legend = findAll(view.contentEl, (el) => el.classes?.has("launchpad-flow-legend-item"));
  assert.ok(legend.length >= 2, `图例项过少：${legend.length}`);
  assert.ok(legend.some((el) => el.allText().includes("起草中") && el.allText().includes("1")), legend.map((el) => el.allText()).join(" / "));
  const ages = findAll(view.contentEl, (el) => el.classes?.has("launchpad-stuck-days"));
  const old = ages.find((el) => el.textContent.startsWith("30 天"));
  assert.ok(old, `应显示 30 天未动：${ages.map((el) => el.textContent).join("、")}`);
  assert.ok(old.classes.has("is-warning"), "发布前阶段 30 天未动应为警示");
});

test("知识页：活动卡片叫「近 7 天更新」，没有类型的写「未标类型」", async () => {
  const pages = [...makePages(), page("Topics/self-media/notes/无类型.md", {}, Date.now() - 1 * DAY)];
  const plugin = await makePlugin({ desktop: true, pages });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  const text = view.contentEl.allText();
  assert.ok(text.includes("近 7 天更新"));
  assert.ok(!text.includes("本周知识库活动"));
  assert.ok(text.includes("未标类型") && !text.includes("（无 type）"));
});

// Failure mode: after a plugin update the old Launchpad tab is still being restored when
// onLayoutReady runs, so getLeavesOfType is empty and a second Launchpad tab was opened.
test("打开启动台：原标签还在恢复中时复用它，不新开第二个", async () => {
  const plugin = await makePlugin({ desktop: true });
  let created = 0;
  let revealed = null;
  const restoring = { getViewState: () => ({ type: "crisp-launchpad-view" }) };
  plugin.app.workspace.getLeavesOfType = () => [];
  plugin.app.workspace.iterateAllLeaves = (fn) => { fn({ getViewState: () => ({ type: "markdown" }) }); fn(restoring); };
  plugin.app.workspace.getLeaf = () => { created++; return { setViewState: async () => {} }; };
  plugin.app.workspace.revealLeaf = (leaf) => { revealed = leaf; };
  await plugin.activateView();
  assert.equal(created, 0, "不应新开标签");
  assert.equal(revealed, restoring, "应显示原来的标签");
});

/* ==========================================================================
   0.8.0 第三期：复盘页节奏读 Pulse、系统问题按类型归组
   ========================================================================== */

function pulseWithDays() {
  return {
    pulseStateApiVersion: 1,
    async getTodaySnapshot() { return { apiVersion: 1, score: 3, streak: 2, memos: null }; },
    async getRecentDays(days) {
      const out = [];
      for (let i = 0; i < days; i++) {
        const recorded = i % 3 !== 0;
        out.push({ date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`, recorded, active: recorded && i % 2 === 0, score: recorded ? i : null, focusMinutes: recorded ? 30 : null, tasksCompleted: recorded ? 1 : null });
      }
      return { apiVersion: 1, scope: "reliable", streak: 2, days: out };
    },
  };
}

async function openTab(view, name) {
  const tabs = findAll(view.contentEl, (el) => el.classes?.has("launchpad-tabs"))[0];
  const button = tabs.children.find((b) => b.textContent === name);
  for (const click of button.listeners.click || []) click();
}

test("复盘页：旧的文件修改热力图去掉，改为 Pulse 每日节奏；未记录的日子是虚柱；可切 7/30/90 天", async () => {
  const plugin = await makePlugin({ desktop: true, extraPlugins: { "crisp-pulse": pulseWithDays() } });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  assert.equal(findAll(view.contentEl, (el) => el.classes?.has("launchpad-heat-cell")).length, 0, "旧热力图应移除");
  assert.ok(!view.contentEl.allText().includes("系统节奏"));
  const card = findAll(view.contentEl, (el) => el.classes?.has("launchpad-pulse-rhythm"))[0];
  assert.ok(card, "应有近期节奏卡片");
  const bars = () => findAll(card, (el) => el.classes?.has("launchpad-pulse-bar"));
  assert.equal(bars().length, 30, "默认 30 天");
  assert.equal(bars().filter((b) => b.classes.has("is-missing")).length, 10, "每 3 天 1 天未记录");
  const text = card.allText();
  assert.ok(text.includes("10 / 20") && text.includes("2 天"), text);
  const seg = findAll(card, (el) => el.classes?.has("launchpad-seg"))[0];
  const seven = seg.children.find((b) => b.allText().startsWith("7"));
  for (const click of seven.listeners.click || []) click();
  assert.equal(bars().length, 7);
});

test("复盘页：没有 Pulse 或 Pulse 太旧时只显示提示，不画假数据", async () => {
  for (const extraPlugins of [{}, { "crisp-pulse": { async getTodaySnapshot() { return { score: 1, streak: 0 }; } } }]) {
    const plugin = await makePlugin({ desktop: true, extraPlugins });
    const { view } = await renderView(plugin, "crisp-launchpad-view");
    const card = findAll(view.contentEl, (el) => el.classes?.has("launchpad-pulse-rhythm"))[0];
    assert.ok(card, "卡片仍在");
    assert.equal(findAll(card, (el) => el.classes?.has("launchpad-pulse-bar")).length, 0);
    assert.ok(card.allText().includes("Crisp Pulse"), card.allText());
  }
});

test("系统页：问题按类型归组，阻塞在前且默认展开，已知代码显示中文，有去处的组带入口", async () => {
  const plugin = await makePlugin({ desktop: true });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  const groups = findAll(view.contentEl, (el) => el.classes?.has("launchpad-finding-group"));
  assert.equal(groups.length, 3, "CONTRACT_ERROR / PENDING_WRITEBACK / STALE_INBOX 三组");
  const head = (g) => findAll(g, (el) => el.classes?.has("launchpad-finding-group-head"))[0].allText();
  assert.ok(head(groups[0]).includes("CONTRACT_ERROR") && head(groups[0]).includes("阻塞"), head(groups[0]));
  assert.ok(groups[0].classes.has("is-open"), "阻塞组默认展开");
  assert.ok(head(groups[1]).includes("待回写") && head(groups[1]).includes("2"), head(groups[1]));
  assert.ok(!groups[1].classes.has("is-open"), "待办组默认收起");
  const stale = groups.find((g) => head(g).includes(STALE_LABEL));
  const go = findAll(stale, (el) => el.tagName === "button" && el.textContent === "去整理")[0];
  assert.ok(go, "超过 3 天未整理组应有「去整理」");
  for (const click of go.listeners.click || []) click({ stopPropagation() {} });
  const active = findAll(view.contentEl, (el) => el.classes?.has("launchpad-tab") && el.classes.has("is-active"))[0];
  assert.equal(active.textContent, "知识");
  const rows = findAll(groups[1], (el) => el.classes?.has("launchpad-finding-row"));
  assert.ok(rows.length && !rows[0].allText().includes("Topics/self-media/outputs/content/published/公众号/待回写甲.md Topics"), "路径不重复");
});
const STALE_LABEL = "超过 3 天未整理";

/* ==========================================================================
   速记归 Pulse：速记日文件不算待整理；今天一行和待你判断读近 7 天没去处的速记
   ========================================================================== */

function pulseWithBacklog(calls) {
  return {
    pulseStateApiVersion: 1,
    async getTodaySnapshot() { return { apiVersion: 1, score: 1, streak: 1, memos: { today: 1, pending: 1 } }; },
    async getMemoBacklog(days) { return { apiVersion: 1, days, from: "2026-09-14", to: "2026-09-20", total: 9, pending: 6 }; },
    async openMemoQuery(query) { calls.push(query); },
  };
}

test("速记：Pulse 速记日文件不算待整理", async () => {
  const pages = [...makePages(), page("Topics/self-media/raw/inbox/scratch/2026-09-01 速记.md", { type: "raw", capture_type: "pulse-memo" }, Date.now() - 20 * DAY)];
  const summary = api.summarizePages(pages);
  assert.ok(!summary.inbox.some((p) => p.path.endsWith("速记.md")), "速记日文件不应进待整理");
  assert.equal(summary.inbox.length, api.summarizePages(makePages()).inbox.length);
  assert.ok(!api.inboxTriageItems(pages, 99).some((p) => p.path.endsWith("速记.md")), "侧栏待整理也不算速记日文件");
});

test("速记：今天一行和待你判断显示近 7 天没去处的速记，点开 Pulse 速记面板并带上筛选", async () => {
  const calls = [];
  const plugin = await makePlugin({ desktop: true, extraPlugins: { "crisp-pulse": pulseWithBacklog(calls) } });
  const { view } = await renderView(plugin, "crisp-launchpad-view");
  await openTab(view, "今天");
  const item = findAll(view.contentEl, (el) => el.classes?.has("launchpad-today-item") && el.allText().endsWith("速记待处理"))[0];
  assert.equal(item.children[0].textContent, "6");
  for (const click of item.listeners.click || []) click();
  const row = findAll(view.contentEl, (el) => el.classes?.has("launchpad-judge-row") && el.allText().includes("速记"))[0];
  assert.ok(row && row.allText().includes("6"), "待你判断应有速记一行");
  for (const click of row.listeners.click || []) click();
  assert.deepEqual(calls, [{ from: "2026-09-14", to: "2026-09-20", converted: false }, { from: "2026-09-14", to: "2026-09-20", converted: false }]);
});
