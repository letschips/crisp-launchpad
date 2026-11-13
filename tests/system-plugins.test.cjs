const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

if (typeof window === "undefined") global.window = global;
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") {
    class Stub {}
    const Platform = { isMobile: false };
    return { Plugin: Stub, ItemView: Stub, PluginSettingTab: Stub, Setting: Stub, Notice: Stub, Modal: Stub, TFile: Stub, TFolder: Stub, Platform, setIcon() {}, addIcon() {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const lp = require("../main.js");
Module._load = originalLoad;

test("版本比较按数字段比，不按字符串", () => {
  assert.equal(lp.compareVersions("1.10.0", "1.9.3"), 1);
  assert.equal(lp.compareVersions("v0.12.1", "0.12.1"), 0);
  assert.equal(lp.compareVersions("0.2.0", "0.12.0"), -1);
  assert.equal(lp.compareVersions("1.2", "1.2.0"), 0);
  assert.equal(lp.compareVersions("beta", "1.0.0"), null);
});

test("只有比本地新的 Release 才算可更新；按 Release 附件核对文件", () => {
  const release = lp.parseCrispRelease({ tag_name: "1.50.0", html_url: "https://github.com/letschips/crisp-pulse/releases/tag/1.50.0", assets: [{ name: "main.js" }, { name: "manifest.json" }, { name: "styles.css" }, { name: "notes.txt" }] });
  assert.deepEqual(release.assets, ["main.js", "manifest.json", "styles.css"]);
  const older = lp.crispPluginStatus({ id: "crisp-pulse", manifest: { name: "Crisp Pulse", version: "1.49.0" }, files: new Set(["main.js", "manifest.json"]), release });
  assert.equal(older.hasUpdate, true);
  assert.equal(older.latest, "1.50.0");
  assert.deepEqual(older.missing, ["styles.css"]);
  const newer = lp.crispPluginStatus({ id: "crisp-pulse", manifest: { version: "1.51.0" }, files: new Set(["main.js", "manifest.json", "styles.css"]), release });
  assert.equal(newer.hasUpdate, false);
  assert.deepEqual(newer.missing, []);
  assert.equal(lp.parseCrispRelease({ message: "Not Found" }), null);
});

test("离线或没查过：不判可更新，只要求 main.js 和 manifest.json", () => {
  const item = lp.crispPluginStatus({ id: "crisp-tempo", manifest: { version: "0.19.1" }, files: new Set(["main.js", "manifest.json"]), release: null });
  assert.equal(item.hasUpdate, false);
  assert.equal(item.latest, "");
  assert.deepEqual(item.missing, []);
  const broken = lp.crispPluginStatus({ id: "crisp-tempo", manifest: { version: "0.19.1" }, files: new Set(["manifest.json"]) });
  assert.deepEqual(broken.missing, ["main.js"]);
});

test("缓存：成功 12 小时内、失败 1 小时内不再请求", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  assert.equal(lp.crispReleaseCacheDue({}, now), true);
  assert.equal(lp.crispReleaseCacheDue({ checkedAt: now - 2 * 3600e3 }, now), false);
  assert.equal(lp.crispReleaseCacheDue({ checkedAt: now - 13 * 3600e3 }, now), true);
  assert.equal(lp.crispReleaseCacheDue({ checkedAt: now - 13 * 3600e3, attemptAt: now - 600e3 }, now), false);
  assert.equal(lp.crispReleaseCacheDue({ attemptAt: now - 2 * 3600e3 }, now), true);
});

test("私有插件不列", () => {
  assert.deepEqual(lp.crispPluginIds({ "crisp-quest": {}, "crisp-pulse": {}, "dataview": {}, "crisp-tempo": {} }), ["crisp-pulse", "crisp-tempo"]);
});

test("授权只读公开状态，读不到返回 null，出错不抛", () => {
  assert.equal(lp.readCrispLicense({ isEntitled: () => true }), true);
  assert.equal(lp.readCrispLicense({ isLicensed: () => false }), false);
  assert.equal(lp.readCrispLicense({ licensed: true }), true);
  assert.equal(lp.readCrispLicense({ licenseManager: { isEntitled() { return this === undefined ? null : true; } } }), true);
  assert.equal(lp.readCrispLicense({ isEntitled: () => { throw new Error("x"); } }), null);
  assert.equal(lp.readCrispLicense({ settings: { licenseCode: "SECRET" } }), null);
  assert.equal(lp.readCrispLicense(null), null);
});

test("诊断信息不含授权码、路径和笔记内容", () => {
  const plugin = { settings: { licenseCode: "CRISP-SECRET-CODE-123" }, licenseCode: "CRISP-SECRET-CODE-123", isEntitled: () => true };
  const items = [
    lp.crispPluginStatus({ id: "crisp-pulse", manifest: { version: "1.49.0", dir: ".obsidian/plugins/crisp-pulse" }, enabled: true, files: new Set(["main.js", "manifest.json"]), release: { tag: "1.50.0", url: "u", assets: ["main.js", "manifest.json", "styles.css"] }, licensed: lp.readCrispLicense(plugin) }),
    lp.crispPluginStatus({ id: "crisp-tempo", manifest: { version: "0.19.1" }, enabled: false, files: new Set(["main.js", "manifest.json"]) }),
  ];
  const health = { generated_at: "2026-11-13T10:00:00Z", data: { status: "warning", counts: { blocking: 0, operational: 3 }, findings: [{ path: "Topics/self-media/raw/inbox/私密笔记.md", message: "私密内容" }] } };
  const text = lp.buildCrispDiagnostics({ obsidianVersion: "1.15.0", platform: "macOS", items, health, checkedAt: Date.parse("2026-11-13T09:00:00Z"), now: Date.parse("2026-11-13T12:00:00Z") });
  assert.match(text, /Obsidian 1\.15\.0 · macOS/);
  assert.match(text, /crisp-pulse 1\.49\.0（最新 1\.50\.0） · 已激活 · 缺 styles\.css/);
  assert.match(text, /crisp-tempo 0\.19\.1 · 未启用 · 文件齐全/);
  assert.match(text, /ANKS 体检：warning · 阻塞 0 · 待办 3/);
  for (const secret of ["CRISP-SECRET-CODE-123", "私密", "Topics/", ".obsidian"]) assert.ok(!text.includes(secret), secret);
  assert.match(lp.buildCrispDiagnostics({ items: [] }), /ANKS 体检：无快照/);
  assert.match(lp.buildCrispDiagnostics({ items: [] }), /版本检查：未检查/);
});
