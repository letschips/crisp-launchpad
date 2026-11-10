/* ==========================================================================
   Crisp Launchpad - native ANKS launchpad for Obsidian
   ========================================================================== */

const {
  Plugin,
  ItemView,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  Platform,
  TFile,
  TFolder,
  setIcon,
  addIcon: registerIcon = (() => {}),
} = require("obsidian");

// Obsidian's Plugin.loadData() returns null for a missing data.json but undefined when the file exists
// and cannot be read or parsed (sync conflict, interrupted write), and Plugin.saveData() swallows write
// errors. These helpers keep such a file from being overwritten by defaults and make lost writes visible.

function dataSafetyStamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Copies an unreadable data.json aside. On "failed" the caller must not write data.json this session. */
async function preserveUnreadableData(adapter, dataPath, now = new Date()) {
  try {
    if (!adapter) throw new Error("vault adapter unavailable");
    if (!(await adapter.exists(dataPath))) return { state: "missing" };
    const backupPath = `${dataPath}.unreadable-${dataSafetyStamp(now)}`;
    await adapter.write(backupPath, await adapter.read(dataPath));
    return { state: "preserved", backupPath };
  } catch (error) {
    return { state: "failed", error };
  }
}


let execFile = null;
try {
  ({ execFile } = require("child_process"));
} catch (error) {
  execFile = null;
}

const CRISP_LAUNCHPAD_ICON_ID = "crisp-launchpad";
const CRISP_LAUNCHPAD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.1" fill="currentColor"/><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.1"><animate attributeName="r" calcMode="spline" dur="1.5s" keySplines=".2,.6,.35,1" repeatCount="indefinite" values="3.1;11"/><animate attributeName="opacity" calcMode="spline" dur="1.5s" keySplines=".2,.6,.35,1" repeatCount="indefinite" values=".9;0"/></circle><circle cx="12" cy="12" r="3.1"><animate attributeName="r" begin="-0.5s" calcMode="spline" dur="1.5s" keySplines=".2,.6,.35,1" repeatCount="indefinite" values="3.1;11"/><animate attributeName="opacity" begin="-0.5s" calcMode="spline" dur="1.5s" keySplines=".2,.6,.35,1" repeatCount="indefinite" values=".9;0"/></circle><circle cx="12" cy="12" r="3.1"><animate attributeName="r" begin="-1s" calcMode="spline" dur="1.5s" keySplines=".2,.6,.35,1" repeatCount="indefinite" values="3.1;11"/><animate attributeName="opacity" begin="-1s" calcMode="spline" dur="1.5s" keySplines=".2,.6,.35,1" repeatCount="indefinite" values=".9;0"/></circle></g></svg>`;
const CRISP_LAUNCHPAD_ICON_STATIC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.1" fill="currentColor"/><circle cx="12" cy="12" r="6.6" stroke="currentColor" stroke-width="1.8" opacity=".5"/><circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.5" opacity=".26"/></svg>`;

const CRISP_NOW_ICON_ID = "crisp-now";
const CRISP_NOW_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="3" fill="currentColor"/><g><circle cx="4" cy="12" r="3" fill="currentColor"/><circle cx="20" cy="12" r="3" fill="currentColor"/><animateTransform attributeName="transform" calcMode="spline" dur="1s" keySplines=".36,.6,.31,1;.36,.6,.31,1" repeatCount="indefinite" type="rotate" values="0 12 12;180 12 12;360 12 12"/></g></svg>`;
const CRISP_NOW_ICON_STATIC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="3"/><circle cx="4" cy="12" r="3"/><circle cx="20" cy="12" r="3"/></svg>`;

function prefersReducedMotion() {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches === true
    );
  } catch (error) {
    return false;
  }
}

function crispIconVariant(kind, reduced = prefersReducedMotion()) {
  if (kind === "now") {
    return reduced ? CRISP_NOW_ICON_STATIC : CRISP_NOW_ICON_SVG;
  }
  return reduced ? CRISP_LAUNCHPAD_ICON_STATIC : CRISP_LAUNCHPAD_ICON_SVG;
}

function crispRegisterIcons() {
  try {
    if (typeof registerIcon === "function") {
      const reduced = prefersReducedMotion();
      registerIcon(CRISP_LAUNCHPAD_ICON_ID, crispIconVariant("launchpad", reduced));
      registerIcon(CRISP_NOW_ICON_ID, crispIconVariant("now", reduced));
    }
  } catch (error) {
    console.warn("[Crisp Launchpad] Failed to register custom icons:", error);
  }
}
crispRegisterIcons();

const VIEW_TYPE_LAUNCHPAD = "crisp-launchpad-view";
const VIEW_TYPE_PANEL = "crisp-launchpad-panel-view";
const CONTENT_STAGES = [
  "intake",
  "brief",
  "research",
  "outline",
  "drafting",
  "fact-check",
  "style-check",
  "visual",
  "mobile-preview",
  "draft-box",
  "publish-ready",
  "reviewing",
  "distilled",
];
const CONTENT_STATUSES = ["draft", "parked", "published", "deprecated"];
const SNAPSHOT_ROOT = ".runtime/snapshot";
const TAB_KEY = "crisp-launchpad-tab";
const SYSTEM_DRAWER_KEY = "crisp-launchpad-system-drawer";
const RHYTHM_DAYS_KEY = "crisp-launchpad-rhythm-days";
const RHYTHM_DAY_OPTIONS = [7, 30, 90];
const AUTO_ROUTE_DEBOUNCE_MS = 1800;
const AUTO_ROUTE_COOLDOWN_MS = 2500;
const AUTO_HEALTH_REBUILD_MS = 90 * 1000;
const REVIEW_DONE_COOLDOWN_DAYS = 14;
const PULSE_PLUGIN_ID = "crisp-pulse";
/* ANKS health 的 STALE_INBOX：vault_sweeper 里未归位且超过 3 天的材料。和「待整理」（全部未归位）不是一个数。 */
const STALE_INBOX_LABEL = "超过 3 天未整理";
/* 发布前的阶段超过这么多天没动，项目行标警示色。 */
const STUCK_WARNING_DAYS = 14;
/* ANKS health 的问题代码在界面上的名字和去处；没列到的代码原样显示。 */
const FINDING_CODE_LABEL = {
  STALE_INBOX: STALE_INBOX_LABEL,
  ORPHAN_ASSET_OLD: "没有被引用的旧附件",
  ORPHAN_ASSET_RECENT: "没有被引用的新附件",
  UNROUTABLE_NOTE: "无法自动归位的笔记",
  LEGACY_PROVENANCE_UNVERIFIED: "来源未核验的知识笔记",
  PENDING_WRITEBACK: "待回写",
  WIP_OVERFLOW: "在制内容过多",
  FORWARD_LINK: "指向未建笔记的链接",
};
const FINDING_CODE_TARGET = {
  STALE_INBOX: { tab: "knowledge", label: "去整理" },
  PENDING_WRITEBACK: { tab: "review", label: "去复盘" },
  WIP_OVERFLOW: { tab: "create", label: "去创作" },
};
const FINDING_SEVERITY_ORDER = { blocking: 0, error: 0, operational: 1, informational: 2 };
const FINDING_GROUP_PREVIEW = 20;
const PULSE_REFRESH_DEBOUNCE_MS = 1500;
/* 速记「待处理」只看近 7 天：更早还没去处的速记当成记录，在 Pulse 里照样能看、能搜。 */
const MEMO_BACKLOG_DAYS = 7;
const PAGES = [
  { id: "today", name: "今天" },
  { id: "create", name: "创作" },
  { id: "knowledge", name: "知识" },
  { id: "review", name: "复盘" },
  { id: "system", name: "系统" },
];

/* ==========================================================================
   工作台形态（自动适配）
   --------------------------------------------------------------------------
   这套界面以前把 self-media / content-projects / 微信模板路径写死在代码里，
   所以只有「和作者做同一件事」的人能用。现在改为：
     1. detectWorkspaceCapabilities() 只按**库的结构**探测能力，不认平台名；
     2. resolveWorkspaceProfile() 把探测结果收敛成三种形态之一；
     3. 界面按形态决定显示哪些页与卡片。
   关键点：探测基于结构（templates/content-project、profiles/*.yaml、
   content-projects/、knowledge/、raw/inbox/、*.base、*大盘*.md），
   因此任何遵循同样目录约定的 Topic 都能被识别，不需要改代码。
   ========================================================================== */

/* 用户可见的形态；auto = 由探测结果决定 */
const WORKSPACE_MODES = ["auto", "content-ops", "knowledge", "actions-only"];

const PAGE_CATALOG = {
  today: "今天",
  create: "创作",
  knowledge: "知识",
  review: "复盘",
  system: "系统",
};

const LAUNCHPAD_PROFILES = {
  /* 有内容流水线：创作 + 复盘都有意义 */
  "content-ops": {
    heroTitle: "ANKS · 内容工作台",
    tabs: ["today", "create", "knowledge", "review", "system"],
    features: { create: true, review: true, kernelPill: true, workGrid: true },
    kpis: ["projects", "inbox", "knowledge", "raw", "outputs", "active"],
  },
  /* 有知识层但没有内容流水线：去掉创作页，保留复盘（行动收口与知识回写仍适用） */
  knowledge: {
    heroTitle: "ANKS · 知识工作台",
    tabs: ["today", "knowledge", "review", "system"],
    features: { create: false, review: true, kernelPill: true, workGrid: true },
    kpis: ["inbox", "knowledge", "raw", "outputs", "active"],
  },
  /* 陌生库：只剩行动层与系统页，也不再显示 DSH 状态（对非 ANKS 用户没有意义） */
  "actions-only": {
    heroTitle: "行动工作台",
    tabs: ["today", "system"],
    features: { create: false, review: false, kernelPill: false, workGrid: false },
    /* 只剩「近 7 天更新」：其余 KPI 都指向 ANKS 的对象层，陌生库里恒为 0 且点开是「未找到」 */
    kpis: ["active"],
  },
};

function launchpadPages(profileId) {
  const profile = LAUNCHPAD_PROFILES[profileId] || LAUNCHPAD_PROFILES["content-ops"];
  return profile.tabs.map((id) => ({ id, name: PAGE_CATALOG[id] || id }));
}

function launchpadProfile(profileId) {
  return LAUNCHPAD_PROFILES[profileId] || LAUNCHPAD_PROFILES["content-ops"];
}

/* 只吃「路径数组」，不碰 app —— 这样探测是可单测的纯函数。
   extra.cliAvailable / extra.snapshotsPresent 由调用方用 adapter.exists 探好后传进来
   （Sidecar/ 与 .runtime/ 可能不在 vault.getFiles() 的返回里）。 */
