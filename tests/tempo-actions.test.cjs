// Crisp Tempo is the only action source (docs/ROLE-CONTRACT.md; Now/ was removed 2026-11-03).
// Failure modes:
// - Launchpad shows tasks from an unactivated Tempo, so "生成下一批行动" silently fails;
// - a Tempo read error throws instead of showing the "connect Tempo" state;
// - new actions get written somewhere other than Tempo, or get a source id Tempo rejects;
// - clicking the same review button twice in a day creates duplicate Tempo tasks.
const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

if (typeof window === "undefined") global.window = global;
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") {
    class Base {}
    const Platform = { isMobile: false };
    return { Plugin: Base, ItemView: Base, PluginSettingTab: Base, Setting: Base, Notice: Base, Modal: Base, TFile: Base, TFolder: Base, Platform, setIcon() {}, addIcon() {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const launchpad = require("../main.js");
Module._load = originalLoad;
const proto = launchpad.prototype;

// Same pattern as Tempo's src/services/source-tasks.ts SOURCE_ID_RE.
const TEMPO_SOURCE_ID_RE = /^[a-z0-9-]+:[A-Za-z0-9-]{1,128}$/;

function fakePlugin(tempo) {
  const created = [];
  const plugin = Object.create(proto);
  plugin.app = {
    plugins: {
      enabledPlugins: new Set(tempo ? ["crisp-tempo"] : []),
      plugins: tempo ? { "crisp-tempo": tempo } : {},
    },
  };
  plugin.app.vault = {
    create: async (path) => created.push(path),
    modify: async (file) => created.push(file?.path),
    process: async (file) => created.push(file?.path),
  };
  return { plugin, created };
}

function fakeTempo({ licensed = true, fail = false, version = 1 } = {}) {
  const calls = [];
  return {
    calls,
    actionsApiVersion: version,
    async getActionOverview() {
      if (fail) throw new Error("Tempo data could not be loaded");
      return {
        apiVersion: 1,
        date: "2026-11-03",
        licensed,
        tasks: [
          { id: "t1", title: "写周报", status: "todo", bucket: "today", focusDate: "2026-11-03", projectTitle: "ANKS" },
          { id: "t2", title: "已完成", status: "done", bucket: "done", completedAt: Date.now() },
        ],
      };
    },
    async createTaskFromSource(input) {
      calls.push(input);
      return { id: "new", sourceId: input.sourceId, title: input.title, status: "todo" };
    },
    async revealTask() {},
  };
}

test("an activated Tempo is the action source", async () => {
  const { plugin } = fakePlugin(fakeTempo());
  const tasks = await plugin.readActions();
  assert.equal(plugin.actionSource, "tempo");
  assert.deepEqual(tasks.map((task) => [task.title, task.bucket, task.done, task.source]), [
    ["写周报", "today", false, "tempo"],
    ["已完成", "done", true, "tempo"],
  ]);
  assert.equal(tasks[0].project, "ANKS");
});

test("without a usable Tempo there are no actions, and new actions are refused instead of written elsewhere", async () => {
  for (const tempo of [null, fakeTempo({ licensed: false }), fakeTempo({ version: 0 }), fakeTempo({ fail: true })]) {
    const { plugin, created } = fakePlugin(tempo);
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      assert.deepEqual(await plugin.readActions(), []);
      assert.equal(plugin.actionSource, "none");
      if (!tempo || tempo.actionsApiVersion < 1) {
        await assert.rejects(plugin.createAction({ text: "x" }), /Crisp Tempo/);
      }
      assert.deepEqual(created, []);
    } finally {
      console.warn = originalWarn;
    }
  }
});
test("new actions go to Tempo with a valid, same-day-stable source id", async () => {
  const tempo = fakeTempo();
  const { plugin, created } = fakePlugin(tempo);
  await plugin.readActions();
  await plugin.createAction({ text: "处理「速记 A」", project: "收件箱", link: "Topics/self-media/raw/inbox/scratch/a.md" });
  await plugin.createAction({ text: "处理「速记 A」", project: "收件箱", link: "Topics/self-media/raw/inbox/scratch/a.md" });
  assert.deepEqual(created, []);
  assert.equal(tempo.calls.length, 2);
  const [first, second] = tempo.calls;
  assert.match(first.sourceId, TEMPO_SOURCE_ID_RE);
  assert.ok(first.sourceId.startsWith("crisp-launchpad:"));
  assert.equal(first.sourceId, second.sourceId);
  assert.equal(first.title, "处理「速记 A」");
  assert.equal(first.notePath, "Topics/self-media/raw/inbox/scratch/a.md");
  assert.notEqual(
    launchpad.launchpadActionSourceId("处理「速记 A」", "2026-11-03"),
    launchpad.launchpadActionSourceId("处理「速记 A」", "2026-11-04"),
  );
});

// Tool entries (docs/ROLE-CONTRACT.md): only enabled plugins with a working command show up, so a
// Craft-package user without some plugin never sees a dead button.
test("tool entries list only enabled plugins whose command exists, and drop empty groups", () => {
  const enabled = new Set(["crisp-pulse", "crisp-search", "crisp-tempo"]);
  const commands = new Set(["crisp-pulse:quick-memo", "crisp-search:open"]);
  const groups = launchpad.availableCrispTools(enabled, (id) => commands.has(id));
  assert.deepEqual(
    groups.map((group) => [group.label, group.tools.map((tool) => tool.command)]),
    [["捕获", ["crisp-pulse:quick-memo"]], ["检索", ["crisp-search:open"]]],
  );
});

test("quick capture goes to Pulse when it is enabled, otherwise to Launchpad's own modal", () => {
  const ran = [];
  const plugin = Object.create(proto);
  plugin.openOwnCaptureModal = () => ran.push("launchpad");
  const commandSet = new Set(["crisp-pulse:quick-memo"]);
  plugin.app = {
    plugins: { enabledPlugins: new Set(["crisp-pulse"]) },
    commands: {
      findCommand: (id) => (commandSet.has(id) ? { id } : undefined),
      executeCommandById: (id) => (ran.push(id), commandSet.has(id)),
    },
  };
  plugin.openQuickCapture();
  plugin.app.plugins.enabledPlugins = new Set();
  plugin.openQuickCapture();
  assert.deepEqual(ran, ["crisp-pulse:quick-memo", "launchpad"]);
});
