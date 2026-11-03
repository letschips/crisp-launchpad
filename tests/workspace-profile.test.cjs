/* ==========================================================================
   工作台形态：能力探测与自动适配
   --------------------------------------------------------------------------
   为什么需要：这套界面原先把 self-media / content-projects / 微信模板路径写死在
   代码里，只有「和作者做同一件事」的用户能用。现在改为按**库的结构**探测能力，
   再把结果收敛成三种形态。这条测试钉住三件事：
     1. 探测只认结构、不认平台名（换任何 Topic / 平台都应工作）；
     2. 自动判定的优先级（内容 → 知识 → 仅行动）；
     3. 显式选择优先于自动，且非法值回落 auto。
   ========================================================================== */

const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

if (typeof window === "undefined") global.window = global;

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") {
    class P {}
    const Platform = { isMobile: false };
    return { Plugin: P, ItemView: P, PluginSettingTab: P, Setting: P, Notice: P, Modal: P,
      TFile: P, TFolder: P, Platform, setIcon() {}, addIcon() {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const launchpad = require("../main.js");
Module._load = originalLoad;

/* ---------- fixture：只给路径，不给平台名 ---------- */

/* 陌生库：什么都没有 */
const VANILLA = ["README.md", "Notes/随便一篇.md"];

/* 只有知识层：没有 content-projects、没有 templates、没有 profiles */
const KNOWLEDGE_ONLY = [
  "Topics/work/knowledge/项目管理.md",
  "Topics/work/knowledge/index.md",
  "Topics/work/raw/inbox/scratch/一条速记.md",
  "Topics/work/sources/官方文档.md",
  "Now/行动.md",
];

/* 有内容项目但没有流水线模板（用户自己建的目录） */
const CONTENT_NO_PIPELINE = [
  "Topics/marketing/content-projects/WECHAT-20260101-X/article.md",
  "Topics/marketing/content-projects/WECHAT-20260101-X/project.yaml",
  "Topics/marketing/raw/inbox/scratch/a.md",
  "Now/行动.md",
];

/* 完整 ANKS（结构与真实库一致，但 Topic 名换成别的，证明不认名字） */
const FULL_ANKS = [
  "Start Here.md",
  "AGENTS.md",
  "Now/行动.md",
  "Topics/studio/knowledge/概念甲.md",
  "Topics/studio/raw/inbox/scratch/a.md",
  "Topics/studio/content-projects/WECHAT-20260101-Y/article.md",
  "Topics/studio/content-projects/index.md",
  "Topics/studio/system/studio-pipeline/templates/content-project/project.yaml",
  "Topics/studio/system/studio-pipeline/templates/content-project/article.md",
  "Topics/studio/system/studio-pipeline/profiles/deep-essay.yaml",
  "Topics/studio/system/studio-pipeline/profiles/flash-news.yaml",
  "Topics/studio/system/studio-pipeline/profiles/nested/ignored.yaml",
  "Topics/studio/内容总览.base",
  "Topics/studio/内容大盘.md",
];

test("探测：只按结构判断，不认识平台名与 Topic 名", () => {
  const caps = launchpad.detectWorkspaceCapabilities(FULL_ANKS);
  assert.deepEqual(caps.topics, ["studio"], "Topic 名来自目录，不来自常量");
  const topic = caps.perTopic.studio;
  /* 平台 id 取自 system/<X>/templates/content-project/，因此换成 studio-pipeline 也识别 */
  assert.deepEqual(topic.platforms, ["studio-pipeline"]);
  assert.deepEqual(topic.profiles["studio-pipeline"], ["deep-essay", "flash-news"], "只收一层 yaml，忽略子目录");
  assert.equal(topic.hasContentProjects, true);
  assert.equal(topic.hasKnowledge, true);
  assert.equal(topic.hasInbox, true);
  assert.equal(topic.basePath, "Topics/studio/内容总览.base", "Base 按后缀探测，不写死文件名");
  assert.equal(topic.dashboardPath, "Topics/studio/内容大盘.md");
  assert.equal(caps.hasIndex, true);
});

test("探测：陌生库不臆造结构", () => {
  const caps = launchpad.detectWorkspaceCapabilities(VANILLA);
  assert.deepEqual(caps.topics, []);
  assert.deepEqual(caps.contentTopics, []);
  assert.deepEqual(caps.knowledgeTopics, []);
  assert.equal(caps.hasCli, false, "未显式告知时不得假定 CLI 存在");
  assert.equal(caps.hasSnapshots, false);
});

test("自动判定优先级：内容 → 知识 → 仅行动", () => {
  const auto = (paths, extra) => launchpad.resolveWorkspaceProfile(launchpad.detectWorkspaceCapabilities(paths, extra));

  assert.equal(auto(FULL_ANKS), "content-ops", "有流水线");
  assert.equal(auto(CONTENT_NO_PIPELINE), "content-ops", "只有 content-projects 也算内容运营");
  assert.equal(auto(KNOWLEDGE_ONLY), "knowledge", "有 knowledge/ 但无内容项目");
  assert.equal(auto(VANILLA), "actions-only", "什么都没有");
  /* 残留的 Now/ 目录不再算任何结构，仍是「仅行动」 */
  assert.equal(auto(VANILLA.concat("Now/行动.md")), "actions-only");
});

test("显式选择优先于自动，非法值回落 auto", () => {
  const caps = launchpad.detectWorkspaceCapabilities(FULL_ANKS);
  assert.equal(launchpad.resolveWorkspaceProfile(caps, "actions-only"), "actions-only");
  assert.equal(launchpad.resolveWorkspaceProfile(caps, "knowledge"), "knowledge");
  assert.equal(launchpad.resolveWorkspaceProfile(caps, "auto"), "content-ops");
  assert.equal(launchpad.resolveWorkspaceProfile(caps, "不存在的形态"), "content-ops", "非法值按 auto 处理");
});

test("形态决定页签集合，未知形态回落内容运营", () => {
  const ids = (profile) => launchpad.launchpadPages(profile).map((p) => p.id);

  assert.deepEqual(ids("content-ops"), ["today", "create", "knowledge", "review", "system"]);
  assert.deepEqual(ids("knowledge"), ["today", "knowledge", "review", "system"], "知识管理不出现创作页");
  assert.deepEqual(ids("actions-only"), ["today", "system"], "陌生库只留两页");
  assert.deepEqual(ids("不存在"), ids("content-ops"));

  /* 页签集合、页名映射与 features 必须自洽：有 create 页签才允许开 create 特写 */
  for (const [id, profile] of Object.entries(launchpad.LAUNCHPAD_PROFILES)) {
    const tabIds = profile.tabs;
    assert.equal(
      profile.features.create,
      tabIds.includes("create"),
      `${id}: features.create 必须与是否含 create 页签一致`,
    );
    assert.ok(profile.heroTitle, `${id}: 必须有 hero 标题`);
    assert.equal(typeof profile.features.workGrid, "boolean", `${id}: 必须显式声明 workGrid`);
    assert.equal(typeof profile.features.completionStats, "boolean", `${id}: 必须显式声明 completionStats`);
    assert.equal(typeof profile.features.kernelPill, "boolean", `${id}: 必须显式声明 kernelPill`);
    /* 指向 ANKS 对象层的卡片只在有该层的形态下渲染 */
    if (id === "actions-only") {
      assert.equal(profile.features.workGrid, false, "陌生库不应渲染 待整理/最近产出 卡");
      assert.equal(profile.features.completionStats, false, "陌生库不应渲染四条对象层 stat");
      assert.equal(profile.features.kernelPill, false, "陌生库不应显示内核胶囊（没有 ANKS 语境）");
    } else {
      assert.equal(profile.features.workGrid, true);
      assert.equal(profile.features.completionStats, true);
    }
    launchpad.launchpadPages(id).forEach((page) => assert.ok(page.name, `${id}: 页 ${page.id} 缺少名称`));
  }
});

test("KPI 卡的跳转目标按探测到的主 Topic 解析，不写死 self-media", () => {
  /* 用换名的 Topic 证明目标跟着库走 */
  const caps = launchpad.detectWorkspaceCapabilities(FULL_ANKS);
  assert.equal(launchpad.primaryTopic(caps), "studio", "优先内容 Topic");
  assert.equal(
    launchpad.resolveKpiTarget(launchpad.KPI_DEFINITIONS.inbox.path, caps),
    "Topics/studio/raw/inbox",
  );
  assert.equal(
    launchpad.resolveKpiTarget(launchpad.KPI_DEFINITIONS.projects.path, caps),
    "Topics/studio/content-projects/index.md",
  );
  /* 主 Topic 优先级：内容 → 知识 → 任意 → 兜底 */
  assert.equal(launchpad.primaryTopic(launchpad.detectWorkspaceCapabilities(KNOWLEDGE_ONLY)), "work");
  assert.equal(launchpad.primaryTopic({ topics: ["misc"] }), "misc");
  assert.equal(launchpad.primaryTopic({}), "self-media", "完全探测不到结构时才兜底");
  /* 占位符必须全部被替换，不能漏一个进到界面里 */
  for (const definition of Object.values(launchpad.KPI_DEFINITIONS)) {
    assert.ok(!launchpad.resolveKpiTarget(definition.path, caps).includes("{"), `${definition.label} 的路径占位符未解析`);
  }
});

test("形态决定显示哪些 KPI：没有内容流水线就不出现「内容项目」", () => {
  const setOf = (profile) => launchpad.LAUNCHPAD_PROFILES[profile].kpis;
  assert.ok(setOf("content-ops").includes("projects"));
  assert.ok(!setOf("knowledge").includes("projects"), "知识管理不该有内容项目 KPI");
  assert.deepEqual(setOf("actions-only"), ["active"], "陌生库只留与路径无关的那一项");
  /* 每一项都必须有定义，否则 renderKpis 会渲染 undefined */
  for (const profile of Object.keys(launchpad.LAUNCHPAD_PROFILES)) {
    for (const key of setOf(profile)) {
      assert.ok(launchpad.KPI_DEFINITIONS[key], `${profile} 引用了未定义的 KPI：${key}`);
    }
  }
});

test("探测容错：空数组、非字符串、重复路径都不抛异常", () => {
  assert.doesNotThrow(() => launchpad.detectWorkspaceCapabilities());
  assert.doesNotThrow(() => launchpad.detectWorkspaceCapabilities(null));
  const caps = launchpad.detectWorkspaceCapabilities([null, 42, "", "Topics/a/knowledge/x.md", "Topics/a/knowledge/y.md"]);
  assert.deepEqual(caps.topics, ["a"]);
  assert.equal(caps.perTopic.a.hasKnowledge, true);
});