function detectWorkspaceCapabilities(paths = [], extra = {}) {
  const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string" && p);
  const topicNames = new Set();
  for (const p of list) {
    const match = /^Topics\/([^/]+)\//.exec(p);
    if (match) topicNames.add(match[1]);
  }
  const perTopic = {};
  for (const topic of [...topicNames].sort()) {
    const prefix = `Topics/${topic}/`;
    const under = list.filter((p) => p.startsWith(prefix));
    const platforms = [
      ...new Set(
        under
          .map((p) => new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}system/([^/]+)/templates/content-project/`).exec(p))
          .filter(Boolean)
          .map((m) => m[1]),
      ),
    ].sort();
    const profiles = {};
    for (const platform of platforms) {
      const dir = `${prefix}system/${platform}/profiles/`;
      profiles[platform] = [
        ...new Set(
          under
            .filter((p) => p.startsWith(dir) && p.endsWith(".yaml"))
            .map((p) => p.slice(dir.length).replace(/\.yaml$/, ""))
            .filter((name) => name && !name.includes("/")),
        ),
      ].sort();
    }
    perTopic[topic] = {
      platforms,
      profiles,
      hasContentProjects: under.some((p) => p.startsWith(`${prefix}content-projects/`)),
      contentProjectsPath: under.some((p) => p.startsWith(`${prefix}content-projects/`))
        ? `${prefix}content-projects`
        : "",
      contentIndexPath: under.includes(`${prefix}content-projects/index.md`)
        ? `${prefix}content-projects/index.md`
        : "",
      hasInbox: under.some((p) => p.startsWith(`${prefix}raw/inbox/`)),
      inboxPath: under.some((p) => p.startsWith(`${prefix}raw/inbox/`))
        ? `${prefix}raw/inbox`
        : "",
      rawPath: under.some((p) => p.startsWith(`${prefix}raw/`)) ? `${prefix}raw` : "",
      hasKnowledge: under.some((p) => p.startsWith(`${prefix}knowledge/`)),
      knowledgePath: under.some((p) => p.startsWith(`${prefix}knowledge/`))
        ? `${prefix}knowledge`
        : "",
      outputsPath: under.some((p) => p.startsWith(`${prefix}outputs/`))
        ? `${prefix}outputs`
        : "",
      readmePath: under.includes(`${prefix}README.md`) ? `${prefix}README.md` : "",
      /* 内容总览 Base 与作战大盘都按「类」探测，不写死文件名 */
      basePath: under.find((p) => /\.base$/.test(p) && !p.includes("/content-projects/")) || "",
      dashboardPath: under.find((p) => /大盘[^/]*\.md$/.test(p)) || "",
    };
  }
  return {
    topics: Object.keys(perTopic),
    perTopic,
    hasCli: extra.cliAvailable === true,
    hasSnapshots: extra.snapshotsPresent === true,
    hasIndex: list.some((p) => p === "Start Here.md"),
    hasAgentContract: list.some((p) => p === "AGENTS.md"),
    hasCore: list.some((p) => p.startsWith("Core/")),
    hasSidecar: list.some((p) => p.startsWith("Sidecar/")),
    contentTopics: Object.keys(perTopic).filter(
      (t) => perTopic[t].hasContentProjects || perTopic[t].platforms.length > 0,
    ),
    knowledgeTopics: Object.keys(perTopic).filter((t) => perTopic[t].hasKnowledge),
  };
}

/* 自动判定：有内容流水线 → 内容运营；只有知识层 → 知识管理；都没有 → 仅行动 */
function resolveWorkspaceProfile(capabilities, mode = "auto") {
  const caps = capabilities || {};
  if (WORKSPACE_MODES.includes(mode) && mode !== "auto") return mode;
  if (Array.isArray(caps.contentTopics) && caps.contentTopics.length) return "content-ops";
  if (Array.isArray(caps.knowledgeTopics) && caps.knowledgeTopics.length) return "knowledge";
  return "actions-only";
}

/* KPI 卡的定义：路径用占位符，避免把 self-media 写死。形态决定显示哪几项。 */
const KPI_DEFINITIONS = {
  projects: { label: "内容项目", hint: "创作流水线在管", path: "Topics/{contentTopic}/content-projects" },
  inbox: { label: "待整理", hint: "raw/inbox 未归位", path: "Topics/{topic}/raw/inbox" },
  knowledge: { label: "知识对象", hint: "source/knowledge 等", path: "Topics/{topic}/knowledge" },
  raw: { label: "原始素材", hint: "raw 证据层", path: "Topics/{topic}/raw" },
  outputs: { label: "产出", hint: "output 交付物", path: "Topics/{topic}/outputs" },
  active: { label: "近 7 天更新", hint: "7 天内变更", path: "Topics" },
};

/* 主 Topic：优先内容 Topic，其次知识 Topic，再其次任意 Topic；保留旧默认值以兼容
   行动与捕获工具。所有可点击的 Topic 路径仍需由 capabilities 确认存在。 */
function primaryTopic(capabilities) {
  const caps = capabilities || {};
  const pick = (list) => (Array.isArray(list) && list.length ? list[0] : "");
  return pick(caps.contentTopics) || pick(caps.knowledgeTopics) || pick(caps.topics) || "self-media";
}

function primaryContentTopic(capabilities) {
  const topics = capabilities?.contentTopics;
  return Array.isArray(topics) && topics.length ? topics[0] : "";
}

function primaryContentPlatform(capabilities, topic = primaryContentTopic(capabilities)) {
  const platforms = capabilities?.perTopic?.[topic]?.platforms;
  return Array.isArray(platforms) && platforms.length ? platforms[0] : "";
}

function contentProjectsPath(topic) {
  return topic ? `Topics/${topic}/content-projects` : "";
}

function contentTemplateRoot(topic, platform) {
  return topic && platform
    ? `Topics/${topic}/system/${platform}/templates/content-project`
    : "";
}

function contentTopicFromPath(projectPath) {
  return /^Topics\/([^/]+)\/content-projects\//.exec(String(projectPath || ""))?.[1] || "";
}

function platformIdPrefix(platform) {
  return String(platform || "content")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase() || "CONTENT";
}

function resolveKpiTarget(template, capabilities) {
  const caps = capabilities || {};
  const source = String(template || "");
  if (source === "Topics") return caps.topics?.length ? "Topics" : "";
  const topic = primaryTopic(caps);
  const contentTopic = primaryContentTopic(caps) || topic;
  const entry = caps.perTopic?.[topic] || {};
  const contentEntry = caps.perTopic?.[contentTopic] || {};
  if (source === "Topics/{contentTopic}/content-projects") {
    return contentEntry.contentIndexPath || contentEntry.contentProjectsPath || "";
  }
  if (source === "Topics/{topic}/raw/inbox") return entry.inboxPath || "";
  if (source === "Topics/{topic}/knowledge") return entry.knowledgePath || "";
  if (source === "Topics/{topic}/raw") return entry.rawPath || "";
  if (source === "Topics/{topic}/outputs") return entry.outputsPath || "";
  const resolved = source.replace("{contentTopic}", contentTopic).replace("{topic}", topic);
  return resolved.includes("//") || resolved.includes("{topic}") || resolved.includes("{contentTopic}")
    ? ""
    : resolved;
}
/* 行动面板：按 ANKS 自己的循环组织 —— 捕获 → 待整理 → 行动，另加收藏。 */
const PANEL_TAB_KEY = "crisp-launchpad-panel-tab";
const PANEL_TABS = [
  { id: "today", name: "今天" },
  { id: "capture", name: "捕获" },
  { id: "triage", name: "待整理" },
  { id: "bookmark", name: "收藏" },
];
const CAPTURE_TYPES = [
  { id: "scratch", name: "速记" },
  { id: "idea", name: "灵感" },
  { id: "link", name: "链接" },
];
const KNOWLEDGE_TYPES = ["source", "knowledge", "concept", "entity", "method", "framework"];
const AUXILIARY_CONTENT_ROLES = new Set([
  "project-control", "publish-record", "title-candidates", "qa", "delivery-summary", "metrics",
]);
/* 热力图按天展开时，把对象类型压成人能读的标签。 */
const PAGE_TYPE_LABEL = {
  raw: "原始素材",
  source: "信源",
  knowledge: "知识",
  concept: "知识",
  entity: "知识",
  method: "知识",
  framework: "知识",
  output: "产出",
  other: "未标类型",
};
const STAGE_ORDER = [
  "intake",
  "brief",
  "research",
  "outline",
  "drafting",
  "fact-check",
  "style-check",
  "visual",
  "mobile-preview",
  "draft-box",
  "publish-ready",
  "reviewing",
  "distilled",
  "done",
  "archived",
];
const STAGE_LABEL = {
  intake: "选题输入",
  brief: "简报",
  research: "事实调研",
  outline: "大纲",
  drafting: "起草中",
  "fact-check": "事实核验",
  "style-check": "风格质检",
  visual: "配图/视觉",
  "mobile-preview": "移动预览",
  "draft-box": "草稿箱",
  "publish-ready": "准备发布",
  reviewing: "待复盘",
  distilled: "已提炼",
  done: "已完成",
  archived: "已归档",
};
const DEFAULT_SETTINGS = {
  openOnStartup: true,
  allowSnapshotRefresh: true,
  autoRouteEnabled: false,
  panelOnStartup: false,
  /* auto = 按库结构自动选择形态；其余为显式选择 */
  workspaceMode: "auto",
  hasCompletedOnboarding: false,
};

function textOr(value, fallback = "") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

/* mtime 的 0 是「未知」的哨兵值 —— pageRecord 用 `file.stat?.mtime || 0` 兜底。
   所以 0 绝不能当成 1970-01-01：所有展示时间的辅助函数必须先过这里，
   把「不可用的时间」统一判为未知（null），再由各自决定怎么表达。
   历史上 dateKeyFromTimestamp 把 0 当今天、daysBetween 当 1970，两个口径互相矛盾。 */
function knownTimestamp(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) && value.getTime() > 0 ? value.getTime() : null;
  }
  const ms = typeof value === "number" ? value : Date.parse(textOr(value));
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function dateKeyFromTimestamp(timestamp) {
  const ms = knownTimestamp(timestamp);
  /* 未知时间返回空串：调用方不会把它当成某一天（否则会把「无时间」的页算作今天有活动）。 */
  if (ms === null) return "";
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKey(date) {
  return dateKeyFromTimestamp(date instanceof Date ? date.getTime() : date);
}

function isDateKey(value) {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(year, month - 1, day);
  return (
    probe.getFullYear() === year &&
    probe.getMonth() === month - 1 &&
    probe.getDate() === day
  );
}

function startOfMonday(date) {
  const base = date instanceof Date ? date : new Date(date || Date.now());
  const valid = isNaN(base.getTime()) ? new Date() : base;
  const copy = new Date(valid.getFullYear(), valid.getMonth(), valid.getDate());
  const offset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offset);
  return copy;
}

function daysBetween(now, then) {
  const n = knownTimestamp(now);
  const t = knownTimestamp(then);
  /* 未知时间不返回 0：0 天前等于「就是今天」，那是另一种撒谎。由调用方决定怎么表达未知。 */
  if (n === null || t === null) return null;
  const start = new Date(n);
  const end = new Date(t);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.max(0, Math.round((startDay - endDay) / 86400000));
}

function formatShortDate(timestamp) {
  const ms = knownTimestamp(timestamp);
  if (ms === null) return "–";
  const date = new Date(ms);
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateTime(timestamp) {
  const ms = knownTimestamp(timestamp);
  if (ms === null) return "–";
  const date = new Date(ms);
  const datePart = `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")}`;
  const timePart = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${datePart} ${timePart}`;
}

function formatFullDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return dateKey(new Date());
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function yamlQuote(value) {
  return `"${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

function sanitizeTitle(value, fallback = "速记") {
  return String(value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/^[-. ]+|[-. ]+$/g, "")
    .slice(0, 80) || fallback;
}

function firstMeaningfulLine(value, fallback = "速记") {
  const line = String(value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  const unquoted = String(line ?? "").replace(/^#+\s*/, "").trim();
  return sanitizeTitle(unquoted, fallback);
}

/* 与 ANKS 侧 vault_sweeper 的判定保持一致：这三种状态都算已归位。 */
const INBOX_SETTLED_STATUSES = new Set(["processed", "archived", "done"]);

function isSettledInboxStatus(value) {
  return INBOX_SETTLED_STATUSES.has(String(value ?? "").trim().toLowerCase());
}

function inferTopicFromPath(path) {
  const match = String(path ?? "").match(/^Topics\/([^/]+)\//);
  return match ? match[1] : "self-media";
}

function strictTopicFromPath(path) {
  return /^Topics\/([^/]+)\//.exec(String(path ?? ""))?.[1] || "";
}

function inboxFolder(inboxType, topic = "") {
  if (!String(topic || "").trim()) throw new Error("捕获需要指定一个已存在的 Topic");
  if (inboxType === "idea") return `Topics/${topic}/raw/inbox/ideas`;
  if (inboxType === "link") return `Topics/${topic}/raw/inbox/links`;
  return `Topics/${topic}/raw/inbox/scratch`;
}

function generateCaptureId(now = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const hmsms = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds(), 3)}`;
  const hex = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
  return `CAP-${ymd}-${hmsms}-${hex}`;
}

function buildInboxNote(text, inboxType = "scratch", now = new Date(), topic = "") {
  const cleanType = ["idea", "link", "scratch"].includes(inboxType) ? inboxType : "scratch";
  const cleanTopic = sanitizeTitle(topic, "").replace(/\s+/g, "-");
  if (!cleanTopic) throw new Error("捕获需要指定一个已存在的 Topic");
  const title = firstMeaningfulLine(text);
  const date = dateKey(now);
  const timeStr = formatFullDateTime(now);
  const captureId = generateCaptureId(now);
  const content = [
    "---",
    `id: ${yamlQuote(captureId)}`,
    "type: raw",
    `topic: ${yamlQuote(cleanTopic)}`,
    `owner: ${yamlQuote(`topic:${cleanTopic}`)}`,
    `title: ${yamlQuote(title)}`,
    `inbox_type: ${cleanType}`,
    'routing_status: "needs-classification"',
    `created: ${yamlQuote(date)}`,
    `updated: ${yamlQuote(date)}`,
    `created_at: ${yamlQuote(timeStr)}`,
    `updated_at: ${yamlQuote(timeStr)}`,
    "routing_confidence: 0",
    'routing_reason: "Quick Capture，等待 Agent 语义分类"',
    "---",
    "",
    `# ${title}`,
    "",
    String(text ?? "").trim(),
    "",
  ].join("\n");
  return {
    folder: inboxFolder(cleanType, cleanTopic),
    filename: `${date}-${sanitizeTitle(title)}.md`,
    title,
    content,
  };
}

/* 分工契约（docs/ROLE-CONTRACT.md）：装了且激活 Crisp Tempo 时，行动以 Tempo 为准。
   Launchpad 只读 Tempo 的 getActionOverview()，换成看板用的行动形状；完成、改期都回 Tempo 做。 */
const TEMPO_PLUGIN_ID = "crisp-tempo";
const TEMPO_REQUIRED_HINT = "行动由 Crisp Tempo 管理，请先启用并激活 Tempo";

function tempoSummaryToAction(item) {
  const done = item?.bucket === "done";
  return {
    id: `tempo:${textOr(item?.id)}`,
    tempoId: textOr(item?.id),
    source: "tempo",
    title: textOr(item?.title, "未命名行动"),
    done,
    due: isDateKey(item?.dueDate) ? item.dueDate : "",
    scheduled: isDateKey(item?.focusDate) ? item.focusDate : "",
    start: isDateKey(item?.startDate) ? item.startDate : "",
    created: "",
    time: "",
    doneAt: done && Number(item?.completedAt) ? dateKey(new Date(Number(item.completedAt))) : "",
    waiting: item?.bucket === "waiting",
    tags: [],
    project: textOr(item?.projectTitle),
    sourceId: textOr(item?.sourceId),
    bucket: textOr(item?.bucket, "anytime"),
  };
}

/* Tempo 按来源标识去重。带上日期：同一天重复点不重复建；隔天同名行动由未完成标题去重，
   否则做完一次的复盘行动以后再也生成不出来。 */
function launchpadActionSourceId(text, day = dateKey(new Date())) {
  const input = `${day}|${String(text ?? "").replace(/\s+/g, " ").trim()}`;
  let hash = 0x811c9dc5;
  for (const char of input) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `crisp-launchpad:${day.replace(/-/g, "")}-${hash.toString(16).padStart(8, "0")}`;
}

/* 其他 Crisp 插件的入口：按「捕获 / 规划 / 检索 / 创作」分组，只显示已启用且命令存在的。
   外观、氛围类插件（Ripple、Pets、Reading Rail 等）不属于工作流程，不放进来。 */
const CRISP_TOOL_GROUPS = [
  {
    label: "捕获",
    tools: [
      { plugin: "crisp-pulse", command: "crisp-pulse:quick-memo", name: "速记", icon: "pencil-line" },
      { plugin: "crisp-asr", command: "crisp-asr:open", name: "转写", icon: "mic" },
    ],
  },
  {
    label: "规划",
    tools: [
      { plugin: "crisp-tempo", command: "crisp-tempo:open-tempo-view", name: "Tempo", icon: "list-checks" },
      { plugin: "crisp-focus", command: "crisp-focus:open-pomodoro", name: "番茄钟", icon: "timer" },
      { plugin: "crisp-pulse", command: "crisp-pulse:open-crisp-pulse-view", name: "Pulse", icon: "activity" },
    ],
  },
  {
    label: "检索",
    tools: [
      { plugin: "crisp-search", command: "crisp-search:open", name: "搜索", icon: "search" },
      { plugin: "crisp-lens", command: "crisp-lens:open", name: "对象面板", icon: "scan-eye" },
      { plugin: "crisp-annotations", command: "crisp-annotations:open-annotation-outline", name: "标注中心", icon: "highlighter" },
    ],
  },
  {
    label: "创作",
    tools: [
      { plugin: "crisp-mind", command: "crisp-mind:create-crisp-mind", name: "新建导图", icon: "network" },
      { plugin: "crisp-dsh", command: "crisp-dsh:open-crisp-dsh", name: "DSH", icon: "bot" },
      { plugin: "crisp-wechat-publisher", command: "crisp-wechat-publisher:open-wechat-sidebar-view", name: "公众号预览", icon: "send" },
    ],
  },
];

function availableCrispTools(enabledPlugins, hasCommand) {
  const enabled = enabledPlugins instanceof Set ? enabledPlugins : new Set(enabledPlugins || []);
  return CRISP_TOOL_GROUPS.map((group) => ({
    label: group.label,
    tools: group.tools.filter((tool) => enabled.has(tool.plugin) && hasCommand(tool.command)),
  })).filter((group) => group.tools.length);
}

const BOOKMARK_KIND_LABEL = {
  file: "文件",
  folder: "文件夹",
  search: "搜索",
  graph: "图谱",
  url: "链接",
};

function normalizeBookmarkEntries(list, limit = 6) {
  const max = Math.max(0, Number(limit) || 0);
  const items = Array.isArray(list) ? list : [];
  const normalized = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const kind = textOr(item.type, "file");
    const path = textOr(item.path, "");
    const url = textOr(item.url, "");
    const target = path || url;
    if (!target) continue;
    normalized.push({
      title: textOr(item.title, "") || path.split("/").pop() || url || "未命名",
      kind,
      kindLabel: BOOKMARK_KIND_LABEL[kind] || kind,
      target,
    });
    if (normalized.length >= max) break;
  }
  return normalized;
}

function capturedToday(pages, now = new Date()) {
  const todayKey = dateKey(now);
  return (Array.isArray(pages) ? pages : [])
    .filter((page) => {
      if (!page || !String(page.path || "").includes("raw/inbox")) return false;
      const created = textOr(page.frontmatter?.created, "");
      const createdAt = textOr(page.frontmatter?.created_at, "");
      return created === todayKey || createdAt.startsWith(todayKey);
    })
    .sort((left, right) => (right.mtime || 0) - (left.mtime || 0));
}

/* 待整理口径与 Launchpad 的 KPI 一致：raw/inbox 且 routing_status 不是 processed。 */
function inboxTriageItems(pages, limit = 20) {
  return (Array.isArray(pages) ? pages : [])
    .filter(
      (page) =>
        page &&
        String(page.path || "").includes("raw/inbox") &&
        !isSettledInboxStatus(page.routing_status) &&
        !isPulseMemoCapture(page),
    )
    .sort((left, right) => (right.mtime || 0) - (left.mtime || 0))
    .slice(0, Math.max(0, Number(limit) || 0));
}

/* 捕获落点：优先当前文件所在的真实 Topic，再用工作区主 Topic；
   保留 self-media 兼容默认，最后才回退到第一个真实 Topic。无 Topic 时返回空串。 */
function captureTargetTopic(app, topics = [], preferredTopic = "") {
  const available = (Array.isArray(topics) ? topics : []).filter(
    (name) => typeof name === "string" && name,
  );
  const activePath = app?.workspace?.getActiveFile?.()?.path || "";
  const activeTopic = strictTopicFromPath(activePath);
  if (available.includes(activeTopic)) return activeTopic;
  if (available.includes(preferredTopic)) return preferredTopic;
  if (available.includes("self-media")) return "self-media";
  return available[0] || "";
}

function contentSlug(value, fallback = "UNTITLED") {
  const slug = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

function contentProjectId(title, now = new Date(), platform = "wechat") {
  return `${platformIdPrefix(platform)}-${dateKey(now).replace(/-/g, "")}-${contentSlug(title)}`;
}

function replaceTemplateTokens(content, replacements) {
  let output = String(content ?? "");
  for (const [key, value] of Object.entries(replacements)) {
    output = output.split(`{{${key}}}`).join(String(value));
    if (key.startsWith("WECHAT-")) output = output.split(key).join(String(value));
  }
  const contentId = textOr(replacements.contentId);
  if (contentId) output = output.replace(/\b[A-Z][A-Z0-9-]*-YYYYMMDD-SLUG\b/g, contentId);
  return output;
}

function projectField(content, key) {
  const match = String(content ?? "").match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function formatYamlScalar(value) {
  if (value === null || value === undefined) return '""';
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value).replace(/\r?\n/g, " ").trim();
  if (!text) return '""';
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text;
  }
  if (/[:#\[\]{}%@&*!|>'`]/.test(text) || text.includes(": ")) {
    return yamlQuote(text);
  }
  return text;
}

function updateProjectField(content, key, value) {
  const source = String(content ?? "");
  const formatted = formatYamlScalar(value);
  const line = `${key}: ${formatted}`;
  const pattern = new RegExp(`^${key}:.*$`, "m");
  if (pattern.test(source)) return source.replace(pattern, line);
  return `${source.replace(/\s*$/, "")}\n${line}\n`;
}

function updateExistingFrontmatterFields(content, fields) {
  const source = String(content ?? "");
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(source);
  if (!match) return source;
  let frontmatter = match[2];
  for (const [key, value] of Object.entries(fields || {})) {
    const pattern = new RegExp(`^${key}:.*$`, "m");
    if (pattern.test(frontmatter)) {
      frontmatter = frontmatter.replace(pattern, `${key}: ${formatYamlScalar(value)}`);
    }
  }
  return `${match[1]}${frontmatter}${match[3]}${source.slice(match[0].length)}`;
}

/* Markdown 文件只改 frontmatter：有就替换，没有就加在 frontmatter 末尾；没有 frontmatter 时新建一块。
   updateProjectField 只用于纯 YAML 的 project.yaml，用在 .md 上会把字段追加到正文最后。 */
function upsertFrontmatterFields(content, fields) {
  const source = String(content ?? "");
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(source);
  let frontmatter = match ? match[2] : "";
  for (const [key, value] of Object.entries(fields || {})) {
    const line = `${key}: ${formatYamlScalar(value)}`;
    const pattern = new RegExp(`^${key}:.*$`, "m");
    if (pattern.test(frontmatter)) frontmatter = frontmatter.replace(pattern, line);
    else frontmatter = frontmatter ? `${frontmatter}\n${line}` : line;
  }
  if (match) return `${match[1]}${frontmatter}${match[3]}${source.slice(match[0].length)}`;
  return `---\n${frontmatter}\n---\n${source}`;
}

function publishRecordContent(body, contentId, date, topic = "self-media", platform = "wechat") {
  return [
    "---",
    "type: output",
    "artifact_type: content",
    "content_role: publish-record",
    `content_id: ${contentId}`,
    `topic: ${formatYamlScalar(topic)}`,
    `owner: ${yamlQuote(`topic:${topic}`)}`,
    `platform: ${formatYamlScalar(platform)}`,
    "status: draft",
    "delivery_target: editorial-ready",
    "knowledge_writeback: none",
    `created_at: ${yamlQuote(date)}`,
    `updated_at: ${yamlQuote(date)}`,
    "schema_version: 1",
    'selected_package_id: ""',
    'selected_title: ""',
    'selected_cover: ""',
    'selection_reason: ""',
    'wechat_draft_id: ""',
    'draft_pushed_at: ""',
    'published_at: ""',
    'publication_url: ""',
    "preview:",
    "  html_generated: false",
    "  mobile_checked: false",
    '  checked_device: ""',
    '  checked_at: ""',
    "authorization:",
    "  draft_push:",
    "    granted: false",
    '    granted_at: ""',
    '    evidence: ""',
    "  formal_publish:",
    "    granted: false",
    '    granted_at: ""',
    '    evidence: ""',
    "---",
    "",
    String(body ?? "").trim(),
    "",
  ].join("\n");
}

/* 和 ANKS capture_normalize.INBOX_SUBDIR_ROUTING 同一张表；收件箱根目录按 scratch 算，to-organize 不补。 */
function inboxTypeForPath(path) {
  const match = /\/raw\/inbox\/(?:([^/]+)\/)?[^/]+$/.exec(String(path ?? ""));
  if (!match) return "";
  if (!match[1]) return "scratch";
  return { scratch: "scratch", ideas: "idea", links: "link" }[match[1]] || "";
}

/* 标为已处理：去掉捕获时的 routing_confidence / routing_reason（留着的话 ANKS 路由器按低置信度
   一直报 UNROUTABLE_NOTE，而待整理里已看不到它）；缺 inbox_type 时按所在收件箱子目录补上。 */
function markProcessedContent(content, now = new Date(), topic = "self-media", inboxType = "") {
  const stamp = formatFullDateTime(now);
  const source = String(content ?? "");
  const cleanTopic = sanitizeTitle(topic, "").replace(/\s+/g, "-");
  if (!cleanTopic) throw new Error("原文不属于已配置 Topic，不能标记为已处理");
  const match = source.match(/^---\r?\n/);
  if (match) {
    const headStart = match[0].length;
    const endMatch = source.slice(headStart).match(/\r?\n---\r?\n/);
    if (endMatch) {
      const end = headStart + endMatch.index;
      const head = source.slice(headStart, end);
      const tail = source.slice(headStart + endMatch.index + endMatch[0].length);
      const lines = head.split(/\r?\n/).filter(
        (line) => !/^(routing_status|routing_confidence|routing_reason|launchpad_processed_at)\s*:/.test(line),
      );
      const title = firstMeaningfulLine(tail) || firstMeaningfulLine(source) || "未命名笔记";
      if (!lines.some((line) => /^type\s*:/.test(line))) {
        lines.unshift("type: raw");
      }
      if (!lines.some((line) => /^topic\s*:/.test(line))) {
        lines.push(`topic: ${cleanTopic}`);
      }
      if (!lines.some((line) => /^owner\s*:/.test(line))) {
        lines.push(`owner: ${yamlQuote(`topic:${cleanTopic}`)}`);
      }
      if (!lines.some((line) => /^title\s*:/.test(line))) {
        lines.push(`title: ${yamlQuote(title)}`);
      }
      if (inboxType && !lines.some((line) => /^inbox_type\s*:/.test(line))) {
        lines.push(`inbox_type: ${inboxType}`);
      }
      lines.push("routing_status: processed", `launchpad_processed_at: ${yamlQuote(stamp)}`);
      return `---\n${lines.join("\n")}\n---\n${tail}`;
    }
  }
  const title = firstMeaningfulLine(source) || "未命名笔记";
  return [
    "---",
    "type: raw",
    `topic: ${cleanTopic}`,
    `owner: ${yamlQuote(`topic:${cleanTopic}`)}`,
    `title: ${yamlQuote(title)}`,
    ...(inboxType ? [`inbox_type: ${inboxType}`] : []),
    "routing_status: processed",
    `launchpad_processed_at: ${yamlQuote(stamp)}`,
    "---",
    "",
    source,
  ].join("\n");
}

function pageRecord(app, file) {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter || {};
  return {
    file,
    path: file.path,
    name: file.basename,
    folder: file.parent?.path || "",
    mtime: file.stat?.mtime || 0,
    frontmatter,
    type: textOr(frontmatter.type),
    content_role: textOr(frontmatter.content_role),
    stage: textOr(frontmatter.stage),
    status: textOr(frontmatter.status),
    platform: textOr(frontmatter.platform),
    knowledge_writeback: textOr(frontmatter.knowledge_writeback),
    routing_status: textOr(frontmatter.routing_status),
    capture_type: textOr(frontmatter.capture_type),
    content_id: textOr(frontmatter.content_id),
    published_at: textOr(frontmatter.published_at),
    publication_status: textOr(frontmatter.publication_status),
    title: textOr(frontmatter.title, file.basename),
  };
}

function collectPages(app) {
  return app.vault
    .getMarkdownFiles()
    .filter((file) => file.path.startsWith("Core/") || file.path.startsWith("Topics/"))
    .map((file) => pageRecord(app, file));
}

function isPulseMemoCapture(page) {
  return textOr(page?.capture_type || page?.frontmatter?.capture_type).toLowerCase() === "pulse-memo";
}

function summarizePages(pages, now = new Date()) {
  const knowledge = pages.filter((page) => KNOWLEDGE_TYPES.includes(page.type));
  const raw = pages.filter((page) => page.type === "raw");
  /* 内容项目里的控制卡、发布记录、标题候选、QA 等和健康日志都带 type: output，但不是交付物，
     和 ANKS calculate_active_wip 一样排除。 */
  const outputs = pages.filter(
    (page) =>
      page.type === "output" &&
      !AUXILIARY_CONTENT_ROLES.has(textOr(page.content_role)) &&
      textOr(page.artifact_type ?? page.frontmatter?.artifact_type) !== "health_report",
  );
  /* Crisp Pulse 的速记日文件不算：一个文件里有很多条速记，每条的去处由 Pulse 判断，
     今天一行和「待你判断」读 Pulse 的近 7 天没去处的条数。 */
  const inbox = pages.filter(
    (page) => page.path.includes("raw/inbox") && !isSettledInboxStatus(page.routing_status) && !isPulseMemoCapture(page),
  );
  const articles = pages.filter(
    (page) => page.content_role === "article" && page.path.includes("content-projects"),
  );
  const activeCutoff = now.getTime() - 7 * 86400000;
  const active = pages.filter(
    (page) => page.mtime >= activeCutoff && !page.path.includes("/content-projects/"),
  );
  return { knowledge, raw, outputs, inbox, articles, active };
}

function buildStageBuckets(articles) {
  const buckets = new Map();
  for (const article of articles) {
    const key = article.stage || article.status || "unknown";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(article);
  }
  return [...buckets.entries()].sort((left, right) => {
    const leftIndex = STAGE_ORDER.indexOf(left[0]);
    const rightIndex = STAGE_ORDER.indexOf(right[0]);
    return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
  });
}

function articleLabel(article) {
  if (article.title) return article.title;
  const segment = article.folder.split("/").filter(Boolean).pop();
  return segment ? segment.replace(/^[A-Z0-9]+-/i, "") : article.name;
}

function contentProjectArticle(pages, projectDir) {
  return (
    pages.find(
      (page) => page.folder === projectDir && page.content_role === "article",
    ) || null
  );
}

function contentProjectLabel(pages, project) {
  const article = contentProjectArticle(pages, textOr(project?.dir));
  const title = textOr(article?.title).trim();
  if (title && !["article", "titles"].includes(title.toLowerCase())) return title;
  const fallback = textOr(project?.content_id, project?.dir || "内容项目");
  return fallback.replace(/^[A-Z0-9]+-/i, "").replace(/[_-]+/g, " ");
}

function publicationTimestamp(page) {
  const published = Date.parse(textOr(page?.published_at));
  if (Number.isFinite(published)) return published;
  return knownTimestamp(page?.mtime) ?? 0;
}

function publishedOutputPages(pages, topicPrefix = "") {
  const candidates = (Array.isArray(pages) ? pages : []).filter((page) => {
    const path = textOr(page?.path);
    if (topicPrefix && !path.startsWith(topicPrefix)) return false;
    const canonicalArticle =
      path.includes("/content-projects/") && textOr(page?.content_role) === "article";
    const legacyOutput = path.includes("/outputs/") && path.includes("/published/");
    return (canonicalArticle && textOr(page?.status).toLowerCase() === "published") || legacyOutput;
  });
  const byKey = new Map();
  for (const page of candidates) {
    const key = textOr(page.content_id) || textOr(page.path);
    const existing = byKey.get(key);
    const isCanonical = textOr(page.path).includes("/content-projects/");
    const existingCanonical = existing && textOr(existing.path).includes("/content-projects/");
    if (!existing || (isCanonical && !existingCanonical)) byKey.set(key, page);
  }
  return [...byKey.values()].sort((left, right) => publicationTimestamp(right) - publicationTimestamp(left));
}

function actionItemMeta(item) {
  if (item?.overdue && item.due) return `逾期 · ${item.due.slice(5)}`;
  if (item?.due) return item.due.slice(5);
  if (item?.bucket === "waiting") return "等待";
  return "随时";
}

function snapshotAge(generatedAt) {
  const target =
    generatedAt && typeof generatedAt === "object"
      ? (generatedAt.generated_at || generatedAt.updated_at || generatedAt.mtime)
      : generatedAt;
  const timestamp = Date.parse(textOr(target));
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (Date.now() - timestamp) / 3600000);
}

function snapshotAgeLabel(ageHours) {
  if (ageHours === null) return "时间未知";
  if (ageHours < 1) return "刚刚检查";
  return `${Math.round(ageHours)} 小时前检查`;
}

/* 路由器明确忽略的前缀（与 Sidecar/tools/knowledge-router/routing-rules.toml 的
   `[settings] ignore_prefixes` 对齐）。落在这些前缀下的改动不需要跑 route fix ——
   跑了也只是空转；但快照仍然要重建，因为 health / content 会随文件变化。
   如果这份清单落后于路由配置，退化为「多跑一次 route fix」，不会漏处理。 */
const ROUTER_IGNORE_PREFIXES = [
  ".git/",
  ".obsidian/",
  "Core/System/",
  "Core/Indexes/",
  "Sidecar/tools/",
  "Sidecar/skills/",
  "Sidecar/logs/",
  ".workbuddy/",
  "Now/",
  "docs/superpowers/",
  "Topics/self-media/outputs/content/公众号HTML输出/",
  ".personal-os-backups/",
  "Topics/self-media/raw/assets/tutorial-9.0/",
  "Topics/self-media/raw/assets/brand-assets/",
  "generated-images/",
  "wiki/",
  "Topics/self-media/content-projects/",
  "Topics/main-business/content-projects/",
  "Topics/self-media/Landing Page/",
];

const ROUTING_RULES_PATH = "Sidecar/tools/knowledge-router/routing-rules.toml";
let activeRouterIgnorePrefixes = ROUTER_IGNORE_PREFIXES;

/* 真源是 routing-rules.toml 的 ignore_prefixes。插件启动和该文件变化时读取，
   读不到或解析失败才退回上面的内置清单。 */
function parseRouterIgnorePrefixes(text) {
  const match = String(text ?? "").match(/^\s*ignore_prefixes\s*=\s*\[([\s\S]*?)\]/m);
  if (!match) return null;
  const items = [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)]
    .map((item) => item[1] ?? item[2])
    .filter(Boolean);
  return items.length ? items : null;
}

function setRouterIgnorePrefixes(prefixes) {
  activeRouterIgnorePrefixes =
    Array.isArray(prefixes) && prefixes.length ? [...prefixes] : ROUTER_IGNORE_PREFIXES;
  return activeRouterIgnorePrefixes;
}

function isRouterIgnoredPath(path, prefixes = activeRouterIgnorePrefixes) {
  const normalized = textOr(path);
  // 与 knowledge_router.py 相同：等于去掉尾斜杠的前缀，或以前缀开头
  return prefixes.some(
    (prefix) => normalized === prefix.replace(/\/+$/, "") || normalized.startsWith(prefix),
  );
}

function eventBridgeKind(path) {
  const normalized = textOr(path);
  const lower = normalized.toLowerCase();
  const isMarkdown = lower.endsWith(".md");
  const isControlData = lower.endsWith(".yaml") || lower.endsWith(".yml");
  if (
    (normalized.startsWith("Topics/") || normalized.startsWith("Core/")) &&
    (isMarkdown || isControlData)
  ) {
    // YAML 控制卡、事实账本和系统契约不是可路由笔记，但会改变
    // content/health/index 的结果；只重建快照，避免把 YAML 交给 route fix。
    return isControlData || isRouterIgnoredPath(normalized) ? "snapshot" : "knowledge";
  }
  return "";
}

/* 返回需要重建 content-projects/index.md 的 Topic：路径必须落在某个项目目录内
   （含目录本身）。index.md 与 content-projects 根下的其它文件不算，避免重建自我触发。 */
function contentIndexTopicForPath(path) {
  const match = textOr(path).match(/^Topics\/([^/]+)\/content-projects\/([^/]+)(\/|$)/);
  if (!match) return "";
  if (!match[3] && /\.[a-z0-9]+$/i.test(match[2])) return "";
  return match[1];
}

/* project.yaml 变化时需要重新物化控制卡的项目。只认项目根下的 project.yaml。 */
function controlCardProjectForPath(path) {
  const match = textOr(path).match(/^Topics\/([^/]+)\/content-projects\/([^/]+)\/project\.ya?ml$/);
  return match ? { topic: match[1], contentId: match[2] } : null;
}

/* 判断 project.md 是否是 `anks content control-card` 生成的卡：正文只有标题和
   四个固定条目。手写过正文的卡不自动覆盖，由 ANKS 的 CONTROL_CARD_STALE 报出。 */
function isGeneratedControlCard(text) {
  const body = String(text ?? "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "---");
  if (!lines.length || !lines[0].startsWith("# 项目控制卡：")) return false;
  return lines
    .slice(1)
    .every((line) => /^- \*\*(项目 ID|体裁 Profile|当前阶段|下一步动作)\*\*：/.test(line));
}

const GENERIC_DOC_NAMES = new Set([
  "article",
  "index",
  "readme",
  "project",
  "qa",
  "titles",
  "brief",
  "outline",
  "facts",
  "sources",
  "publish",
  "assets",
  "metrics",
]);

function normalizeActionKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/的发布内容/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function findingBasename(finding) {
  const path = textOr(finding?.path || finding?.evidence?.path);
  const parts = path.split("/").filter(Boolean);
  const rawName = (parts.pop() || "未命名对象").replace(/\.md$/i, "");
  if (GENERIC_DOC_NAMES.has(rawName.toLowerCase()) && parts.length > 0) {
    const parent = parts.pop();
    const cleanParent = parent.replace(/^[A-Z0-9-]+-\d{8}-/i, "");
    return `${cleanParent} · ${rawName}`;
  }
  return rawName;
}

function reviewFindingCategory(finding) {
  const path = textOr(finding?.path || finding?.evidence?.path).replace(/\\/g, "/");
  if (path.includes("/content-projects/") || path.includes("/outputs/content/")) return "内容待回写";
  if (path.includes("/outputs/health/")) return "报告待复核";
  if (path.includes("/outputs/visualizations/")) return "图表待复核";
  return "知识待回写";
}

/* 列表里的展示名：有独立标题就用标题；project.md / article.md 这类通用文件名
   用父目录限定，避免一屏全是「project」。 */
function pageLabel(page) {
  const title = textOr(page?.title, "");
  const name = textOr(page?.name, "");
  if (title && title !== name) return title;
  return findingBasename({ path: textOr(page?.path, "") });
}

const BLOCKING_ACTION_PREFIX = "处理系统阻塞：";

function suggestReviewActions({
  tasks = [],
  pages = [],
  health = null,
  contentProjects = [],
  max = 5,
  perGroupLimit = 2,
  today = new Date(),
} = {}) {
  const healthData = health?.data || health || {};
  const findings = Array.isArray(healthData.findings) ? healthData.findings : [];
  /* 勾掉行动不会改写 health 的真源（knowledge_writeback / 收件箱状态），
     finding 仍在。只按未完成去重时，同一批前几条会被无限重复生成，后面的
     finding 永远排不上。近期完成的行动也算已处理，让队列往后推进。 */
  const cooldownStart = dateKey(
    new Date(today.getTime() - REVIEW_DONE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000),
  );
  const relevantTasks = tasks.filter((task) => !task.done || (isDateKey(task.doneAt) && task.doneAt >= cooldownStart));
  const existing = new Set(
    relevantTasks
      .filter(task => !task.reviewIdentity)
      .map((task) => normalizeActionKey(task.title))
      .filter(Boolean),
  );
  const identities = new Set(relevantTasks.map(task => task.reviewIdentity).filter(Boolean));
  const candidateKeys = new Set();
  const candidates = [];
  const push = (text, project = "复盘", link = "") => {
    const clean = String(text ?? "").trim();
    const key = normalizeActionKey(clean);
    const identity = link ? `${project}:${link}` : "";
    const candidateKey = identity || key;
    if (!clean || !key || existing.has(key) || identities.has(identity) || candidateKeys.has(candidateKey)) return false;
    candidateKeys.add(candidateKey);
    candidates.push({ text: clean, project, ...(link ? { link, identity: `${project}:${link}` } : {}) });
    return true;
  };

  const blocking = findings.filter(
    (finding) => finding.severity === "blocking" || finding.severity === "error",
  );
  if (blocking.length) {
    push(`${BLOCKING_ACTION_PREFIX}${blocking[0].code || "blocking"}`, "ANKS", textOr(blocking[0].path || blocking[0].evidence?.path));
  }

  const overdue = tasks.filter((task) => !task.done && task.bucket === "overdue");
  if (overdue.length) push("复盘并重排当前逾期行动", "行动");

  const writebacks = findings.filter((finding) => finding.code === "PENDING_WRITEBACK");
  let writebackCount = 0;
  for (const finding of writebacks) {
    if (push(`回写待提炼：${findingBasename(finding)}`, "知识回写", textOr(finding.path || finding.evidence?.path))) {
      if (++writebackCount >= perGroupLimit) break;
    }
  }

  const staleInbox = findings.filter((finding) => finding.code === "STALE_INBOX");
  let staleCount = 0;
  for (const finding of staleInbox) {
    if (push(`整理积压收件箱：${findingBasename(finding)}`, "收件箱", textOr(finding.path || finding.evidence?.path))) {
      if (++staleCount >= perGroupLimit) break;
    }
  }

  const reviewingProjects = contentProjects.filter(
    (project) => textOr(project.stage).toLowerCase() === "reviewing",
  );
  let reviewingCount = 0;
  for (const project of reviewingProjects) {
    if (push(`复盘内容项目：${contentProjectLabel(pages, project)}`, "内容复盘", `${textOr(project.dir)}/project.md`)) {
      if (++reviewingCount >= perGroupLimit) break;
    }
  }

  const waiting = tasks.filter((task) => !task.done && task.bucket === "waiting");
  if (waiting.length) push("跟进等待中的行动", "行动");
  push("完成本周复盘并生成下一批行动", "复盘");

  return candidates.slice(0, Math.max(0, Number(max) || 0));
}

function compactCommandError(stdout, stderr, fallback = "") {
  const text = String(stderr || stdout || fallback || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const payload = JSON.parse(text.slice(start, end + 1));
      const counts = payload.counts || {};
      const blocking = Number(counts.blocking || 0);
      const firstBlocking = (payload.findings || []).find(
        (finding) => finding.severity === "blocking" || finding.severity === "error",
      );
      const firstCode = firstBlocking?.code || Object.keys(payload.finding_codes || {})[0] || "";
      if (blocking > 0) {
        return `失败：${blocking} blocking${firstCode ? ` · ${firstCode}` : ""}`;
      }
      if (payload.status) {
        return `失败：${payload.status}${firstCode ? ` · ${firstCode}` : ""}`;
      }
      if (Array.isArray(payload.errors)) {
        const firstError = payload.errors[0] || "未知校验错误";
        return `校验未通过 · ${payload.errors.length} 项 · ${firstError}`;
      }
    } catch (error) {
      // Fall back to a readable text line below.
    }
  }
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("{")) || "命令执行失败";
  return line.length > 180 ? `${line.slice(0, 177)}...` : line;
}

/* 界面上的中文状态。文件和快照里仍是英文值，只在显示时换。 */
const CONTENT_STATUS_LABEL = { draft: "草稿", parked: "搁置", published: "已发布", deprecated: "已废弃" };
const SEVERITY_LABEL = { blocking: "阻塞", operational: "待办", informational: "提示" };

function contentStatusLabel(status) {
  const value = textOr(status);
  return CONTENT_STATUS_LABEL[value.toLowerCase()] || value;
}

function stageLabel(stage) {
  const value = textOr(stage);
  return STAGE_LABEL[value.toLowerCase()] || value;
}

function elementHasClass(element, cls) {
  if (typeof element?.hasClass === "function") return element.hasClass(cls);
  if (element?.classList) return element.classList.contains(cls);
  return Boolean(element?.classes?.has?.(cls));
}

/* 卡片两层结构（和 Crisp Pulse 一致）：卡片头留在外层托盘，其余内容收进内层面板。
   渲染完一个页签后调用一次；已经收好的卡片不会重复包。 */
function insetCardBodies(root) {
  for (const child of Array.from(root?.children || [])) {
    if (elementHasClass(child, "launchpad-card")) {
      const kids = Array.from(child.children || []);
      const header = kids.find((kid) => elementHasClass(kid, "launchpad-card-header"));
      const rest = kids.filter((kid) => kid !== header);
      const alreadyInset = rest.length === 1 && elementHasClass(rest[0], "launchpad-inset");
      if (rest.length && !alreadyInset) {
        child.empty();
        if (header) child.appendChild(header);
        const inset = child.createDiv({ cls: "launchpad-inset" });
        for (const kid of rest) inset.appendChild(kid);
      }
    }
    insetCardBodies(child);
  }
}

/* 「self-media 51 · main-business 1」：按 Topic 数，多的在前；只有一个 Topic 时只写名字。 */
function topicBreakdown(pages) {
  const counts = new Map();
  for (const page of pages || []) {
    const topic = inferTopicFromPath(page.path) || "其他";
    counts.set(topic, (counts.get(topic) || 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length <= 1) return entries[0]?.[0] || "";
  return entries.map(([topic, count]) => `${topic} ${count}`).join(" · ");
}

function formatScore(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function addIcon(parent, iconName, className = "launchpad-inline-icon") {
  const icon = parent.createSpan({ cls: className });
  setIcon(icon, iconName);
  return icon;
}

function addButton(parent, label, className = "launchpad-btn") {
  return parent.createEl("button", { cls: className, text: label });
}

function makeClickable(element, handler, label = "") {
  element.tabIndex = 0;
  element.setAttribute("role", "button");
  if (label) element.setAttribute("aria-label", label);
  element.addEventListener("click", handler);
  element.addEventListener("keydown", (event) => {
    if (event.target !== element || event.isComposing) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handler(event);
    }
  });
}

class LaunchpadRenderer {
  constructor(view, root, snapshots, pageData, profileId = "content-ops", capabilities = null) {
    this.view = view;
    this.app = view.app;
    this.plugin = view.plugin;
    this.root = root;
    this.snapshots = snapshots;
    this.pages = pageData;
    this.summary = summarizePages(pageData);
    this.panels = {};
    this.tabButtons = {};
    /* 页签集合来自工作台形态，而不是写死的 PAGES */
    this.profileId = LAUNCHPAD_PROFILES[profileId] ? profileId : "content-ops";
    this.profile = launchpadProfile(this.profileId);
    this.tabs = launchpadPages(this.profileId);
    /* KPI 卡的跳转目标按探测到的主 Topic 解析，避免写死 self-media */
    this.capabilities = capabilities;
    this.activeTab = this.loadActiveTab();
  }

  hasTab(id) {
    return this.tabs.some((tab) => tab.id === id);
  }

  loadActiveTab() {
    try {
      const saved = window.localStorage.getItem(TAB_KEY);
      /* 记忆的页签必须属于当前形态：库结构变了（例如删掉 content-projects）
         之后，旧的 create 页签不能把界面卡在一个不存在的页上。 */
      if (this.tabs.some((tab) => tab.id === saved)) return saved;
    } catch (error) {
      // Fall through to the default tab.
    }
    return this.tabs[0].id;
  }

  saveActiveTab(tab) {
    try {
      window.localStorage.setItem(TAB_KEY, tab);
    } catch (error) {
      // localStorage is optional.
    }
  }

  loadRhythmDays() {
    try {
      const saved = Number(window.localStorage.getItem(RHYTHM_DAYS_KEY));
      return RHYTHM_DAY_OPTIONS.includes(saved) ? saved : 30;
    } catch (error) {
      return 30;
    }
  }

  saveRhythmDays(days) {
    try {
      window.localStorage.setItem(RHYTHM_DAYS_KEY, String(days));
    } catch (error) {
      // localStorage is optional.
    }
  }

  loadSystemDrawer() {
    try {
      return window.localStorage.getItem(SYSTEM_DRAWER_KEY) === "open";
    } catch (error) {
      return false;
    }
  }

  saveSystemDrawer(open) {
    try {
      window.localStorage.setItem(SYSTEM_DRAWER_KEY, open ? "open" : "closed");
    } catch (error) {
      // localStorage is optional.
    }
  }

  render() {
    this.root.empty();
    this.renderHero();
    this.renderTabs();
    this.renderedTabs = new Set();
    this.showTab(this.activeTab);
  }

  renderHero() {
    const card = this.root.createDiv({ cls: "launchpad-hero" });
    const header = card.createDiv({ cls: "launchpad-hero-header" });
    const titleGroup = header.createDiv({ cls: "launchpad-hero-title-group" });
    const icon = titleGroup.createDiv({ cls: "launchpad-hero-icon" });
    setIcon(icon, CRISP_LAUNCHPAD_ICON_ID);
    const copy = titleGroup.createDiv();
    copy.createDiv({ cls: "launchpad-hero-title", text: this.profile.heroTitle });

    const actions = header.createDiv({ cls: "launchpad-actions" });
    /* 内核状态胶囊：报告本机 ANKS 内核（Sidecar/bin/anks）能不能干活。
       原先这里显示的是「另一个插件（crisp-dsh）是否启用」—— 那既不是本产品的前置，
       也会让没装 DSH 的人看到「DSH 离线」而以为坏了。
       形态没有 ANKS 语境时（陌生库）整条不渲染。 */
    if (this.profile.features.kernelPill) {
      const caps = this.capabilities || {};
      let label = "内核就绪";
      let dotCls = "launchpad-dot";
      let hint = "本机 ANKS 内核可用：快照刷新、内容项目与确定性转化均已开启。";
      if (Platform.isMobile) {
        label = "移动端只读";
        dotCls = "launchpad-dot is-inactive";
        hint = "移动端不跑本地内核命令；速记、行动编辑与 Markdown 读写仍可用。";
      } else if (!caps.hasCli) {
        label = "内核缺失";
        dotCls = "launchpad-dot is-inactive";
        hint = "未找到 Sidecar/bin/anks：刷新快照、新建项目、转为选题等操作已关闭，界面只读现有快照与 Markdown。";
      }
      const pill = actions.createDiv({ cls: "launchpad-kernel-pill" });
      pill.setAttribute("aria-label", hint);
      pill.title = hint;
      pill.createSpan({ cls: dotCls });
      pill.createSpan({ text: label });
    }
    actions.createDiv({
      cls: "launchpad-date-badge",
      text: new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "short",
      }).format(new Date()),
    });
  }

  renderSystemStatus(card) {
    const health = this.snapshots.health;
    const index = this.snapshots.index;
    const strip = card.createDiv({ cls: "launchpad-system-status" });
    const main = strip.createDiv({ cls: "launchpad-system-status-main" });
    const dot = main.createSpan({ cls: "launchpad-status-dot" });
    const copy = main.createDiv({ cls: "launchpad-status-copy" });
    const title = copy.createDiv({ cls: "launchpad-status-title" });
    const meta = copy.createDiv({ cls: "launchpad-status-meta" });

    const metrics = strip.createDiv({ cls: "launchpad-system-status-metrics" });
    const metricValues = {};
    for (const definition of [
      ["blocking", SEVERITY_LABEL.blocking],
      ["operational", SEVERITY_LABEL.operational],
      ["informational", SEVERITY_LABEL.informational],
      ["documents", "索引文档"],
    ]) {
      const metric = metrics.createDiv({ cls: "launchpad-status-metric" });
      metricValues[definition[0]] = metric.createDiv({
        cls: "launchpad-status-metric-value",
        text: "–",
      });
      metric.createDiv({ cls: "launchpad-status-metric-label", text: definition[1] });
    }

    const actions = strip.createDiv({ cls: "launchpad-actions launchpad-system-status-actions" });
    const refresh = addButton(actions, "刷新快照", "launchpad-btn is-accent");
    refresh.disabled =
      !this.plugin.settings.allowSnapshotRefresh || !this.plugin.canRunAnks();
    if (!this.plugin.canRunAnks()) {
      refresh.title = "移动端只读取现有快照，请在桌面端刷新";
    }
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      try {
        await this.view.plugin.refreshSystemSnapshots();
        await this.view.render();
      } catch (error) {
        new Notice(`Crisp Launchpad：${error.message || error}`, 8000);
        refresh.disabled = false;
      }
    });
    const repair = addButton(actions, "环境修复");
    repair.disabled = !this.plugin.canRunAnks();
    if (repair.disabled) repair.title = "移动端不支持本地 CLI 修复";
    repair.addEventListener("click", () => {
      new LaunchpadOnboardingModal(this.app, this.plugin, { repairOnly: true }).open();
    });

    if (!health) {
      dot.addClass("is-warning");
      title.setText("系统快照缺失");
      meta.setText(
        this.plugin.canRunAnks()
          ? "运行 `sh Sidecar/bin/anks snapshot build` 后重新打开启动台。"
          : "移动端只读取现有快照；请在桌面端生成后同步 Vault。",
      );
      return;
    }

    const counts = health.data?.counts || {};
    const blocking = Number(counts.blocking || 0);
    const operational = Number(counts.operational || 0);
    const informational = Number(counts.informational || 0);
    const documents = Number(index?.data?.documents || 0);
    const chunks = Number(index?.data?.chunks || 0);
    metricValues.blocking.setText(String(blocking));
    metricValues.operational.setText(String(operational));
    metricValues.informational.setText(String(informational));
    metricValues.documents.setText(String(documents));

    const age = snapshotAge(health.generated_at);
    const state = blocking > 0 ? "error" : health.data?.status === "healthy" ? "healthy" : "warning";
    const refreshError = textOr(this.plugin.autoSyncLastError);
    if (refreshError) {
      dot.addClass("is-warning");
      title.setText("状态刷新失败 · 显示上次结果");
      meta.setText(snapshotAgeLabel(age) + " · " + refreshError);
      return;
    }
    dot.addClass(`is-${state}`);
    title.setText(
      blocking > 0
        ? `系统阻塞 · ${blocking}`
        : state === "healthy"
          ? "系统健康"
          : "系统可用 · 有运营待办",
    );
    meta.setText(
      `${snapshotAgeLabel(age)} · 索引 ${documents} 篇 / ${chunks} 段${age !== null && age > 24 ? " · 已陈旧" : ""}`,
    );
  }

  renderTabs() {
    const tabs = this.root.createDiv({ cls: "launchpad-tabs" });
    for (const page of this.tabs) {
      const button = tabs.createEl("button", {
        cls: `launchpad-tab${page.id === this.activeTab ? " is-active" : ""}`,
        text: page.name,
      });
      this.tabButtons[page.id] = button;
      button.addEventListener("click", () => this.showTab(page.id));
    }
    for (const page of this.tabs) {
      const isActive = page.id === this.activeTab;
      const panel = this.root.createDiv({
        cls: `launchpad-page${isActive ? " is-active" : ""}`,
      });
      if (!isActive) {
        panel.style.display = "none";
      }
      this.panels[page.id] = panel;
    }
  }

  showTab(tab) {
    if (!this.hasTab(tab)) return;
    if (!this.renderedTabs.has(tab)) {
      const renderers = { today: "renderToday", create: "renderCreate", knowledge: "renderKnowledge", review: "renderReview", system: "renderSystem" };
      this[renderers[tab]]();
      insetCardBodies(this.panels[tab]);
      this.renderedTabs.add(tab);
    }
    this.activeTab = tab;
    this.saveActiveTab(tab);
    for (const page of this.tabs) {
      const isActive = page.id === tab;
      if (this.panels[page.id]) {
        this.panels[page.id].style.display = isActive ? "" : "none";
        this.panels[page.id].toggleClass("is-active", isActive);
      }
      if (this.tabButtons[page.id]) {
        this.tabButtons[page.id].toggleClass("is-active", isActive);
      }
    }
  }

  renderActionCard(parent) {
    const card = parent.createDiv({ cls: "launchpad-card launchpad-action-card" });
    const header = card.createDiv({ cls: "launchpad-card-header" });
    const title = header.createDiv({ cls: "launchpad-card-title" });
    addIcon(title, CRISP_NOW_ICON_ID);
    title.createSpan({ text: "行动台" });
    const usesTempo = this.plugin.usesTempo();
    if (!usesTempo) title.createSpan({ cls: "launchpad-badge", text: "未连接 Tempo" });
    const headerActions = header.createDiv({ cls: "launchpad-actions" });
    const snapshot = this.snapshots.actions;
    const liveTasks = Array.isArray(this.snapshots.tasks)
      ? this.snapshots.tasks.filter((task) => !task.done)
      : [];
    const liveCounts = {
      overdue: liveTasks.filter((task) => task.bucket === "overdue").length,
      today: liveTasks.filter((task) => task.bucket === "today").length,
      waiting: liveTasks.filter((task) => task.bucket === "waiting").length,
      upcoming: liveTasks.filter((task) => task.bucket === "upcoming").length,
      anytime: liveTasks.filter((task) => task.bucket === "anytime").length,
      inbox: liveTasks.filter((task) => task.bucket === "inbox").length,
    };
    const liveTotal = liveTasks.length;
    const completedTotal = Array.isArray(this.snapshots.tasks)
      ? this.snapshots.tasks.filter((task) => task.done).length
      : 0;
    const snapshotTotal = Object.values(snapshot?.counts || {}).reduce(
      (sum, value) => sum + Number(value || 0),
      0,
    );

    // Tempo is the action authority; its live data wins over a possibly stale snapshot.
    const useLive = Array.isArray(this.snapshots.tasks);
    const countsSource = useLive ? liveCounts : (snapshot?.counts || liveCounts);
    const totalCount = useLive ? liveTotal : snapshotTotal;

    // Same rule as actions_snapshot.py: today + overdue against the
    // snapshot's limit (default 5).
    const wipLimit = Number(snapshot?.load?.limit) || 5;
    const wipActive = Number(countsSource.overdue || 0) + Number(countsSource.today || 0);
    const wipOver = wipActive > wipLimit;
    const wipBadge = title.createSpan({
      cls: `launchpad-badge${wipOver ? " is-warning" : ""}`,
      text: `负荷 ${wipActive}/${wipLimit}`,
    });
    wipBadge.title = wipOver
      ? `今天 + 逾期共 ${wipActive} 项，超过上限 ${wipLimit}：先完成或改到以后`
      : `今天 + 逾期共 ${wipActive} 项，上限 ${wipLimit}`;

    /* 读的是 Tempo 实时数据时不挂来源徽章；只有退回旧快照时才提示快照时间并给刷新按钮。 */
    if (!useLive) {
      const age = snapshotAge(snapshot?.generated_at || snapshot);
      const stale = age !== null && age > 24;
      headerActions.createDiv({
        cls: `launchpad-badge${stale ? " is-warning" : ""}`,
        text: `快照 · ${snapshotAgeLabel(age)}${stale ? " (已陈旧)" : ""}`,
      });
      const refresh = addButton(headerActions, "刷新行动");
      refresh.disabled =
        !this.plugin.settings.allowSnapshotRefresh || !this.plugin.canRunAnks();
      if (!this.plugin.canRunAnks()) {
        refresh.title = "快照请在桌面端刷新";
      }
      refresh.addEventListener("click", async () => {
        refresh.disabled = true;
        try {
          await this.view.plugin.refreshActionSnapshots();
          await this.view.render();
        } catch (error) {
          new Notice(`Crisp Launchpad：${error.message || error}`, 8000);
          refresh.disabled = false;
        }
      });
    }
    const newAction = addButton(headerActions, "新建行动");
    const openNow = addButton(headerActions, "打开 Tempo", "launchpad-btn is-accent");
    openNow.addEventListener("click", () => this.plugin.openActionBoard());
    newAction.addEventListener("click", () => this.plugin.openNewAction());

    /* 分段控件：「全部」是默认双栏，其余各看一个分桶。逾期为 0 时不占位。 */
    const seg = card.createDiv({ cls: "launchpad-seg launchpad-action-seg" });
    seg.setAttribute("role", "tablist");
    seg.setAttribute("aria-label", "行动分组");
    const countDefs = [
      ["overdue", "逾期"],
      ["today", "今天"],
      ["waiting", "等待"],
      ["upcoming", "即将"],
      ["anytime", "随时"],
      /* Tempo 收件箱：还没排进计划的任务。 */
      ["inbox", "收件箱"],
    ].filter(([key]) => key !== "overdue" || Number(countsSource.overdue || 0) > 0);

    const groups = new Map((snapshot?.groups || []).map((group) => [group.id, group.items || []]));
    const getBucketTasks = (bucket) => {
      if (useLive) {
        return liveTasks.filter((t) => t.bucket === bucket);
      }
      return (groups.get(bucket) || []).map((item) => ({ ...item, bucket }));
    };

    let currentFilter = this.view.activeActionFilter || null;
    if (currentFilter && !countDefs.some(([key]) => key === currentFilter)) currentFilter = null;
    const segButtons = new Map();
    const addSegButton = (key, label, num = null) => {
      const button = seg.createEl("button", {
        cls: `launchpad-seg-btn${num === 0 ? " is-zero" : ""}`,
        attr: { type: "button", role: "tab" },
      });
      button.createSpan({ text: label });
      if (num !== null) button.createSpan({ cls: "launchpad-seg-count", text: String(num) });
      button.addEventListener("click", () => {
        currentFilter = key;
        this.view.activeActionFilter = currentFilter;
        updateActionView();
      });
      segButtons.set(key, button);
    };
    addSegButton(null, "全部", null);
    for (const [key, label] of countDefs) addSegButton(key, label, Number(countsSource[key] || 0));

    const bodyWrap = card.createDiv({ cls: "launchpad-action-body-wrap" });
    const statusEl = card.createDiv({ cls: "launchpad-action-status" });

    const updateActionView = () => {
      for (const [key, button] of segButtons.entries()) {
        button.setAttribute("aria-selected", String(currentFilter === key));
      }

      bodyWrap.empty();
      statusEl.setText("");

      if (!usesTempo) {
        this.renderEmpty(bodyWrap, `${TEMPO_REQUIRED_HINT}，行动会显示在这里`);
        return;
      }

      if (!currentFilter) {
        const grid = bodyWrap.createDiv({ cls: "launchpad-action-grid" });
        const overdueTasks = getBucketTasks("overdue");
        const todayTasks = getBucketTasks("today");
        const waitingTasks = getBucketTasks("waiting");
        const upcomingTasks = getBucketTasks("upcoming");

        const todayColumn = grid.createDiv({ cls: "launchpad-action-column" });
        const todayTitle = todayColumn.createDiv({ cls: "launchpad-action-column-title" });
        if (overdueTasks.length > 0) {
          todayTitle.createSpan({ text: `逾期 (${overdueTasks.length}) · 今天 (${todayTasks.length})` });
        } else {
          todayTitle.createSpan({ text: `今天 (${todayTasks.length})` });
        }
        const todayList = todayColumn.createDiv({ cls: "launchpad-action-list" });
        const focusTasks = [...overdueTasks, ...todayTasks];
        if (!focusTasks.length) {
          const next = [...getBucketTasks("anytime"), ...getBucketTasks("inbox")];
          if (next.length) todayTitle.setText(`接下来 (${next.length})`);
          this.renderActionItems(todayList, next, 5);
        } else {
          this.renderActionItems(todayList, focusTasks, 8);
        }

        const laterColumn = grid.createDiv({ cls: "launchpad-action-column" });
        const laterTitle = laterColumn.createDiv({ cls: "launchpad-action-column-title" });
        laterTitle.createSpan({ text: `等待 (${waitingTasks.length}) · 即将 (${upcomingTasks.length})` });
        const laterList = laterColumn.createDiv({ cls: "launchpad-action-list" });
        this.renderActionItems(laterList, [...waitingTasks, ...upcomingTasks], 8);

      } else {
        const empty = {
          overdue: "没有逾期的行动",
          today: "今天没有安排行动",
          waiting: "没有在等别人的事",
          upcoming: "近期没有排期",
          anytime: "随时池是空的",
          inbox: "Tempo 收件箱是空的",
        }[currentFilter] || "当前没有行动";
        const filteredTasks = getBucketTasks(currentFilter);
        const listContainer = bodyWrap.createDiv({ cls: "launchpad-action-list is-single-column" });
        if (!filteredTasks.length) {
          this.renderEmpty(listContainer, empty);
        } else {
          this.renderActionItems(listContainer, filteredTasks, 20);
        }
      }
      if (!useLive) {
        statusEl.setText(`${snapshot?.source?.label || "ANKS 行动快照"} · ${totalCount} 条未完成${completedTotal ? ` · ${completedTotal} 条已完成` : ""}`);
      }
    };

    updateActionView();
  }

  renderActionItems(container, items, limit = 8) {
    if (!items.length) {
      this.renderEmpty(container, "当前没有行动");
      return;
    }
    for (const item of items.slice(0, limit)) {
      const row = container.createDiv({ cls: "launchpad-breakdown-row launchpad-action-item" });
      const left = row.createDiv({ cls: "launchpad-row-left" });
      left.createDiv({ cls: "launchpad-row-title", text: item.title });
      const right = row.createDiv({ cls: "launchpad-row-right" });
      if (item.project) right.createSpan({ cls: "launchpad-badge", text: item.project });
      right.createSpan({ text: actionItemMeta(item) });
      makeClickable(
        row,
        () => this.plugin.openAction(item, (path, title) => this.view.openTarget(path, title)),
        `打开行动：${item.title}`,
      );
    }
  }

  renderKpis(parent) {
    const data = this.summary;
    const topic = primaryTopic(this.capabilities);
    const prefix = topic ? `Topics/${topic}/` : "";
    const contentRoot = contentProjectsPath(primaryContentTopic(this.capabilities));
    /* 除内容项目外都按全库各 Topic 合计，副标题写分布；「待整理」和今天一行、待整理卡片同一个数。 */
    const inTopics = (pages) => pages.filter((page) => page.path.startsWith("Topics/"));
    const groups = {
      inbox: data.inbox,
      knowledge: inTopics(data.knowledge),
      raw: inTopics(data.raw),
      outputs: inTopics(data.outputs),
      active: inTopics(data.active),
    };
    const values = {
      projects: data.articles.filter((page) => contentRoot && page.path.startsWith(`${contentRoot}/`)).length,
      ...Object.fromEntries(Object.entries(groups).map(([key, pages]) => [key, pages.length])),
    };
    const keys = (this.profile.kpis || Object.keys(KPI_DEFINITIONS)).filter((key) => KPI_DEFINITIONS[key]);
    const kpis = keys.map((key) => {
      const definition = KPI_DEFINITIONS[key];
      const scope = key === "projects" ? primaryContentTopic(this.capabilities) : topicBreakdown(groups[key]) || "—";
      return [values[key], definition.label, scope, resolveKpiTarget(definition.path, this.capabilities)];
    }).filter(([, , , target]) => target);
    if (!kpis.length) return;
    const grid = parent.createDiv({ cls: "launchpad-kpi-row" });
    for (const [value, label, subtitle, target] of kpis) {
      const card = grid.createDiv({ cls: "launchpad-kpi-box" });
      card.createDiv({ cls: "launchpad-kpi-label", text: label });
      card.createDiv({ cls: "launchpad-kpi-val", text: String(value) });
      card.createDiv({ cls: "launchpad-kpi-sub", text: subtitle });
      makeClickable(card, () => this.view.openTarget(target, label), `${label}（${subtitle}）`);
    }
  }

  /* 复盘页的近期节奏：读 Crisp Pulse 的 getRecentDays()（1.42.0+），柱高是每天的贡献分，
     没有记录的日子画虚柱，不当成 0。没有 Pulse 时只给一句提示。 */
  renderPulseRhythm(parent) {
    const card = parent.createDiv({ cls: "launchpad-card launchpad-pulse-rhythm" });
    const header = card.createDiv({ cls: "launchpad-card-header" });
    const title = header.createDiv({ cls: "launchpad-card-title" });
    addIcon(title, "activity");
    title.createSpan({ text: "近期节奏" });
    const actions = header.createDiv({ cls: "launchpad-actions" });
    const body = card.createDiv({ cls: "launchpad-pulse-body" });
    const recent = this.snapshots.signals?.recent;
    const pulseOn = Boolean(this.app.plugins?.enabledPlugins?.has(PULSE_PLUGIN_ID));
    if (!recent) {
      this.renderEmpty(body, pulseOn ? "更新 Crisp Pulse 到 1.42.0 以上后，这里显示每天的贡献节奏" : "启用 Crisp Pulse 后，这里显示每天的贡献节奏");
      return;
    }
    const seg = actions.createDiv({ cls: "launchpad-seg" });
    seg.setAttribute("role", "tablist");
    seg.setAttribute("aria-label", "时间范围");
    const open = addButton(actions, "在 Pulse 看复盘");
    open.addEventListener("click", () => this.plugin.runCrispCommand("crisp-pulse:open-crisp-pulse-view", "Crisp Pulse"));
    const buttons = new Map();
    const draw = (range) => {
      this.saveRhythmDays(range);
      for (const [value, button] of buttons) button.setAttribute("aria-selected", String(value === range));
      body.empty();
      const days = recent.days.slice(-range);
      const recorded = days.filter((day) => day.recorded);
      const active = recorded.filter((day) => day.active).length;
      const focus = recorded.reduce((sum, day) => sum + (Number(day.focusMinutes) || 0), 0);
      const tasks = recorded.reduce((sum, day) => sum + (Number(day.tasksCompleted) || 0), 0);
      const stats = body.createDiv({ cls: "launchpad-pulse-stats" });
      for (const [value, label] of [
        [`${active} / ${recorded.length}`, "有产出 / 有记录"],
        [`${Number(recent.streak) || 0} 天`, "连续"],
        [focus >= 60 ? `${(focus / 60).toFixed(1)} 小时` : `${focus} 分钟`, "专注"],
        [String(tasks), "完成任务"],
      ]) {
        const cell = stats.createDiv({ cls: "launchpad-pulse-stat" });
        cell.createDiv({ cls: "launchpad-today-value", text: value });
        cell.createDiv({ cls: "launchpad-today-label", text: label });
      }
      const max = Math.max(1, ...recorded.map((day) => Number(day.score) || 0));
      const chart = body.createDiv({ cls: "launchpad-pulse-bars" });
      chart.setAttribute("role", "img");
      chart.setAttribute("aria-label", `近 ${range} 天每天的贡献分`);
      for (const day of days) {
        const bar = chart.createDiv({ cls: `launchpad-pulse-bar${day.recorded ? "" : " is-missing"}${day.active ? " is-active" : ""}` });
        const score = Number(day.score) || 0;
        bar.style.height = day.recorded ? `${Math.max(4, Math.round((score / max) * 100))}%` : "100%";
        bar.setAttribute("aria-label", day.recorded ? `${day.date} · ${formatScore(score)} 分` : `${day.date} · 未记录`);
        bar.setAttribute("data-tooltip-position", "top");
      }
    };
    for (const range of RHYTHM_DAY_OPTIONS) {
      const button = seg.createEl("button", { cls: "launchpad-seg-btn", text: `${range} 天`, attr: { type: "button", role: "tab" } });
      button.addEventListener("click", () => draw(range));
      buttons.set(range, button);
    }
    draw(this.loadRhythmDays());
  }

  renderWorkGrid(parent) {
    const topic = primaryTopic(this.capabilities);
    const topicPrefix = topic ? `Topics/${topic}/` : "";
    const topicCapabilities = this.capabilities?.perTopic?.[topic] || {};
    /* 全库未归位材料，和今天一行、KPI 同一个数；多个 Topic 时每行标 Topic。 */
    const inboxPages = [...this.summary.inbox].sort((left, right) => (right.mtime || 0) - (left.mtime || 0));
    const multiTopic = new Set(inboxPages.map((page) => inferTopicFromPath(page.path))).size > 1;
    const grid = parent.createDiv({ cls: "launchpad-grid-2" });
    const inboxCard = grid.createDiv({ cls: "launchpad-card launchpad-inbox-card" });
    const inboxHeader = inboxCard.createDiv({ cls: "launchpad-card-header" });
    const inboxTitle = inboxHeader.createDiv({ cls: "launchpad-card-title" });
    addIcon(inboxTitle, "inbox");
    inboxTitle.createSpan({ text: "待整理" });
    inboxTitle.createSpan({ cls: "launchpad-badge", text: `${inboxPages.length} 条` });
    if (topicCapabilities.inboxPath) {
      const inboxBtn = addButton(inboxHeader, "收件箱 ↗");
      inboxBtn.addEventListener("click", () => this.view.openTarget(topicCapabilities.inboxPath, "收件箱"));
    }
    const inboxList = inboxCard.createDiv({ cls: "launchpad-breakdown-card" });
    if (!inboxPages.length) {
      this.renderEmpty(inboxList, "没有待整理的材料");
    } else {
      const renderInboxRow = (page) => {
        const row = inboxList.createDiv({ cls: "launchpad-breakdown-row" });
        const left = row.createDiv({ cls: "launchpad-row-left" });
        left.createDiv({ cls: "launchpad-row-title", text: page.name });
        const right = row.createDiv({ cls: "launchpad-row-right" });
        if (multiTopic) right.createSpan({ text: inferTopicFromPath(page.path) });
        const age = daysBetween(new Date(), page.mtime);
        right.createSpan({ text: age === null ? "时间未知" : age === 0 ? "今天" : `${age} 天前` });
        const convert = addButton(right, "转化", "launchpad-row-action");
        convert.addEventListener("click", (event) => {
          event.stopPropagation();
          new InboxConversionModal(this.app, this.plugin, this.view, page).open();
        });
        makeClickable(row, () => this.view.openTarget(page.path, page.name), `打开待整理：${page.name}`);
      };
      inboxPages.slice(0, 6).forEach(renderInboxRow);
      if (inboxPages.length > 6) {
        const more = addButton(inboxList, `查看全部 ${inboxPages.length} 条`, "launchpad-row-action launchpad-list-more");
        more.addEventListener("click", () => {
          more.remove();
          inboxPages.slice(6).forEach(renderInboxRow);
        });
      }
    }

    const outputTarget = topicCapabilities.outputsPath || topicCapabilities.contentProjectsPath;
    if (outputTarget || topicCapabilities.hasContentProjects) {
      const outputCard = grid.createDiv({ cls: "launchpad-card" });
      const outputHeader = outputCard.createDiv({ cls: "launchpad-card-header" });
      const outputTitle = outputHeader.createDiv({ cls: "launchpad-card-title" });
      addIcon(outputTitle, "sun");
      outputTitle.createSpan({ text: "最近产出" });
      outputTitle.createSpan({ cls: "launchpad-badge", text: "已发布" });
      if (outputTarget) {
        const outputLabel = topicCapabilities.outputsPath ? "产出目录" : "内容项目";
        const outputBtn = addButton(outputHeader, `${outputLabel} ↗`);
        outputBtn.addEventListener("click", () => this.view.openTarget(outputTarget, outputLabel));
      }
      const outputList = outputCard.createDiv({ cls: "launchpad-breakdown-card" });
      const recent = publishedOutputPages(this.pages, topicPrefix).slice(0, 5);
      if (!recent.length) {
        this.renderEmpty(outputList, "还没有已发布产出");
      } else {
        for (const page of recent) {
          const row = outputList.createDiv({ cls: "launchpad-breakdown-row" });
          const left = row.createDiv({ cls: "launchpad-row-left" });
          left.createDiv({ cls: "launchpad-row-title", text: pageLabel(page) });
          const right = row.createDiv({ cls: "launchpad-row-right" });
          if (page.platform) right.createSpan({ text: page.platform });
          right.createSpan({ cls: "launchpad-badge", text: formatShortDate(publicationTimestamp(page)) });
          makeClickable(row, () => this.view.openTarget(page.path, page.title), `打开产出：${page.title}`);
        }
      }
    }
  }

  renderToday() {
    // 首屏聚焦行动、需要人判断的事项和一句系统状态；统计与完整队列放在次级页。
    this.renderTodayStrip(this.panels.today);
    this.renderActionCard(this.panels.today);
    if (this.profile.features.review && this.hasTab("review")) {
      this.renderTodayReviewSummary(this.panels.today);
    }
    this.renderToolCard(this.panels.today);
    if (this.profile.features.kernelPill) this.renderSystemSummary(this.panels.today);
  }

  /* 今天一行：各项只在数据源可用时出现。邻居插件没装、读失败或返回 null 时整项不显示，不当成 0。 */
  renderTodayStrip(parent) {
    const items = [];
    const signals = this.snapshots.signals || {};
    if (this.plugin.usesTempo() && Array.isArray(this.snapshots.tasks)) {
      const open = this.snapshots.tasks.filter((task) => !task.done);
      const due = open.filter((task) => task.bucket === "overdue" || task.bucket === "today").length;
      const overdue = open.filter((task) => task.bucket === "overdue").length;
      items.push({
        label: "行动", value: String(due), warn: overdue > 0,
        hint: overdue ? `今天 ${due - overdue} 项，逾期 ${overdue} 项` : "今天要做的行动",
        open: () => this.plugin.openActionBoard(),
      });
      if (Number.isFinite(signals.completed)) {
        items.push({ label: "已完成", value: String(signals.completed), hint: "今天在 Tempo 完成", open: () => this.plugin.openActionBoard() });
      }
    }
    const pulse = signals.pulse;
    if (pulse) {
      const openPulse = () => this.plugin.runCrispCommand("crisp-pulse:open-crisp-pulse-view", "Crisp Pulse");
      items.push({ label: "贡献分", value: formatScore(pulse.score), hint: "Crisp Pulse 今天的贡献分", open: openPulse });
      items.push({ label: "连续", value: `${Number(pulse.streak) || 0} 天`, hint: "连续有产出的天数", open: openPulse });
      const backlog = signals.memoBacklog;
      if (backlog) {
        items.push({
          label: "速记待处理", value: String(Number(backlog.pending)), hint: `近 ${backlog.days} 天还没转成任务或笔记的速记`,
          open: () => this.plugin.openMemoBacklog(backlog),
        });
      } else if (pulse.memos && Number.isFinite(Number(pulse.memos.pending))) {
        items.push({
          label: "速记待处理", value: String(Number(pulse.memos.pending)), hint: "今天记下、还没转成任务或笔记的速记",
          open: () => this.plugin.runCrispCommand("crisp-pulse:open-memo-view", "Crisp Pulse 速记"),
        });
      }
    }
    if (this.profile.features.workGrid) {
      const inbox = this.summary.inbox.length;
      items.push({
        label: "待整理", value: String(inbox), hint: "全库 raw/inbox 里还没归位的材料",
        open: () => this.showTab("knowledge"),
      });
    }
    if (!items.length) return;
    const strip = parent.createDiv({ cls: "launchpad-today-strip" });
    for (const item of items) {
      const cell = strip.createDiv({ cls: `launchpad-today-item${item.warn ? " is-warning" : ""}` });
      cell.createDiv({ cls: "launchpad-today-value", text: item.value });
      cell.createDiv({ cls: "launchpad-today-label", text: item.label });
      cell.setAttribute("data-tooltip-position", "top");
      makeClickable(cell, item.open, `${item.label} ${item.value}：${item.hint}`);
    }
  }

  renderToolCard(parent) {
    const groups = availableCrispTools(this.app.plugins?.enabledPlugins, (id) => this.plugin.hasCommand(id));
    if (!groups.length) return;
    const card = parent.createDiv({ cls: "launchpad-card" });
    const header = card.createDiv({ cls: "launchpad-card-header" });
    const title = header.createDiv({ cls: "launchpad-card-title" });
    addIcon(title, "layout-grid");
    title.createSpan({ text: "Crisp 工具" });
    const list = card.createDiv({ cls: "launchpad-tool-groups" });
    for (const group of groups) {
      const row = list.createDiv({ cls: "launchpad-tool-group" });
      row.createDiv({ cls: "launchpad-tool-group-label", text: group.label });
      const tools = row.createDiv({ cls: "launchpad-tool-list" });
      for (const tool of group.tools) {
        const button = tools.createEl("button", { cls: "launchpad-tool" });
        addIcon(button, tool.icon, "launchpad-tool-icon");
        button.createSpan({ text: tool.name });
        button.addEventListener("click", () => {
          if (!this.app.commands.executeCommandById(tool.command)) {
            new Notice(`Crisp Launchpad：「${tool.name}」暂时打不开`);
          }
        });
      }
    }
  }

  renderTodayReviewSummary(parent) {
    const queues = this.getReviewQueues();
    const writebackCounts = new Map();
    for (const finding of queues.writebacks) {
      const label = reviewFindingCategory(finding);
      writebackCounts.set(label, (writebackCounts.get(label) || 0) + 1);
    }
    const toReview = () => this.showTab("review");
    const backlog = this.snapshots.signals?.memoBacklog;
    const groups = [
      ...[...writebackCounts.entries()].map(([label, count]) => [count, label, toReview]),
      [queues.reviewingProjects.length, "内容待复盘", toReview],
      [queues.staleInbox.length, STALE_INBOX_LABEL, toReview],
      ...(backlog ? [[Number(backlog.pending), `近 ${backlog.days} 天的速记还没去处`, () => this.plugin.openMemoBacklog(backlog)]] : []),
    ];
    const pending = groups.filter(([count]) => count > 0);
    const card = parent.createDiv({ cls: "launchpad-card" });
    const header = card.createDiv({ cls: "launchpad-card-header" });
    const title = header.createDiv({ cls: "launchpad-card-title" });
    addIcon(title, "check-circle");
    title.createSpan({ text: "待你判断" });
    const button = addButton(header, "打开复盘 ↗");
    button.addEventListener("click", () => this.showTab("review"));
    if (!pending.length) {
      this.renderEmpty(card, "暂无待复盘事项");
      return;
    }
    const list = card.createDiv({ cls: "launchpad-judge-list" });
    for (const [count, label, open] of pending.sort((a, b) => b[0] - a[0])) {
      const row = list.createDiv({ cls: "launchpad-judge-row" });
      row.createSpan({ cls: "launchpad-judge-count", text: String(count) });
      row.createSpan({ cls: "launchpad-judge-label", text: label });
      addIcon(row, "chevron-right", "launchpad-judge-go");
      makeClickable(row, open, `${label} ${count} 项`);
    }
  }

  renderSystemSummary(parent) {
    const card = parent.createDiv({ cls: "launchpad-card launchpad-today-status-card" });
    const strip = card.createDiv({ cls: "launchpad-system-status" });
    const main = strip.createDiv({ cls: "launchpad-system-status-main" });
    const dot = main.createSpan({ cls: "launchpad-status-dot" });
    const copy = main.createDiv({ cls: "launchpad-status-copy" });
    const title = copy.createDiv({ cls: "launchpad-status-title" });
    const meta = copy.createDiv({ cls: "launchpad-status-meta" });
    const actions = strip.createDiv({ cls: "launchpad-actions launchpad-system-status-actions" });
    const details = addButton(actions, "系统详情 ↗");
    details.addEventListener("click", () => this.showTab("system"));

    const health = this.snapshots.health;
    const counts = health?.data?.counts || {};
    const blocking = Number(counts.blocking || 0);
    const refreshError = textOr(this.plugin.autoSyncLastError);
    const age = snapshotAge(health?.generated_at);
    if (!health) {
      dot.addClass("is-warning");
      title.setText(this.capabilities?.hasCli ? "系统状态待检查" : "本机内核未配置");
      meta.setText("完整状态和配置入口在系统页。");
      return;
    }
    if (refreshError) {
      dot.addClass("is-warning");
      title.setText("状态刷新失败 · 显示上次结果");
    } else if (blocking > 0) {
      dot.addClass("is-error");
      title.setText(`有 ${blocking} 项阻塞`);
    } else if (health.data?.status === "healthy") {
      dot.addClass("is-healthy");
      title.setText("系统检查正常 · 0 项阻塞");
    } else {
      dot.addClass("is-warning");
      title.setText("系统可运行 · 有运营待办");
    }
    meta.setText(`${snapshotAgeLabel(age)} · 完整队列收在系统页。`);
  }

  renderSystemDrawer(parent) {
    const card = parent.createDiv({ cls: "launchpad-card" });
    const health = this.snapshots.health;
    const counts = health?.data?.counts || {};
    const blocking = Number(counts.blocking || 0);
    const operational = Number(counts.operational || 0);
    const informational = Number(counts.informational || 0);
    const details = card.createEl("details", { cls: "launchpad-system-drawer" });
    details.open = this.loadSystemDrawer();
    details.addEventListener("toggle", () => this.saveSystemDrawer(details.open));
    details.createEl("summary", {
      cls: "launchpad-system-drawer-summary",
      text: health
        ? `系统状态 · ${blocking} 项阻塞 / ${operational} 项待办 / ${informational} 项提示`
        : "系统状态 · 快照缺失",
    });
    const body = details.createDiv({ cls: "launchpad-system-drawer-body" });
    this.renderSystemStatus(body);
  }

  renderCreate() {
    const topic = primaryContentTopic(this.capabilities);
    const platform = primaryContentPlatform(this.capabilities, topic);
    const topicCapabilities = this.capabilities?.perTopic?.[topic] || {};
    const projectRoot = contentProjectsPath(topic);
    const contentIndexTarget = topicCapabilities.contentIndexPath || topicCapabilities.contentProjectsPath;
    /* 阶段和状态以控制卡 project.md 为准（推进弹窗、复盘页、ANKS 都读它），article.md 只提供标题和打开目标。 */
    const controlByFolder = new Map(
      (this.pages || [])
        .filter((page) => page.content_role === "project-control" && page.stage)
        .map((page) => [page.folder, page]),
    );
    const articles = this.summary.articles
      .filter((article) => projectRoot && article.path.startsWith(`${projectRoot}/`))
      .map((article) => {
        const control = controlByFolder.get(article.folder);
        return control ? { ...article, stage: control.stage, status: control.status || article.status } : article;
      });
    const profiles = topicCapabilities.profiles?.[platform] || [];
    const canCreateProject = Boolean(topic && platform && profiles.length);
    const buckets = buildStageBuckets(articles);
    const flowCard = this.panels.create.createDiv({ cls: "launchpad-card" });
    const flowHeader = flowCard.createDiv({ cls: "launchpad-card-header" });
    const flowTitle = flowHeader.createDiv({ cls: "launchpad-card-title" });
    addIcon(flowTitle, "content");
    flowTitle.createSpan({ text: "内容流向" });
    flowHeader.createDiv({ cls: "launchpad-badge", text: `共 ${articles.length} 个内容项目` });
    const total = buckets.reduce((sum, [, rows]) => sum + rows.length, 0);
    const bar = flowCard.createDiv({ cls: "launchpad-dist-bar" });
    const legend = flowCard.createDiv({ cls: "launchpad-flow-legend" });
    /* 同一种强调色按阶段先后由深到浅；每段都在图例里写出阶段名和数量，点图例跳到流水线里的该阶段。 */
    const stageGroups = new Map();
    buckets.forEach(([stage, rows], index) => {
      const strength = buckets.length > 1 ? Math.round(95 - (index * 75) / (buckets.length - 1)) : 80;
      const color = `color-mix(in srgb, var(--interactive-accent) ${strength}%, transparent)`;
      const segment = bar.createDiv({ cls: "launchpad-dist-seg" });
      segment.style.width = total ? `${(rows.length / total) * 100}%` : "0";
      segment.style.background = color;
      const item = legend.createDiv({ cls: "launchpad-flow-legend-item" });
      const swatch = item.createSpan({ cls: "launchpad-flow-swatch" });
      swatch.style.background = color;
      item.createSpan({ text: stageLabel(stage) });
      item.createSpan({ cls: "launchpad-flow-count", text: String(rows.length) });
      makeClickable(item, () => stageGroups.get(stage)?.scrollIntoView?.({ block: "start", behavior: "smooth" }), `${stageLabel(stage)} ${rows.length} 篇`);
    });
    const updatedByDir = new Map(
      (Array.isArray(this.snapshots.content?.data) ? this.snapshots.content.data : [])
        .map((project) => [textOr(project?.dir), Date.parse(textOr(project?.updated_at))]),
    );
    const today = new Date();

    const pipeline = this.panels.create.createDiv({ cls: "launchpad-card" });
    const pipelineHeader = pipeline.createDiv({ cls: "launchpad-card-header launchpad-pipeline-header" });
    const pipelineTitle = pipelineHeader.createDiv({ cls: "launchpad-card-title" });
    addIcon(pipelineTitle, "content");
    pipelineTitle.createSpan({ text: "创作流水线" });
    const pipelineActions = pipelineHeader.createDiv({ cls: "launchpad-actions" });
    const newProjectButton = addButton(pipelineActions, "新建项目", "launchpad-btn is-primary");
    newProjectButton.disabled = !canCreateProject;
    if (!canCreateProject) {
      newProjectButton.title = "当前 Topic 尚未配置内容项目模板和 Profile";
    }
    const baseButton = topicCapabilities.basePath
      ? addButton(pipelineActions, "内容总览 Base")
      : null;
    const dashboardButton = topicCapabilities.dashboardPath
      ? addButton(pipelineActions, "作战大盘 ↗")
      : null;
    newProjectButton.addEventListener("click", () => {
      if (canCreateProject) {
        new ContentProjectCreateModal(this.app, this.plugin, this.view, { topic, platform }).open();
      }
    });
    baseButton?.addEventListener("click", () => this.view.openTarget(topicCapabilities.basePath, "内容总览 Base"));
    dashboardButton?.addEventListener("click", () =>
      this.view.openTarget(topicCapabilities.dashboardPath, "作战大盘"),
    );
    if (!canCreateProject) {
      pipeline.createDiv({
        cls: "launchpad-empty-tip",
        text: "新建项目需要该 Topic 下的内容模板和 Profile；现有项目仍可查看和推进。",
      });
    }
    const list = pipeline.createDiv({ cls: "launchpad-breakdown-card" });
    for (const [stage, rows] of buckets) {
      const groupRow = list.createDiv({ cls: "launchpad-breakdown-row" });
      stageGroups.set(stage, groupRow);
      const prePublish = STAGE_ORDER.indexOf(stage) >= 0 && STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf("reviewing");
      const groupLeft = groupRow.createDiv({ cls: "launchpad-row-left" });
      groupLeft.createDiv({
        cls: `launchpad-badge${stage === "reviewing" ? " is-accent" : ""}`,
        text: STAGE_LABEL[stage] || stage,
      });
      groupLeft.createDiv({ cls: "launchpad-row-title", text: `${rows.length} 篇` });
      const stageList = list.createDiv({ cls: "launchpad-stage-items" });
      const renderArticle = (article) => {
        const row = stageList.createDiv({ cls: "launchpad-breakdown-row" });
        const left = row.createDiv({ cls: "launchpad-row-left" });
        left.createDiv({ cls: "launchpad-row-title", text: articleLabel(article) });
        const right = row.createDiv({ cls: "launchpad-row-right" });
        if (article.platform) right.createSpan({ text: article.platform });
        /* 几天没动：内容快照的 updated_at，没有时用文件修改时间。 */
        const updated = updatedByDir.get(article.folder);
        const idle = daysBetween(today, Number.isFinite(updated) ? updated : article.mtime);
        if (idle !== null) {
          const stale = prePublish && idle >= STUCK_WARNING_DAYS;
          const ageEl = right.createSpan({ cls: `launchpad-stuck-days${stale ? " is-warning" : ""}`, text: idle === 0 ? "今天动过" : `${idle} 天未动` });
          if (stale) ageEl.setAttribute("aria-label", `在「${stageLabel(stage)}」停了 ${idle} 天`);
        }
        if (article.status) right.createSpan({ cls: "launchpad-badge", text: contentStatusLabel(article.status) });
        const advance = addButton(right, "推进", "launchpad-row-action");
        advance.addEventListener("click", (event) => {
          event.stopPropagation();
          new ContentProjectStageModal(
            this.app,
            this.plugin,
            this.view,
            article.folder,
            articleLabel(article),
          ).open();
        });
        makeClickable(row, () => this.view.openTarget(article.path, article.title), `打开内容项目：${article.title}`);
      };
      rows.slice(0, 4).forEach(renderArticle);
      if (rows.length > 4) {
        const expand = addButton(groupRow, `查看该阶段全部 ${rows.length} 篇`, "launchpad-row-action");
        expand.addEventListener("click", () => {
          rows.slice(4).forEach(renderArticle);
          expand.remove();
        });
      }
    }
  }

  getReviewQueues() {
    const tasks = Array.isArray(this.snapshots.tasks) ? this.snapshots.tasks : [];
    const openTasks = tasks.filter((task) => !task.done);
    const completedTasks = tasks.filter((task) => task.done);
    const healthData = this.snapshots.health?.data || {};
    const findings = Array.isArray(healthData.findings) ? healthData.findings : [];
    const writebacks = findings.filter((finding) => finding.code === "PENDING_WRITEBACK");
    const staleInbox = findings.filter((finding) => finding.code === "STALE_INBOX");
    const topic = primaryContentTopic(this.capabilities);
    const projectsRoot = contentProjectsPath(topic);
    const prefix = projectsRoot ? `${projectsRoot}/` : "";
    const projectsByDir = new Map();
    for (const project of Array.isArray(this.snapshots.content?.data) ? this.snapshots.content.data : []) {
      const dir = textOr(project.dir);
      if (prefix && dir.startsWith(prefix)) projectsByDir.set(dir, project);
    }
    for (const article of this.summary.articles) {
      if (!prefix || !article.path.startsWith(prefix)) continue;
      if (!projectsByDir.has(article.folder)) {
        projectsByDir.set(article.folder, {
          content_id: article.content_id || article.folder.split("/").pop(),
          dir: article.folder,
          stage: article.stage,
          status: article.status,
          updated_at: article.mtime,
        });
      }
    }
    const contentProjects = [...projectsByDir.values()];
    const reviewingProjects = contentProjects.filter(
      (project) => textOr(project.stage).toLowerCase() === "reviewing",
    );
    return {
      tasks,
      openTasks,
      completedTasks,
      healthData,
      findings,
      writebacks,
      staleInbox,
      contentProjects,
      reviewingProjects,
    };
  }

  renderKnowledge() {
    this.renderKpis(this.panels.knowledge);
    if (this.profile.features.workGrid) this.renderWorkGrid(this.panels.knowledge);
    const card = this.panels.knowledge.createDiv({ cls: "launchpad-card" });
    const header = card.createDiv({ cls: "launchpad-card-header" });
    const title = header.createDiv({ cls: "launchpad-card-title" });
    addIcon(title, "activity");
    title.createSpan({ text: "近 7 天更新" });
    /* 和上方 KPI「近 7 天更新」同一口径：有 Topics/ 时只算 Topics/ 下的笔记。 */
    const hasTopics = Array.isArray(this.capabilities?.topics) && this.capabilities.topics.length > 0;
    const active = hasTopics ? this.summary.active.filter((page) => page.path.startsWith("Topics/")) : this.summary.active;
    title.createSpan({ cls: "launchpad-badge", text: `${active.length} 篇` });
    const counts = new Map();
    for (const page of active) {
      const type = page.type || "未标类型";
      counts.set(type, (counts.get(type) || 0) + 1);
    }
    const chips = card.createDiv({ cls: "launchpad-action-group-buttons" });
    if (!counts.size) {
      chips.createDiv({ cls: "launchpad-breakdown-row is-empty", text: "近 7 天没有更新" });
    } else {
      for (const [type, count] of [...counts.entries()].sort((left, right) => right[1] - left[1])) {
        chips.createSpan({ cls: "launchpad-badge", text: `${type} ${count}` });
      }
    }
    const list = card.createDiv({ cls: "launchpad-breakdown-card" });
    for (const page of [...active].sort((left, right) => right.mtime - left.mtime).slice(0, 6)) {
      const row = list.createDiv({ cls: "launchpad-breakdown-row" });
      const left = row.createDiv({ cls: "launchpad-row-left" });
      left.createDiv({ cls: "launchpad-row-title", text: page.name });
      const right = row.createDiv({ cls: "launchpad-row-right" });
      right.createSpan({ text: page.type || "未标类型" });
      right.createSpan({ cls: "launchpad-badge", text: formatDateTime(page.mtime) });
      makeClickable(row, () => this.view.openTarget(page.path, page.name), `打开：${page.name}`);
    }
  }

  renderReview() {
    const {
      tasks,
      openTasks,
      completedTasks,
      writebacks,
      staleInbox,
      contentProjects,
      reviewingProjects,
    } = this.getReviewQueues();
    const overview = this.panels.review.createDiv({ cls: "launchpad-card" });
    const header = overview.createDiv({ cls: "launchpad-card-header launchpad-review-header" });
    const title = header.createDiv({ cls: "launchpad-card-title" });
    addIcon(title, "refresh-cw");
    title.createSpan({ text: "统一复盘" });
    title.createSpan({
      cls: `launchpad-badge${
        this.plugin.settings.autoRouteEnabled && this.plugin.canRunAnks() ? " is-accent" : ""
      }`,
      text: !this.plugin.canRunAnks()
        ? "自动整理仅限电脑"
        : this.plugin.settings.autoRouteEnabled
          ? "自动整理已开"
          : "手动整理",
    });
    const actions = header.createDiv({ cls: "launchpad-actions" });
    const generate = addButton(actions, "预览下一批行动", "launchpad-btn is-primary");
    const openNow = addButton(actions, "打开 Tempo");
    openNow.addEventListener("click", () => this.plugin.openActionBoard());
    generate.addEventListener("click", () => new ReviewActionsModal(this.app, this.plugin, this.view, {
      pages: this.pages, health: this.snapshots.health, contentProjects,
    }).open());

    const metrics = overview.createDiv({ cls: "launchpad-review-metrics" });
    for (const [value, label, detail] of [
      [openTasks.length, "未完成", "Tempo 当前行动"],
      [tasks.filter((task) => task.bucket === "overdue").length, "逾期", "需要重排或关闭"],
      [tasks.filter((task) => task.bucket === "waiting").length, "等待", "需要跟进阻塞"],
      [completedTasks.length, "已完成", "今天在 Tempo 完成"],
      [writebacks.length, "待回写与复核", "判断哪些产出需要沉淀"],
      [staleInbox.length, STALE_INBOX_LABEL, "ANKS 健康检查列出的积压"],
    ]) {
      const metric = metrics.createDiv({ cls: "launchpad-review-metric" });
      metric.createDiv({ cls: "launchpad-review-metric-value", text: String(value) });
      metric.createDiv({ cls: "launchpad-review-metric-label", text: label });
      metric.createDiv({ cls: "launchpad-review-metric-detail", text: detail });
    }

    const grid = this.panels.review.createDiv({ cls: "launchpad-grid-2" });
    const actionCard = grid.createDiv({ cls: "launchpad-card" });
    const actionHeader = actionCard.createDiv({ cls: "launchpad-card-header" });
    const actionTitle = actionHeader.createDiv({ cls: "launchpad-card-title" });
    addIcon(actionTitle, CRISP_NOW_ICON_ID);
    actionTitle.createSpan({ text: "行动收口" });
    actionHeader.createDiv({
      cls: "launchpad-badge",
      text: `${openTasks.length} 条未完成`,
    });
    const actionList = actionCard.createDiv({ cls: "launchpad-breakdown-card" });
    const actionItems = [
      ...openTasks.filter((task) => task.bucket === "overdue"),
      ...openTasks.filter((task) => task.bucket === "waiting"),
      ...openTasks.filter((task) => task.bucket === "today"),
    ].slice(0, 7);
    if (!actionItems.length) {
      this.renderEmpty(actionList, "当前没有逾期、等待或今日行动");
    } else {
      for (const task of actionItems) {
        const row = actionList.createDiv({ cls: "launchpad-breakdown-row" });
        const left = row.createDiv({ cls: "launchpad-row-left" });
        left.createDiv({ cls: "launchpad-row-title", text: task.title });
        const right = row.createDiv({ cls: "launchpad-row-right" });
        if (task.project) right.createSpan({ cls: "launchpad-badge", text: task.project });
        right.createSpan({ text: actionItemMeta(task) });
        makeClickable(
          row,
          () => this.plugin.openAction(task),
          `在 Tempo 打开：${task.title}`,
        );
      }
    }

    const knowledgeCard = grid.createDiv({ cls: "launchpad-card" });
    const knowledgeHeader = knowledgeCard.createDiv({ cls: "launchpad-card-header" });
    const knowledgeTitle = knowledgeHeader.createDiv({ cls: "launchpad-card-title" });
    addIcon(knowledgeTitle, "book-open");
    knowledgeTitle.createSpan({ text: "待回写与复核" });
    knowledgeHeader.createDiv({
      cls: `launchpad-badge${writebacks.length ? " is-accent" : ""}`,
      text: `${writebacks.length} 条待处理`,
    });
    const knowledgeList = knowledgeCard.createDiv({ cls: "launchpad-breakdown-card" });
    if (!writebacks.length) {
      this.renderEmpty(knowledgeList, "当前没有待回写或待复核项");
    } else {
      for (const finding of writebacks.slice(0, 7)) {
        const path = textOr(finding.path || finding.evidence?.path);
        const row = knowledgeList.createDiv({ cls: "launchpad-breakdown-row" });
        const left = row.createDiv({ cls: "launchpad-row-left" });
        left.createDiv({
          cls: "launchpad-row-title",
          text: findingBasename(finding),
        });
        row.createDiv({ cls: "launchpad-row-right", text: reviewFindingCategory(finding) });
        makeClickable(row, () => this.view.openTarget(path, findingBasename(finding)));
      }
    }

    const reviewGrid = this.panels.review.createDiv({ cls: "launchpad-grid-2" });
    const inboxCard = reviewGrid.createDiv({ cls: "launchpad-card" });
    const inboxHeader = inboxCard.createDiv({ cls: "launchpad-card-header" });
    const inboxTitle = inboxHeader.createDiv({ cls: "launchpad-card-title" });
    addIcon(inboxTitle, "inbox");
    inboxTitle.createSpan({ text: STALE_INBOX_LABEL });
    inboxHeader.createDiv({
      cls: `launchpad-badge${staleInbox.length ? " is-accent" : ""}`,
      text: `${staleInbox.length} 条`,
    });
    const inboxList = inboxCard.createDiv({ cls: "launchpad-breakdown-card" });
    if (!staleInbox.length) {
      this.renderEmpty(inboxList, "当前没有需要重新检查的收件箱条目");
    } else {
      for (const finding of staleInbox.slice(0, 7)) {
        const path = textOr(finding.path || finding.evidence?.path);
        const row = inboxList.createDiv({ cls: "launchpad-breakdown-row" });
        const left = row.createDiv({ cls: "launchpad-row-left" });
        left.createDiv({ cls: "launchpad-row-title", text: findingBasename(finding) });
        row.createDiv({ cls: "launchpad-row-right", text: "待整理" });
        makeClickable(row, () => this.view.openTarget(path, findingBasename(finding)));
      }
    }

    if (primaryContentTopic(this.capabilities)) {
      const projectCard = reviewGrid.createDiv({ cls: "launchpad-card" });
      const projectHeader = projectCard.createDiv({ cls: "launchpad-card-header" });
      const projectTitle = projectHeader.createDiv({ cls: "launchpad-card-title" });
      addIcon(projectTitle, "content");
      projectTitle.createSpan({ text: "内容项目复盘" });
      projectHeader.createDiv({
        cls: `launchpad-badge${reviewingProjects.length ? " is-accent" : ""}`,
        text: `${reviewingProjects.length} 个待复盘`,
      });
      const projectList = projectCard.createDiv({ cls: "launchpad-breakdown-card" });
      if (!reviewingProjects.length) {
        this.renderEmpty(projectList, "当前没有待复盘的项目");
      } else {
        for (const project of reviewingProjects.slice(0, 7)) {
          const dir = textOr(project.dir);
          const article = contentProjectArticle(this.pages, dir);
          const label = contentProjectLabel(this.pages, project);
          const row = projectList.createDiv({ cls: "launchpad-breakdown-row" });
          const left = row.createDiv({ cls: "launchpad-row-left" });
          left.createDiv({ cls: "launchpad-row-title", text: label });
          const right = row.createDiv({ cls: "launchpad-row-right" });
          right.createSpan({ cls: "launchpad-badge", text: stageLabel("reviewing") });
          const advance = addButton(right, "复盘", "launchpad-row-action");
          advance.addEventListener("click", (event) => {
            event.stopPropagation();
            new ContentProjectStageModal(this.app, this.plugin, this.view, dir, label).open();
          });
          makeClickable(
            row,
            () => this.view.openTarget(article?.path || `${dir}/project.yaml`, label),
            `打开内容项目：${label}`,
          );
        }
      }
    }
    this.renderPulseRhythm(this.panels.review);
  }

  renderSystem() {
    if (this.profile.features.kernelPill) this.renderSystemDrawer(this.panels.system);
    const findings = this.snapshots.health?.data?.findings;
    if (Array.isArray(findings)) this.renderFindingGroups(this.panels.system, findings);
    if (!this.hasTab("knowledge") && !this.hasTab("review") && this.profile.kpis?.length) {
      this.renderKpis(this.panels.system);
    }
    const nav = this.panels.system.createDiv({ cls: "launchpad-card" });
    const header = nav.createDiv({ cls: "launchpad-card-header" });
    const title = header.createDiv({ cls: "launchpad-card-title" });
    addIcon(title, "package");
    title.createSpan({ text: "系统空间" });
    const grid = nav.createDiv({ cls: "launchpad-nav-grid" });
    const items = [];
    const capabilities = this.capabilities || {};
    if (capabilities.hasIndex) items.push(["开始使用", "系统入口与日常动作", "book", "Start Here.md"]);
    for (const topic of capabilities.topics || []) {
      const entry = capabilities.perTopic?.[topic] || {};
      if (entry.dashboardPath) items.push([`${topic} 大盘`, "Topic 工作总览", "content", entry.dashboardPath]);
      if (entry.basePath) items.push([`${topic} 总览`, "多维筛选视图", "project", entry.basePath]);
      if (entry.contentProjectsPath) {
        items.push([
          `${topic} 内容项目`,
          "项目清单与生产记录",
          "content",
          entry.contentIndexPath || entry.contentProjectsPath,
        ]);
      }
      if (entry.readmePath) items.push([`${topic} 说明`, "Topic 目标与边界", "book-open", entry.readmePath]);
    }
    if (capabilities.hasAgentContract) items.push(["Agent 契约", "AGENTS.md 工作规则", "settings", "AGENTS.md"]);
    if (capabilities.hasCore) items.push(["Core 知识区", "概念 · 方法 · 政策 · 模式", "layers", "Core"]);
    if (capabilities.hasSidecar) items.push(["Sidecar 工具区", "CLI · 工具 · 技能 · 索引", "package", "Sidecar"]);
    if (!items.length) this.renderEmpty(grid, "尚未发现可用的系统入口");
    for (const [name, description, iconName, target] of items) {
      const item = grid.createDiv({ cls: "launchpad-nav-card" });
      const nameRow = item.createDiv({ cls: "launchpad-nav-name" });
      addIcon(nameRow, iconName);
      nameRow.createSpan({ text: name });
      item.createDiv({ cls: "launchpad-nav-desc", text: description });
      makeClickable(item, () => this.view.openTarget(target, name), `${name}（${description}）`);
    }

    const quick = this.panels.system.createDiv({ cls: "launchpad-card" });
    const quickHeader = quick.createDiv({ cls: "launchpad-card-header" });
    const quickTitle = quickHeader.createDiv({ cls: "launchpad-card-title" });
    addIcon(quickTitle, "zap");
    quickTitle.createSpan({ text: "快捷入口" });
    quickTitle.createSpan({ cls: "launchpad-badge is-accent", text: "本库已启用" });
    const actions = quick.createDiv({ cls: "launchpad-actions" });
    let quickCount = 0;
    if (this.app.plugins?.enabledPlugins?.has("crisp-pulse")) {
      const pulse = addButton(actions, "知识脉冲看板");
      quickCount += 1;
      pulse.addEventListener("click", () => {
        if (!this.app.commands.executeCommandById("crisp-pulse:open-crisp-pulse-view")) {
          new Notice("Crisp Launchpad：知识脉冲命令不可用");
        }
      });
    }
    const panel = addButton(actions, "行动面板");
    quickCount += 1;
    panel.addEventListener("click", () => this.plugin.activatePanelView());
    const shortcuts = [];
    if (capabilities.hasIndex) shortcuts.push(["开始使用", "Start Here.md"]);
    if (capabilities.hasAgentContract) shortcuts.push(["Agent 契约", "AGENTS.md"]);
    const contentTopic = primaryContentTopic(capabilities);
    const contentEntry = capabilities.perTopic?.[contentTopic] || {};
    if (contentEntry.dashboardPath) shortcuts.push([`${contentTopic} 大盘`, contentEntry.dashboardPath]);
    for (const [label, target] of shortcuts) {
      const button = addButton(actions, label);
      quickCount += 1;
      button.addEventListener("click", () => this.view.openTarget(target, label));
    }
    if (!quickCount) this.renderEmpty(actions, "没有识别到快捷入口");
  }

  /* 问题清单按代码归组：阻塞 → 待办 → 提示，同级按数量多到少；阻塞组默认展开。
     有去处的组带入口，组内每行只写文件名和目录。 */
  renderFindingGroups(parent, findings) {
    const card = parent.createDiv({ cls: "launchpad-card" });
    const header = card.createDiv({ cls: "launchpad-card-header" });
    const title = header.createDiv({ cls: "launchpad-card-title" });
    addIcon(title, "list-checks");
    title.createSpan({ text: "问题清单" });
    title.createSpan({ cls: "launchpad-badge", text: `${findings.length} 项` });
    const list = card.createDiv({ cls: "launchpad-finding-groups" });
    if (!findings.length) {
      this.renderEmpty(list, "没有待处理问题");
      return;
    }
    const rank = (severity) => FINDING_SEVERITY_ORDER[severity] ?? 3;
    const groups = new Map();
    for (const finding of findings) {
      const code = textOr(finding.code, "UNKNOWN");
      const group = groups.get(code) || { code, severity: finding.severity, items: [] };
      if (rank(finding.severity) < rank(group.severity)) group.severity = finding.severity;
      group.items.push(finding);
      groups.set(code, group);
    }
    const sorted = [...groups.values()].sort((a, b) => rank(a.severity) - rank(b.severity) || b.items.length - a.items.length || a.code.localeCompare(b.code));
    for (const group of sorted) {
      const blocking = rank(group.severity) === 0;
      const box = list.createDiv({ cls: `launchpad-finding-group${blocking ? " is-open is-blocking" : ""}` });
      const head = box.createDiv({ cls: "launchpad-finding-group-head" });
      addIcon(head, "chevron-right", "launchpad-finding-chevron");
      head.createSpan({ cls: "launchpad-finding-group-name", text: FINDING_CODE_LABEL[group.code] || group.code });
      head.createSpan({ cls: `launchpad-badge launchpad-severity is-${rank(group.severity)}`, text: SEVERITY_LABEL[group.severity === "error" ? "blocking" : group.severity] || SEVERITY_LABEL.informational });
      head.createSpan({ cls: "launchpad-finding-group-count", text: String(group.items.length) });
      const target = FINDING_CODE_TARGET[group.code];
      if (target && this.hasTab(target.tab)) {
        const go = addButton(head, target.label, "launchpad-row-action");
        go.addEventListener("click", (event) => {
          event.stopPropagation();
          this.showTab(target.tab);
        });
      }
      const hint = textOr(group.items[0]?.action);
      let open = blocking;
      makeClickable(head, () => {
        open = !open;
        box.toggleClass("is-open", open);
        head.setAttribute("aria-expanded", String(open));
      }, `${FINDING_CODE_LABEL[group.code] || group.code} ${group.items.length} 项${hint ? `：${hint}` : ""}`);
      head.setAttribute("aria-expanded", String(blocking));
      const body = box.createDiv({ cls: "launchpad-finding-group-body" });
      const renderItem = (finding) => {
        const path = textOr(finding.path || finding.evidence?.path);
        const row = body.createDiv({ cls: "launchpad-breakdown-row launchpad-finding-row" });
        const left = row.createDiv({ cls: "launchpad-row-left" });
        if (path) {
          const slash = path.lastIndexOf("/");
          left.createDiv({ cls: "launchpad-row-title", text: path.slice(slash + 1) });
          if (slash > 0) left.createDiv({ cls: "launchpad-finding-path", text: path.slice(0, slash) });
          makeClickable(row, () => this.view.openTarget(path), `打开：${path}`);
        } else {
          left.createDiv({ cls: "launchpad-row-title", text: textOr(finding.message || finding.summary, group.code) });
        }
      };
      group.items.slice(0, FINDING_GROUP_PREVIEW).forEach(renderItem);
      if (group.items.length > FINDING_GROUP_PREVIEW) {
        const more = addButton(body, `查看全部 ${group.items.length} 项`, "launchpad-row-action launchpad-list-more");
        more.addEventListener("click", () => {
          more.remove();
          group.items.slice(FINDING_GROUP_PREVIEW).forEach(renderItem);
        });
      }
    }
  }

  renderEmpty(container, message) {
    container.createDiv({ cls: "launchpad-breakdown-row is-empty", text: message });
  }
}

