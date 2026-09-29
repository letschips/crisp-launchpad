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
const VIEW_TYPE_NOW = "crisp-now-view";
const VIEW_TYPE_PANEL = "crisp-launchpad-panel-view";
const NOW_ACTION_PATH = "Now/行动.md";
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
const RHYTHM_WEEKS_KEY = "crisp-launchpad-rhythm-weeks";
const RHYTHM_WEEK_OPTIONS = [4, 13, 26, 52];
const TOTAL_HEATMAP_WEEKS = 53;
const AUTO_ROUTE_DEBOUNCE_MS = 1800;
const AUTO_ROUTE_COOLDOWN_MS = 2500;
const AUTO_HEALTH_REBUILD_MS = 90 * 1000;
const REVIEW_DONE_COOLDOWN_DAYS = 14;
const REMINDER_INTERVAL_MS = 30 * 1000;
const REMINDER_START_DELAY_MS = 4000;
const REMINDER_GRACE_MS = 12 * 60 * 60 * 1000;
const REMINDER_KEY_LIMIT = 200;
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
    features: { create: true, review: true, kernelPill: true, workGrid: true, completionStats: true },
    kpis: ["projects", "inbox", "knowledge", "raw", "outputs", "active"],
  },
  /* 有知识层但没有内容流水线：去掉创作页，保留复盘（行动收口与知识回写仍适用） */
  knowledge: {
    heroTitle: "ANKS · 知识工作台",
    tabs: ["today", "knowledge", "review", "system"],
    features: { create: false, review: true, kernelPill: true, workGrid: true, completionStats: true },
    kpis: ["inbox", "knowledge", "raw", "outputs", "active"],
  },
  /* 陌生库：只剩行动层与系统页，也不再显示 DSH 状态（对非 ANKS 用户没有意义） */
  "actions-only": {
    heroTitle: "行动工作台",
    tabs: ["today", "system"],
    features: { create: false, review: false, kernelPill: false, workGrid: false, completionStats: false },
    /* 只剩「本周动过」：其余 KPI 都指向 ANKS 的对象层，陌生库里恒为 0 且点开是「未找到」 */
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
    hasActionLayer: list.some((p) => p === "Now/行动.md" || p.startsWith("Now/")),
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
  if (caps.hasActionLayer) return "actions-only";
  return "actions-only";
}