function createDetachedContainer(parent, cls) {
  if (typeof createDiv === "function") {
    return createDiv({ cls });
  }
  if (parent?.ownerDocument?.createElement) {
    const el = parent.ownerDocument.createElement("div");
    if (typeof el.addClass === "function") el.addClass(cls);
    else el.className = cls;
    return el;
  }
  if (parent?.constructor) {
    return new parent.constructor("div", { cls });
  }
  return null;
}

class CrispLaunchpadView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.renderNonce = 0;
  }

  getViewType() {
    return VIEW_TYPE_LAUNCHPAD;
  }

  getDisplayText() {
    return "Crisp Launchpad";
  }

  getIcon() {
    return CRISP_LAUNCHPAD_ICON_ID;
  }

  async onOpen() {
    this.contentEl.addClass("crisp-launchpad-view");
    await this.render();
  }

  async render() {
    const nonce = ++this.renderNonce;
    /* 快照读取与工作区形态探测全部在清空前并行就绪，避免清空后等待 I/O 导致白屏闪烁。 */
    const [actions, health, content, index, tasks, profileId] = await Promise.all([
      this.readSnapshot("actions"),
      this.readSnapshot("health"),
      this.readSnapshot("content"),
      this.readSnapshot("index"),
      this.plugin.readActions(),
      this.plugin.resolveWorkspaceProfile(),
    ]);
    /* Tempo 的今天完成数要在 readActions 判定连上 Tempo 之后再读。 */
    const signals = await this.plugin.readTodaySignals();
    if (nonce !== this.renderNonce) return;

    /* 使用离屏容器构建完整的 DOM 树，避免在屏幕可见 DOM 上同步插入 1000+ 节点引起的重排与抖动。 */
    const root = createDetachedContainer(this.contentEl, "launchpad-wrapper");
    new LaunchpadRenderer(
      this,
      root,
      { actions, health, content, index, tasks, signals },
      collectPages(this.app),
      profileId,
      this.plugin.lastCapabilities,
    ).render();

    this.contentEl.empty();
    this.contentEl.appendChild(root);
  }

  async readSnapshot(kind) {
    try {
      return await this.readJson(`${SNAPSHOT_ROOT}/${kind}.json`);
    } catch (error) {
      console.error(`[Crisp Launchpad] Failed to read ${kind} snapshot`, error);
      return null;
    }
  }

  async readText(path) {
    try {
      if (!(await this.app.vault.adapter.exists(path))) return "";
      return await this.app.vault.adapter.read(path);
    } catch (error) {
      return "";
    }
  }

  async readJson(path) {
    const raw = await this.readText(path);
    return raw ? JSON.parse(raw) : null;
  }

  async openTarget(target, label = "") {
    const normalized = textOr(target).trim();
    if (!normalized) return false;
    const file =
      this.app.vault.getAbstractFileByPath(normalized) ||
      this.app.vault.getAbstractFileByPath(`${normalized}.md`) ||
      this.app.metadataCache.getFirstLinkpathDest(normalized.replace(/\.md$/i, ""), "");
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
      return true;
    }
    if (file instanceof TFolder) {
      const explorer = this.app.internalPlugins?.getEnabledPluginById?.("file-explorer");
      if (explorer?.revealInFolder) {
        explorer.revealInFolder(file);
        return true;
      }
    }
    new Notice(`Crisp Launchpad：未找到「${label || normalized}」`);
    return false;
  }
}

class CrispPanelRenderer {
  constructor(view, data = {}) {
    this.view = view;
    this.app = view.app;
    this.plugin = view.plugin;
    this.root = view.contentEl;
    this.tasks = Array.isArray(data.tasks) ? data.tasks : [];
    this.bookmarks = Array.isArray(data.bookmarks) ? data.bookmarks : [];
    this.captures = Array.isArray(data.captures) ? data.captures : [];
    this.triage = Array.isArray(data.triage) ? data.triage : [];
    this.triageTotal = Number.isFinite(data.triageTotal) ? data.triageTotal : this.triage.length;
    this.topic = textOr(data.topic, "");
    this.activeTab = PANEL_TABS.some((tab) => tab.id === data.activeTab)
      ? data.activeTab
      : PANEL_TABS[0].id;
  }

  render() {
    this.renderHeader();
    this.renderTabs();
    const body = this.root.createDiv({ cls: "crisp-panel-body" });
    if (this.activeTab === "capture") this.renderCapture(body);
    else if (this.activeTab === "triage") this.renderTriage(body);
    else if (this.activeTab === "bookmark") this.renderBookmarks(body);
    else this.renderToday(body);
    this.renderActions();
  }

  renderTabs() {
    const tabs = this.root.createDiv({ cls: "crisp-panel-tabs" });
    for (const tab of PANEL_TABS) {
      const button = tabs.createEl("button", {
        cls: `crisp-panel-tab${tab.id === this.activeTab ? " is-active" : ""}`,
        text: tab.name,
      });
      button.addEventListener("click", () => this.view.setPanelTab(tab.id));
    }
  }