/* KPI 卡的定义：路径用占位符，避免把 self-media 写死。形态决定显示哪几项。 */
const KPI_DEFINITIONS = {
  projects: { label: "内容项目", hint: "创作流水线在管", path: "Topics/{contentTopic}/content-projects" },
  inbox: { label: "待整理", hint: "raw/inbox 未归位", path: "Topics/{topic}/raw/inbox" },
  knowledge: { label: "知识对象", hint: "source/knowledge 等", path: "Topics/{topic}/knowledge" },
  raw: { label: "原始素材", hint: "raw 证据层", path: "Topics/{topic}/raw" },
  outputs: { label: "产出", hint: "output 交付物", path: "Topics/{topic}/outputs" },
  active: { label: "本周动过", hint: "7 天内变更", path: "Topics" },
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
  remindersEnabled: true,
  remindedKeys: [],
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

function normalizeTimeKey(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return "";
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function isTimeKey(value) {
  return normalizeTimeKey(value) !== "";
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

function normalizeProjectTag(value) {
  const text = String(value ?? "").trim().replace(/^#/, "").replace(/^project\//i, "");
  return text.replace(/[\s#/]+/g, "-").replace(/^-+|-+$/g, "");
}

/* 写回时只清理会破坏标签 token 的字符（空白 / #），保留 `/` 以支持 Obsidian 的嵌套标签。
   否则 #project/知识/回写 会被静默改写成 #project/知识-回写，属于静默改写用户数据。 */
function safeProjectTag(value) {
  const text = String(value ?? "").trim().replace(/^#/, "").replace(/^project\//i, "");
  if (!text) return "";
  return /[\s#]/.test(text) ? normalizeProjectTag(text) : text.replace(/^-+|-+$/g, "");
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

function appendActionTask(existing, text, due = "", project = "") {
  let line = `- [ ] ${String(text ?? "").trim().split(/\r?\n/)[0] || "未命名行动"}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) line += ` 📅 ${due}`;
  const tag = normalizeProjectTag(project);
  if (tag) line += ` #project/${tag}`;
  const eol = detectEol(existing);
  const base = String(existing ?? "").replace(/\s*$/, "");
  return `${base}${base ? eol : ""}${line}${eol}`;
}

const MANAGED_TASK_TAGS = new Set(["waiting", "blocked", "待回复", "等待", "阻塞"]);

function isManagedTaskTag(tag) {
  const normalized = String(tag ?? "").toLowerCase();
  return normalized.startsWith("project/") || MANAGED_TASK_TAGS.has(normalized);
}

function cleanTaskTitle(text) {
  return String(text ?? "")
    .replace(/[📅⏳🛫➕✅]\s*\d{4}-\d{2}-\d{2}/gu, "")
    .replace(/⏰\s*\d{1,2}:\d{2}/gu, "")
    .replace(/[\uFE0E\uFE0F\u200B-\u200D]/gu, "")
    /* 只移除插件托管的标签（#project/… 与等待态）。标题里手写的其它 #token 原样保留，
       否则「修复 #123 的 bug」会在读入时变成「修复 的 bug」。 */
    .replace(/(?<!\w)#([^\s#]+)/g, (match, tag) => (isManagedTaskTag(tag) ? "" : match))
    .replace(/\s+/g, " ")
    .trim() || "未命名行动";
}

function parseNowTaskLine(line, path, lineNumber, today = new Date()) {
  const match = String(line).match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/);
  if (!match) return null;
  const raw = match[2];
  const tags = [...raw.matchAll(/(?<!\w)#([^\s#]+)/g)].map((item) => item[1]);
  const normalizedTags = tags.map((tag) => tag.toLowerCase());
  const pickDate = (emoji) => {
    const found = raw.match(new RegExp(`${emoji}\\s*(\\d{4}-\\d{2}-\\d{2})`));
    return isDateKey(found?.[1]) ? found[1] : "";
  };
  const due = pickDate("📅");
  const scheduled = pickDate("⏳");
  const start = pickDate("🛫");
  const created = pickDate("➕");
  const doneAt = pickDate("✅");
  const time = normalizeTimeKey(raw.match(/⏰\s*(\d{1,2}:\d{2})/)?.[1]);
  const done = match[1].toLowerCase() === "x";
  const waitingTags = new Set(["waiting", "blocked", "待回复", "等待", "阻塞"]);
  const waiting = normalizedTags.some((tag) => waitingTags.has(tag));
  const todayKey = dateKey(today);
  const effectiveDate = due || scheduled;
  let bucket = "anytime";
  if (!done) {
    if (waiting) bucket = "waiting";
    else if (effectiveDate && effectiveDate < todayKey) bucket = "overdue";
    else if (effectiveDate && effectiveDate === todayKey) bucket = "today";
    else if (effectiveDate && effectiveDate > todayKey) bucket = "upcoming";
    else if (start && start > todayKey) bucket = "upcoming";
    else if (start && start === todayKey) bucket = "today";
  }
  const projectTag = tags.find((tag) => tag.toLowerCase().startsWith("project/"));
  return {
    id: `${path}:${lineNumber}`,
    path,
    line: lineNumber,
    rawLine: String(line),
    title: cleanTaskTitle(raw),
    done,
    due,
    scheduled,
    start,
    created,
    time,
    doneAt,
    waiting,
    tags,
    project: projectTag ? projectTag.slice("project/".length) : "",
    bucket: done ? "done" : bucket,
  };
}

function parseNowTasks(documents, today = new Date()) {
  const tasks = [];
  for (const document of documents) {
    String(document.content ?? "")
      .split(/\r?\n/)
      .forEach((line, index) => {
        const task = parseNowTaskLine(line, document.path, index + 1, today);
        if (task) tasks.push(task);
      });
  }
  return tasks;
}

function reminderMoment(task) {
  if (!task || task.done) return null;
  const date = isDateKey(task.due)
    ? task.due
    : isDateKey(task.scheduled)
      ? task.scheduled
      : isDateKey(task.start)
        ? task.start
        : "";
  const time = normalizeTimeKey(task.time);
  if (!date || !time) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const at = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (isNaN(at.getTime())) return null;
  return {
    date,
    time,
    at,
    key: `${task.path || ""}::${task.title || ""}::${date}::${time}`,
  };
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
        !isSettledInboxStatus(page.routing_status),
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

function taskLine(task) {
  const title = String(task.title ?? "").trim() || "未命名行动";
  const done = Boolean(task.done);
  const created = isDateKey(task.created) ? " ➕ " + task.created : "";
  const start = isDateKey(task.start) ? ` 🛫 ${task.start}` : "";
  const scheduled = isDateKey(task.scheduled) ? ` ⏳ ${task.scheduled}` : "";
  const due = isDateKey(task.due) ? ` 📅 ${task.due}` : "";
  const time = isTimeKey(task.time) ? ` ⏰ ${normalizeTimeKey(task.time)}` : "";
  const doneAt = done && isDateKey(task.doneAt) ? ` ✅ ${task.doneAt}` : "";
  /* 标题里手写的标签保持原位，不再被搬到行尾。 */
  const inlineTags = new Set(
    [...title.matchAll(/(?<!\w)#([^\s#]+)/g)].map((match) => match[1].toLowerCase()),
  );
  const extraTags = (task.tags || []).filter((tag) => {
    const normalized = tag.toLowerCase();
    if (inlineTags.has(normalized)) return false;
    return !normalized.startsWith("project/") && !MANAGED_TASK_TAGS.has(normalized);
  });
  if (task.waiting) {
    const waitingTag = (task.tags || []).find((tag) => MANAGED_TASK_TAGS.has(tag.toLowerCase()));
    extraTags.unshift(waitingTag || "waiting");
  }
  const project = safeProjectTag(task.project);
  const tagText = extraTags.map((tag) => ` #${tag}`).join("");
  return "- [" + (done ? "x" : " ") + "] " + title + start + created + scheduled + due + time + doneAt + tagText + (project ? " #project/" + project : "");
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

function markProcessedContent(content, now = new Date(), topic = "self-media") {
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
        (line) => !/^routing_status\s*:/.test(line) && !/^launchpad_processed_at\s*:/.test(line),
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

function summarizePages(pages, now = new Date()) {
  const knowledge = pages.filter((page) => KNOWLEDGE_TYPES.includes(page.type));
  const raw = pages.filter((page) => page.type === "raw");
  const outputs = pages.filter((page) => page.type === "output");
  const inbox = pages.filter(
    (page) => page.path.includes("raw/inbox") && !isSettledInboxStatus(page.routing_status),
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

function heatLevel(count) {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  if (count <= 20) return 4;
  return 5;
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
];

function isRouterIgnoredPath(path) {
  const normalized = textOr(path);
  return ROUTER_IGNORE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function eventBridgeKind(path) {
  const normalized = textOr(path);
  const lower = normalized.toLowerCase();
  const isMarkdown = lower.endsWith(".md");
  const isControlData = lower.endsWith(".yaml") || lower.endsWith(".yml");
  if (normalized.startsWith("Now/") && isMarkdown) {
    return "actions";
  }
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

function suggestReviewActions({
  tasks = [],
  pages = [],
  health = null,
  contentProjects = [],
  max = 5,
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
  const existing = new Set(
    tasks
      .filter((task) => !task.done || (isDateKey(task.doneAt) && task.doneAt >= cooldownStart))
      .map((task) => normalizeActionKey(task.title))
      .filter(Boolean),
  );
  const candidates = [];
  const push = (text, project = "复盘") => {
    const clean = String(text ?? "").trim();
    const key = normalizeActionKey(clean);
    if (!clean || !key || existing.has(key)) return false;
    existing.add(key);
    candidates.push({ text: clean, project });
    return true;
  };

  const blocking = findings.filter(
    (finding) => finding.severity === "blocking" || finding.severity === "error",
  );
  if (blocking.length) {
    push(`处理系统阻塞：${blocking[0].code || "blocking"}`, "ANKS");
  }

  const overdue = tasks.filter((task) => !task.done && task.bucket === "overdue");
  if (overdue.length) push("复盘并重排当前逾期行动", "Now");

  const writebacks = findings.filter((finding) => finding.code === "PENDING_WRITEBACK");
  let writebackCount = 0;
  for (const finding of writebacks) {
    if (push(`回写待提炼：${findingBasename(finding)}`, "知识回写")) {
      if (++writebackCount >= 2) break;
    }
  }

  const staleInbox = findings.filter((finding) => finding.code === "STALE_INBOX");
  let staleCount = 0;
  for (const finding of staleInbox) {
    if (push(`整理积压收件箱：${findingBasename(finding)}`, "收件箱")) {
      if (++staleCount >= 2) break;
    }
  }

  const reviewingProjects = contentProjects.filter(
    (project) => textOr(project.stage).toLowerCase() === "reviewing",
  );
  let reviewingCount = 0;
  for (const project of reviewingProjects) {
    if (push(`复盘内容项目：${contentProjectLabel(pages, project)}`, "内容复盘")) {
      if (++reviewingCount >= 2) break;
    }
  }

  const waiting = tasks.filter((task) => !task.done && task.bucket === "waiting");
  if (waiting.length) push("跟进等待中的行动", "Now");
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

function normalizeRhythmWeeks(value) {
  const parsed = Number(value);
  return RHYTHM_WEEK_OPTIONS.includes(parsed) ? parsed : 13;
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
    this.rhythmWeeks = this.loadRhythmWeeks();
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

  loadRhythmWeeks() {
    try {
      return normalizeRhythmWeeks(window.localStorage.getItem(RHYTHM_WEEKS_KEY));
    } catch (error) {
      return 13;
    }
  }

  saveRhythmWeeks(weeks) {
    this.rhythmWeeks = normalizeRhythmWeeks(weeks);
    try {
      window.localStorage.setItem(RHYTHM_WEEKS_KEY, String(this.rhythmWeeks));
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
    /* 只渲染当前形态存在的页：面板对象本身按 tabs 创建，缺页时不可访问。 */
    if (this.hasTab("today")) this.renderToday();
    if (this.profile.features.create && this.hasTab("create")) this.renderCreate();
    if (this.hasTab("knowledge")) this.renderKnowledge();
    if (this.profile.features.review && this.hasTab("review")) this.renderReview();
    if (this.hasTab("system")) this.renderSystem();
    this.showTab(this.activeTab);
  }

  renderHero() {
    const card = this.root.createDiv({ cls: "launchpad-card" });
    const header = card.createDiv({ cls: "launchpad-card-header" });
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
      ["blocking", "blocking"],
      ["operational", "operational"],
      ["informational", "informational"],
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
      `${snapshotAgeLabel(age)} · ${operational} operational / ${informational} informational · 索引 ${documents} 文档 / ${chunks} chunks${age !== null && age > 24 ? " · 已陈旧" : ""}`,
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
    title.createSpan({ cls: "launchpad-badge", text: "Now/" });
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
    };
    const liveTotal = liveTasks.length;
    const completedTotal = Array.isArray(this.snapshots.tasks)
      ? this.snapshots.tasks.filter((task) => task.done).length
      : 0;
    const snapshotTotal = Object.values(snapshot?.counts || {}).reduce(
      (sum, value) => sum + Number(value || 0),
      0,
    );

    // Now/ is the action authority. A successful snapshot can still be stale
    // after an external edit, disabled refresh, or a calendar-day change.
    const useLive = Array.isArray(this.snapshots.tasks);
    const countsSource = useLive ? liveCounts : (snapshot?.counts || liveCounts);
    const totalCount = useLive ? liveTotal : snapshotTotal;

    const age = snapshotAge(snapshot?.generated_at || snapshot);
    const ageText = snapshotAgeLabel(age);
    let badgeText = "快照已连接";
    let badgeCls = "launchpad-badge";
    if (useLive) {
      badgeText = Platform.isMobile ? "实时活数据 (移动端)" : "实时活数据";
    } else {
      badgeText = `快照 · ${ageText}${age !== null && age > 24 ? " (已陈旧)" : ""}`;
      if (age !== null && age > 24) badgeCls = "launchpad-badge is-warning";
    }

    const badge = headerActions.createDiv({
      cls: badgeCls,
      text: badgeText,
    });
    const refresh = addButton(headerActions, "刷新行动");
    refresh.disabled =
      !this.plugin.settings.allowSnapshotRefresh || !this.plugin.canRunAnks();
    if (!this.plugin.canRunAnks()) {
      refresh.title = "移动端直接读写 Now/，快照请在桌面端刷新";
    }
    const capture = addButton(headerActions, "速记");
    const newAction = addButton(headerActions, "新建行动");
    const openNow = addButton(headerActions, "打开 Now/", "launchpad-btn is-accent");
    openNow.addEventListener("click", () => this.plugin.activateNowView());
    capture.addEventListener("click", () => {
      new QuickCaptureModal(this.app, this.plugin, this.view).open();
    });
    newAction.addEventListener("click", () => {
      new QuickCaptureModal(this.app, this.plugin, this.view, "action").open();
    });
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

    const counts = card.createDiv({ cls: "launchpad-action-counts" });
    const countDefs = [
      ["overdue", "逾期"],
      ["today", "今天"],
      ["waiting", "等待"],
      ["upcoming", "即将"],
      ["anytime", "随时"],
    ];

    const groups = new Map((snapshot?.groups || []).map((group) => [group.id, group.items || []]));
    const getBucketTasks = (bucket) => {
      if (useLive) {
        return liveTasks.filter((t) => t.bucket === bucket);
      }
      return (groups.get(bucket) || []).map((item) => ({ ...item, bucket }));
    };

    let currentFilter = this.view.activeActionFilter || null;
    const countEls = new Map();

    for (const [key, label] of countDefs) {
      const num = Number(countsSource[key] || 0);
      const count = counts.createDiv({
        cls: `launchpad-action-count is-clickable${num > 0 ? " has-items" : " is-zero"}${currentFilter === key ? " is-active" : ""}`,
      });
      count.title = currentFilter === key
        ? `正在筛选「${label}」· 再次点击返回默认双栏`
        : `点击筛选：只看「${label}」行动`;
      count.createDiv({
        cls: "launchpad-action-count-value",
        text: String(num),
      });
      count.createDiv({ cls: "launchpad-action-count-label", text: label });
      countEls.set(key, count);

      count.addEventListener("click", () => {
        currentFilter = currentFilter === key ? null : key;
        this.view.activeActionFilter = currentFilter;
        updateActionView();
      });
    }

    const bodyWrap = card.createDiv({ cls: "launchpad-action-body-wrap" });
    const statusEl = card.createDiv({ cls: "launchpad-action-status" });

    const updateActionView = () => {
      for (const [key, countEl] of countEls.entries()) {
        const isActive = currentFilter === key;
        countEl.toggleClass("is-active", isActive);
        const label = countDefs.find((d) => d[0] === key)?.[1];
        countEl.title = isActive
          ? `正在筛选「${label}」· 再次点击返回默认双栏`
          : `点击筛选：只看「${label}」行动`;
      }

      bodyWrap.empty();

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
        this.renderActionItems(todayList, [...overdueTasks, ...todayTasks], 8);

        const laterColumn = grid.createDiv({ cls: "launchpad-action-column" });
        const laterTitle = laterColumn.createDiv({ cls: "launchpad-action-column-title" });
        laterTitle.createSpan({ text: `等待 (${waitingTasks.length}) · 即将 (${upcomingTasks.length})` });
        const laterList = laterColumn.createDiv({ cls: "launchpad-action-list" });
        this.renderActionItems(laterList, [...waitingTasks, ...upcomingTasks], 8);

        const baseStatus = useLive
          ? `数据源：Now/ 实时解析 · ${totalCount} 条未完成行动${completedTotal ? ` · ${completedTotal} 条已完成` : ""}`
          : `数据源：${snapshot?.source?.label || "ANKS 行动快照"} · ${totalCount} 条未完成行动${completedTotal ? ` · ${completedTotal} 条已完成` : ""}`;
        statusEl.setText(`${baseStatus} · 点击上方指标可单独筛选`);
      } else {
        const filterMeta = {
          overdue: { label: "逾期行动", empty: "当前没有任何逾期事项" },
          today: { label: "今日行动", empty: "今日暂无待办事项" },
          waiting: { label: "等待行动", empty: "当前没有等待中的外部依赖事项" },
          upcoming: { label: "即将到来", empty: "近期暂无日程安排事项" },
          anytime: { label: "随时行动", empty: "随时行动池目前为空" },
        }[currentFilter] || { label: "行动", empty: "当前没有行动" };

        const headerRow = bodyWrap.createDiv({ cls: "launchpad-action-filter-header" });
        const titleRow = headerRow.createDiv({ cls: "launchpad-action-filter-title" });
        const filteredTasks = getBucketTasks(currentFilter);
        titleRow.createSpan({ text: `${filterMeta.label} (${filteredTasks.length})` });

        const resetBtn = headerRow.createEl("button", {
          cls: "launchpad-action-filter-reset",
          text: "✕ 返回默认双栏",
        });
        resetBtn.addEventListener("click", () => {
          currentFilter = null;
          this.view.activeActionFilter = null;
          updateActionView();
        });

        const listContainer = bodyWrap.createDiv({ cls: "launchpad-action-list is-single-column" });
        if (!filteredTasks.length) {
          this.renderEmpty(listContainer, filterMeta.empty);
        } else {
          this.renderActionItems(listContainer, filteredTasks, 20);
        }

        const baseStatus = useLive
          ? `数据源：Now/ 实时解析 · ${totalCount} 条未完成行动${completedTotal ? ` · ${completedTotal} 条已完成` : ""}`
          : `数据源：${snapshot?.source?.label || "ANKS 行动快照"} · ${totalCount} 条未完成行动${completedTotal ? ` · ${completedTotal} 条已完成` : ""}`;
        statusEl.setText(`${baseStatus} · 正在聚焦「${filterMeta.label}」· 再次点击上方指标返回双栏`);
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
        () => this.view.openTarget(item.origin?.path || item.path || "Now/行动.md", item.title),
        `打开行动：${item.title}`,
      );
    }
  }

  renderKpis(parent) {
    const data = this.summary;
    const topic = primaryTopic(this.capabilities);
    const prefix = topic ? `Topics/${topic}/` : "";
    const contentRoot = contentProjectsPath(primaryContentTopic(this.capabilities));
    const values = {
      projects: data.articles.filter((page) => contentRoot && page.path.startsWith(`${contentRoot}/`)).length,
      inbox: data.inbox.filter((page) => prefix && page.path.startsWith(prefix)).length,
      knowledge: data.knowledge.filter((page) => prefix && page.path.startsWith(prefix)).length,
      raw: data.raw.filter((page) => prefix && page.path.startsWith(prefix)).length,
      outputs: data.outputs.filter((page) => prefix && page.path.startsWith(prefix)).length,
      active: data.active.filter((page) => page.path.startsWith("Topics/")).length,
    };
    const keys = (this.profile.kpis || Object.keys(KPI_DEFINITIONS)).filter((key) => KPI_DEFINITIONS[key]);
    const kpis = keys.map((key) => {
      const definition = KPI_DEFINITIONS[key];
      return [values[key], definition.label, definition.hint, resolveKpiTarget(definition.path, this.capabilities)];
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

  renderRhythm(parent) {
    const card = parent.createDiv({ cls: "launchpad-card" });
    const header = card.createDiv({ cls: "launchpad-card-header launchpad-rhythm-header" });
    const title = header.createDiv({ cls: "launchpad-card-title" });
    addIcon(title, "activity");
    title.createSpan({ text: "系统节奏" });
    this.rhythmBadge = title.createSpan({ cls: "launchpad-badge", text: `近 ${this.rhythmWeeks} 周` });
    const ranges = header.createDiv({ cls: "launchpad-rhythm-ranges" });
    this.rhythmRangeButtons = new Map();
    for (const weeks of RHYTHM_WEEK_OPTIONS) {
      const button = ranges.createEl("button", {
        cls: `launchpad-range-btn${weeks === this.rhythmWeeks ? " is-active" : ""}`,
        text: `${weeks} 周`,
      });
      this.rhythmRangeButtons.set(weeks, button);
      button.addEventListener("click", () => this.setRhythmRange(weeks));
    }
    header.createDiv({ cls: "launchpad-badge is-accent", text: `本周活跃 ${this.summary.active.length} 次改动` });

    const split = card.createDiv({ cls: "launchpad-rhythm-split" });
    this.renderHeatmap(split);
    /* 四条 stat 全部指向 ANKS 的对象层（内容已发布 / 知识回写 / 素材升级），
       陌生库里恒为 0/0 —— 形态没有这些层时不渲染。 */
    if (this.profile.features.completionStats) this.renderCompletionStats(split);
  }

  setRhythmRange(weeks) {
    const nextWeeks = normalizeRhythmWeeks(weeks);
    if (nextWeeks === this.rhythmWeeks) return;
    this.saveRhythmWeeks(nextWeeks);
    for (const [value, button] of this.rhythmRangeButtons.entries()) {
      button.toggleClass("is-active", value === this.rhythmWeeks);
    }
    this.rhythmBadge.setText(`近 ${this.rhythmWeeks} 周`);
    this.updateHeatmapRange();
    this.updateCompletionStats();
  }

  renderHeatmap(parent) {
    const days = new Map();
    for (const page of this.pages) {
      const key = dateKeyFromTimestamp(page.mtime);
      /* 无 mtime 的页不归属任何一天：不能算作今天有活动。 */
      if (!key) continue;
      days.set(key, (days.get(key) || 0) + 1);
    }
    const currentWeekStart = startOfMonday(new Date());
    const start = new Date(currentWeekStart);
    start.setDate(start.getDate() - (TOTAL_HEATMAP_WEEKS - 1) * 7);
    this.heatDays = days;
    this.heatWeeks = [];
    const box = parent.createDiv({ cls: "launchpad-heat-box" });
    const head = box.createDiv({ cls: "launchpad-heat-foot" });
    this.heatRangeLabel = head.createSpan();
    this.heatPeakLabel = head.createSpan();

    const scroll = box.createDiv({ cls: "launchpad-heat-scroll" });
    const wrap = scroll.createDiv({ cls: "launchpad-heat-wrap" });

    // 月份刻度
    const monthsContainer = wrap.createDiv({ cls: "launchpad-heat-body" });
    monthsContainer.createDiv(); // 26px 留白对齐星期
    const monthsGrid = monthsContainer.createDiv({ cls: "launchpad-heat-months" });
    monthsGrid.style.display = "grid";
    monthsGrid.style.gridTemplateColumns = `repeat(${TOTAL_HEATMAP_WEEKS}, minmax(0, 1fr))`;
    monthsGrid.style.gap = "3.5px";

    let lastMonth = -1;
    for (let week = 0; week < TOTAL_HEATMAP_WEEKS; week += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7);
      const m = date.getMonth();
      if (m !== lastMonth) {
        lastMonth = m;
        const label = monthsGrid.createDiv({
          cls: "launchpad-heat-monthlabel",
          text: `${m + 1}月`,
        });
        label.style.gridColumn = String(week + 1);
      }
    }

    // 热力图主体：左星期 + 右 53 周矩阵
    const body = wrap.createDiv({ cls: "launchpad-heat-body" });
    const weekdays = body.createDiv({ cls: "launchpad-heat-weekdays" });
    for (const name of ["一", "三", "五", "日"]) {
      weekdays.createSpan({ cls: "launchpad-heat-weekday", text: name });
    }

    const grid = body.createDiv({ cls: "launchpad-heat-weeks" });
    const todayKey = dateKey(new Date());
    this.heatCells = new Map();
    for (let week = 0; week < TOTAL_HEATMAP_WEEKS; week += 1) {
      const column = grid.createDiv({ cls: "launchpad-heat-week" });
      this.heatWeeks.push({ index: week, column });
      for (let day = 0; day < 7; day += 1) {
        const date = new Date(start);
        date.setDate(start.getDate() + week * 7 + day);
        const key = dateKey(date);
        const count = days.get(key) || 0;
        const cell = column.createDiv({ cls: "launchpad-heat-cell" });
        cell.dataset.level = String(heatLevel(count));
        cell.title = `${key}：${count} 次变更`;
        if (key === todayKey) cell.addClass("is-today");
        cell.addClass("is-clickable");
        this.heatCells.set(key, cell);
        makeClickable(cell, () => this.selectHeatDay(key), `${key} 的改动`);
      }
    }
    const legend = box.createDiv({ cls: "launchpad-heat-legend" });
    legend.createSpan({ text: "少" });
    for (let level = 0; level <= 5; level += 1) {
      const cell = legend.createDiv({ cls: "launchpad-heat-legend-cell" });
      cell.dataset.level = String(level);
    }
    legend.createSpan({ text: "多" });
    this.heatDetailEl = box.createDiv({ cls: "launchpad-heat-detail" });
    if (!this.heatSelectedDay || !this.heatCells.has(this.heatSelectedDay)) {
      /* 默认落在最近一个有改动的日子：热力图一打开就有内容，而不是一块空白等提示。 */
      const active = [...days.keys()].filter((key) => key <= todayKey).sort();
      this.heatSelectedDay = days.has(todayKey)
        ? todayKey
        : active[active.length - 1] || todayKey;
    }
    this.updateHeatmapRange();
    this.renderHeatDetail();
  }

  /* 热力图的时间维度索引：点某天 → 列出当天改了哪些文件，可直接打开。 */
  pagesChangedOn(key) {
    return this.pages
      .filter((page) => dateKeyFromTimestamp(page.mtime) === key)
      .sort((left, right) => (right.mtime || 0) - (left.mtime || 0));
  }

  selectHeatDay(key) {
    if (!this.heatCells?.has(key)) return;
    this.heatSelectedDay = key;
    this.renderHeatDetail();
  }

  renderHeatDetail() {
    const host = this.heatDetailEl;
    if (!host) return;
    host.empty();
    for (const [key, cell] of this.heatCells.entries()) {
      cell.toggleClass("is-selected", key === this.heatSelectedDay);
    }
    const key = this.heatSelectedDay;
    if (!key) return;

    const pages = this.pagesChangedOn(key);
    const head = host.createDiv({ cls: "launchpad-heat-detail-head" });
    head.createSpan({ cls: "launchpad-heat-detail-date", text: key });
    head.createSpan({ cls: "launchpad-badge", text: `${pages.length} 次变更` });
    const perType = new Map();
    for (const page of pages) {
      const type = textOr(page.type, "other") || "other";
      perType.set(type, (perType.get(type) || 0) + 1);
    }
    for (const [type, count] of [...perType.entries()].sort((a, b) => b[1] - a[1])) {
      head.createSpan({
        cls: "launchpad-badge",
        text: `${PAGE_TYPE_LABEL[type] || type} ${count}`,
      });
    }
    if (!pages.length) {
      host.createDiv({ cls: "launchpad-heat-detail-empty", text: "这天没有改动记录" });
      return;
    }
    const list = host.createDiv({ cls: "launchpad-heat-detail-list" });
    const limit = 12;
    for (const page of pages.slice(0, limit)) {
      const row = list.createDiv({ cls: "launchpad-heat-detail-row" });
      row.createSpan({ cls: "launchpad-heat-detail-time", text: formatDateTime(page.mtime) });
      row.createSpan({
        cls: "launchpad-heat-detail-title",
        text: pageLabel(page),
      });
      row.createSpan({
        cls: "launchpad-heat-detail-path",
        text: String(page.path || "").replace(/^Topics\/[^/]+\//, ""),
      });
      makeClickable(
        row,
        () => this.view.openTarget(page.path, page.title),
        `打开 ${pageLabel(page)}`,
      );
    }
    if (pages.length > limit) {
      host.createDiv({
        cls: "launchpad-heat-detail-more",
        text: `另有 ${pages.length - limit} 个文件`,
      });
    }
  }

  updateHeatmapRange() {
    const currentWeekStart = startOfMonday(new Date());
    const rangeStart = new Date(currentWeekStart);
    rangeStart.setDate(rangeStart.getDate() - (this.rhythmWeeks - 1) * 7);
    const rangeStartKey = dateKey(rangeStart);
    const todayKey = dateKey(new Date());
    const outsideWeekCount = TOTAL_HEATMAP_WEEKS - this.rhythmWeeks;
    for (const entry of this.heatWeeks || []) {
      entry.column.toggleClass("is-outside-range", entry.index < outsideWeekCount);
    }
    const visibleCounts = [...(this.heatDays || new Map()).entries()]
      .filter(([key]) => key >= rangeStartKey && key <= todayKey)
      .map(([, count]) => count);
    this.heatRangeLabel.setText(`完整 53 周 · 统计近 ${this.rhythmWeeks} 周`);
    this.heatPeakLabel.setText(`峰值 ${Math.max(1, ...visibleCounts)} 次/天`);
  }

  renderCompletionStats(parent) {
    this.statsContainer = parent.createDiv({ cls: "launchpad-stat-row" });
    this.statRefs = [];
    const statCount = this.completionStatDefinitions().length;
    this.statsContainer.setAttribute("data-count", String(statCount));
    for (let index = 0; index < statCount; index += 1) {
      const box = this.statsContainer.createDiv({ cls: "launchpad-stat-box" });
      const label = box.createDiv({ cls: "launchpad-stat-label" });
      const row = box.createDiv({ cls: "launchpad-stat-val-row" });
      const value = row.createSpan({ cls: "launchpad-stat-val" });
      const unit = row.createSpan({ cls: "launchpad-stat-unit" });
      const bar = box.createDiv({ cls: "launchpad-stat-bar" });
      const fill = bar.createDiv({ cls: "launchpad-stat-bar-fill" });
      this.statRefs.push({ label, value, unit, fill });
    }
    this.updateCompletionStats();
  }

  completionStatDefinitions() {
    const definitions = [];
    if (primaryContentTopic(this.capabilities)) {
      definitions.push([
        "内容已发布",
        this.summary.articles.filter((page) => page.status === "published").length,
        this.summary.articles.length,
      ]);
    }
    const writebacks = this.pages.filter((page) =>
      ["pending", "completed", "proposed"].includes(page.knowledge_writeback),
    );
    const raw = this.summary.raw.length;
    const sources = this.pages.filter((page) => page.type === "source").length;
    const rangeStart = Date.now() - this.rhythmWeeks * 7 * 86400000;
    const rangeActiveDays = new Set(
      this.pages
        .filter((page) => page.mtime >= rangeStart)
        .map((page) => dateKeyFromTimestamp(page.mtime))
        .filter(Boolean),
    ).size;
    definitions.push(
      ["知识回写", writebacks.filter((page) => page.knowledge_writeback === "completed").length, writebacks.length],
      ["素材升级", sources, sources + raw],
      [`近 ${this.rhythmWeeks} 周活跃`, rangeActiveDays, this.rhythmWeeks * 7],
    );
    return definitions;
  }

  updateCompletionStats() {
    const definitions = this.completionStatDefinitions();
    definitions.forEach(([label, value, total], index) => {
      const percent = total ? Math.round((value / total) * 100) : 0;
      const refs = this.statRefs[index];
      refs.label.setText(label);
      refs.value.setText(`${percent}%`);
      refs.unit.setText(`${value}/${total}`);
      refs.fill.style.width = `${percent}%`;
    });
  }

  renderWorkGrid(parent) {
    const topic = primaryTopic(this.capabilities);
    const topicPrefix = topic ? `Topics/${topic}/` : "";
    const topicCapabilities = this.capabilities?.perTopic?.[topic] || {};
    const inboxPages = this.summary.inbox.filter((page) => topicPrefix && page.path.startsWith(topicPrefix));
    const grid = parent.createDiv({ cls: "launchpad-grid-2" });
    const inboxCard = grid.createDiv({ cls: "launchpad-card" });
    const inboxHeader = inboxCard.createDiv({ cls: "launchpad-card-header" });
    const inboxTitle = inboxHeader.createDiv({ cls: "launchpad-card-title" });
    addIcon(inboxTitle, "inbox");
    inboxTitle.createSpan({ text: "待整理" });
    inboxTitle.createSpan({ cls: "launchpad-badge", text: "raw/inbox" });
    if (topicCapabilities.inboxPath) {
      const inboxBtn = addButton(inboxHeader, "收件箱 ↗");
      inboxBtn.addEventListener("click", () => this.view.openTarget(topicCapabilities.inboxPath, "收件箱"));
    }
    const inboxList = inboxCard.createDiv({ cls: "launchpad-breakdown-card" });
    if (!topicCapabilities.inboxPath) {
      this.renderEmpty(inboxList, "该 Topic 尚未配置 raw/inbox");
    } else if (!inboxPages.length) {
      this.renderEmpty(inboxList, "收件箱是空的 · 没有积压");
    } else {
      for (const page of inboxPages.slice(0, 6)) {
        const row = inboxList.createDiv({ cls: "launchpad-breakdown-row" });
        const left = row.createDiv({ cls: "launchpad-row-left" });
        left.createDiv({ cls: "launchpad-row-title", text: page.name });
        const right = row.createDiv({ cls: "launchpad-row-right" });
        const age = daysBetween(new Date(), page.mtime);
        right.createSpan({ text: age === null ? "时间未知" : `${age} 天前` });
        const convert = addButton(right, "转化", "launchpad-row-action");
        convert.addEventListener("click", (event) => {
          event.stopPropagation();
          new InboxConversionModal(this.app, this.plugin, this.view, page).open();
        });
        makeClickable(row, () => this.view.openTarget(page.path, page.name), `打开待整理：${page.name}`);
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
    this.renderActionCard(this.panels.today);
    if (this.profile.features.review && this.hasTab("review")) {
      this.renderTodayReviewSummary(this.panels.today);
    }
    if (this.profile.features.kernelPill) this.renderSystemSummary(this.panels.today);
  }

  renderTodayReviewSummary(parent) {
    const queues = this.getReviewQueues();
    const writebackCounts = new Map();
    for (const finding of queues.writebacks) {
      const label = reviewFindingCategory(finding);
      writebackCounts.set(label, (writebackCounts.get(label) || 0) + 1);
    }
    const groups = [
      ...[...writebackCounts.entries()].map(([label, count]) => [count, label]),
      [queues.reviewingProjects.length, "内容待复盘"],
      [queues.staleInbox.length, "收件箱待检查"],
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
      card.createDiv({ cls: "launchpad-breakdown-row is-empty", text: "暂无待复盘事项" });
      return;
    }
    const row = card.createDiv({ cls: "launchpad-action-group-buttons" });
    for (const [count, label] of pending) {
      row.createSpan({ cls: "launchpad-badge is-accent", text: `${count} · ${label}` });
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
        ? `系统状态 · ${blocking} blocking / ${operational} operational / ${informational} informational`
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
    const articles = this.summary.articles.filter(
      (article) => projectRoot && article.path.startsWith(`${projectRoot}/`),
    );
    const profiles = topicCapabilities.profiles?.[platform] || [];
    const canCreateProject = Boolean(topic && platform && profiles.length);
    const buckets = buildStageBuckets(articles);
    const flowCard = this.panels.create.createDiv({ cls: "launchpad-card" });
    const flowHeader = flowCard.createDiv({ cls: "launchpad-card-header" });
    const flowTitle = flowHeader.createDiv({ cls: "launchpad-card-title" });
    addIcon(flowTitle, "content");
    flowTitle.createSpan({ text: "内容流向" });
    flowTitle.createSpan({ cls: "launchpad-badge", text: "按阶段分布" });
    flowHeader.createDiv({ cls: "launchpad-badge", text: `共 ${articles.length} 个内容项目` });
    const total = buckets.reduce((sum, [, rows]) => sum + rows.length, 0);
    const bar = flowCard.createDiv({ cls: "launchpad-dist-bar" });
    const strengths = ["95%", "72%", "52%", "34%", "20%"];
    buckets.forEach(([stage, rows], index) => {
      const segment = bar.createDiv({ cls: "launchpad-dist-seg" });
      segment.style.width = total ? `${(rows.length / total) * 100}%` : "0";
      segment.style.background = `color-mix(in srgb, var(--interactive-accent) ${strengths[index % strengths.length]}, transparent)`;
      segment.title = `${STAGE_LABEL[stage] || stage} · ${rows.length}`;
    });

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
      const groupLeft = groupRow.createDiv({ cls: "launchpad-row-left" });
      groupLeft.createDiv({
        cls: `launchpad-badge${stage === "reviewing" ? " is-accent" : ""}`,
        text: STAGE_LABEL[stage] || stage,
      });
      groupLeft.createDiv({ cls: "launchpad-row-title", text: `${rows.length} 篇` });
      if (contentIndexTarget) {
        groupRow.addEventListener("click", () =>
          this.view.openTarget(contentIndexTarget, "内容项目索引"),
        );
      }
      for (const article of rows.slice(0, 4)) {
        const row = list.createDiv({ cls: "launchpad-breakdown-row" });
        const left = row.createDiv({ cls: "launchpad-row-left" });
        left.createDiv({ cls: "launchpad-row-title", text: articleLabel(article) });
        const right = row.createDiv({ cls: "launchpad-row-right" });
        if (article.platform) right.createSpan({ text: article.platform });
        if (article.status) right.createSpan({ cls: "launchpad-badge", text: article.status });
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
    title.createSpan({ text: "本周知识库活动" });
    header.createDiv({ cls: "launchpad-badge", text: "按对象类型" });
    const counts = new Map();
    for (const page of this.summary.active) {
      const type = page.type || "（无 type）";
      counts.set(type, (counts.get(type) || 0) + 1);
    }
    const chips = card.createDiv({ cls: "launchpad-action-group-buttons" });
    if (!counts.size) {
      chips.createDiv({ cls: "launchpad-breakdown-row is-empty", text: "本周没有变更" });
    } else {
      for (const [type, count] of [...counts.entries()].sort((left, right) => right[1] - left[1])) {
        chips.createSpan({ cls: "launchpad-badge", text: `${type} ${count}` });
      }
    }
    const list = card.createDiv({ cls: "launchpad-breakdown-card" });
    for (const page of [...this.summary.active].sort((left, right) => right.mtime - left.mtime).slice(0, 6)) {
      const row = list.createDiv({ cls: "launchpad-breakdown-row" });
      const left = row.createDiv({ cls: "launchpad-row-left" });
      left.createDiv({ cls: "launchpad-row-title", text: page.name });
      const right = row.createDiv({ cls: "launchpad-row-right" });
      right.createSpan({ text: page.type || "—" });
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
    const suggestions = suggestReviewActions({
      tasks,
      pages: this.pages,
      health: this.snapshots.health,
      contentProjects,
    });

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
    const generate = addButton(actions, "生成下一批行动", "launchpad-btn is-primary");
    generate.title =
      suggestions.length > 0
        ? `将生成 ${suggestions.length} 条去重后的 Now 行动`
        : "当前没有新的复盘行动";
    const openNow = addButton(actions, "打开 Now/");
    openNow.addEventListener("click", () => this.plugin.activateNowView());
    generate.addEventListener("click", async () => {
      generate.disabled = true;
      try {
        if (!suggestions.length) {
          new Notice("Crisp Launchpad：当前没有新的复盘行动");
          generate.disabled = false;
          return;
        }
        for (const suggestion of suggestions) {
          await this.plugin.createAction(suggestion);
        }
        await this.plugin.refreshActionSnapshots({ silent: true });
        new Notice(`Crisp Launchpad：已生成 ${suggestions.length} 条 Now 行动`);
        await this.view.render();
      } catch (error) {
        new Notice(`Crisp Launchpad：${error.message || error}`, 8000);
        generate.disabled = false;
      }
    });

    const metrics = overview.createDiv({ cls: "launchpad-review-metrics" });
    for (const [value, label, detail] of [
      [openTasks.length, "未完成", "Now/ 当前行动"],
      [tasks.filter((task) => task.bucket === "overdue").length, "逾期", "需要重排或关闭"],
      [tasks.filter((task) => task.bucket === "waiting").length, "等待", "需要跟进阻塞"],
      [completedTasks.length, "已完成", "保留在 Markdown 清单"],
      [writebacks.length, "待回写与复核", "判断哪些产出需要沉淀"],
      [staleInbox.length, "积压收件箱", "检查仍待整理的材料"],
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
          () => new NowTaskEditModal(this.app, this.plugin, this.view, task).open(),
          `编辑行动：${task.title}`,
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
    inboxTitle.createSpan({ text: "收件箱积压" });
    inboxHeader.createDiv({
      cls: `launchpad-badge${staleInbox.length ? " is-accent" : ""}`,
      text: `${staleInbox.length} 条待检查`,
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
        this.renderEmpty(projectList, "当前没有处于 reviewing 阶段的项目");
      } else {
        for (const project of reviewingProjects.slice(0, 7)) {
          const dir = textOr(project.dir);
          const article = contentProjectArticle(this.pages, dir);
          const label = contentProjectLabel(this.pages, project);
          const row = projectList.createDiv({ cls: "launchpad-breakdown-row" });
          const left = row.createDiv({ cls: "launchpad-row-left" });
          left.createDiv({ cls: "launchpad-row-title", text: label });
          const right = row.createDiv({ cls: "launchpad-row-right" });
          right.createSpan({ cls: "launchpad-badge", text: "reviewing" });
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
    this.renderRhythm(this.panels.review);
  }

  renderSystem() {
    if (this.profile.features.kernelPill) this.renderSystemDrawer(this.panels.system);
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
    if (capabilities.hasActionLayer) items.push(["行动清单", "跨 Topic 下一步", "check-circle", NOW_ACTION_PATH]);
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
    if (capabilities.hasActionLayer) {
      const panel = addButton(actions, "行动面板");
      quickCount += 1;
      panel.addEventListener("click", () => this.plugin.activatePanelView());
    }
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

  renderEmpty(container, message) {
    container.createDiv({ cls: "launchpad-breakdown-row is-empty", text: message });
  }
}

class NowBoardRenderer {
  constructor(view, tasks) {
    this.view = view;
    this.app = view.app;
    this.plugin = view.plugin;
    const existing = view.contentEl?.querySelectorAll?.(".now-board");
    if (existing) existing.forEach((el) => el.remove());
    this.root = view.contentEl.createDiv({ cls: "now-board" });
    this.tasks = tasks;
  }

  render() {
    this.renderHeader();
    const openTasks = this.tasks.filter((task) => !task.done);
    const completedTasks = this.tasks.filter((task) => task.done);
    const groups = [
      ["overdue", "逾期"],
      ["today", "今天"],
      ["waiting", "等待"],
      ["upcoming", "即将"],
      ["anytime", "随时"],
      ["done", "已完成"],
    ];
    const grid = this.root.createDiv({ cls: "now-board-grid" });
    for (const [bucket, label] of groups) {
      this.renderColumn(
        grid,
        label,
        bucket === "done"
          ? completedTasks
          : openTasks.filter((task) => task.bucket === bucket),
        bucket,
        bucket === "done" ? "还没有已完成行动" : "没有行动",
      );
    }
  }

  renderHeader() {
    const header = this.root.createDiv({ cls: "now-board-header" });
    const title = header.createDiv({ cls: "now-board-title" });
    const icon = title.createDiv({ cls: "now-board-icon" });
    setIcon(icon, CRISP_NOW_ICON_ID);
    const copy = title.createDiv();
    copy.createDiv({ cls: "now-board-heading", text: "Now 行动" });
    copy.createDiv({
      cls: "now-board-subtitle",
      text: Platform.isMobile
        ? "以 Now/行动.md 为数据源 · 触屏轻触卡片可快速调整日期与状态"
        : "以 Now/行动.md 为唯一数据源的图形看板",
    });

    const actions = header.createDiv({ cls: "now-board-actions" });
    const add = addButton(actions, "新增行动", "launchpad-btn is-primary");
    const refresh = addButton(actions, "刷新快照");
    const source = addButton(actions, "打开源文件");
    refresh.disabled = !this.plugin.canRunAnks();
    if (refresh.disabled) {
      refresh.title = "移动端直接读写 Now/，快照请在桌面端刷新";
    }
    add.addEventListener("click", () => {
      new QuickCaptureModal(this.app, this.plugin, this.view, "action").open();
    });
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      try {
        await this.plugin.refreshActionSnapshots();
        await this.view.render();
      } catch (error) {
        new Notice(`Crisp Now：${error.message || error}`);
        refresh.disabled = false;
      }
    });
    source.addEventListener("click", () => this.view.openTarget(NOW_ACTION_PATH, "Now 行动"));

    const openTasks = this.tasks.filter((task) => !task.done);
    const completedTasks = this.tasks.filter((task) => task.done);
    const counts = {
      overdue: openTasks.filter((task) => task.bucket === "overdue").length,
      today: openTasks.filter((task) => task.bucket === "today").length,
      waiting: openTasks.filter((task) => task.bucket === "waiting").length,
      upcoming: openTasks.filter((task) => task.bucket === "upcoming").length,
      anytime: openTasks.filter((task) => task.bucket === "anytime").length,
      done: completedTasks.length,
    };
    const stats = this.root.createDiv({ cls: "now-board-stats" });
    for (const [key, label] of [
      ["overdue", "逾期"],
      ["today", "今天"],
      ["waiting", "等待"],
      ["upcoming", "即将"],
      ["anytime", "随时"],
      ["done", "已完成"],
    ]) {
      const stat = stats.createDiv({ cls: `now-board-stat is-${key}` });
      stat.createDiv({ cls: "now-board-stat-value", text: String(counts[key]) });
      stat.createDiv({ cls: "now-board-stat-label", text: label });
    }
  }

  async moveTaskToBucket(taskId, targetBucket, taskReference = "") {
    const today = new Date();
    const todayStr = dateKey(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = dateKey(tomorrow);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = dateKey(yesterday);

    let due = "";
    let waiting = false;
    if (targetBucket === "done") {
      try {
        await this.plugin.updateNowTask(taskId, { done: true, doneAt: todayStr }, taskReference);
      } catch (error) {
        new Notice(`Crisp Now：完成行动失败 · ${error.message || error}`);
      }
      return;
    }
    if (targetBucket === "today") {
      due = todayStr;
      waiting = false;
    } else if (targetBucket === "upcoming") {
      due = tomorrowStr;
      waiting = false;
    } else if (targetBucket === "waiting") {
      waiting = true;
      due = "";
    } else if (targetBucket === "overdue") {
      due = yesterdayStr;
      waiting = false;
    } else if (targetBucket === "anytime") {
      due = "";
      waiting = false;
    }

    try {
      const updates = { due, waiting };
      if (targetBucket === "anytime") {
        updates.scheduled = "";
        updates.start = "";
        updates.time = "";
      }
      await this.plugin.updateNowTask(taskId, updates, taskReference);
    } catch (error) {
      new Notice(`Crisp Now：移动行动失败 · ${error.message || error}`);
    }
  }

  renderColumn(parent, title, tasks, bucket, emptyText = "没有行动") {
    const collapsibleDone = bucket === "done" && tasks.length > 0;
    if (bucket === "done" && tasks.length === 0) this.view.doneExpanded = false;
    const doneExpanded = Boolean(this.view.doneExpanded);
    const columnClasses = ["now-board-column", `is-${bucket}`];
    if (tasks.length > 0) columnClasses.push("has-tasks");
    if (collapsibleDone) columnClasses.push(doneExpanded ? "is-expanded" : "is-collapsed");
    const column = parent.createDiv({ cls: columnClasses.join(" ") });
    column.dataset.bucket = bucket;
    const header = column.createDiv({ cls: "now-board-column-header" });
    header.createSpan({ text: title });
    const headerActions = header.createDiv({ cls: "now-board-column-header-actions" });
    headerActions.createSpan({ cls: "now-board-count", text: String(tasks.length) });
    let toggleIcon = null;
    if (collapsibleDone) {
      header.addClass("is-collapsible");
      toggleIcon = headerActions.createSpan({ cls: "now-board-column-toggle-icon" });
      setIcon(toggleIcon, doneExpanded ? "chevron-down" : "chevron-right");
      header.setAttribute("aria-expanded", String(doneExpanded));
      const updateToggle = () => {
        const expanded = Boolean(this.view.doneExpanded);
        column.toggleClass("is-expanded", expanded);
        column.toggleClass("is-collapsed", !expanded);
        header.setAttribute("aria-expanded", String(expanded));
        header.setAttribute(
          "aria-label",
          `${expanded ? "收起" : "展开"}已完成行动，${tasks.length} 项`,
        );
        header.title = `${expanded ? "收起" : "展开"}已完成行动`;
        setIcon(toggleIcon, expanded ? "chevron-down" : "chevron-right");
      };
      makeClickable(
        header,
        () => {
          this.view.doneExpanded = !this.view.doneExpanded;
          updateToggle();
          renderDoneContent();
        },
        `${doneExpanded ? "收起" : "展开"}已完成行动，${tasks.length} 项`,
      );
      header.setAttribute("aria-expanded", String(doneExpanded));
      header.title = `${doneExpanded ? "收起" : "展开"}已完成行动`;
    }
    const list = column.createDiv({ cls: "now-board-list" });

    const renderDoneContent = () => {
      list.replaceChildren();
      if (!this.view.doneExpanded) {
        list.createDiv({ cls: "now-board-done-summary", text: "完成记录已收起 · 点击标题展开" });
        return;
      }
      for (const task of tasks) this.renderTaskCard(list, task);
    };

    column.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      column.addClass("is-dragover");
    });
    column.addEventListener("dragleave", (event) => {
      if (!column.contains(event.relatedTarget)) {
        column.removeClass("is-dragover");
      }
    });
    column.addEventListener("drop", async (event) => {
      event.preventDefault();
      column.removeClass("is-dragover");
      let taskId = event.dataTransfer.getData("text/plain");
      let taskReference = "";
      const rawJson = event.dataTransfer.getData("application/json");
      if (rawJson) {
        try {
          const payload = JSON.parse(rawJson);
          if (payload?.id) taskId = payload.id;
          if (payload?.title || payload?.rawLine) taskReference = payload;
        } catch (_) {}
      }
      if (taskId) {
        await this.moveTaskToBucket(taskId, bucket, taskReference);
      }
    });

    if (!tasks.length) {
      list.createDiv({ cls: "now-board-empty", text: emptyText });
      return;
    }
    if (collapsibleDone) {
      renderDoneContent();
      return;
    }
    for (const task of tasks) this.renderTaskCard(list, task);
  }

  renderTaskCard(parent, task) {
    const card = parent.createDiv({ cls: "now-task-card" });
    if (!task.done) card.setAttribute("draggable", "true");
    let isDragging = false;
    let dragEndTime = 0;
    card.addEventListener("dragstart", (event) => {
      if (task.done) {
        event.preventDefault();
        return;
      }
      isDragging = true;
      event.dataTransfer.setData("text/plain", task.id);
      event.dataTransfer.setData(
        "application/json",
        JSON.stringify({ id: task.id, title: task.title, rawLine: taskRawLine(task) }),
      );
      event.dataTransfer.effectAllowed = "move";
      card.addClass("is-dragging");
    });
    card.addEventListener("dragend", () => {
      isDragging = false;
      dragEndTime = Date.now();
      card.removeClass("is-dragging");
    });

    const checkbox = card.createEl("button", {
      cls: `now-task-checkbox${task.done ? " is-done" : ""}`,
      attr: { "aria-label": task.done ? "恢复行动" : "完成行动" },
    });
    setIcon(checkbox, "check");
    checkbox.addEventListener("click", async (event) => {
      event.stopPropagation();
      checkbox.disabled = true;
      try {
        await this.plugin.toggleNowTask(task.id, task);
      } catch (error) {
        new Notice(`Crisp Now：${error.message || error}`);
        checkbox.disabled = false;
      }
    });
    const body = card.createDiv({ cls: "now-task-body" });
    body.createDiv({ cls: "now-task-title", text: task.title });
    const meta = body.createDiv({ cls: "now-task-meta" });
    if (task.waiting) meta.createSpan({ cls: "launchpad-badge is-warning", text: "等待中" });
    if (task.project) meta.createSpan({ cls: "launchpad-badge", text: task.project });
    if (task.done) {
      meta.createSpan({
        cls: "now-task-done-at",
        text: task.doneAt ? `✅ ${task.doneAt}` : "✅ 已完成",
      });
    } else {
      if (task.start) meta.createSpan({ text: `🛫 ${task.start}` });
      if (task.due) {
        meta.createSpan({ text: task.time ? `📅 ${task.due} ⏰ ${task.time}` : `📅 ${task.due}` });
      } else if (task.scheduled) {
        meta.createSpan({
          text: task.time ? `⏳ ${task.scheduled} ⏰ ${task.time}` : `⏳ ${task.scheduled}`,
        });
      } else if (task.time) {
        meta.createSpan({ text: `⏰ ${task.time}` });
      }
    }
    if (task.path !== NOW_ACTION_PATH) meta.createSpan({ text: task.path.replace(/^Now\//, "") });
    makeClickable(
      card,
      () => {
        if (isDragging || Date.now() - dragEndTime < 200) return;
        new NowTaskEditModal(this.app, this.plugin, this.view, task).open();
      },
      `编辑行动：${task.title}`,
    );
  }

}

function dateFromKey(value) {
  if (!isDateKey(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

class CrispDatePicker {
  constructor(setting, text, initialValue, onChange) {
    this.setting = setting;
    this.text = text;
    this.inputEl = text?.inputEl;
    this.controlEl = setting?.controlEl;
    this.doc = this.inputEl?.ownerDocument || document;
    this.onChange = onChange;
    this.value = String(initialValue || "").trim();
    const selected = dateFromKey(this.value);
    const base = selected || new Date();
    this.month = new Date(base.getFullYear(), base.getMonth(), 1);
    this.popover = null;

    if (!this.inputEl || !this.controlEl) return;

    this.controlEl.addClass?.("launchpad-date-control");
    this.inputEl.type = "text";
    this.inputEl.readOnly = true;
    this.inputEl.value = this.value;
    this.inputEl.placeholder = "选择日期";
    this.inputEl.addClass?.("launchpad-date-input");
    this.inputEl.setAttribute?.("aria-haspopup", "dialog");
    this.inputEl.setAttribute?.("aria-expanded", "false");
    this.inputEl.setAttribute?.("aria-label", "选择日期");

    this.triggerEl = this.doc.createElement("button");
    this.triggerEl.type = "button";
    this.triggerEl.className = "launchpad-date-picker-trigger";
    this.triggerEl.setAttribute("aria-label", "打开日历");
    this.triggerEl.setAttribute("title", "打开日历");
    setIcon(this.triggerEl, "calendar");
    this.controlEl.appendChild(this.triggerEl);

    this.onToggle = () => this.toggle();
    this.onInputKeydown = (event) => {
      if (["Enter", " ", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        this.open();
      }
    };
    this.inputEl.addEventListener("click", this.onToggle);
    this.inputEl.addEventListener("keydown", this.onInputKeydown);
    this.triggerEl.addEventListener("click", this.onToggle);
  }

  toggle() {
    if (this.popover) this.close();
    else this.open();
  }

  setValue(value) {
    this.value = String(value || "").trim();
    this.inputEl.value = this.value;
    this.text?.setValue?.(this.value);
    const selected = dateFromKey(this.value);
    if (selected) this.month = new Date(selected.getFullYear(), selected.getMonth(), 1);
    this.onChange?.(this.value);
    if (this.popover) this.render();
  }

  open() {
    if (this.popover || !this.inputEl) return;
    const popover = this.doc.createElement("div");
    popover.className = "launchpad-date-picker-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "选择日期");
    const modalRoot = this.setting?.settingEl?.closest?.(
      ".crisp-launchpad-quick-modal, .crisp-now-edit-modal",
    );
    const modalAccent = modalRoot
      ? this.doc.defaultView?.getComputedStyle(modalRoot).getPropertyValue("--lp-modal-accent").trim()
      : "";
    if (modalAccent) popover.style.setProperty("--lp-modal-accent", modalAccent);
    this.doc.body.appendChild(popover);
    this.popover = popover;
    this.render();
    this.position();
    this.inputEl.setAttribute("aria-expanded", "true");

    this.onOutsidePointerDown = (event) => {
      if (this.popover?.contains(event.target) || this.controlEl?.contains(event.target)) return;
      this.close();
    };
    this.onDocumentKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close();
        this.inputEl?.focus?.();
      }
    };
    this.onWindowResize = () => this.position();
    this.onDocumentScroll = () => this.close();
    this.doc.addEventListener("pointerdown", this.onOutsidePointerDown, true);
    this.doc.addEventListener("keydown", this.onDocumentKeydown, true);
    this.doc.addEventListener("scroll", this.onDocumentScroll, true);
    this.doc.defaultView?.addEventListener("resize", this.onWindowResize);
  }

  close() {
    if (!this.popover) return;
    this.doc.removeEventListener("pointerdown", this.onOutsidePointerDown, true);
    this.doc.removeEventListener("keydown", this.onDocumentKeydown, true);
    this.doc.removeEventListener("scroll", this.onDocumentScroll, true);
    this.doc.defaultView?.removeEventListener("resize", this.onWindowResize);
    this.popover.remove();
    this.popover = null;
    this.inputEl?.setAttribute?.("aria-expanded", "false");
  }

  destroy() {
    this.close();
    this.inputEl?.removeEventListener?.("click", this.onToggle);
    this.inputEl?.removeEventListener?.("keydown", this.onInputKeydown);
    this.triggerEl?.removeEventListener?.("click", this.onToggle);
    this.triggerEl?.remove?.();
  }

  createElement(tag, className, text) {
    const element = this.doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  createButton(className, ariaLabel, iconName) {
    const button = this.createElement("button", className);
    button.type = "button";
    button.setAttribute("aria-label", ariaLabel);
    button.setAttribute("title", ariaLabel);
    if (iconName) setIcon(button, iconName);
    return button;
  }

  render() {
    if (!this.popover) return;
    this.popover.replaceChildren();

    const header = this.createElement("div", "launchpad-date-picker-header");
    const previous = this.createButton("launchpad-date-picker-nav", "上个月", "chevron-left");
    const monthLabel = this.createElement(
      "div",
      "launchpad-date-picker-month",
      `${this.month.getFullYear()}年${String(this.month.getMonth() + 1).padStart(2, "0")}月`,
    );
    const next = this.createButton("launchpad-date-picker-nav", "下个月", "chevron-right");
    previous.addEventListener("click", () => {
      this.month = new Date(this.month.getFullYear(), this.month.getMonth() - 1, 1);
      this.render();
      this.position();
    });
    next.addEventListener("click", () => {
      this.month = new Date(this.month.getFullYear(), this.month.getMonth() + 1, 1);
      this.render();
      this.position();
    });
    header.append(previous, monthLabel, next);
    this.popover.appendChild(header);

    const weekdays = this.createElement("div", "launchpad-date-picker-weekdays");
    for (const day of ["一", "二", "三", "四", "五", "六", "日"]) {
      weekdays.appendChild(this.createElement("div", "launchpad-date-picker-weekday", day));
    }
    this.popover.appendChild(weekdays);

    const grid = this.createElement("div", "launchpad-date-picker-days");
    const firstDay = new Date(this.month.getFullYear(), this.month.getMonth(), 1);
    const mondayOffset = (firstDay.getDay() + 6) % 7;
    const gridStart = new Date(this.month.getFullYear(), this.month.getMonth(), 1 - mondayOffset);
    const today = dateKey(new Date());
    const selected = this.value;
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const key = dateKey(date);
      const currentMonth = date.getMonth() === this.month.getMonth();
      const classes = ["launchpad-date-picker-day"];
      if (!currentMonth) classes.push("is-outside-month");
      if (key === today) classes.push("is-today");
      if (key === selected) classes.push("is-selected");
      const button = this.createButton(classes.join(" "), key);
      button.textContent = String(date.getDate());
      button.setAttribute("aria-pressed", key === selected ? "true" : "false");
      button.tabIndex = key === selected || (!selected && key === today) ? 0 : -1;
      button.addEventListener("click", () => {
        this.setValue(key);
        this.close();
      });
      grid.appendChild(button);
    }
    this.popover.appendChild(grid);

    const footer = this.createElement("div", "launchpad-date-picker-footer");
    const clear = this.createButton("launchpad-btn launchpad-btn-sm", "清除日期");
    clear.textContent = "清除";
    clear.addEventListener("click", () => {
      this.setValue("");
      this.close();
    });
    const todayButton = this.createButton("launchpad-btn launchpad-btn-sm is-primary", "选择今天");
    todayButton.textContent = "今天";
    todayButton.addEventListener("click", () => {
      this.setValue(today);
      this.close();
    });
    footer.append(clear, todayButton);
    this.popover.appendChild(footer);
  }

  position() {
    if (!this.popover || !this.inputEl) return;
    const view = this.doc.defaultView;
    if (!view) return;
    const rect = this.inputEl.getBoundingClientRect();
    const width = this.popover.offsetWidth || 304;
    const height = this.popover.offsetHeight || 360;
    const left = Math.max(8, Math.min(rect.left, view.innerWidth - width - 8));
    let top = rect.bottom + 8;
    if (top + height > view.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
    this.popover.style.left = `${left}px`;
    this.popover.style.top = `${top}px`;
  }
}

class NowTaskEditModal extends Modal {
  constructor(app, plugin, view, task) {
    super(app);
    this.plugin = plugin;
    this.view = view;
    this.initialTitle = task.title;
    this.task = { ...task };
    this.datePickers = [];
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("crisp-now-edit-modal");
    this.contentEl.createEl("h2", { text: "编辑行动" });

    const presets = this.contentEl.createDiv({ cls: "crisp-now-presets" });
    const todayStr = dateKey(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = dateKey(tomorrow);

    let dueInput;
    let duePicker;
    let waitingToggle;

    const setPreset = (dueVal, waitingVal) => {
      this.task.due = dueVal;
      this.task.waiting = waitingVal;
      if (duePicker) duePicker.setValue(dueVal);
      else if (dueInput) dueInput.setValue(dueVal);
      if (waitingToggle) waitingToggle.setValue(waitingVal);
      updatePresetHighlights();
    };

    const todayBtn = presets.createEl("button", { cls: "crisp-now-preset-btn", text: "☀️ 安排到今天" });
    const tomorrowBtn = presets.createEl("button", { cls: "crisp-now-preset-btn", text: "📅 安排到明天" });
    const waitingBtn = presets.createEl("button", { cls: "crisp-now-preset-btn", text: "⏸️ 设为等待" });
    const clearBtn = presets.createEl("button", { cls: "crisp-now-preset-btn", text: "📥 随时 (清除)" });

    const updatePresetHighlights = () => {
      todayBtn.toggleClass("is-active", this.task.due === todayStr && !this.task.waiting);
      tomorrowBtn.toggleClass("is-active", this.task.due === tomorrowStr && !this.task.waiting);
      waitingBtn.toggleClass("is-active", Boolean(this.task.waiting));
      clearBtn.toggleClass("is-active", !this.task.due && !this.task.waiting);
    };

    todayBtn.addEventListener("click", () => setPreset(todayStr, false));
    tomorrowBtn.addEventListener("click", () => setPreset(tomorrowStr, false));
    waitingBtn.addEventListener("click", () => setPreset(this.task.due || "", true));
    clearBtn.addEventListener("click", () => setPreset("", false));
    updatePresetHighlights();

    new Setting(this.contentEl)
      .setName("行动内容")
      .addText((text) =>
        text.setValue(this.task.title).onChange((value) => {
          this.task.title = value;
        }),
      );

    const dueSetting = new Setting(this.contentEl)
      .setName("截止日期")
      .setDesc("可从 Crisp 日历选择日期；留空表示随时。")
      .addText((text) => {
        dueInput = text;
      });
    duePicker = new CrispDatePicker(
      dueSetting,
      dueInput,
      this.task.due || "",
      (value) => {
        this.task.due = value;
        updatePresetHighlights();
      },
    );
    this.datePickers.push(duePicker);

    let startInput;
    const startSetting = new Setting(this.contentEl)
      .setName("计划开始")
      .setDesc("可从 Crisp 日历选择日期；留空表示不限开始时间。")
      .addText((text) => {
        startInput = text;
      });
    const startPicker = new CrispDatePicker(
      startSetting,
      startInput,
      this.task.start || "",
      (value) => {
        this.task.start = value;
      },
    );
    this.datePickers.push(startPicker);

    new Setting(this.contentEl)
      .setName("提醒时间")
      .setDesc("格式 HH:MM（24 小时制）。只有设置了时间才会触发到点提醒。")
      .addText((text) =>
        text.setValue(this.task.time || "").onChange((value) => {
          this.task.time = value.trim();
        }),
      );

    new Setting(this.contentEl)
      .setName("等待中")
      .setDesc("开启后任务进入「等待」列，保存时自动管理 #waiting 标签。")
      .addToggle((toggle) => {
        waitingToggle = toggle;
        toggle.setValue(Boolean(this.task.waiting)).onChange((value) => {
          this.task.waiting = value;
          updatePresetHighlights();
        });
      });

    const editExistingProjects = this.plugin.listProjectTags();
    let editProjectInput;
    new Setting(this.contentEl)
      .setName("项目标签")
      .setDesc("对应 #project/名称。可自由输入新项目或点击已有项目。")
      .addText((text) => {
        editProjectInput = text;
        const datalistId = "now-edit-project-datalist";
        if (this.contentEl.createEl) {
          let datalist = this.contentEl.querySelector?.(`#${datalistId}`);
          if (!datalist) {
            datalist = this.contentEl.createEl("datalist", { attr: { id: datalistId } });
          } else if (datalist.empty) {
            datalist.empty();
          }
          for (const p of editExistingProjects) {
            datalist.createEl("option", { attr: { value: p } });
          }
        }
        if (text.inputEl?.setAttribute) {
          text.inputEl.setAttribute("list", datalistId);
          text.inputEl.setAttribute("autocomplete", "off");
        }
        text.setValue(this.task.project || "").onChange((value) => {
          this.task.project = value.trim();
          updateEditChipStates();
        });
      });

    let updateEditChipStates = () => {};
    if (editExistingProjects.length > 0) {
      const chipsRow = this.contentEl.createDiv({ cls: "launchpad-tag-chips" });
      const chipButtons = [];
      for (const p of editExistingProjects) {
        const chip = chipsRow.createEl("button", {
          cls: `launchpad-tag-chip${this.task.project === p ? " is-active" : ""}`,
          text: `#${p}`,
        });
        chip.type = "button";
        chip.addEventListener("click", () => {
          if (this.task.project === p) {
            this.task.project = "";
            editProjectInput?.setValue("");
          } else {
            this.task.project = p;
            editProjectInput?.setValue(p);
          }
          updateEditChipStates();
        });
        chipButtons.push({ p, chip });
      }
      updateEditChipStates = () => {
        for (const item of chipButtons) {
          item.chip.toggleClass?.("is-active", this.task.project === item.p);
        }
      };
    }

    const actions = this.contentEl.createDiv({ cls: "launchpad-modal-actions" });
    const remove = addButton(actions, "删除", "launchpad-btn");
    const save = addButton(actions, "保存", "launchpad-btn is-primary");
    remove.addEventListener("click", async () => {
      try {
        remove.disabled = true;
        await this.plugin.deleteNowTask(this.task.id, this.task);
        this.close();
      } catch (error) {
        new Notice(`Crisp Now：${error.message || error}`);
        remove.disabled = false;
      }
    });
    save.addEventListener("click", async () => {
      const invalid = [];
      if (this.task.start && !isDateKey(this.task.start)) invalid.push("计划开始");
      if (this.task.due && !isDateKey(this.task.due)) invalid.push("截止日期");
      if (this.task.time && !isTimeKey(this.task.time)) invalid.push("提醒时间");
      if (invalid.length) {
        new Notice(
          `Crisp Now：${invalid.join(" / ")} 格式不对 · 日期用 YYYY-MM-DD，时间用 HH:MM`,
        );
        return;
      }
      try {
        save.disabled = true;
        await this.plugin.updateNowTask(this.task.id, this.task, this.task);
        this.close();
      } catch (error) {
        new Notice(`Crisp Now：${error.message || error}`);
        save.disabled = false;
      }
    });
  }

  onClose() {
    this.datePickers.forEach((picker) => picker.destroy());
    this.datePickers = [];
    this.contentEl.empty();
  }
}

class CrispNowView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.renderNonce = 0;
    this.doneExpanded = false;
  }

  getViewType() {
    return VIEW_TYPE_NOW;
  }

  getDisplayText() {
    return "Crisp Now";
  }

  getIcon() {
    return CRISP_NOW_ICON_ID;
  }

  async onOpen() {
    this.contentEl.addClass("crisp-now-view");
    await this.render();
  }

  async render() {
    const nonce = ++this.renderNonce;
    const tasks = await this.plugin.readNowTasks();
    if (nonce !== this.renderNonce) return;
    this.contentEl.empty();
    new NowBoardRenderer(this, tasks).render();
  }

  onClose() {
    this.contentEl.empty();
  }

  async openTarget(target, label = "") {
    const file =
      this.app.vault.getAbstractFileByPath(target) ||
      this.app.vault.getAbstractFileByPath(`${target}.md`);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
      return true;
    }
    new Notice(`Crisp Now：未找到「${label || target}」`);
    return false;
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
      this.plugin.readNowTasks(),
      this.plugin.resolveWorkspaceProfile(),
    ]);
    if (nonce !== this.renderNonce) return;

    /* 使用离屏容器构建完整的 DOM 树，避免在屏幕可见 DOM 上同步插入 1000+ 节点引起的重排与抖动。 */
    const root = createDetachedContainer(this.contentEl, "launchpad-wrapper");
    new LaunchpadRenderer(
      this,
      root,
      { actions, health, content, index, tasks },
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
      text: "捕获 → 待整理 → 行动 · Now/ 为唯一行动源",
    });
    const stats = header.createDiv({ cls: "crisp-panel-stats" });
    for (const [value, label] of [
      [
        openTasks.filter((task) => task.bucket === "overdue" || task.bucket === "today").length,
        "今天",
      ],
      [openTasks.filter((task) => task.bucket === "waiting").length, "等待"],
      [this.triage.length, "待整理"],
    ]) {
      const stat = stats.createDiv({ cls: "crisp-panel-stat" });
      stat.createDiv({ cls: "crisp-panel-stat-value", text: String(value) });
      stat.createDiv({ cls: "crisp-panel-stat-label", text: label });
    }
  }

  renderToday(parent) {
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
    const checkbox = row.createEl("button", {
      cls: "now-task-checkbox",
      attr: { "aria-label": task.done ? "恢复行动" : "完成行动" },
    });
    setIcon(checkbox, "check");
    checkbox.addEventListener("click", async (event) => {
      event.stopPropagation();
      checkbox.disabled = true;
      try {
        await this.plugin.toggleNowTask(task.id, task);
        await this.view.render();
      } catch (error) {
        new Notice(`Crisp 行动面板：${error.message || error}`);
        checkbox.disabled = false;
      }
    });
    const body = row.createDiv({ cls: "crisp-panel-task-body" });
    body.createDiv({ cls: "crisp-panel-task-title", text: task.title });
    const meta = body.createDiv({ cls: "crisp-panel-task-meta" });
    if (task.bucket === "overdue") meta.createSpan({ text: "逾期" });
    if (task.waiting) meta.createSpan({ text: "等待中" });
    if (task.project) meta.createSpan({ text: `#${task.project}` });
    if (task.due) {
      meta.createSpan({ text: task.time ? `📅 ${task.due} ⏰ ${task.time}` : `📅 ${task.due}` });
    }
    makeClickable(row, () => this.plugin.activateNowView(), `打开 Now 看板：${task.title}`);
  }

  renderCapture(parent) {
    const section = parent.createDiv({ cls: "crisp-panel-section" });
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
      try {
        const path = await this.plugin.createInboxCapture({
          text,
          inboxType: this.view.captureType,
          topic: this.topic,
        });
        this.view.captureDraft = "";
        new Notice(`Crisp 行动面板：已捕获 → ${path}`);
        await this.view.render();
      } catch (error) {
        new Notice(`Crisp 行动面板：${error.message || error}`);
        save.disabled = false;
        saving = false;
      }
    };
    save.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });

    const listTitle = section.createDiv({ cls: "crisp-panel-section-title" });
    listTitle.createSpan({ text: "今天的捕获" });
    listTitle.createSpan({ text: `${this.captures.length} 条` });
    const list = section.createDiv({ cls: "crisp-panel-list" });
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
    title.createSpan({ text: `${this.triage.length} 条` });
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
    const openNow = addButton(actions, "打开 Now 看板");
    const openLaunchpad = addButton(actions, "打开启动台");
    if (this.activeTab !== "capture") {
      const capture = addButton(actions, "捕获", "launchpad-btn is-primary");
      capture.addEventListener("click", () => this.view.setPanelTab("capture"));
    }
    newAction.addEventListener("click", () => {
      new QuickCaptureModal(this.app, this.plugin, this.view, "action").open();
    });
    openNow.addEventListener("click", () => this.plugin.activateNowView());
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
    const tasks = await this.plugin.readNowTasks();
    const pages = collectPages(this.app);
    const bookmarks = this.plugin.readBookmarks();
    if (nonce !== this.renderNonce) return;
    this.contentEl.empty();
    new CrispPanelRenderer(this, {
      tasks,
      bookmarks,
      captures: capturedToday(pages),
      triage: inboxTriageItems(pages),
      topic: captureTargetTopic(
        this.app,
        this.plugin.listTopics(),
        primaryTopic(this.plugin.lastCapabilities),
      ),
      activeTab: this.activePanelTab,
    }).render();
  }

  onClose() {
    this.contentEl.empty();
  }

  async openTarget(target, label = "") {
    const file =
      this.app.vault.getAbstractFileByPath(target) ||
      this.app.vault.getAbstractFileByPath(`${target}.md`);
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
    new Notice(`Crisp 行动面板：未找到「${label || target}」`);
    return false;
  }
}

class QuickCaptureModal extends Modal {
  constructor(app, plugin, view, initialMode = "capture") {
    super(app);
    this.plugin = plugin;
    this.view = view;
    this.initialMode = initialMode;
    this.text = "";
    /* 当前 Topic 优先，其次工作区主 Topic；只使用库里真实存在的 Topic。 */
    this.topic = captureTargetTopic(
      app,
      plugin.listTopics(),
      primaryTopic(plugin.lastCapabilities),
    );
    this.inboxType = "scratch";
    this.due = "";
    this.project = "";
    this.datePickers = [];
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("crisp-launchpad-quick-modal");
    this.contentEl.createEl("h2", { text: this.initialMode === "action" ? "新建行动" : "速记" });
    this.contentEl.createDiv({
      cls: "launchpad-modal-hint",
      text: this.plugin.canRunAnks()
        ? "内容先进入本地 Markdown；速记落 raw/inbox，行动落 Now/。"
        : "移动端直接写入本地 Markdown；速记落 raw/inbox，行动落 Now/。",
    });

    const contentSetting = new Setting(this.contentEl)
      .setName("内容")
      .setDesc("第一行会作为标题。")
      .addTextArea((text) => {
        text.inputEl.rows = 6;
        text.setPlaceholder("写下想法、链接说明或下一步行动…").onChange((value) => {
          this.text = value;
        });
      });
    contentSetting.settingEl.addClass("launchpad-quick-content-setting");

    if (this.initialMode !== "action") {
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
        .setDesc("用于“存为速记”。")
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
    }

    const todayStr = dateKey(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = dateKey(tomorrow);

    let dueInput;
    let duePicker;
    const dueSetting = new Setting(this.contentEl)
      .setName("截止日期")
      .setDesc("可从 Crisp 日历选择日期；留空表示随时行动。");

    const quickDates = dueSetting.controlEl.createDiv({ cls: "launchpad-quick-dates" });
    const addDateBtn = (label, dateVal) => {
      const btn = quickDates.createEl("button", {
        cls: "launchpad-btn launchpad-btn-sm",
        text: label,
      });
      btn.type = "button";
      btn.addEventListener("click", () => {
        if (duePicker) duePicker.setValue(dateVal);
        else {
          this.due = dateVal;
          if (dueInput) dueInput.setValue(dateVal);
        }
      });
      return btn;
    };
    addDateBtn("今天", todayStr);
    addDateBtn("明天", tomorrowStr);
    addDateBtn("清除", "");

    dueSetting.addText((text) => {
      dueInput = text;
    });
    duePicker = new CrispDatePicker(dueSetting, dueInput, this.due, (value) => {
      this.due = value;
    });
    this.datePickers.push(duePicker);

    const existingProjects = this.plugin.listProjectTags();
    const projectSetting = new Setting(this.contentEl)
      .setName("项目标签")
      .setDesc("可选，对应 #project/名称。可自由输入新项目或点击已有项目。");

    let projectInput;
    projectSetting.addText((text) => {
      projectInput = text;
      const datalistId = "launchpad-project-datalist";
      if (this.contentEl.createEl) {
        let datalist = this.contentEl.querySelector?.(`#${datalistId}`);
        if (!datalist) {
          datalist = this.contentEl.createEl("datalist", { attr: { id: datalistId } });
        } else if (datalist.empty) {
          datalist.empty();
        }
        for (const p of existingProjects) {
          datalist.createEl("option", { attr: { value: p } });
        }
      }
      if (text.inputEl?.setAttribute) {
        text.inputEl.setAttribute("list", datalistId);
        text.inputEl.setAttribute("autocomplete", "off");
      }
      text.setPlaceholder(existingProjects[0] || "工作台");
      if (this.project) text.setValue(this.project);
      text.onChange((value) => {
        this.project = value.trim();
        updateChipStates();
      });
    });

    let updateChipStates = () => {};
    if (existingProjects.length > 0) {
      const chipsRow = this.contentEl.createDiv({ cls: "launchpad-tag-chips" });
      const chipButtons = [];
      for (const p of existingProjects) {
        const chip = chipsRow.createEl("button", {
          cls: `launchpad-tag-chip${this.project === p ? " is-active" : ""}`,
          text: `#${p}`,
        });
        chip.type = "button";
        chip.addEventListener("click", () => {
          if (this.project === p) {
            this.project = "";
            projectInput?.setValue("");
          } else {
            this.project = p;
            projectInput?.setValue(p);
          }
          updateChipStates();
        });
        chipButtons.push({ p, chip });
      }
      updateChipStates = () => {
        for (const item of chipButtons) {
          item.chip.toggleClass?.("is-active", this.project === item.p);
        }
      };
    }

    const actions = this.contentEl.createDiv({ cls: "launchpad-modal-actions" });
    if (this.initialMode !== "action") {
      const capture = addButton(actions, "存为速记");
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

    const action = addButton(
      actions,
      "创建行动",
      "launchpad-btn is-primary",
    );
    action.addEventListener("click", async () => {
      try {
        action.disabled = true;
        await this.plugin.createAction({
          text: this.text,
          due: this.due,
          project: this.project,
        });
        new Notice("Crisp Launchpad：行动已加入 Now/");
        this.close();
        await this.plugin.refreshActionSnapshots({ silent: true });
        await this.view?.render?.();
      } catch (error) {
        new Notice(`Crisp Launchpad：${error.message || error}`);
        action.disabled = false;
      }
    });
  }

  onClose() {
    this.datePickers.forEach((picker) => picker.destroy());
    this.datePickers = [];
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
        const created = await this.plugin.createContentProject({
          title: this.title || this.slug,
          slug: this.slug || this.title,
          profile: this.profile,
          track: this.track,
          topic: this.topic,
          platform: this.platform,
        });
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
        "监听 Topics/、Core/ 和 Now/ 变更：只在路由真正处理的路径上执行 route fix --min-confidence 1（路由忽略的前缀如 content-projects/、Core/System/ 只重建快照），不启用 Core promotion。移动端不可用。",
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
      .setName("行动提醒")
      .setDesc(
        "Obsidian 运行时每 30 秒检查 Now/ 中带时间（⏰ HH:MM）的行动；到点优先发系统通知，不可用时改用应用内弹窗。",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.remindersEnabled).onChange(async (value) => {
          await this.plugin.setRemindersEnabled(value);
        }),
      );
    new Setting(this.containerEl)
      .setName("重新运行启动向导")
      .setDesc("重新检查 ANKS CLI、Now/ 和快照状态。")
      .addButton((button) =>
        button.setButtonText("运行向导").onClick(() => {
          new LaunchpadOnboardingModal(this.app, this.plugin).open();
        }),
      );
  }
}

/* Now/ 行动行的原地改写。由 CrispLaunchpadPlugin.mutateNowTask 串行调用，避免丢更新。 */
function fileRevision(file) {
  const revision = file?.stat?.mtime;
  return Number.isFinite(revision) ? revision : null;
}

function taskRawLine(task) {
  if (!task || typeof task !== "object") return "";
  return String(task.rawLine ?? task.raw_line ?? task.lineText ?? "");
}

function taskReference(expected) {
  if (expected && typeof expected === "object") {
    return {
      title: String(expected.title ?? ""),
      rawLine: taskRawLine(expected),
    };
  }
  return {
    title: typeof expected === "string" ? expected : "",
    rawLine: "",
  };
}

function assertFileRevision(file, expectedRevision) {
  if (
    expectedRevision !== null &&
    fileRevision(file) !== null &&
    fileRevision(file) !== expectedRevision
  ) {
    throw new Error("行动文件在编辑期间被外部修改，请刷新看板后重试");
  }
}

async function processVaultText(plugin, file, transform) {
  const vault = plugin.app.vault;
  if (typeof vault.process === "function") {
    return vault.process(file, transform);
  }
  /* Lightweight test doubles and older embedded callers may not expose the
     native transaction. Keep the old preflight as a degraded fallback. */
  const expectedRevision = fileRevision(file);
  const content = await vault.read(file);
  assertFileRevision(file, expectedRevision);
  const output = transform(content);
  assertFileRevision(file, expectedRevision);
  await vault.modify(file, output);
  return output;
}

async function applyNowTaskMutation(plugin, id, mutate, expectedTask = "") {
  const match = String(id).match(/^(.*):(\d+)$/);
  if (!match) throw new Error("行动标识无效");
  const path = match[1];
  const requestedLineNumber = Number(match[2]);
  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error("行动文件不存在");
  const reference = taskReference(expectedTask);
  const transform = (content) => {
    const lines = String(content).split(/\r?\n/);
    let index = requestedLineNumber - 1;
    let lineNumber = requestedLineNumber;
    let current = parseNowTaskLine(lines[index] || "", path, lineNumber, new Date());
    const candidates = [];

    for (let i = 0; i < lines.length; i++) {
      const candidate = parseNowTaskLine(lines[i], path, i + 1, new Date());
      if (!candidate) continue;
      if (reference.rawLine && String(lines[i]) === reference.rawLine) {
        candidates.push({ index: i, task: candidate });
      } else if (
        !reference.rawLine &&
        reference.title &&
        cleanTaskTitle(candidate.title) === cleanTaskTitle(reference.title)
      ) {
        candidates.push({ index: i, task: candidate });
      }
    }

    if (reference.rawLine || reference.title) {
      if (candidates.length !== 1) {
        throw new Error("行动已被外部移动或修改，请刷新看板后重试（也可能存在重复任务）");
      }
      index = candidates[0].index;
      lineNumber = index + 1;
      current = candidates[0].task;
    }

    if (!current) throw new Error("行动已被移动或删除");
    const result = mutate({ ...current });
    if (result === "delete") {
      lines.splice(index, 1);
    } else {
      const indent = (lines[index].match(/^\s*/) || [""])[0];
      lines[index] = `${indent}${taskLine(result)}`;
    }
    return lines.join(detectEol(content));
  };

  /* Vault.process 把读取、变换和提交放进 Obsidian 的原子写路径；外部
     修改会在同一提交窗口内基于最新正文重算，而不是覆盖旧全文。 */
  await processVaultText(plugin, file, transform);
  try {
    const snapshotUpdated = await plugin.refreshActionSnapshots({ silent: true });
    return { saved: true, snapshotUpdated: snapshotUpdated !== false };
  } catch (error) {
    new Notice("Crisp Now：行动已保存，快照未更新。可点击“刷新快照”重试。", 8000);
    return {
      saved: true,
      snapshotUpdated: false,
      error: String(error?.message || error),
    };
  }
}

function detectEol(text) {
  return /\r\n/.test(String(text ?? "")) ? "\r\n" : "\n";
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
  async onload() {
    await this.loadSettings();
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
    this.reminderTimer = null;
    this.reminderRunning = false;
    this.reminderBootTimer = null;
    this.unloaded = false;
    this.nowMutationChain = Promise.resolve();
    this.healthRebuildTimer = null;
    this.registerView(VIEW_TYPE_LAUNCHPAD, (leaf) => new CrispLaunchpadView(leaf, this));
    this.registerView(VIEW_TYPE_NOW, (leaf) => new CrispNowView(leaf, this));
    this.registerView(VIEW_TYPE_PANEL, (leaf) => new CrispPanelView(leaf, this));
    crispRegisterIcons();
    this.addRibbonIcon(CRISP_LAUNCHPAD_ICON_ID, "打开 Crisp Launchpad", () => this.activateView());
    // Mobile already exposes the Now view in the right drawer; avoid a duplicate bottom-bar shortcut.
    if (!Platform.isMobile) {
      this.addRibbonIcon(CRISP_NOW_ICON_ID, "打开 Crisp Now 行动看板", () => this.activateNowView());
    }
    this.addCommand({
      id: "open-crisp-launchpad-view",
      name: "打开 Crisp Launchpad",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "open-crisp-now-view",
      name: "打开 Crisp Now 行动看板",
      callback: () => this.activateNowView(),
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
        new QuickCaptureModal(this.app, this, leaf?.view).open();
      },
    });
    this.addCommand({
      id: "new-action",
      name: "Crisp Launchpad：新建行动",
      callback: async () => {
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_LAUNCHPAD)[0];
        new QuickCaptureModal(this.app, this, leaf?.view, "action").open();
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
    this.registerObsidianProtocolHandler("crisp-now", () => this.activateNowView());
    this.addSettingTab(new CrispLaunchpadSettingTab(this.app, this));

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (
          !file?.path ||
          (!file.path.startsWith("Core/") &&
            !file.path.startsWith("Topics/") &&
            !file.path.startsWith("Now/"))
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
      this.startReminderLoop();
    });
  }

  onunload() {
    this.unloaded = true;
    window.clearTimeout(this.refreshTimer);
    window.clearTimeout(this.autoSyncTimer);
    this.stopReminderLoop();
    this.cancelHealthRebuild();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_LAUNCHPAD);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_NOW);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_PANEL);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
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

  canUseSystemNotifications() {
    return typeof Notification === "function" && Notification.permission === "granted";
  }

  async requestNotificationPermission() {
    if (typeof Notification !== "function") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try {
      const result = await Notification.requestPermission();
      return result === "granted";
    } catch (error) {
      return false;
    }
  }

  async setRemindersEnabled(value) {
    this.settings.remindersEnabled = value === true;
    await this.saveSettings();
    if (this.settings.remindersEnabled) {
      const granted = await this.requestNotificationPermission();
      this.startReminderLoop();
      new Notice(
        granted
          ? "Crisp Now：行动提醒已开启（系统通知）"
          : "Crisp Now：行动提醒已开启（应用内弹窗，系统通知不可用）",
      );
    } else {
      this.stopReminderLoop();
      new Notice("Crisp Now：行动提醒已关闭");
    }
    this.refreshViews();
  }

  startReminderLoop() {
    if (this.unloaded || !this.settings.remindersEnabled) return;
    window.clearInterval(this.reminderTimer);
    this.reminderTimer = window.setInterval(() => {
      this.checkNowReminders({ silent: true });
    }, REMINDER_INTERVAL_MS);
    window.clearTimeout(this.reminderBootTimer);
    this.reminderBootTimer = window.setTimeout(() => {
      this.reminderBootTimer = null;
      this.checkNowReminders({ silent: true });
    }, REMINDER_START_DELAY_MS);
  }

  stopReminderLoop() {
    window.clearInterval(this.reminderTimer);
    this.reminderTimer = null;
    window.clearTimeout(this.reminderBootTimer);
    this.reminderBootTimer = null;
  }

  async checkNowReminders(options = {}) {
    if (this.unloaded) return 0;
    if (!this.settings.remindersEnabled) return 0;
    if (this.reminderRunning) return 0;
    this.reminderRunning = true;
    let fired = 0;
    try {
      const now = new Date();
      const reminded = new Set(
        Array.isArray(this.settings.remindedKeys) ? this.settings.remindedKeys : [],
      );
      const tasks = await this.readNowTasks();
      const pending = [];
      for (const task of tasks) {
        const moment = reminderMoment(task);
        if (!moment) continue;
        const elapsed = now.getTime() - moment.at.getTime();
        if (elapsed < 0 || elapsed > REMINDER_GRACE_MS) continue;
        if (reminded.has(moment.key)) continue;
        pending.push({ task, moment });
      }
      for (const item of pending) {
        reminded.add(item.moment.key);
        fired += 1;
        await this.notifyNowReminder(item.task, item.moment);
      }
      if (pending.length) {
        this.settings.remindedKeys = [...reminded].slice(-REMINDER_KEY_LIMIT);
        await this.saveSettings();
      }
    } catch (error) {
      if (!options.silent) {
        console.warn("[Crisp Launchpad] Reminder check failed:", error);
      }
    } finally {
      this.reminderRunning = false;
    }
    return fired;
  }

  async notifyNowReminder(task, moment) {
    const title = `Crisp Now · ${moment.time} 行动提醒`;
    const body = String(task.title || "未命名行动");
    if (this.canUseSystemNotifications()) {
      try {
        const notification = new Notification(title, { body });
        notification.onclick = () => {
          if (typeof window !== "undefined") window.focus?.();
          this.activateNowView();
        };
        return true;
      } catch (error) {
        console.warn("[Crisp Launchpad] System notification failed:", error);
      }
    }
    new Notice(`Crisp Now：${body}（${moment.time}）`, 10000);
    return false;
  }

  handleAutoRouteCandidate(file) {
    if (this.unloaded) return;
    const indexTopic = contentIndexTopicForPath(file?.path);
    // 删除整个项目目录时事件路径是文件夹（无扩展名），eventBridgeKind 不认，
    // 但派生的 content-projects/index.md 仍需重建。
    const kind = eventBridgeKind(file?.path) || (indexTopic ? "snapshot" : "");
    if (!kind) return;
    // Local views must follow deletions/renames even when CLI automation is off
    // (including mobile). Merge vault and metadata events into one render.
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      if (!this.unloaded) this.refreshViews();
    }, 1200);
    if (!this.settings.autoRouteEnabled || !this.canRunAnks()) return;
    this.autoSyncDirty[kind] = true;
    if (indexTopic) (this.autoSyncIndexTopics ||= new Set()).add(indexTopic);
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
    const pending = { ...this.autoSyncDirty };
    this.autoSyncDirty = { actions: false, knowledge: false, snapshot: false };
    const indexTopics = [...(this.autoSyncIndexTopics || [])];
    this.autoSyncIndexTopics = new Set();
    if (!pending.actions && !pending.knowledge && !pending.snapshot) return;

    this.autoSyncRunning = true;
    try {
      /* 项目在插件外被删除、改名或改了控制文件时，index.md 不会自己更新，
         health 随即报 BROKEN_LINK_PATH。content index 只在内容变化时写入，
         且 index.md 本身不入队，不会自我触发。 */
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

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_LAUNCHPAD)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_LAUNCHPAD, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async activateNowView() {
    const workspace = this.app.workspace;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_NOW)[0] || null;
    let leaf;

    if (Platform.isMobile) {
      let rightLeaf = workspace.getRightLeaf?.(false) || null;
      if (!rightLeaf && typeof workspace.ensureSideLeaf === "function") {
        try {
          rightLeaf = await workspace.ensureSideLeaf(VIEW_TYPE_NOW, "right", {
            active: true,
          });
        } catch (error) {
          console.warn("[Crisp Launchpad] Right sidebar unavailable for Crisp Now:", error);
        }
      }

      leaf = rightLeaf || existing || workspace.getLeaf("tab");
    } else {
      let existingInRoot = false;
      if (existing && typeof workspace.iterateRootLeaves === "function") {
        workspace.iterateRootLeaves((rootLeaf) => {
          if (rootLeaf === existing) existingInRoot = true;
        });
      }
      leaf = existingInRoot ? existing : workspace.getLeaf("tab");
    }

    if (leaf !== existing) {
      const existingState = existing?.getViewState?.() || {};
      await leaf.setViewState({ ...existingState, type: VIEW_TYPE_NOW, active: true });
      existing?.detach?.();
    }
    workspace.revealLeaf(leaf);
  }

  async activatePanelView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PANEL)[0];
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

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_LAUNCHPAD)) {
      if (leaf.view instanceof CrispLaunchpadView) {
        leaf.view.render();
      }
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_NOW)) {
      if (leaf.view instanceof CrispNowView) {
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

  async ensureActionFile() {
    await this.ensureFolder("Now");
    const path = "Now/行动.md";
    if (!(await this.app.vault.adapter.exists(path))) {
      await this.app.vault.create(path, "# 行动\n");
    }
    return path;
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

  async createAction({ text, due = "", project = "", link = "" }) {
    const clean = String(text ?? "").trim();
    if (!clean) throw new Error("行动不能为空");
    return this.enqueueNowMutation(async () => {
      const path = await this.ensureActionFile();
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error("无法找到 Now/行动.md");
      const linkedText = link
        ? `${clean} [[${String(link).replace(/\.md$/i, "")}]]`
        : clean;
      await processVaultText(this, file, (existing) =>
        appendActionTask(existing, linkedText, due, project),
      );
      return path;
    });
  }

  async markProcessed(file) {
    if (!(file instanceof TFile)) throw new Error("原文不存在");
    const content = await this.app.vault.read(file);
    const topic = strictTopicFromPath(file.path);
    if (!topic) throw new Error("原文不属于 Topics/，不能按 Topic 路由标记");
    await this.app.vault.modify(file, markProcessedContent(content, new Date(), topic));
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

  async readNowTasks() {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith("Now/"));
    const documents = await Promise.all(
      files.map(async (file) => ({
        path: file.path,
        content: await this.app.vault.read(file),
      })),
    );
    return parseNowTasks(documents, new Date());
  }

  /* Now/ 的写路径是「读全文 → 改一行 → 写回全文」，并发调用会互相覆盖（丢更新）：
     同时勾选两条行动时，后一次写入会基于旧快照把前一次改回去。这里把所有变更串行化，
     面板勾选、看板勾选、拖拽、编辑弹窗共用同一条队列。 */
  enqueueNowMutation(run) {
    const previous = this.nowMutationChain || Promise.resolve();
    const next = previous.then(run, run);
    this.nowMutationChain = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  async mutateNowTask(id, mutate, expectedTitle = "") {
    const run = () => applyNowTaskMutation(this, id, mutate, expectedTitle);
    if (typeof this.enqueueNowMutation === "function") {
      return this.enqueueNowMutation(run);
    }
    // Keep the prototype method usable with lightweight test doubles and
    // older embedded callers that only copied mutateNowTask.
    const previous = this.nowMutationChain || Promise.resolve();
    const next = previous.then(run, run);
    this.nowMutationChain = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  async toggleNowTask(id, expectedTitle = "") {
    return this.mutateNowTask(
      id,
      (task) => {
        const done = !task.done;
        return parseNowTaskLine(
          taskLine({
            ...task,
            done,
            doneAt: done ? dateKey(new Date()) : "",
          }),
          task.path,
          task.line,
          new Date(),
        );
      },
      expectedTitle,
    );
  }

  async updateNowTask(id, updates, expectedTitle = "") {
    return this.mutateNowTask(
      id,
      (task) => {
        const done = updates.done !== undefined ? Boolean(updates.done) : task.done;
        let doneAt = updates.doneAt !== undefined ? String(updates.doneAt).trim() : task.doneAt;
        if (!done) {
          doneAt = "";
        } else if (!isDateKey(doneAt)) {
          doneAt = dateKey(new Date());
        }
        return {
          ...task,
          title: updates.title !== undefined ? String(updates.title).trim() : task.title,
          start: updates.start !== undefined ? String(updates.start).trim() : task.start,
          due: updates.due !== undefined ? String(updates.due).trim() : task.due,
          scheduled:
            updates.scheduled !== undefined ? String(updates.scheduled).trim() : task.scheduled,
          time: updates.time !== undefined ? String(updates.time).trim() : task.time,
          project: updates.project !== undefined ? String(updates.project).trim() : task.project,
          waiting: updates.waiting !== undefined ? Boolean(updates.waiting) : task.waiting,
          done,
          doneAt,
        };
      },
      expectedTitle,
    );
  }

  async deleteNowTask(id, expectedTitle = "") {
    return this.mutateNowTask(id, () => "delete", expectedTitle);
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

  async updateContentProject(projectDir, { stage, status, nextAction }) {
    const today = dateKey(new Date());
    const path = `${projectDir}/project.yaml`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("project.yaml 不存在");
    let content = await this.app.vault.read(file);
    content = updateProjectField(content, "stage", stage);
    content = updateProjectField(content, "status", status);
    content = updateProjectField(content, "updated_at", today);
    content = updateProjectField(content, "next_action", nextAction || "继续推进当前阶段");
    if (status === "published") {
      content = updateProjectField(content, "publication_status", "live");
    }
    await this.app.vault.modify(file, content);

    const articlePath = `${projectDir}/article.md`;
    const articleFile = this.app.vault.getAbstractFileByPath(articlePath);
    if (articleFile instanceof TFile) {
      let articleContent = await this.app.vault.read(articleFile);
      articleContent = updateProjectField(articleContent, "stage", stage);
      articleContent = updateProjectField(articleContent, "status", status);
      articleContent = updateProjectField(articleContent, "updated_at", today);
      if (status === "published") {
        articleContent = updateProjectField(articleContent, "publication_status", "live");
      }
      await this.app.vault.modify(articleFile, articleContent);
    }

    const publishPath = `${projectDir}/publish.md`;
    const publishFile = this.app.vault.getAbstractFileByPath(publishPath);
    if (publishFile instanceof TFile) {
      let publishContent = await this.app.vault.read(publishFile);
      publishContent = updateProjectField(publishContent, "status", status);
      publishContent = updateProjectField(publishContent, "updated_at", today);
      if (status === "published") {
        publishContent = updateProjectField(publishContent, "publication_status", "live");
        publishContent = updateProjectField(publishContent, "published_at", today);
      }
      await this.app.vault.modify(publishFile, publishContent);
    }

    if (this.canRunAnks()) {
      // 先重新物化 project.md 再建快照，否则 content 快照读到的是旧阶段。
      const projectId = String(projectDir || "").replace(/\/+$/, "").split("/").pop();
      await this.syncContentArtifacts(projectId, {
        force: true,
        topic: contentTopicFromPath(projectDir),
      });
      try {
        await this.refreshSystemSnapshots({ silent: true });
      } catch (error) {
        // The project write succeeded; a system-wide snapshot may still be blocked
        // by an unrelated gate elsewhere in the vault.
      }
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

  listProjectTags() {
    const projects = new Set();
    try {
      const allTags = this.app.metadataCache?.getTags?.() || {};
      for (const tag of Object.keys(allTags)) {
        if (tag.toLowerCase().startsWith("#project/")) {
          const name = tag.slice("#project/".length).trim();
          if (name) projects.add(name);
        }
      }
    } catch {}
    try {
      const snapshotTasks = this.snapshots?.action?.data?.tasks || [];
      for (const t of snapshotTasks) {
        if (t.project) projects.add(t.project);
      }
    } catch {}
    return Array.from(projects).sort((a, b) => a.localeCompare(b, "zh-CN"));
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
    await addCheck("原生行动清单", "Now/行动.md", "启动台行动层的数据入口");
    await addCheck("系统状态快照", ".runtime/snapshot/health.json", "健康与索引状态");
    await addCheck("行动快照", ".runtime/snapshot/actions.json", "今天、等待、即将");
    return checks;
  }

  async repairEnvironment() {
    await this.ensureActionFile();
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
module.exports.safeProjectTag = safeProjectTag;
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
module.exports.TOTAL_HEATMAP_WEEKS = TOTAL_HEATMAP_WEEKS;
module.exports.actionItemMeta = actionItemMeta;
module.exports.buildStageBuckets = buildStageBuckets;
module.exports.collectPages = collectPages;
module.exports.compactCommandError = compactCommandError;
module.exports.contentProjectArticle = contentProjectArticle;
module.exports.contentProjectId = contentProjectId;
module.exports.contentProjectLabel = contentProjectLabel;
module.exports.publishedOutputPages = publishedOutputPages;
module.exports.contentSlug = contentSlug;
module.exports.appendActionTask = appendActionTask;
module.exports.buildInboxNote = buildInboxNote;
module.exports.eventBridgeKind = eventBridgeKind;
module.exports.contentIndexTopicForPath = contentIndexTopicForPath;
module.exports.heatLevel = heatLevel;
module.exports.inferTopicFromPath = inferTopicFromPath;
module.exports.captureTargetTopic = captureTargetTopic;
module.exports.normalizeRhythmWeeks = normalizeRhythmWeeks;
module.exports.markProcessedContent = markProcessedContent;
module.exports.normalizeProjectTag = normalizeProjectTag;
module.exports.parseNowTaskLine = parseNowTaskLine;
module.exports.parseNowTasks = parseNowTasks;
module.exports.isDateKey = isDateKey;
module.exports.isTimeKey = isTimeKey;
module.exports.normalizeTimeKey = normalizeTimeKey;
module.exports.reminderMoment = reminderMoment;
module.exports.projectField = projectField;
module.exports.replaceTemplateTokens = replaceTemplateTokens;
module.exports.snapshotAge = snapshotAge;
module.exports.snapshotAgeLabel = snapshotAgeLabel;
module.exports.suggestReviewActions = suggestReviewActions;
module.exports.summarizePages = summarizePages;
module.exports.taskLine = taskLine;
module.exports.formatYamlScalar = formatYamlScalar;
module.exports.updateProjectField = updateProjectField;
module.exports.generateCaptureId = generateCaptureId;
module.exports.formatDateTime = formatDateTime;
module.exports.formatFullDateTime = formatFullDateTime;
module.exports.STAGE_ORDER = STAGE_ORDER;
module.exports.STAGE_LABEL = STAGE_LABEL;
module.exports.NowBoardRenderer = NowBoardRenderer;
module.exports.NowTaskEditModal = NowTaskEditModal;
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