  renderHeader() {
    const openTasks = this.tasks.filter((task) => !task.done);
    const header = this.root.createDiv({ cls: "crisp-panel-header" });
    const title = header.createDiv({ cls: "crisp-panel-title" });
    addIcon(title, CRISP_NOW_ICON_ID);
    title.createSpan({ text: "ANKS 行动面板" });
    header.createDiv({
      cls: "crisp-panel-subtitle",
      text: "捕获 → 待整理 → 行动 · Tempo 为唯一行动源",
    });
    const stats = header.createDiv({ cls: "crisp-panel-stats" });
    // 没连上 Tempo 时行动数不可知，显示「—」而不是 0。
    const tempo = this.plugin.usesTempo();
    for (const [value, label] of [
      [
        tempo ? openTasks.filter((task) => task.bucket === "overdue" || task.bucket === "today").length : "—",
        "今天",
      ],
      [tempo ? openTasks.filter((task) => task.bucket === "waiting").length : "—", "等待"],
      [this.triageTotal, "全库待整理"],
    ]) {
      const stat = stats.createDiv({ cls: "crisp-panel-stat" });
      stat.createDiv({ cls: "crisp-panel-stat-value", text: String(value) });
      stat.createDiv({ cls: "crisp-panel-stat-label", text: label });
    }
  }

  renderToday(parent) {
    if (!this.plugin.usesTempo()) {
      const section = parent.createDiv({ cls: "crisp-panel-section" });
      section.createDiv({ cls: "crisp-panel-section-title" }).createSpan({ text: "今天要做" });
      section.createDiv({ cls: "crisp-panel-list" }).createDiv({ cls: "crisp-panel-empty", text: TEMPO_REQUIRED_HINT });
      return;
    }
    const focus = this.tasks
      .filter((task) => !task.done && (task.bucket === "overdue" || task.bucket === "today"))
      .slice(0, 8);
    // 今天没有排期时，退而展示接下来能推进的行动，避免面板出现空白区。
    const fallback = focus.length
      ? []
      : this.tasks.filter((task) => !task.done).slice(0, 5);
    const rows = focus.length ? focus : fallback;
    const section = parent.createDiv({ cls: "crisp-panel-section" });
    const title = section.createDiv({ cls: "crisp-panel-section-title" });
    title.createSpan({ text: focus.length ? "今天要做" : "接下来" });
    title.createSpan({ text: `${rows.length} 条` });
    const list = section.createDiv({ cls: "crisp-panel-list" });
    if (!rows.length) {
      list.createDiv({ cls: "crisp-panel-empty", text: "今天没有排期行动" });
      return;
    }
    for (const task of rows) this.renderTask(list, task);
  }

  renderTask(parent, task) {
    const row = parent.createDiv({ cls: "crisp-panel-task" });
    /* 行动只读：完成要在 Tempo 里做（重复提醒、子任务、日历同步都在那边），点行打开 Tempo。 */
    const body = row.createDiv({ cls: "crisp-panel-task-body" });
    body.createDiv({ cls: "crisp-panel-task-title", text: task.title });
    const meta = body.createDiv({ cls: "crisp-panel-task-meta" });
    if (task.bucket === "overdue") meta.createSpan({ text: "逾期" });
    if (task.waiting) meta.createSpan({ text: "等待中" });
    if (task.project) meta.createSpan({ text: `#${task.project}` });
    if (task.due) {
      meta.createSpan({ text: task.time ? `📅 ${task.due} ⏰ ${task.time}` : `📅 ${task.due}` });
    }
    makeClickable(row, () => this.plugin.openAction(task), `在 Tempo 打开：${task.title}`);
  }

  renderCapture(parent) {
    const section = parent.createDiv({ cls: "crisp-panel-section" });
    section.addClass("crisp-panel-capture-editor");
    section.dataset.captureTopic = this.topic;
    section.dataset.captureType = this.view.captureType;
    const title = section.createDiv({ cls: "crisp-panel-section-title" });
    title.createSpan({ text: "捕获" });
    title.createSpan({ text: this.topic });

    const types = section.createDiv({ cls: "crisp-panel-types" });
    for (const type of CAPTURE_TYPES) {
      const button = types.createEl("button", {
        cls: `crisp-panel-type${type.id === this.view.captureType ? " is-active" : ""}`,
        text: type.name,
      });
      button.addEventListener("click", () => {
        this.view.captureType = type.id;
        this.view.render();
      });
    }

    const input = section.createEl("textarea", {
      cls: "crisp-panel-capture-input",
      attr: { placeholder: "现在的想法是…（Enter 保存，Shift+Enter 换行）", rows: "3" },
    });
    input.value = textOr(this.view.captureDraft, "");
    input.addEventListener("input", () => {
      this.view.captureDraft = input.value;
    });

    const hasTopic = Boolean(this.topic);
    section.createDiv({
      cls: "crisp-panel-capture-hint",
      text: hasTopic
        ? `存入 ${inboxFolder(this.view.captureType, this.topic)}/（ANKS Raw，等待分类）`
        : "尚未配置 Topic：先在 Topics/ 下建一个（如 Topics/<topic>），再使用捕获",
    });

    const save = addButton(section, "记下", "launchpad-btn is-primary");
    save.disabled = !hasTopic;
    if (!hasTopic) save.title = "尚未配置 Topic";
    let saving = false;
    const submit = async () => {
      if (saving) return;
      const text = String(input.value || "").trim();
      if (!text) {
        new Notice("Crisp 行动面板：内容不能为空");
        return;
      }
      saving = true;
      save.disabled = true;
      input.readOnly = true;
      try {
        const path = await this.plugin.createInboxCapture({
          text,
          inboxType: this.view.captureType,
          topic: this.topic,
        });
        this.view.captureDraft = "";
        new Notice(`Crisp 行动面板：已捕获 → ${path}`);
        input.value = "";
        input.readOnly = false;
        save.disabled = !hasTopic;
        saving = false;
        await this.view.render();
      } catch (error) {
        new Notice(`Crisp 行动面板：${error.message || error}`);
        input.readOnly = false;
        save.disabled = false;
        saving = false;
      }
    };
    save.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        submit();
      }
    });

    const recent = parent.createDiv({ cls: "crisp-panel-section" });
    const listTitle = recent.createDiv({ cls: "crisp-panel-section-title" });
    listTitle.createSpan({ text: "今天的捕获" });
    listTitle.createSpan({ text: `${this.captures.length} 条` });
    const list = recent.createDiv({ cls: "crisp-panel-list" });
    if (!this.captures.length) {
      list.createDiv({ cls: "crisp-panel-empty", text: "今天还没有捕获" });
      return;
    }
    for (const page of this.captures) this.renderPageRow(list, page, "capture");
  }

  renderTriage(parent) {
    const section = parent.createDiv({ cls: "crisp-panel-section" });
    const title = section.createDiv({ cls: "crisp-panel-section-title" });
    title.createSpan({ text: "待整理" });
    title.createSpan({ text: `${this.triage.length} / ${this.triageTotal} 条` });
    section.createDiv({
      cls: "crisp-panel-capture-hint",
      text: "raw/inbox 未归位 · 点条目可转为行动 / 标为已处理（转选题需桌面端）",
    });
    const list = section.createDiv({ cls: "crisp-panel-list" });
    if (!this.triage.length) {
      list.createDiv({ cls: "crisp-panel-empty", text: "待整理已清空" });
      return;
    }
    for (const page of this.triage) this.renderPageRow(list, page, "triage");
    if (this.triage.length < this.triageTotal) {
      const more = addButton(section, `查看全部 ${this.triageTotal} 条`);
      more.addEventListener("click", () => {
        this.view.showAllTriage = true;
        this.view.render();
      });
    }
  }

  renderPageRow(parent, page, kind) {
    const row = parent.createDiv({ cls: "crisp-panel-task" });
    const body = row.createDiv({ cls: "crisp-panel-task-body" });
    const label = textOr(page.title, textOr(page.name, "未命名"));
    body.createDiv({ cls: "crisp-panel-task-title", text: label });
    const meta = body.createDiv({ cls: "crisp-panel-task-meta" });
    const inboxType = textOr(page.frontmatter?.inbox_type, "");
    if (inboxType) meta.createSpan({ text: inboxType });
    if (kind === "triage" && page.routing_status) meta.createSpan({ text: page.routing_status });
    meta.createSpan({ text: String(page.path || "").replace(/^Topics\/[^/]+\//, "") });
    makeClickable(
      row,
      () => {
        if (kind === "triage") {
          new InboxConversionModal(this.app, this.plugin, this.view, page).open();
          return;
        }
        this.view.openTarget(page.path, label);
      },
      kind === "triage" ? `整理：${label}` : `打开：${label}`,
    );
  }

  renderActions() {
    const section = this.root.createDiv({ cls: "crisp-panel-section" });
    const title = section.createDiv({ cls: "crisp-panel-section-title" });
    title.createSpan({ text: "快速入口" });
    const actions = section.createDiv({ cls: "crisp-panel-actions" });
    const newAction = addButton(actions, "新建行动");
    const openNow = addButton(actions, "打开 Tempo");
    const openLaunchpad = addButton(actions, "打开启动台");
    if (this.activeTab !== "capture") {
      const capture = addButton(actions, "捕获", "launchpad-btn is-primary");
      capture.addEventListener("click", () => this.view.setPanelTab("capture"));
    }
    newAction.addEventListener("click", () => this.plugin.openNewAction());
    openNow.addEventListener("click", () => this.plugin.openActionBoard());
    openLaunchpad.addEventListener("click", () => this.plugin.activateView());
  }

  renderBookmarks(parent) {
    const section = parent.createDiv({ cls: "crisp-panel-section" });
    const title = section.createDiv({ cls: "crisp-panel-section-title" });
    title.createSpan({ text: "收藏" });
    title.createSpan({ text: `${this.bookmarks.length} 项` });
    const list = section.createDiv({ cls: "crisp-panel-list" });
    if (!this.bookmarks.length) {
      list.createDiv({ cls: "crisp-panel-empty", text: "未找到书签（需启用核心插件「书签」）" });
      return;
    }
    for (const bookmark of this.bookmarks) {
      const row = list.createDiv({ cls: "crisp-panel-bookmark" });
      row.createDiv({ cls: "crisp-panel-bookmark-title", text: bookmark.title });
      row.createDiv({ cls: "crisp-panel-bookmark-kind", text: bookmark.kindLabel });
      makeClickable(row, () => this.openBookmark(bookmark), `打开收藏：${bookmark.title}`);
    }
  }

  async openBookmark(bookmark) {
    if (bookmark.kind === "url") {
      window.open(bookmark.target, "_blank");
      return;
    }
    if (bookmark.kind === "graph") {
      new Notice(`Crisp 行动面板：「${bookmark.title}」是图谱书签，请在书签面板打开`);
      return;
    }
    await this.view.openTarget(bookmark.target, bookmark.title);
  }
}

class CrispPanelView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.renderNonce = 0;
    this.activePanelTab = this.loadPanelTab();
    this.captureType = "scratch";
    this.captureDraft = "";
  }

  loadPanelTab() {
    try {
      const saved = window.localStorage.getItem(PANEL_TAB_KEY);
      if (PANEL_TABS.some((tab) => tab.id === saved)) return saved;
    } catch (error) {
      // localStorage 不可用时回落到默认页。
    }
    return PANEL_TABS[0].id;
  }

  async setPanelTab(tab) {
    if (!PANEL_TABS.some((item) => item.id === tab)) return;
    this.activePanelTab = tab;
    try {
      window.localStorage.setItem(PANEL_TAB_KEY, tab);
    } catch (error) {
      // localStorage 可选。
    }
    await this.render();
  }

  getViewType() {
    return VIEW_TYPE_PANEL;
  }

  getDisplayText() {
    return "Crisp 行动面板";
  }

  getIcon() {
    return CRISP_NOW_ICON_ID;
  }

  async onOpen() {
    this.contentEl.addClass("crisp-launchpad-panel-view");
    await this.render();
  }

  async render() {
    const nonce = ++this.renderNonce;
    const tasks = await this.plugin.readActions();
    const pages = collectPages(this.app);
    const bookmarks = this.plugin.readBookmarks();
    if (nonce !== this.renderNonce) return;
    const topic = captureTargetTopic(this.app, this.plugin.listTopics(), primaryTopic(this.plugin.lastCapabilities));
    const previousEditor = this.activePanelTab === "capture" ? this.contentEl.querySelector?.(".crisp-panel-capture-editor") : null;
    const preserveEditor = previousEditor && previousEditor.dataset.captureTopic === topic && previousEditor.dataset.captureType === this.captureType;
    // Keep the actual focused textarea in the document: restoring focus after replacement
    // would still interrupt an IME composition or move the mobile keyboard.
    const target = createDetachedContainer(this.contentEl, "crisp-panel-render-buffer");
    const triage = inboxTriageItems(pages, Number.MAX_SAFE_INTEGER);
    const renderer = new CrispPanelRenderer(this, {
      tasks,
      bookmarks,
      captures: capturedToday(pages),
      triage: this.showAllTriage ? triage : triage.slice(0, 20),
      triageTotal: triage.length,
      topic,
      activeTab: this.activePanelTab,
    });
    renderer.root = target;
    renderer.render();
    if (preserveEditor) {
      const oldBody = previousEditor.parentElement;
      const nextBody = target.querySelector(".crisp-panel-body");
      for (const child of [...oldBody.children]) if (child !== previousEditor) child.remove();
      for (const child of [...nextBody.children]) if (!child.classList.contains("crisp-panel-capture-editor")) oldBody.appendChild(child);
      for (const child of [...this.contentEl.children]) if (child !== oldBody) child.remove();
      for (const child of [...target.children]) {
        if (child === nextBody) continue;
        if (child.classList.contains("crisp-panel-header") || child.classList.contains("crisp-panel-tabs")) this.contentEl.insertBefore(child, oldBody);
        else this.contentEl.appendChild(child);
      }
    } else {
      this.contentEl.empty();
      for (const child of [...target.children]) this.contentEl.appendChild(child);
    }
  }

  onClose() {
    this.contentEl.empty();
  }

  async openTarget(target, label = "") {
    // 和启动台一样：去空白，路径找不到时按链接名解析（书签里常是短链接）。
    const normalized = textOr(target).trim();
    if (!normalized) return false;
    const file =
      this.app.vault.getAbstractFileByPath(normalized) ||
      this.app.vault.getAbstractFileByPath(`${normalized}.md`) ||
      this.app.metadataCache.getFirstLinkpathDest(normalized.replace(/\.md$/i, ""), "");
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
      return true;
    }
    if (file instanceof TFolder) {
      const explorer = this.app.internalPlugins?.getEnabledPluginById?.("file-explorer");
      if (explorer?.revealInFolder) {
        explorer.revealInFolder(file);
        return true;
      }
    }
    new Notice(`Crisp 行动面板：未找到「${label || normalized}」`);
    return false;
  }
}

class ReviewActionsModal extends Modal {
  constructor(app, plugin, view, context) {
    super(app);
    this.plugin = plugin;
    this.view = view;
    this.context = context;
    this.closed = false;
  }

  async onOpen() {
    this.contentEl.addClass("launchpad-review-preview-modal");
    this.contentEl.createEl("h2", { text: "下一批行动" });
    const status = this.contentEl.createDiv({ cls: "launchpad-modal-hint", text: "正在核对最近 14 天的完成记录…" });
    try {
      const tasks = await this.plugin.readReviewTasks(new Date(), this.context);
      if (this.closed) return;
      const suggestions = suggestReviewActions({ ...this.context, tasks });
      status.setText(suggestions.length ? "确认后写入 Tempo。" : "当前没有新的复盘行动。");
      const selections = [];
      for (const suggestion of suggestions) {
        const row = this.contentEl.createDiv({ cls: "launchpad-review-choice" });
        const label = row.createEl("label");
        const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
        checkbox.checked = true;
        label.createSpan({ text: suggestion.text });
        selections.push({ suggestion, checkbox });
        if (suggestion.link) {
          const source = addButton(row, "打开来源", "launchpad-row-action");
          source.addEventListener("click", () => this.view.openTarget(suggestion.link));
        }
      }
      if (!suggestions.length) return;
      const create = addButton(this.contentEl, "生成选中行动", "launchpad-btn is-primary");
      create.addEventListener("click", async () => {
        const selected = selections.filter(({ checkbox }) => checkbox.checked && !checkbox.disabled);
        if (!selected.length) { status.setText("请至少选择一条行动。"); return; }
        create.disabled = true;
        let created = 0;
        try {
          // Re-read before writing: another view/device may have completed or created a task
          // while this preview was open. Failed history reads must never turn into an empty history.
          const current = await this.plugin.readReviewTasks(new Date(), this.context);
          const eligible = new Set(suggestReviewActions({ ...this.context, tasks: current, max: Number.MAX_SAFE_INTEGER }).map(s => s.identity || normalizeActionKey(s.text)));
          for (const { suggestion, checkbox } of selected) {
            if (eligible.has(suggestion.identity || normalizeActionKey(suggestion.text))) {
              await this.plugin.createAction(suggestion);
              created += 1;
            }
            checkbox.checked = false;
            checkbox.disabled = true;
          }
          new Notice(`Crisp Launchpad：已生成 ${created} 条行动，写入 Tempo`);
          this.close();
          this.plugin.refreshViews();
          try { await this.plugin.refreshActionSnapshots({ silent: true }); }
          catch (error) { new Notice(`行动已保存，快照刷新失败：${error.message || error}`); }
        } catch (error) {
          if (!this.closed) status.setText(`已生成 ${created} 条；${error.message || error}。可重试未完成项。`);
          create.disabled = false;
        }
      });
    } catch (error) {
      if (!this.closed) status.setText(`无法核对完成记录：${error.message || error}`);
    }
  }

  onClose() {
    this.closed = true;
    this.contentEl.empty();
  }
}

class QuickCaptureModal extends Modal {
  constructor(app, plugin, view) {
    super(app);
    this.plugin = plugin;
    this.view = view;
    this.text = "";
    /* 当前 Topic 优先，其次工作区主 Topic；只使用库里真实存在的 Topic。 */
    this.topic = captureTargetTopic(
      app,
      plugin.listTopics(),
      primaryTopic(plugin.lastCapabilities),
    );
    this.inboxType = "scratch";
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("crisp-launchpad-quick-modal");
    this.contentEl.createEl("h2", { text: "速记" });
    this.contentEl.createDiv({
      cls: "launchpad-modal-hint",
      text: "速记落到所选 Topic 的 raw/inbox；行动请在 Crisp Tempo 里新建。",
    });

    const contentSetting = new Setting(this.contentEl)
      .setName("内容")
      .setDesc("第一行会作为标题。")
      .addTextArea((text) => {
        text.inputEl.rows = 6;
        text.setPlaceholder("写下想法或链接说明…").onChange((value) => {
          this.text = value;
        });
      });
    contentSetting.settingEl.addClass("launchpad-quick-content-setting");

    new Setting(this.contentEl)
      .setName("Topic")
      .setDesc("决定速记进入哪个 Topic 的 raw/inbox。")
      .addDropdown((dropdown) => {
        for (const topic of this.plugin.listTopics()) dropdown.addOption(topic, topic);
        dropdown.setValue(this.topic).onChange((value) => {
          this.topic = value;
        });
      });

    new Setting(this.contentEl)
      .setName("速记类型")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("scratch", "速记")
          .addOption("idea", "灵感")
          .addOption("link", "链接")
          .setValue(this.inboxType)
          .onChange((value) => {
            this.inboxType = value;
          }),
      );

    const actions = this.contentEl.createDiv({ cls: "launchpad-modal-actions" });
    const capture = addButton(actions, "存为速记", "launchpad-btn is-primary");
    capture.addEventListener("click", async () => {
      try {
        capture.disabled = true;
        const path = await this.plugin.createInboxCapture({
          text: this.text,
          inboxType: this.inboxType,
          topic: this.topic,
        });
        new Notice(`Crisp Launchpad：已保存 ${path}`);
        this.close();
        await this.view?.render?.();
      } catch (error) {
        new Notice(`Crisp Launchpad：${error.message || error}`);
        capture.disabled = false;
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class InboxConversionModal extends Modal {
  constructor(app, plugin, view, page) {
    super(app);
    this.plugin = plugin;
    this.view = view;
    this.page = page;
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("crisp-launchpad-convert-modal");
    this.contentEl.createEl("h2", { text: `转化：${this.page.title || this.page.name}` });
    this.contentEl.createDiv({ cls: "launchpad-modal-hint", text: this.page.path });
    const preview = this.contentEl.createEl("pre", { cls: "launchpad-modal-preview" });
    try {
      const raw = await this.app.vault.adapter.read(this.page.path);
      preview.setText(raw.slice(0, 1600));
    } catch (error) {
      preview.setText("无法读取原文预览。");
    }

    const actions = this.contentEl.createDiv({ cls: "launchpad-modal-actions" });
    const open = addButton(actions, "打开原文");
    const action = addButton(actions, "转为行动", "launchpad-btn is-primary");
    const topic = addButton(actions, "转为选题", "launchpad-btn is-accent");
    const processed = addButton(actions, "标为已处理");
    topic.disabled = !this.plugin.canRunAnks();
    if (topic.disabled) {
      topic.title = "移动端不支持本地 CLI，请在桌面端转换为选题";
    }

    open.addEventListener("click", () => {
      this.view.openTarget(this.page.path, this.page.title);
      this.close();
    });
    action.addEventListener("click", async () => {
      try {
        action.disabled = true;
        await this.plugin.createAction({
          text: `处理「${this.page.title || this.page.name}」`,
          project: "收件箱",
          link: this.page.path,
        });
        await this.plugin.markProcessed(this.page.file);
        new Notice("Crisp Launchpad：已转为行动");
        this.close();
        await this.plugin.refreshActionSnapshots({ silent: true });
      } catch (error) {
        new Notice(`Crisp Launchpad：${error.message || error}`);
        action.disabled = false;
      }
    });
    topic.addEventListener("click", async () => {
      try {
        topic.disabled = true;
        await this.plugin.convertInboxToTopic(this.page.file);
        await this.plugin.markProcessed(this.page.file);
        new Notice("Crisp Launchpad：已生成选题卡片");
        this.close();
        await this.view.render();
      } catch (error) {
        new Notice(`Crisp Launchpad：${error.message || error}`);
        topic.disabled = false;
      }
    });
    processed.addEventListener("click", async () => {
      try {
        processed.disabled = true;
        await this.plugin.markProcessed(this.page.file);
        new Notice("Crisp Launchpad：已移出待整理视图");
        this.close();
        await this.view.render();
      } catch (error) {
        new Notice(`Crisp Launchpad：${error.message || error}`);
        processed.disabled = false;
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class LaunchpadOnboardingModal extends Modal {
  constructor(app, plugin, options = {}) {
    super(app);
    this.plugin = plugin;
    this.repairOnly = options.repairOnly === true;
    this.checks = [];
    this.busy = false;
  }

  async onOpen() {
    await this.render();
  }

  async render() {
    this.contentEl.empty();
    this.contentEl.addClass("crisp-launchpad-onboarding-modal");
    this.contentEl.createEl("h2", {
      text: this.repairOnly ? "ANKS 环境修复" : "ANKS 首次启动向导",
    });
    this.contentEl.createDiv({
      cls: "launchpad-modal-hint",
      text: this.repairOnly
        ? "只修复系统前置和快照，不自动清理运营告警。"
        : "检查原生启动台所需的本地路径、CLI 和快照，不连接外部服务。",
    });

    this.checks = await this.plugin.checkEnvironment();
    const list = this.contentEl.createDiv({ cls: "launchpad-onboarding-checks" });
    for (const check of this.checks) {
      const row = list.createDiv({ cls: `launchpad-onboarding-check${check.ok ? " is-ok" : " is-missing"}` });
      row.createSpan({ text: check.ok ? "✓" : "!" });
      const copy = row.createDiv();
      copy.createDiv({ cls: "launchpad-onboarding-label", text: check.label });
      copy.createDiv({ cls: "launchpad-onboarding-detail", text: check.detail });
    }

    const actions = this.contentEl.createDiv({ cls: "launchpad-modal-actions" });
    const recheck = addButton(actions, "重新检查");
    const repair = addButton(actions, "一键修复", "launchpad-btn is-primary");
    const finish = addButton(actions, this.repairOnly ? "关闭" : "完成", "launchpad-btn is-accent");
    const canRepair = this.plugin.canRunAnks();
    recheck.disabled = this.busy;
    repair.disabled = this.busy || !canRepair;
    if (!canRepair) repair.title = "移动端只读检查；请在桌面端运行修复";
    finish.disabled = this.busy;
    recheck.addEventListener("click", () => this.render());
    repair.addEventListener("click", async () => {
      this.busy = true;
      try {
        await this.render();
        await this.plugin.repairEnvironment();
        new Notice("Crisp Launchpad：环境检查与快照修复完成");
        this.busy = false;
        await this.render();
      } catch (error) {
        this.busy = false;
        new Notice(`Crisp Launchpad：修复失败 · ${error.message || error}`, 8000);
        await this.render();
      }
    });
    finish.addEventListener("click", async () => {
      await this.plugin.completeOnboarding();
      this.close();
      await this.plugin.activateView();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ContentProjectCreateModal extends Modal {
  constructor(app, plugin, view, context = {}) {
    super(app);
    this.plugin = plugin;
    this.view = view;
    const capabilities = plugin.lastCapabilities || {};
    this.topic = context.topic || primaryContentTopic(capabilities);
    this.platform = context.platform || primaryContentPlatform(capabilities, this.topic);
    this.profileOptions = capabilities.perTopic?.[this.topic]?.profiles?.[this.platform] || [];
    this.canCreate = Boolean(this.topic && this.platform && this.profileOptions.length);
    this.title = "";
    this.slug = "";
    this.profile = this.profileOptions[0] || "";
    this.track = this.platform === "wechat" ? "obsidian" : "";
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("crisp-content-project-modal");
    this.contentEl.createEl("h2", { text: "新建内容项目" });
    this.contentEl.createDiv({
      cls: "launchpad-modal-hint",
      text: !this.canCreate
        ? "当前工作台没有检测到可用的内容模板和 Profile；请先在 Topic 中配置内容流水线。"
        : this.plugin.canRunAnks()
          ? `使用 ${this.topic} / ${this.platform} 模板创建项目，并立即执行 schema 校验。`
          : `使用 ${this.topic} / ${this.platform} 模板创建项目；校验待桌面端执行。`,
    });
    new Setting(this.contentEl)
      .setName("项目标题")
      .addText((text) =>
        text.setPlaceholder("例如：Agent OS 的底层反转").onChange((value) => {
          this.title = value;
        }),
      );
    new Setting(this.contentEl)
      .setName("英文简称")
      .setDesc("用于 content_id，只保留 A-Z / 0-9 / -。")
      .addText((text) =>
        text.setPlaceholder("AGENT-OS-SUBSTRATE").onChange((value) => {
          this.slug = value;
        }),
      );
    if (this.platform === "wechat") {
      new Setting(this.contentEl)
        .setName("创作轨道")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("obsidian", "Obsidian")
            .addOption("ai-frontiers", "AI Frontiers")
            .setValue(this.track)
            .onChange((value) => {
              this.track = value;
            }),
        );
    }
    if (this.profileOptions.length) {
      new Setting(this.contentEl)
        .setName("模板类型")
        .addDropdown((dropdown) => {
          for (const profile of this.profileOptions) {
            dropdown.addOption(profile, profile.replace(/-/g, " "));
          }
          if (this.profile) dropdown.setValue(this.profile);
          dropdown.onChange((value) => {
            this.profile = value;
          });
        });
    } else {
      this.contentEl.createDiv({
        cls: "launchpad-empty-tip",
        text: "此模板尚未提供 profiles/*.yaml，无法创建项目。",
      });
    }
    const actions = this.contentEl.createDiv({ cls: "launchpad-modal-actions" });
    const create = addButton(actions, "创建项目", "launchpad-btn is-primary");
    create.disabled = !this.canCreate;
    create.addEventListener("click", async () => {
      try {
        create.disabled = true;
        const created = await this.plugin.withForegroundSync(() => this.plugin.createContentProject({
          title: this.title || this.slug,
          slug: this.slug || this.title,
          profile: this.profile,
          track: this.track,
          topic: this.topic,
          platform: this.platform,
        }));
        new Notice(
          created.validation.status === "passed"
            ? `Crisp Launchpad：已创建 ${created.contentId} 并通过校验`
            : created.validation.status === "desktop-required"
              ? `Crisp Launchpad：已创建 ${created.contentId}，校验待桌面端执行`
              : `Crisp Launchpad：已创建 ${created.contentId}，仍有流水线校验待办`,
          8000,
        );
        this.close();
        await this.view.render();
      } catch (error) {
        new Notice(`Crisp Launchpad：${error.message || error}`, 8000);
        create.disabled = false;
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ContentProjectStageModal extends Modal {
  constructor(app, plugin, view, projectDir, projectName) {
    super(app);
    this.plugin = plugin;
    this.view = view;
    this.projectDir = projectDir;
    this.projectName = projectName;
    this.stage = "intake";
    this.status = "draft";
    this.nextAction = "";
  }

  async onOpen() {
    try {
      const path = `${this.projectDir}/project.yaml`;
      if (!(await this.app.vault.adapter.exists(path))) {
        throw new Error(`找不到配置文件：${path}`);
      }
      const content = await this.app.vault.adapter.read(path);
      this.stage = projectField(content, "stage") || "intake";
      this.status = projectField(content, "status") || "draft";
      this.nextAction = projectField(content, "next_action");
      this.contentEl.empty();
      this.contentEl.addClass("crisp-content-project-modal");
      this.contentEl.createEl("h2", { text: `推进：${this.projectName}` });
      this.contentEl.createDiv({ cls: "launchpad-modal-hint", text: this.projectDir });
      new Setting(this.contentEl)
        .setName("阶段")
        .addDropdown((dropdown) => {
          for (const stage of CONTENT_STAGES) {
            const label = STAGE_LABEL[stage] ? `${STAGE_LABEL[stage]} (${stage})` : stage;
            dropdown.addOption(stage, label);
          }
          dropdown.setValue(this.stage).onChange((value) => {
            this.stage = value;
          });
        });
      new Setting(this.contentEl)
        .setName("状态")
        .addDropdown((dropdown) => {
          for (const status of CONTENT_STATUSES) dropdown.addOption(status, status);
          dropdown.setValue(this.status).onChange((value) => {
            this.status = value;
          });
        });
      new Setting(this.contentEl)
        .setName("下一步")
        .addTextArea((text) => {
          text.inputEl.rows = 3;
          text.setValue(this.nextAction).onChange((value) => {
            this.nextAction = value;
          });
        });
      const actions = this.contentEl.createDiv({ cls: "launchpad-modal-actions" });
      const save = addButton(actions, "保存状态", "launchpad-btn is-primary");
      save.addEventListener("click", async () => {
        try {
          save.disabled = true;
          await this.plugin.updateContentProject(this.projectDir, {
            stage: this.stage,
            status: this.status,
            nextAction: this.nextAction,
          });
          new Notice("Crisp Launchpad：项目状态已更新");
          this.close();
          await this.view.render();
        } catch (error) {
          new Notice(`Crisp Launchpad：${error.message || error}`, 8000);
          save.disabled = false;
        }
      });
    } catch (error) {
      this.contentEl.empty();
      this.contentEl.addClass("crisp-content-project-modal");
      this.contentEl.createEl("h2", { text: `推进：${this.projectName}` });
      this.contentEl.createDiv({
        cls: "launchpad-empty-tip",
        text: `无法读取项目配置：${error.message || error}`,
      });
      new Notice(`Crisp Launchpad：${error.message || error}`);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class CrispLaunchpadSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("工作台形态")
      .setDesc(
        "决定工作台显示哪些入口。默认「自动」：按库内 Topic、知识区和内容模板适配；识别结果显示在下方，也可以手动覆盖。",
      )
      .addDropdown((dropdown) => {
        for (const [value, label] of [
          ["auto", "自动（按库结构）"],
          ["content-ops", "内容运营（创作 + 复盘）"],
          ["knowledge", "知识管理（无创作页）"],
          ["actions-only", "仅行动（最小界面）"],
        ]) {
          dropdown.addOption(value, label);
        }
        dropdown.setValue(this.plugin.settings.workspaceMode || "auto").onChange(async (value) => {
          this.plugin.settings.workspaceMode = WORKSPACE_MODES.includes(value) ? value : "auto";
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          this.display();
        });
      });
    const detected = this.containerEl.createDiv({ cls: "setting-item-description" });
    detected.setText(this.plugin.describeCapabilities());
    new Setting(this.containerEl)
      .setName("启动时打开启动台")
      .setDesc("Obsidian 启动后自动打开原生启动台视图。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openOnStartup).onChange(async (value) => {
          this.plugin.settings.openOnStartup = value;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(this.containerEl)
      .setName("允许一键刷新快照")
      .setDesc("只执行 Vault 内固定的 Sidecar/bin/anks 命令；关闭后界面只读取现有快照。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.allowSnapshotRefresh).onChange(async (value) => {
          this.plugin.settings.allowSnapshotRefresh = value;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }),
      );
    new Setting(this.containerEl)
      .setName("启用自动路由与状态同步")
      .setDesc(
        "监听 Topics/ 和 Core/ 变更：只在路由真正处理的路径上执行 route fix --min-confidence 1（路由忽略的前缀如 content-projects/、Core/System/ 只重建快照），不启用 Core promotion。移动端不可用。",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoRouteEnabled).onChange(async (value) => {
          await this.plugin.setAutoRouteEnabled(value);
        }),
      );
    new Setting(this.containerEl)
      .setName("启动时打开侧栏面板")
      .setDesc(
        "在右侧栏打开「Crisp 行动面板」，把今天 / 速记 / 新建行动 / 收藏收进同一个入口。",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.panelOnStartup).onChange(async (value) => {
          this.plugin.settings.panelOnStartup = value === true;
          await this.plugin.saveSettings();
          if (value === true) await this.plugin.activatePanelView();
        }),
      );
    new Setting(this.containerEl)
      .setName("重新运行启动向导")
      .setDesc("重新检查 ANKS CLI 和快照状态。")
      .addButton((button) =>
        button.setButtonText("运行向导").onClick(() => {
          new LaunchpadOnboardingModal(this.app, this.plugin).open();
        }),
      );
  }
}

const AUTO_SYNC_COMPONENT_LABELS = {
  route: "路由",
  snapshot: "快照",
  health: "健康",
  actions: "行动",
};

function newAutoSyncComponentState() {
  return { lastAttemptAt: 0, lastSuccessAt: 0, error: "", errorAt: 0 };
}

function ensureAutoSyncStatus(plugin) {
  if (!plugin.autoSyncStatus || typeof plugin.autoSyncStatus !== "object") {
    plugin.autoSyncStatus = {};
  }
  for (const component of Object.keys(AUTO_SYNC_COMPONENT_LABELS)) {
    if (!plugin.autoSyncStatus[component]) {
      plugin.autoSyncStatus[component] = newAutoSyncComponentState();
    }
  }
  return plugin.autoSyncStatus;
}

function refreshAutoSyncError(plugin) {
  const status = ensureAutoSyncStatus(plugin);
  plugin.autoSyncLastError = Object.entries(status)
    .filter(([, state]) => state?.error)
    .map(([component, state]) => `${AUTO_SYNC_COMPONENT_LABELS[component] || component}：${state.error}`)
    .join(" · ");
}

function recordAutoSyncAttempt(plugin, component) {
  const state = ensureAutoSyncStatus(plugin)[component];
  if (!state) return;
  state.lastAttemptAt = Date.now();
}

function recordAutoSyncSuccess(plugin, component) {
  const state = ensureAutoSyncStatus(plugin)[component];
  if (!state) return;
  state.lastSuccessAt = Date.now();
  state.error = "";
  state.errorAt = 0;
  refreshAutoSyncError(plugin);
}

function recordAutoSyncFailure(plugin, component, error) {
  const message = compactCommandError("", "", error?.message || String(error));
  const now = Date.now();
  const status = ensureAutoSyncStatus(plugin);
  const state = status[component] || status.snapshot;
  const repeated = state.error === message && now - state.errorAt < 10 * 60 * 1000;
  state.error = message;
  state.errorAt = repeated ? state.errorAt : now;
  refreshAutoSyncError(plugin);
  if (!repeated) plugin.autoSyncLastErrorAt = now;
  return { message, repeated };
}

class CrispLaunchpadPlugin extends Plugin {

  // Never overwrite a data.json that could not be read and could not be backed up either.
  async saveData(data) {
    if (this.dataWriteBlocked) throw new Error("设置文件受保护，本次运行无法保存设置");
    const text = JSON.stringify(data, null, 2);
    const path = `${this.manifest.dir}/data.json`;
    const adapter = this.app.vault.adapter;
    const write = async () => {
      await adapter.write(path, text);
      if (await adapter.read(path) !== text) throw new Error("设置保存校验失败，请重试");
    };
    const pending = (this.settingsSaveQueue || Promise.resolve()).catch(() => {}).then(write);
    this.settingsSaveQueue = pending;
    return pending;
  }

  // loadData() yields undefined when data.json exists but cannot be read; keep a copy before defaults take over.
  async protectUnreadableData(raw) {
    if (raw !== undefined) return;
    const result = await preserveUnreadableData(this.app?.vault?.adapter, `${this.manifest?.dir}/data.json`);
    if (result.state === "preserved") {
      new Notice(`Crisp Launchpad 的设置文件无法读取，已备份为 ${result.backupPath.split("/").pop()} 并恢复默认设置。`, 12000);
    } else if (result.state === "failed") {
      this.dataWriteBlocked = true;
      console.error("Crisp Launchpad could not back up unreadable data.json", result.error);
      new Notice("Crisp Launchpad 的设置文件无法读取，也无法备份。为保护原文件，本次运行不会保存设置。", 0);
    }
  }
  async onload() {
    await this.loadSettings();
    await this.loadRouterIgnorePrefixes();
    this.refreshTimer = null;
    this.autoSyncTimer = null;
    this.autoSyncRunning = false;
    this.autoSyncDirty = { actions: false, knowledge: false, snapshot: false };
    this.autoSyncIndexTopics = new Set();
    this.autoSyncIgnoreUntil = 0;
    this.autoSyncLastError = "";
    this.autoSyncLastErrorAt = 0;
    this.autoSyncStatus = Object.fromEntries(
      Object.keys(AUTO_SYNC_COMPONENT_LABELS).map((component) => [
        component,
        newAutoSyncComponentState(),
      ]),
    );
    this.unloaded = false;
    this.healthRebuildTimer = null;
    this.registerView(VIEW_TYPE_LAUNCHPAD, (leaf) => new CrispLaunchpadView(leaf, this));
    this.registerView(VIEW_TYPE_PANEL, (leaf) => new CrispPanelView(leaf, this));
    crispRegisterIcons();
    this.addRibbonIcon(CRISP_LAUNCHPAD_ICON_ID, "打开 Crisp Launchpad", () => this.activateView());
    this.addCommand({
      id: "open-crisp-launchpad-view",
      name: "打开 Crisp Launchpad",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "open-crisp-panel-view",
      name: "打开 Crisp 行动面板（侧栏）",
      callback: () => this.activatePanelView(),
    });
    this.addCommand({
      id: "refresh-crisp-launchpad-actions",
      name: "刷新 Crisp Launchpad 行动快照",
      callback: async () => {
        try {
          await this.refreshActionSnapshots();
        } catch (error) {
          new Notice(`Crisp Launchpad：${error.message || error}`, 8000);
        }
      },
    });
    this.addCommand({
      id: "refresh-crisp-launchpad-system",
      name: "刷新 Crisp Launchpad 系统快照",
      callback: async () => {
        try {
          await this.refreshSystemSnapshots();
        } catch (error) {
          new Notice(`Crisp Launchpad：${error.message || error}`, 8000);
        }
      },
    });
    this.addCommand({
      id: "quick-capture",
      name: "Crisp Launchpad：速记",
      callback: async () => {
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_LAUNCHPAD)[0];
        this.openQuickCapture(leaf?.view);
      },
    });
    this.addCommand({
      id: "new-action",
      name: "Crisp Launchpad：新建行动",
      callback: async () => {
        this.openNewAction();
      },
    });
    this.addCommand({
      id: "run-onboarding",
      name: "Crisp Launchpad：运行环境向导",
      callback: () => new LaunchpadOnboardingModal(this.app, this).open(),
    });
    this.addCommand({
      id: "new-content-project",
      name: "Crisp Launchpad：新建内容项目",
      callback: async () => {
        await this.resolveWorkspaceProfile();
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_LAUNCHPAD)[0];
        new ContentProjectCreateModal(this.app, this, leaf?.view).open();
      },
    });
    this.addCommand({
      id: "open-content-base",
      name: "Crisp Launchpad：打开内容总览 Base",
      callback: async () => {
        await this.resolveWorkspaceProfile();
        const topic = primaryContentTopic(this.lastCapabilities);
        const basePath = this.lastCapabilities?.perTopic?.[topic]?.basePath || "";
        const file = basePath ? this.app.vault.getAbstractFileByPath(basePath) : null;
        if (file instanceof TFile) {
          await this.app.workspace.getLeaf(false).openFile(file);
        } else {
          new Notice("Crisp Launchpad：当前内容 Topic 没有可用的 Base");
        }
      },
    });
    /* Tempo 只在任务真的变了才发 crisp-tempo:state：看板刷新，事件桥开着时顺带重建行动快照。 */
    this.registerEvent(
      this.app.workspace.on("crisp-tempo:state", () => this.queueEventBridge("actions")),
    );
    /* Pulse 的分数、连续天数或速记变了：合并成一次刷新，今天一行跟着更新。 */
    this.registerEvent(
      this.app.workspace.on("crisp-pulse:state", () => this.queuePulseRefresh()),
    );
    this.addSettingTab(new CrispLaunchpadSettingTab(this.app, this));

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (
          !file?.path ||
          (!file.path.startsWith("Core/") &&
            !file.path.startsWith("Topics/"))
        ) {
          return;
        }
        this.handleAutoRouteCandidate(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        this.handleAutoRouteCandidate(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.handleAutoRouteCandidate(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.handleAutoRouteCandidate(file);
        this.handleAutoRouteCandidate({ path: oldPath });
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.handleAutoRouteCandidate(file);
      }),
    );
    this.app.workspace.onLayoutReady(async () => {
      if (this.unloaded) return;
      if (this.settings.openOnStartup) await this.activateView();
      if (this.settings.panelOnStartup) await this.activatePanelView();
      if (!this.settings.hasCompletedOnboarding) {
        new LaunchpadOnboardingModal(this.app, this).open();
      }
    });
  }

  onunload() {
    this.unloaded = true;
    window.clearTimeout(this.refreshTimer);
    window.clearTimeout(this.autoSyncTimer);
    window.clearTimeout(this.pulseRefreshTimer);
    this.cancelHealthRebuild();
    /* 不在卸载时关掉视图：Obsidian 会保留标签位置，插件重新加载（更新）后原地恢复。
       关掉再重开会把启动台挪到最后一个标签。 */
  }

  async loadSettings() {
    const stored = await this.loadData();
    await this.protectUnreadableData(stored);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
  }

  async saveSettings() {
    try { await this.saveData(this.settings); }
    catch (error) {
      new Notice(`Crisp Launchpad：设置未保存，${error.message || error}`, 8000);
      throw error;
    }
  }

  canRunAnks() {
    const hasBasePath = Boolean(this.app.vault.adapter.getBasePath?.());
    const isWindows =
      typeof process !== "undefined" && process.platform === "win32";
    return !Platform.isMobile && typeof execFile === "function" && hasBasePath && !isWindows;
  }

  async setAutoRouteEnabled(value) {
    if (value === true && !this.canRunAnks()) {
      this.settings.autoRouteEnabled = false;
      await this.saveSettings();
      this.refreshViews();
      new Notice("Crisp Launchpad：当前环境不支持自动事件桥");
      return;
    }
    this.settings.autoRouteEnabled = value === true;
    await this.saveSettings();
    this.refreshViews();
  }

  handleAutoRouteCandidate(file) {
    if (this.unloaded) return;
    if (textOr(file?.path) === ROUTING_RULES_PATH) {
      void this.loadRouterIgnorePrefixes();
      return;
    }
    const indexTopic = contentIndexTopicForPath(file?.path);
    const cardProject = controlCardProjectForPath(file?.path);
    // 删除整个项目目录时事件路径是文件夹（无扩展名），eventBridgeKind 不认，
    // 但派生的 content-projects/index.md 仍需重建。
    const kind = eventBridgeKind(file?.path) || (indexTopic ? "snapshot" : "");
    if (!kind) return;
    this.queueEventBridge(kind, indexTopic, cardProject);
  }

  /* "actions" 来自 Tempo 的 crisp-tempo:state：重建 CLI 用的行动快照，视图跟着刷新。 */
  queueEventBridge(kind, indexTopic = "", cardProject = null) {
    if (this.unloaded) return;
    // Local views must follow deletions/renames even when CLI automation is off
    // (including mobile). Merge vault and metadata events into one render.
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      if (!this.unloaded) this.refreshViews();
    }, 1200);
    if (!this.settings.autoRouteEnabled || !this.canRunAnks()) return;
    this.autoSyncDirty[kind] = true;
    if (indexTopic) (this.autoSyncIndexTopics ||= new Set()).add(indexTopic);
    if (cardProject) {
      (this.autoSyncCardProjects ||= new Map()).set(cardProject.contentId, cardProject.topic);
    }
    if (this.autoSyncRunning) {
      return;
    }
    const wait =
      kind !== "actions" && Date.now() < this.autoSyncIgnoreUntil
        ? Math.max(AUTO_ROUTE_DEBOUNCE_MS, this.autoSyncIgnoreUntil - Date.now() + 50)
        : AUTO_ROUTE_DEBOUNCE_MS;
    window.clearTimeout(this.autoSyncTimer);
    this.autoSyncTimer = window.setTimeout(
      () => this.runEventBridgeSync(),
      wait,
    );
  }

  async runEventBridgeSync() {
    if (this.unloaded) return;
    if (this.autoSyncRunning || !this.settings.autoRouteEnabled || !this.canRunAnks()) {
      return;
    }
    if (this.foregroundSyncDepth > 0) {
      // 前台正在跑同样的命令：脏标记留着，稍后再来。
      window.clearTimeout(this.autoSyncTimer);
      this.autoSyncTimer = window.setTimeout(() => this.runEventBridgeSync(), AUTO_ROUTE_DEBOUNCE_MS);
      return;
    }
    const pending = { ...this.autoSyncDirty };
    this.autoSyncDirty = { actions: false, knowledge: false, snapshot: false };
    const indexTopics = [...(this.autoSyncIndexTopics || [])];
    this.autoSyncIndexTopics = new Set();
    const cardProjects = [...(this.autoSyncCardProjects || new Map())];
    this.autoSyncCardProjects = new Map();
    if (!pending.actions && !pending.knowledge && !pending.snapshot) return;

    this.autoSyncRunning = true;
    try {
      /* 项目在插件外被删除、改名或改了控制文件时，index.md 不会自己更新，
         health 随即报 BROKEN_LINK_PATH。content index 只在内容变化时写入，
         且 index.md 本身不入队，不会自我触发。 */
      for (const [contentId, topic] of cardProjects) {
        await this.refreshGeneratedControlCard(contentId, topic);
      }
      for (const topic of indexTopics) {
        await this.syncContentIndex(topic);
      }
      if (pending.knowledge) {
        recordAutoSyncAttempt(this, "route");
        try {
          await this.runAnks(["route", "fix", "--min-confidence", "1"]);
          recordAutoSyncSuccess(this, "route");
        } catch (error) {
          this.reportAutoSyncError(error, "route");
        }
      }
      if (pending.knowledge || pending.snapshot) {
        recordAutoSyncAttempt(this, "snapshot");
        try {
          /* 只重建 content/index：它们各约 0.14s，而 health 要扫全库（约 3.4s），
             并且 health 一旦有 blocking，`snapshot build` 会整体失败、连 content/index
             都不写。health 因此统一合并到停顿后再补，避免快照管道被一个 blocking 拖停。 */
          await this.runAnks(["snapshot", "build", "--only", "content,index"]);
          this.scheduleHealthRebuild();
          recordAutoSyncSuccess(this, "snapshot");
        } catch (error) {
          this.reportAutoSyncError(error, "snapshot");
        }
      }
      if (pending.actions) {
        recordAutoSyncAttempt(this, "actions");
        try {
          await this.runAnks(["actions", "snapshot"]);
          recordAutoSyncSuccess(this, "actions");
        } catch (error) {
          this.reportAutoSyncError(error, "actions");
        }
      }
      this.refreshViews();
    } finally {
      this.autoSyncIgnoreUntil = Date.now() + AUTO_ROUTE_COOLDOWN_MS;
      this.autoSyncRunning = false;
      if (this.unloaded) return;
      if (
        this.autoSyncDirty.actions ||
        this.autoSyncDirty.knowledge ||
        this.autoSyncDirty.snapshot
      ) {
        window.clearTimeout(this.autoSyncTimer);
        this.autoSyncTimer = window.setTimeout(
          () => this.runEventBridgeSync(),
          AUTO_ROUTE_DEBOUNCE_MS,
        );
      }
    }
  }

  /* health 快照的全库扫描很贵，内容项目这类高频编辑把它合并到停顿后再补一次。 */
  scheduleHealthRebuild() {
    window.clearTimeout(this.healthRebuildTimer);
    this.healthRebuildTimer = window.setTimeout(async () => {
      this.healthRebuildTimer = null;
      if (this.unloaded || !this.settings.autoRouteEnabled || !this.canRunAnks()) return;
      recordAutoSyncAttempt(this, "health");
      try {
        await this.runAnks(["snapshot", "build", "--only", "health"]);
        recordAutoSyncSuccess(this, "health");
        this.refreshViews();
      } catch (error) {
        this.reportAutoSyncError(error, "health");
      }
    }, AUTO_HEALTH_REBUILD_MS);
  }

  cancelHealthRebuild() {
    window.clearTimeout(this.healthRebuildTimer);
    this.healthRebuildTimer = null;
  }

  reportAutoSyncError(error, component = "snapshot") {
    const { message, repeated } = recordAutoSyncFailure(this, component, error);
    if (repeated) {
      return;
    }
    new Notice(`Crisp Launchpad：自动事件桥 · ${message}`, 8000);
  }

  /* 插件更新后原来的标签要过一会儿才恢复成启动台视图，这时 getLeavesOfType 还找不到它；
     再按布局里记的视图类型找一遍，避免新开第二个标签。 */
  findLeafOfType(type) {
    const live = this.app.workspace.getLeavesOfType(type)[0];
    if (live) return live;
    let restoring = null;
    this.app.workspace.iterateAllLeaves?.((leaf) => {
      if (!restoring && leaf.getViewState?.()?.type === type) restoring = leaf;
    });
    return restoring;
  }

  async activateView() {
    let leaf = this.findLeafOfType(VIEW_TYPE_LAUNCHPAD);
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_LAUNCHPAD, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async activatePanelView() {
    let leaf = this.findLeafOfType(VIEW_TYPE_PANEL);
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_PANEL, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  readBookmarks(limit = 6) {
    try {
      const internal = this.app.internalPlugins;
      const instance =
        internal?.plugins?.bookmarks?.instance ||
        internal?.getEnabledPluginById?.("bookmarks")?.instance;
      if (!instance?.getBookmarks) return [];
      return normalizeBookmarkEntries(instance.getBookmarks(), limit);
    } catch (error) {
      console.warn("[Crisp Launchpad] Failed to read bookmarks:", error);
      return [];
    }
  }

  queuePulseRefresh() {
    if (this.unloaded) return;
    window.clearTimeout(this.pulseRefreshTimer);
    this.pulseRefreshTimer = window.setTimeout(() => {
      this.pulseRefreshTimer = null;
      if (!this.unloaded) this.refreshViews();
    }, PULSE_REFRESH_DEBOUNCE_MS);
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_LAUNCHPAD)) {
      if (leaf.view instanceof CrispLaunchpadView) {
        leaf.view.render();
      }
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PANEL)) {
      if (leaf.view instanceof CrispPanelView) {
        leaf.view.render();
      }
    }
  }

  async refreshActionSnapshots(options = {}) {
    if (!this.canRunAnks()) {
      if (options.silent) {
        this.refreshViews();
        return false;
      }
      throw new Error("当前环境不支持本地 ANKS CLI");
    }
    if (!this.settings.allowSnapshotRefresh) {
      if (options.silent) {
        this.refreshViews();
        return false;
      }
      throw new Error("一键刷新已在设置中关闭");
    }
    recordAutoSyncAttempt(this, "actions");
    try {
      await this.runAnks(["actions", "snapshot"]);
      recordAutoSyncSuccess(this, "actions");
      if (!options.silent) new Notice("Crisp Launchpad：行动快照已刷新");
      this.refreshViews();
      return true;
    } catch (error) {
      recordAutoSyncFailure(this, "actions", error);
      this.refreshViews();
      throw error;
    }
  }

  /* project.yaml 在插件外被改时，只刷新生成的控制卡；手写卡保持原样。 */
  async refreshGeneratedControlCard(contentId, topic) {
    const cardPath = `Topics/${topic}/content-projects/${contentId}/project.md`;
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(cardPath))) return false;
      if (!isGeneratedControlCard(await adapter.read(cardPath))) return false;
      await this.runAnks(["content", "control-card", contentId, "--topic", topic, "--force"]);
      return true;
    } catch (error) {
      console.warn("[Crisp Launchpad] control card refresh failed:", error);
      return false;
    }
  }

  async loadRouterIgnorePrefixes() {
    try {
      const adapter = this.app.vault.adapter;
      const text = (await adapter.exists(ROUTING_RULES_PATH))
        ? await adapter.read(ROUTING_RULES_PATH)
        : "";
      return setRouterIgnorePrefixes(parseRouterIgnorePrefixes(text));
    } catch (error) {
      return setRouterIgnorePrefixes(null);
    }
  }

  /* content-projects/index.md 是派生文件（真源是各项目的 project.yaml），
     由 Sidecar 的 `anks content index` 重建。重建失败不应让项目创建/推进失败。 */
  async syncContentIndex(topic = "") {
    if (!this.canRunAnks()) return false;
    try {
      const args = ["content", "index"];
      if (topic) args.push("--topic", topic);
      await this.runAnks(args);
      return true;
    } catch (error) {
      console.warn("[Crisp Launchpad] content index rebuild failed:", error);
      return false;
    }
  }

  /* project.md 是 project.yaml 的副本，而且 anks_core 定位控制文件时 project.md 优先。
     所以推进阶段/状态后必须重新物化，否则工具会读到过期的控制卡。 */
  async syncContentArtifacts(contentId = "", options = {}) {
    if (!this.canRunAnks()) return false;
    if (contentId) {
      try {
        const args = ["content", "control-card", String(contentId)];
        if (options.topic) args.push("--topic", options.topic);
        if (options.force) args.push("--force");
        await this.runAnks(args);
      } catch (error) {
        console.warn("[Crisp Launchpad] control card sync failed:", error);
      }
    }
    return this.syncContentIndex(options.topic || "");
  }

  async refreshSystemSnapshots(options = {}) {
    if (!this.canRunAnks()) {
      if (options.silent) {
        this.refreshViews();
        return false;
      }
      throw new Error("当前环境不支持本地 ANKS CLI");
    }
    if (!this.settings.allowSnapshotRefresh) {
      if (options.silent) {
        this.refreshViews();
        return false;
      }
      throw new Error("一键刷新已在设置中关闭");
    }
    recordAutoSyncAttempt(this, "snapshot");
    recordAutoSyncAttempt(this, "health");
    try {
      await this.runAnks(["snapshot", "build"]);
      recordAutoSyncSuccess(this, "snapshot");
      recordAutoSyncSuccess(this, "health");
      if (!options.silent) new Notice("Crisp Launchpad：系统快照已刷新");
      this.refreshViews();
      return true;
    } catch (error) {
      recordAutoSyncFailure(this, "snapshot", error);
      recordAutoSyncFailure(this, "health", error);
      this.refreshViews();
      throw error;
    }
  }

  async ensureFolder(folderPath) {
    const segments = String(folderPath).split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  async uniquePath(path) {
    if (!(await this.app.vault.adapter.exists(path))) return path;
    const match = path.match(/^(.*?)(\.[^/.]+)?$/);
    const stem = match?.[1] || path;
    const extension = match?.[2] || "";
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${stem}-${index}${extension}`;
      if (!(await this.app.vault.adapter.exists(candidate))) return candidate;
    }
    throw new Error("无法生成唯一文件名");
  }

  async createInboxCapture({ text, inboxType = "scratch", topic = "" }) {
    if (!String(text ?? "").trim()) throw new Error("内容不能为空");
    const cleanTopic = String(topic ?? "").trim();
    if (!cleanTopic) {
      throw new Error("尚未配置 Topic：先在 Topics/ 下建一个（如 Topics/<topic>），再使用捕获");
    }
    const topicFolder = this.app.vault.getAbstractFileByPath(`Topics/${cleanTopic}`);
    if (!(topicFolder instanceof TFolder)) {
      throw new Error(`Topic「${cleanTopic}」不存在：先在 Topics/ 下建好目录再捕获`);
    }
    const note = buildInboxNote(text, inboxType, new Date(), cleanTopic);
    await this.ensureFolder(note.folder);
    const path = await this.uniquePath(`${note.folder}/${note.filename}`);
    await this.app.vault.create(path, note.content);
    return path;
  }

  async createAction({ text, due = "", project = "", link = "", identity = "" }) {
    const clean = String(text ?? "").trim();
    if (!clean) throw new Error("行动不能为空");
    const tempo = this.tempoApi();
    if (!tempo) throw new Error(TEMPO_REQUIRED_HINT);
    const notes = [due ? `截止 ${due}` : "", project ? `#${project}` : ""].filter(Boolean).join(" · ");
    await tempo.createTaskFromSource({
      sourceId: identity
        ? launchpadActionSourceId(identity)
        : link ? launchpadActionSourceId(String(link), "source") : launchpadActionSourceId(clean),
      title: clean,
      ...(notes ? { description: `来自 Crisp Launchpad · ${notes}` } : {}),
      ...(link ? { notePath: String(link) } : {}),
    });
    return "Crisp Tempo";
  }

  async markProcessed(file) {
    if (!(file instanceof TFile)) throw new Error("原文不存在");
    const topic = strictTopicFromPath(file.path);
    if (!topic) throw new Error("原文不属于 Topics/，不能按 Topic 路由标记");
    await this.app.vault.process(file, content => markProcessedContent(content, new Date(), topic, inboxTypeForPath(file.path)));
  }

  async convertInboxToTopic(file) {
    if (!(file instanceof TFile)) throw new Error("原文不存在");
    if (!this.canRunAnks()) {
      throw new Error("当前环境不支持本地 ANKS CLI，请在桌面端转换选题");
    }
    const topic = strictTopicFromPath(file.path);
    if (!topic) throw new Error("原文不属于 Topics/，不能转换为该 Topic 的选题");
    await this.runAnks([
      "topic",
      "--input",
      file.path,
      "--topic",
      topic,
      "--write",
    ]);
  }

  hasCommand(id) {
    return Boolean(this.app.commands?.findCommand?.(id));
  }

  /* 速记交给 Pulse（它管速记和写作活跃度）；Pulse 没开时用 Launchpad 自带的弹窗。 */
  openQuickCapture(view) {
    const command = "crisp-pulse:quick-memo";
    if (this.app.plugins?.enabledPlugins?.has("crisp-pulse") && this.hasCommand(command)) {
      if (this.app.commands.executeCommandById(command)) return;
    }
    this.openOwnCaptureModal(view);
  }

  openOwnCaptureModal(view) {
    new QuickCaptureModal(this.app, this, view).open();
  }

  /* 今天一行用的邻居数据，只读。读不到的项保持 null，界面据此不显示。 */
  async readTodaySignals() {
    const signals = { pulse: null, completed: null, recent: null, memoBacklog: null };
    const pulse = this.app.plugins?.enabledPlugins?.has(PULSE_PLUGIN_ID) ? this.app.plugins?.plugins?.[PULSE_PLUGIN_ID] : null;
    if (pulse && typeof pulse.getTodaySnapshot === "function") {
      try {
        const snapshot = await pulse.getTodaySnapshot();
        if (snapshot && Number.isFinite(Number(snapshot.score))) signals.pulse = snapshot;
      } catch (error) {
        console.warn("[Crisp Launchpad] reading Crisp Pulse failed:", error);
      }
    }
    if (pulse && typeof pulse.getMemoBacklog === "function") {
      try {
        const backlog = await pulse.getMemoBacklog(MEMO_BACKLOG_DAYS);
        if (backlog && Number.isFinite(Number(backlog.pending))) signals.memoBacklog = backlog;
      } catch (error) {
        console.warn("[Crisp Launchpad] reading Crisp Pulse memos failed:", error);
      }
    }
    if (pulse && typeof pulse.getRecentDays === "function") {
      try {
        const recent = await pulse.getRecentDays(Math.max(...RHYTHM_DAY_OPTIONS));
        if (recent && Array.isArray(recent.days)) signals.recent = recent;
      } catch (error) {
        console.warn("[Crisp Launchpad] reading Crisp Pulse history failed:", error);
      }
    }
    const tempo = this.usesTempo() ? this.tempoApi() : null;
    if (tempo && typeof tempo.getCompletedToday === "function") {
      try {
        const result = await tempo.getCompletedToday();
        const count = Number(result?.count);
        if (Number.isFinite(count)) signals.completed = count;
      } catch (error) {
        console.warn("[Crisp Launchpad] reading Tempo completions failed:", error);
      }
    }
    return signals;
  }

  /* 打开 Pulse 速记面板，只看这段时间里还没去处的速记。 */
  async openMemoBacklog(backlog) {
    const pulse = this.app.plugins?.plugins?.[PULSE_PLUGIN_ID];
    if (typeof pulse?.openMemoQuery === "function") {
      try {
        await pulse.openMemoQuery({ from: backlog.from, to: backlog.to, converted: false });
        return;
      } catch (error) {
        console.warn("[Crisp Launchpad] opening Crisp Pulse memos failed:", error);
      }
    }
    this.runCrispCommand("crisp-pulse:open-memo-view", "Crisp Pulse 速记");
  }

  runCrispCommand(command, name) {
    if (this.hasCommand(command) && this.app.commands.executeCommandById(command)) return true;
    new Notice(`Crisp Launchpad：「${name}」暂时打不开`);
    return false;
  }

  tempoApi() {
    if (!this.app.plugins?.enabledPlugins?.has(TEMPO_PLUGIN_ID)) return null;
    const tempo = this.app.plugins?.plugins?.[TEMPO_PLUGIN_ID];
    if (!tempo || !(Number(tempo.actionsApiVersion) >= 1)) return null;
    if (typeof tempo.getActionOverview !== "function" || typeof tempo.createTaskFromSource !== "function") return null;
    return tempo;
  }

  /* 行动只认 Crisp Tempo（docs/ROLE-CONTRACT.md）。没装、没激活或读失败时 actionSource 为 "none"，
     行动台显示提示，新建行动不可用。 */
  async readActions() {
    const tempo = this.tempoApi();
    if (tempo) {
      try {
        const overview = await tempo.getActionOverview();
        if (overview?.licensed && Array.isArray(overview.tasks)) {
          this.actionSource = "tempo";
          return overview.tasks.map(tempoSummaryToAction);
        }
      } catch (error) {
        console.warn("[Crisp Launchpad] reading Crisp Tempo failed:", error);
      }
    }
    this.actionSource = "none";
    return [];
  }

  usesTempo() {
    return this.actionSource === "tempo" && Boolean(this.tempoApi());
  }

  async readReviewTasks(today = new Date(), context = null) {
    const tempo = this.tempoApi();
    if (!tempo || typeof tempo.getCompletedOn !== "function" || typeof tempo.getActionOverview !== "function") {
      throw new Error("请启用支持完成历史查询的 Crisp Tempo");
    }
    const overview = await tempo.getActionOverview();
    if (!overview?.licensed || !Array.isArray(overview.tasks)) throw new Error(TEMPO_REQUIRED_HINT);
    const tasks = overview.tasks.map(tempoSummaryToAction);
    const days = Array.from({ length: REVIEW_DONE_COOLDOWN_DAYS + 1 }, (_, offset) => {
      const day = new Date(today);
      day.setDate(day.getDate() - offset);
      return dateKey(day);
    });
    const history = await Promise.all(days.map(async key => {
      const result = await tempo.getCompletedOn(key);
      if (!Array.isArray(result?.tasks)) throw new Error("Tempo 完成历史不可用");
      return result.tasks.map(task => ({
        ...tempoSummaryToAction({ ...task, bucket: "done" }), doneAt: key,
      }));
    }));
    const all = new Map([...tasks, ...history.flat()].map(task => [task.id, task]));
    if (context) {
      if (typeof tempo.getTasksBySource !== "function") throw new Error("Tempo 来源查询不可用，请更新后重试");
      const candidates = suggestReviewActions({ ...context, tasks: [], today, max: Number.MAX_SAFE_INTEGER, perGroupLimit: Number.MAX_SAFE_INTEGER });
      const bySource = new Map();
      for (const candidate of candidates) {
        if (!candidate.identity) continue;
        for (const day of days) bySource.set(launchpadActionSourceId(candidate.identity, day), candidate.identity);
        // Source IDs carry the creation day, which can predate the completion window.
        // Recent Tempo also includes them in completed history; never infer creation from completion.
        for (const task of all.values()) {
          const match = /^crisp-launchpad:(\d{4})(\d{2})(\d{2})-/.exec(task.sourceId || "");
          if (match) {
            const day = `${match[1]}-${match[2]}-${match[3]}`;
            const sourceId = launchpadActionSourceId(candidate.identity, day);
            if (sourceId === task.sourceId) bySource.set(sourceId, candidate.identity);
          }
        }
      }
      if (bySource.size) {
        const linked = await tempo.getTasksBySource([...bySource.keys()]);
        if (!linked || typeof linked !== "object" || Array.isArray(linked)) throw new Error("Tempo 来源查询失败");
        for (const task of Object.values(linked)) {
          const existing = all.get(`tempo:${task.id}`);
          const identity = bySource.get(task.sourceId);
          if (existing && identity) existing.reviewIdentity = identity;
        }
      }
    }
    return [...all.values()];
  }

  runTempoCommand(command) {
    if (this.tempoApi() && this.app.commands.executeCommandById(`${TEMPO_PLUGIN_ID}:${command}`)) return true;
    new Notice(`Crisp Launchpad：${TEMPO_REQUIRED_HINT}`);
    return false;
  }

  openActionBoard() {
    this.runTempoCommand("open-tempo-view");
  }

  /* 新建行动用 Tempo 的新建弹窗：Tempo 0.14.0 起直接弹在当前页面，不跳到 Tempo；
     旧版或未激活时退回 Tempo 的快速新建命令（会打开 Tempo，并在未激活时提示）。 */
  async openNewAction() {
    const tempo = this.tempoApi();
    if (tempo && typeof tempo.openQuickAddModal === "function") {
      try {
        if (await tempo.openQuickAddModal()) return;
      } catch (error) {
        console.warn("[Crisp Launchpad] Tempo quick add dialog failed:", error);
      }
    }
    this.runTempoCommand("quick-add-task");
  }

  /* 行动交给 Tempo 打开并选中。 */
  async openAction(task) {
    try {
      await this.tempoApi()?.revealTask?.(task.tempoId);
    } catch (error) {
      new Notice(`Crisp Launchpad：${error.message || error}`);
    }
  }

  async createContentProject({
    title,
    slug,
    profile = "",
    track = "obsidian",
    topic = "",
    platform = "",
  }) {
    const now = new Date();
    const projectTitle = String(title || "").trim();
    const finalSlug = contentSlug(slug || projectTitle, "CONTENT");
    if (!projectTitle) throw new Error("项目标题不能为空");
    await this.resolveWorkspaceProfile();
    const selectedTopic = String(topic || primaryContentTopic(this.lastCapabilities)).trim();
    const selectedPlatform = String(
      platform || primaryContentPlatform(this.lastCapabilities, selectedTopic),
    ).trim();
    const topicCapabilities = this.lastCapabilities?.perTopic?.[selectedTopic];
    const allowedProfiles = topicCapabilities?.profiles?.[selectedPlatform] || [];
    if (!selectedTopic || !selectedPlatform || !topicCapabilities) {
      throw new Error("未找到可用的内容 Topic 或平台模板");
    }
    if (!allowedProfiles.includes(profile)) {
      throw new Error(`Profile 未配置：${selectedPlatform}/${profile || "（空）"}`);
    }
    const templateRoot = contentTemplateRoot(selectedTopic, selectedPlatform);
    const projectRoot = topicCapabilities.contentProjectsPath || contentProjectsPath(selectedTopic);
    const contentId = contentProjectId(finalSlug, now, selectedPlatform);
    const projectDir = `${projectRoot}/${contentId}`;
    if (await this.app.vault.adapter.exists(projectDir)) {
      throw new Error(`项目已存在：${contentId}`);
    }
    const templateFiles = this.app.vault
      .getFiles()
      .filter((file) => file.path.startsWith(`${templateRoot}/`));
    if (!templateFiles.length) throw new Error(`未找到内容项目模板：${templateRoot}`);

    const replacements = {
      contentId,
      "WECHAT-YYYYMMDD-SLUG": contentId,
      created_at: dateKey(now),
      updated_at: dateKey(now),
      run_id: `${selectedPlatform}-${dateKey(now)}-${finalSlug.toLowerCase()}`,
    };
    await this.ensureFolder(projectDir);
    for (const template of templateFiles) {
      const relative = template.path.slice(templateRoot.length + 1);
      const target = `${projectDir}/${relative}`;
      const parent = target.split("/").slice(0, -1).join("/");
      await this.ensureFolder(parent);
      let content = replaceTemplateTokens(await this.app.vault.read(template), replacements);
      content = updateExistingFrontmatterFields(content, {
        content_id: contentId,
        topic: selectedTopic,
        owner: `topic:${selectedTopic}`,
        platform: selectedPlatform,
      });
      if (relative === "project.yaml") {
        content = content.replace(/^parent_question:.*\n?/m, "");
        if (selectedPlatform === "wechat" && track) {
          content = updateProjectField(content, "track", track);
        }
        content = updateProjectField(content, "profile", profile);
        content = content.replace(
          /^delivery_target:.*$/m,
          `$&\n\nquestion_waiver:\n  granted: true\n  reason: ${yamlQuote("作者通过 Crisp Launchpad 新建项目并直接指定选题")}\n  approved_by: "user"\n  approved_at: ${yamlQuote(dateKey(now))}`,
        );
      }
      if (relative === "article.md") {
        if (selectedPlatform === "wechat" && track) {
          content = updateProjectField(content, "track", track);
        }
        content = updateProjectField(content, "profile", profile);
        content = updateProjectField(content, "stage", "intake");
        if (title) {
          content = updateProjectField(content, "title", title);
          content = content.replace(/^# \s*$/m, `# ${title}`);
        }
      }
      if (relative === "publish.md" && selectedPlatform === "wechat") {
        const body = content.replace(/^---[\s\S]*?---\s*/, "");
        content = publishRecordContent(body, contentId, dateKey(now), selectedTopic, selectedPlatform);
      }
      await this.app.vault.create(target, content);
    }

    let validation = this.canRunAnks()
      ? { status: "pending", error: "" }
      : { status: "desktop-required", error: "" };
    if (this.canRunAnks()) {
      try {
        await this.runAnks(["content", "validate", contentId, "--strict", "--json"]);
        validation = { status: "passed", error: "" };
      } catch (error) {
        validation = { status: "pending", error: error.message || String(error) };
      }
      // 先物化控制卡：anks_core 优先读 project.md，快照要建在最新控制卡上。
      await this.syncContentArtifacts(contentId, { topic: selectedTopic });
      try {
        await this.refreshSystemSnapshots({ silent: true });
      } catch (error) {
        // A project can be created while an unrelated vault-wide gate keeps the
        // system snapshot refresh blocked. Do not report that as creation failure.
      }
    }
    return { contentId, projectDir, validation };
  }

  async updateContentProject(projectDir, changes) {
    const pending = (this.contentWriteQueue || Promise.resolve()).catch(() => {}).then(
      () => this.withForegroundSync(() => this.commitContentProject(projectDir, changes)),
    );
    this.contentWriteQueue = pending;
    return pending;
  }

  /* 新建、推进内容项目时自己会跑 control-card / index / snapshot。期间事件桥不启动，
     结束后再按冷却期补跑一次，避免两组 anks 子进程同时写 project.md、index.md 和快照。 */
  async withForegroundSync(fn) {
    this.foregroundSyncDepth = (this.foregroundSyncDepth || 0) + 1;
    try {
      return await fn();
    } finally {
      this.foregroundSyncDepth -= 1;
      if (!this.foregroundSyncDepth) this.autoSyncIgnoreUntil = Date.now() + AUTO_ROUTE_COOLDOWN_MS;
    }
  }

  async commitContentProject(projectDir, { stage, status, nextAction }) {
    if (!CONTENT_STAGES.includes(stage) || !CONTENT_STATUSES.includes(status)) {
      throw new Error("项目阶段或状态无效");
    }
    const today = dateKey(new Date());
    const vault = this.app.vault;
    const projectFile = vault.getAbstractFileByPath(`${projectDir}/project.yaml`);
    if (!(projectFile instanceof TFile)) throw new Error("project.yaml 不存在");
    const changes = [];
    // Prepare every new file before the first write. Keep the original bytes for recovery.
    // project.md 是 project.yaml 的镜像且 anks_core 优先读它：一起改 frontmatter（只改已有键），
    // 手写正文不被 --force 覆盖，移动端推进后也不会留下过期控制卡。
    for (const name of ["project.yaml", "project.md", "article.md", "publish.md"]) {
      const file = vault.getAbstractFileByPath(`${projectDir}/${name}`);
      if (!(file instanceof TFile)) continue;
      const before = await vault.read(file);
      const control = name === "project.yaml" || name === "project.md";
      const fields = {};
      if (name !== "publish.md") fields.stage = stage;
      fields.status = status;
      fields.updated_at = today;
      if (control) fields.next_action = nextAction || "继续推进当前阶段";
      if (status === "published") {
        fields.publication_status = "live";
        // 「最近产出」读 article.md 的 published_at，所以两个 Markdown 文件都补上，已有的不改。
        if (!control && !projectField(before, "published_at")) fields.published_at = today;
      }
      let after = before;
      if (name === "project.yaml") {
        for (const [key, value] of Object.entries(fields)) after = updateProjectField(after, key, value);
      } else if (name === "project.md") {
        after = updateExistingFrontmatterFields(before, fields);
      } else {
        after = upsertFrontmatterFields(before, fields);
      }
      changes.push({ file, before, after });
    }
    const applied = [];
    try {
      for (const change of changes) {
        await vault.process(change.file, current => {
          if (current !== change.before) throw new Error(`文件已被外部修改：${change.file.path}`);
          return change.after;
        });
        applied.push(change);
      }
    } catch (error) {
      const conflicts = [];
      for (const change of applied.reverse()) {
        try {
          await vault.process(change.file, current => {
            if (current !== change.after) throw new Error("外部修改");
            return change.before;
          });
        } catch (_) { conflicts.push(change.file.path); }
      }
      if (conflicts.length) throw new Error(`保存未完成，以下文件因外部修改或写入失败未能恢复：${conflicts.join("、")}；${error.message || error}`);
      throw new Error(`项目状态未保存，已恢复原内容：${error.message || error}`);
    }
    if (this.canRunAnks()) {
      const projectId = String(projectDir || "").replace(/\/+$/, "").split("/").pop();
      const topic = contentTopicFromPath(projectDir);
      // 没有控制卡就物化一张；生成的卡照旧重建；手写过正文的只靠上面的 frontmatter 同步。
      const card = changes.find((change) => change.file.path.endsWith("/project.md"));
      if (!card || isGeneratedControlCard(card.after)) {
        await this.syncContentArtifacts(projectId, { force: Boolean(card), topic });
      } else {
        await this.syncContentIndex(topic);
      }
      try {
        await this.runAnks(["content", "validate", projectId, "--strict", "--json"]);
      } catch (error) {
        new Notice(`项目状态已保存，但 ANKS 校验未通过：${error.message || error}`, 10000);
      }
      try { await this.refreshSystemSnapshots({ silent: true }); }
      catch (error) { new Notice(`项目状态已保存，快照刷新失败：${error.message || error}`); }
    }
    this.refreshViews();
    return { stage, status, nextAction };
  }

  listTopics() {
    const folder = this.app.vault.getAbstractFileByPath("Topics");
    /* 没有 Topics/ 就返回空数组：由调用方提示「尚未配置 Topic」，
       而不是回落到 self-media 并在陌生库里造出 Topics/self-media/…。 */
    if (!(folder instanceof TFolder)) return [];
    return folder.children
      .filter((child) => child instanceof TFolder && !child.name.startsWith("."))
      .map((child) => child.name)
      .sort((left, right) => left.localeCompare(right));
  }

  /* 探测当前库支持什么，并解析成界面形态。
     设置里 workspaceMode = auto 时由结构决定；用户显式选过则尊重选择。
     每次渲染都重新探测，因此库结构变化会立刻反映到界面上。 */
  async resolveWorkspaceProfile() {
    const paths = (this.app.vault.getFiles?.() || []).map((file) => file.path);
    const exists = async (path) => {
      try {
        return await this.app.vault.adapter.exists(path);
      } catch (error) {
        return false;
      }
    };
    const capabilities = detectWorkspaceCapabilities(paths, {
      cliAvailable: await exists("Sidecar/bin/anks"),
      snapshotsPresent: await exists(".runtime/snapshot/health.json"),
    });
    this.lastCapabilities = capabilities;
    return resolveWorkspaceProfile(capabilities, this.settings.workspaceMode);
  }

  /* 给设置页用的一句话摘要：让用户知道自动探测看到了什么。 */
  describeCapabilities(capabilities = this.lastCapabilities) {
    const caps = capabilities || {};
    const modeLabels = {
      "content-ops": "内容运营",
      knowledge: "知识管理",
      "actions-only": "仅行动",
    };
    const mode = resolveWorkspaceProfile(caps, this.settings.workspaceMode);
    const modeText = modeLabels[mode] || modeLabels["actions-only"];
    const modeSource = this.settings.workspaceMode === "auto" ? "自动识别" : "手动选择";
    if (!caps.topics || !caps.topics.length) {
      return `未检测到 Topics/ 目录；${modeSource}为「${modeText}」。可以先用行动面板记录和推进事项。`;
    }
    const parts = caps.topics.map((topic) => {
      const entry = caps.perTopic[topic] || {};
      const bits = [];
      if (entry.hasContentProjects) bits.push("内容项目");
      if (entry.platforms && entry.platforms.length) {
        const platformSummary = entry.platforms.map((platform) => {
          const profiles = entry.profiles?.[platform] || [];
          return profiles.length ? `${platform}（${profiles.join("、")}）` : platform;
        });
        bits.push(`内容模板 ${platformSummary.join("/")}`);
      }
      if (entry.hasKnowledge) bits.push("知识");
      if (entry.hasInbox) bits.push("收件箱");
      if (entry.outputsPath) bits.push("产出");
      return `${topic}（${bits.join(" · ") || "已识别 Topic"}）`;
    });
    const cliText = caps.hasCli ? "本机 CLI 可用" : "未找到本机 CLI，命令行能力关闭";
    return `${modeSource}：${parts.join("；")}。当前形态：${modeText}。${cliText}。`;
  }

  async checkEnvironment() {
    const checks = [];
    const addCheck = async (label, path, detail) => {
      const ok = await this.app.vault.adapter.exists(path);
      checks.push({ label, detail, ok });
    };
    await addCheck("ANKS CLI", "Sidecar/bin/anks", "用于生成快照和执行确定性转化");
    await addCheck("系统状态快照", ".runtime/snapshot/health.json", "健康与索引状态");
    await addCheck("行动快照", ".runtime/snapshot/actions.json", "今天、等待、即将");
    return checks;
  }

  async repairEnvironment() {
    if (!this.canRunAnks()) {
      throw new Error("移动端不支持本地 CLI 修复");
    }
    await this.runAnks(["sync", "update"]);
    await this.runAnks(["snapshot", "build"]);
    await this.runAnks(["actions", "snapshot"]);
    this.settings.hasCompletedOnboarding = true;
    await this.saveSettings();
    this.refreshViews();
  }

  async completeOnboarding() {
    this.settings.hasCompletedOnboarding = true;
    await this.saveSettings();
  }

  async runAnks(args) {
    if (!this.canRunAnks()) {
      throw new Error(
        Platform.isMobile
          ? "移动端不支持本地 ANKS CLI"
          : "当前环境不支持本地 ANKS CLI",
      );
    }
    const vaultPath = this.app.vault.adapter.getBasePath?.();
    if (
      typeof process !== "undefined" &&
      process.platform === "win32"
    ) {
      throw new Error("当前一键刷新仅支持 macOS / POSIX 环境");
    }
    const processEnv = typeof process !== "undefined" ? process.env || {} : {};
    const envPath = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      processEnv.HOME ? `${processEnv.HOME}/.local/bin` : "",
      processEnv.PATH,
    ]
      .filter(Boolean)
      .join(":");
    return new Promise((resolve, reject) => {
      execFile(
        "sh",
        ["Sidecar/bin/anks", ...args],
        {
          cwd: vaultPath,
          timeout: 180000,
          maxBuffer: 1024 * 1024 * 8,
          env: { ...processEnv, PATH: envPath },
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(compactCommandError(stdout, stderr, error.message || String(error))));
          } else {
            resolve(stdout);
          }
        },
      );
    });
  }
}

module.exports = CrispLaunchpadPlugin;
module.exports.VIEW_TYPE_LAUNCHPAD = VIEW_TYPE_LAUNCHPAD;
module.exports.VIEW_TYPE_PANEL = VIEW_TYPE_PANEL;
module.exports.normalizeBookmarkEntries = normalizeBookmarkEntries;
module.exports.pageLabel = pageLabel;
module.exports.capturedToday = capturedToday;
module.exports.isRouterIgnoredPath = isRouterIgnoredPath;
module.exports.isSettledInboxStatus = isSettledInboxStatus;
module.exports.inboxTriageItems = inboxTriageItems;
module.exports.PANEL_TABS = PANEL_TABS;
module.exports.PAGES = PAGES;
module.exports.detectWorkspaceCapabilities = detectWorkspaceCapabilities;
module.exports.resolveWorkspaceProfile = resolveWorkspaceProfile;
module.exports.launchpadPages = launchpadPages;
module.exports.KPI_DEFINITIONS = KPI_DEFINITIONS;
module.exports.primaryTopic = primaryTopic;
module.exports.resolveKpiTarget = resolveKpiTarget;
module.exports.launchpadProfile = launchpadProfile;
module.exports.LAUNCHPAD_PROFILES = LAUNCHPAD_PROFILES;
module.exports.WORKSPACE_MODES = WORKSPACE_MODES;

module.exports.LaunchpadRenderer = LaunchpadRenderer;
module.exports.actionItemMeta = actionItemMeta;
module.exports.buildStageBuckets = buildStageBuckets;
module.exports.collectPages = collectPages;
module.exports.compactCommandError = compactCommandError;
module.exports.contentProjectArticle = contentProjectArticle;
module.exports.contentProjectId = contentProjectId;
module.exports.contentProjectLabel = contentProjectLabel;
module.exports.publishedOutputPages = publishedOutputPages;
module.exports.contentSlug = contentSlug;
module.exports.buildInboxNote = buildInboxNote;
module.exports.eventBridgeKind = eventBridgeKind;
module.exports.contentIndexTopicForPath = contentIndexTopicForPath;
module.exports.controlCardProjectForPath = controlCardProjectForPath;
module.exports.isGeneratedControlCard = isGeneratedControlCard;
module.exports.parseRouterIgnorePrefixes = parseRouterIgnorePrefixes;
module.exports.setRouterIgnorePrefixes = setRouterIgnorePrefixes;
module.exports.ROUTER_IGNORE_PREFIXES = ROUTER_IGNORE_PREFIXES;
module.exports.ROUTING_RULES_PATH = ROUTING_RULES_PATH;
module.exports.inferTopicFromPath = inferTopicFromPath;
module.exports.captureTargetTopic = captureTargetTopic;
module.exports.markProcessedContent = markProcessedContent;
module.exports.inboxTypeForPath = inboxTypeForPath;
module.exports.upsertFrontmatterFields = upsertFrontmatterFields;
module.exports.tempoSummaryToAction = tempoSummaryToAction;
module.exports.launchpadActionSourceId = launchpadActionSourceId;
module.exports.availableCrispTools = availableCrispTools;
module.exports.isDateKey = isDateKey;
module.exports.projectField = projectField;
module.exports.replaceTemplateTokens = replaceTemplateTokens;
module.exports.snapshotAge = snapshotAge;
module.exports.snapshotAgeLabel = snapshotAgeLabel;
module.exports.suggestReviewActions = suggestReviewActions;
module.exports.summarizePages = summarizePages;
module.exports.formatYamlScalar = formatYamlScalar;
module.exports.updateProjectField = updateProjectField;
module.exports.generateCaptureId = generateCaptureId;
module.exports.formatDateTime = formatDateTime;
module.exports.formatFullDateTime = formatFullDateTime;
module.exports.STAGE_ORDER = STAGE_ORDER;
module.exports.STAGE_LABEL = STAGE_LABEL;
module.exports.contentStatusLabel = contentStatusLabel;
module.exports.insetCardBodies = insetCardBodies;
module.exports.QuickCaptureModal = QuickCaptureModal;
module.exports.formatShortDate = formatShortDate;
module.exports.daysBetween = daysBetween;
module.exports.knownTimestamp = knownTimestamp;
module.exports.dateKeyFromTimestamp = dateKeyFromTimestamp;
module.exports.findingBasename = findingBasename;
module.exports.normalizeActionKey = normalizeActionKey;
module.exports.CRISP_LAUNCHPAD_ICON_ID = CRISP_LAUNCHPAD_ICON_ID;
module.exports.CRISP_LAUNCHPAD_ICON_SVG = CRISP_LAUNCHPAD_ICON_SVG;
module.exports.CRISP_NOW_ICON_ID = CRISP_NOW_ICON_ID;
module.exports.CRISP_NOW_ICON_SVG = CRISP_NOW_ICON_SVG;
module.exports.CRISP_LAUNCHPAD_ICON_STATIC = CRISP_LAUNCHPAD_ICON_STATIC;
module.exports.CRISP_NOW_ICON_STATIC = CRISP_NOW_ICON_STATIC;
module.exports.prefersReducedMotion = prefersReducedMotion;
module.exports.crispIconVariant = crispIconVariant;
module.exports.crispRegisterIcons = crispRegisterIcons;
