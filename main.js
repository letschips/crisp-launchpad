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
  TFile,
  TFolder,
  setIcon,
} = require("obsidian");

const { execFile } = require("child_process");

const VIEW_TYPE_LAUNCHPAD = "crisp-launchpad-view";
const VIEW_TYPE_NOW = "crisp-now-view";
const NOW_ACTION_PATH = "Now/行动.md";
const SNAPSHOT_ROOT = ".runtime/snapshot";
const TAB_KEY = "crisp-launchpad-tab";
const RHYTHM_WEEKS_KEY = "crisp-launchpad-rhythm-weeks";
const RHYTHM_WEEK_OPTIONS = [4, 13, 26, 52];
const TOTAL_HEATMAP_WEEKS = 53;
const PAGES = [
  { id: "overview", name: "总览" },
  { id: "create", name: "创作" },
  { id: "knowledge", name: "知识" },
  { id: "system", name: "系统" },
];
const KNOWLEDGE_TYPES = ["source", "knowledge", "concept", "entity", "method", "framework"];
const STAGE_ORDER = ["drafting", "visual", "reviewing", "done", "archived"];
const STAGE_LABEL = {
  drafting: "起草中",
  visual: "配图/视觉",
  reviewing: "待复盘",
  done: "已完成",
  archived: "已归档",
};
const DEFAULT_SETTINGS = {
  openOnStartup: true,
  allowSnapshotRefresh: true,
  hasCompletedOnboarding: false,
};

function textOr(value, fallback = "") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function dateKeyFromTimestamp(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKey(date) {
  return dateKeyFromTimestamp(date.getTime());
}

function startOfMonday(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offset);
  return copy;
}

function daysBetween(now, then) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  return Math.max(0, Math.round((start - end) / 86400000));
}

function formatShortDate(timestamp) {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  const datePart = `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")}`;
  const timePart = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${datePart} ${timePart}`;
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
  return sanitizeTitle(line, fallback);
}

function normalizeProjectTag(value) {
  const text = String(value ?? "").trim().replace(/^#/, "").replace(/^project\//i, "");
  return text.replace(/[\s#/]+/g, "-").replace(/^-+|-+$/g, "");
}

function inferTopicFromPath(path) {
  const match = String(path ?? "").match(/^Topics\/([^/]+)\//);
  return match ? match[1] : "self-media";
}

function inboxFolder(inboxType, topic = "self-media") {
  if (inboxType === "idea") return `Topics/${topic}/raw/inbox/ideas`;
  if (inboxType === "link") return `Topics/${topic}/raw/inbox/links`;
  return `Topics/${topic}/raw/inbox/scratch`;
}

function buildInboxNote(text, inboxType = "scratch", now = new Date(), topic = "self-media") {
  const cleanType = ["idea", "link", "scratch"].includes(inboxType) ? inboxType : "scratch";
  const cleanTopic = sanitizeTitle(topic, "self-media").replace(/\s+/g, "-");
  const title = firstMeaningfulLine(text);
  const date = dateKey(now);
  const createdAt = now.toISOString();
  const content = [
    "---",
    "type: raw",
    `topic: ${cleanTopic}`,
    `owner: topic:${cleanTopic}`,
    `title: ${yamlQuote(title)}`,
    `inbox_type: ${cleanType}`,
    "capture_type: crisp-launchpad",
    "capture_contract: anks-capture-v1",
    `created_at: ${yamlQuote(createdAt)}`,
    `created: ${yamlQuote(date)}`,
    "routing_confidence: 1",
    'routing_reason: "Crisp Launchpad quick capture"',
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
  const base = String(existing ?? "").replace(/\s*$/, "");
  return `${base}${base ? "\n" : ""}${line}\n`;
}

function cleanTaskTitle(text) {
  return String(text ?? "")
    .replace(/[📅⏳🛫➕✅]\s*\d{4}-\d{2}-\d{2}/gu, "")
    .replace(/[\uFE0E\uFE0F\u200B-\u200D\uD800-\uDFFF]/g, "")
    .replace(/(?<!\w)#[^\s#]+/g, "")
    .replace(/\s+/g, " ")
    .trim() || "未命名行动";
}

function parseNowTaskLine(line, path, lineNumber, today = new Date()) {
  const match = String(line).match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/);
  if (!match) return null;
  const raw = match[2];
  const tags = [...raw.matchAll(/(?<!\w)#([^\s#]+)/g)].map((item) => item[1]);
  const normalizedTags = tags.map((tag) => tag.toLowerCase());
  const dueMatch = raw.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
  const scheduledMatch = raw.match(/⏳\s*(\d{4}-\d{2}-\d{2})/);
  const due = dueMatch?.[1] || "";
  const scheduled = scheduledMatch?.[1] || "";
  const done = match[1].toLowerCase() === "x";
  const waitingTags = new Set(["waiting", "blocked", "待回复", "等待", "阻塞"]);
  const waiting = normalizedTags.some((tag) => waitingTags.has(tag));
  let bucket = "anytime";
  if (!done) {
    if (waiting) bucket = "waiting";
    else if (due && due < dateKey(today)) bucket = "overdue";
    else if (due && due === dateKey(today)) bucket = "today";
    else if (due && due > dateKey(today)) bucket = "upcoming";
  }
  const projectTag = tags.find((tag) => tag.toLowerCase().startsWith("project/"));
  return {
    id: `${path}:${lineNumber}`,
    path,
    line: lineNumber,
    title: cleanTaskTitle(raw),
    done,
    due,
    scheduled,
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

function taskLine(task) {
  const title = String(task.title ?? "").trim() || "未命名行动";
  const due = /^\d{4}-\d{2}-\d{2}$/.test(task.due || "") ? ` 📅 ${task.due}` : "";
  const scheduled = /^\d{4}-\d{2}-\d{2}$/.test(task.scheduled || "") ? ` ⏳ ${task.scheduled}` : "";
  const extraTags = (task.tags || []).filter((tag) => {
    const normalized = tag.toLowerCase();
    return !normalized.startsWith("project/");
  });
  const project = normalizeProjectTag(task.project);
  const tagText = extraTags.map((tag) => ` #${tag}`).join("");
  return `- [${task.done ? "x" : " "}] ${title}${due}${scheduled}${tagText}${project ? ` #project/${project}` : ""}`;
}

function markProcessedContent(content, now = new Date()) {
  const stamp = now.toISOString();
  const source = String(content ?? "");
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
      lines.push("routing_status: processed", `launchpad_processed_at: ${yamlQuote(stamp)}`);
      return `---\n${lines.join("\n")}\n---\n${tail}`;
    }
  }
  return `---\nrouting_status: processed\nlaunchpad_processed_at: ${yamlQuote(stamp)}\n---\n\n${source}`;
}

function parseHeroVersions(documents) {
  const text = documents.filter(Boolean).join("\n");
  const pick = (pattern) => {
    const match = text.match(pattern);
    return match ? match[1] : null;
  };
  const suite = pick(/Suite\/tutorial\s+`([^`]+)`/);
  if (!suite) {
    return "Capture → Triage → Compile → Create → Publish → Analytics → Distill → Health";
  }
  return `套件 ${suite} · 内核 ${pick(/ANKS micro-kernel\s+`([^`]+)`/) || "—"} · 插件 ${pick(/enabled Crisp plugins\s+`([^`]+)`/) || "—"} · Topics ${pick(/当前 Topics：`([^`]+)`/) || "—"}`;
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
    (page) => page.path.includes("raw/inbox") && page.routing_status !== "processed",
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
  return segment ? segment.replace(/^WECHAT-/, "") : article.name;
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
  const timestamp = Date.parse(textOr(generatedAt));
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (Date.now() - timestamp) / 3600000);
}

function snapshotAgeLabel(ageHours) {
  if (ageHours === null) return "时间未知";
  if (ageHours < 1) return "刚刚检查";
  return `${Math.round(ageHours)} 小时前检查`;
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
  constructor(view, root, snapshots, pageData, heroText) {
    this.view = view;
    this.app = view.app;
    this.plugin = view.plugin;
    this.root = root;
    this.snapshots = snapshots;
    this.pages = pageData;
    this.summary = summarizePages(pageData);
    this.heroText = heroText;
    this.panels = {};
    this.tabButtons = {};
    this.activeTab = this.loadActiveTab();
    this.rhythmWeeks = this.loadRhythmWeeks();
  }

  loadActiveTab() {
    try {
      const saved = window.localStorage.getItem(TAB_KEY);
      if (PAGES.some((page) => page.id === saved)) return saved;
    } catch (error) {
      // Fall through to the default tab.
    }
    return PAGES[0].id;
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

  render() {
    this.root.empty();
    this.renderHero();
    this.renderTabs();
    this.renderOverview();
    this.renderCreate();
    this.renderKnowledge();
    this.renderSystem();
    this.showTab(this.activeTab);
  }

  renderHero() {
    const card = this.root.createDiv({ cls: "launchpad-card" });
    const header = card.createDiv({ cls: "launchpad-card-header" });
    const titleGroup = header.createDiv({ cls: "launchpad-hero-title-group" });
    const icon = titleGroup.createDiv({ cls: "launchpad-hero-icon" });
    setIcon(icon, "layers");
    const copy = titleGroup.createDiv();
    copy.createDiv({ cls: "launchpad-hero-title", text: "ANKS · 知识生产中枢" });
    copy.createDiv({
      cls: "launchpad-hero-subtitle",
      text: parseHeroVersions(this.heroText),
    });

    const actions = header.createDiv({ cls: "launchpad-actions" });
    const dshEnabled = this.app.plugins?.enabledPlugins?.has("crisp-dsh") || false;
    const dsh = actions.createDiv({ cls: "launchpad-dsh-pill" });
    dsh.createSpan({ cls: `launchpad-dot${dshEnabled ? "" : " is-inactive"}` });
    dsh.createSpan({ text: dshEnabled ? "DSH 就绪" : "DSH 离线" });
    actions.createDiv({
      cls: "launchpad-date-badge",
      text: new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "short",
      }).format(new Date()),
    });

    this.renderSystemStatus(card);
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
    refresh.disabled = !this.plugin.settings.allowSnapshotRefresh;
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      try {
        await this.view.plugin.refreshSystemSnapshots();
        await this.view.render();
      } catch (error) {
        new Notice(`Crisp Launchpad：${error.message || error}`);
        refresh.disabled = false;
      }
    });
    const repair = addButton(actions, "环境修复");
    repair.addEventListener("click", () => {
      new LaunchpadOnboardingModal(this.app, this.plugin, { repairOnly: true }).open();
    });

    if (!health) {
      dot.addClass("is-warning");
      title.setText("系统快照缺失");
      meta.setText("运行 `sh Sidecar/bin/anks snapshot build` 后重新打开启动台。");
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

    const state = blocking > 0 ? "error" : health.data?.status === "healthy" ? "healthy" : "warning";
    dot.addClass(`is-${state}`);
    title.setText(
      blocking > 0
        ? `系统阻塞 · ${blocking}`
        : state === "healthy"
          ? "系统健康"
          : "系统可用 · 有运营待办",
    );
    const age = snapshotAge(health.generated_at);
    meta.setText(
      `${snapshotAgeLabel(age)} · ${operational} operational / ${informational} informational · 索引 ${documents} 文档 / ${chunks} chunks${age !== null && age > 24 ? " · 已陈旧" : ""}`,
    );
  }

  renderTabs() {
    const tabs = this.root.createDiv({ cls: "launchpad-tabs" });
    for (const page of PAGES) {
      const button = tabs.createEl("button", {
        cls: `launchpad-tab${page.id === this.activeTab ? " is-active" : ""}`,
        text: page.name,
      });
      this.tabButtons[page.id] = button;
      button.addEventListener("click", () => this.showTab(page.id));
    }
    for (const page of PAGES) {
      this.panels[page.id] = this.root.createDiv({ cls: "launchpad-page" });
    }
  }

  showTab(tab) {
    this.activeTab = tab;
    this.saveActiveTab(tab);
    for (const page of PAGES) {
      this.panels[page.id].style.display = page.id === tab ? "" : "none";
      this.tabButtons[page.id].toggleClass("is-active", page.id === tab);
    }
  }

  renderActionCard(parent) {
    const card = parent.createDiv({ cls: "launchpad-card launchpad-action-card" });
    const header = card.createDiv({ cls: "launchpad-card-header" });
    const title = header.createDiv({ cls: "launchpad-card-title" });
    addIcon(title, "check-square");
    title.createSpan({ text: "行动台" });
    title.createSpan({ cls: "launchpad-badge", text: "Now/" });
    const headerActions = header.createDiv({ cls: "launchpad-actions" });
    const snapshot = this.snapshots.actions;
    const badge = headerActions.createDiv({
      cls: "launchpad-badge",
      text: snapshot ? "快照已连接" : "快照缺失",
    });
    const refresh = addButton(headerActions, "刷新行动");
    refresh.disabled = !this.plugin.settings.allowSnapshotRefresh;
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
        new Notice(`Crisp Launchpad：${error.message || error}`);
        refresh.disabled = false;
      }
    });

    const counts = card.createDiv({ cls: "launchpad-action-counts" });
    const countValues = {};
    for (const definition of [
      ["overdue", "逾期"],
      ["today", "今天"],
      ["waiting", "等待"],
      ["upcoming", "即将"],
      ["anytime", "随时"],
    ]) {
      const count = counts.createDiv({ cls: "launchpad-action-count" });
      countValues[definition[0]] = count.createDiv({
        cls: "launchpad-action-count-value",
        text: snapshot ? String(snapshot.counts?.[definition[0]] || 0) : "–",
      });
      count.createDiv({ cls: "launchpad-action-count-label", text: definition[1] });
    }

    const grid = card.createDiv({ cls: "launchpad-action-grid" });
    const todayColumn = grid.createDiv({ cls: "launchpad-action-column" });
    todayColumn.createDiv({ cls: "launchpad-action-column-title", text: "今天" });
    const todayList = todayColumn.createDiv({ cls: "launchpad-action-list" });
    const laterColumn = grid.createDiv({ cls: "launchpad-action-column" });
    laterColumn.createDiv({ cls: "launchpad-action-column-title", text: "等待与即将" });
    const laterList = laterColumn.createDiv({ cls: "launchpad-action-list" });
    if (!snapshot) {
      this.renderEmpty(todayList, "先运行刷新命令生成行动快照");
      this.renderEmpty(laterList, "行动来源：Now/ · 默认零外部依赖");
    } else {
      const groups = new Map((snapshot.groups || []).map((group) => [group.id, group.items || []]));
      this.renderActionItems(todayList, [...(groups.get("overdue") || []), ...(groups.get("today") || [])]);
      this.renderActionItems(laterList, [
        ...(groups.get("waiting") || []),
        ...(groups.get("upcoming") || []),
      ]);
    }

    const total = Object.values(snapshot?.counts || {}).reduce(
      (sum, value) => sum + Number(value || 0),
      0,
    );
    card.createDiv({
      cls: "launchpad-action-status",
      text: snapshot
        ? `来源：${snapshot.source?.label || "Obsidian 原生清单"} · ${total} 条未完成行动。`
        : "尚无行动快照。",
    });
    if (snapshot) badge.setText("更新于刚刚");
  }

  renderActionItems(container, items) {
    if (!items.length) {
      this.renderEmpty(container, "当前没有行动");
      return;
    }
    for (const item of items.slice(0, 8)) {
      const row = container.createDiv({ cls: "launchpad-breakdown-row launchpad-action-item" });
      const left = row.createDiv({ cls: "launchpad-row-left" });
      left.createDiv({ cls: "launchpad-row-title", text: item.title });
      const right = row.createDiv({ cls: "launchpad-row-right" });
      if (item.project) right.createSpan({ cls: "launchpad-badge", text: item.project });
      right.createSpan({ text: actionItemMeta(item) });
      makeClickable(
        row,
        () => this.view.openTarget(item.origin?.path, item.title),
        `打开行动：${item.title}`,
      );
    }
  }

  renderKpis(parent) {
    const data = this.summary;
    const grid = parent.createDiv({ cls: "launchpad-kpi-row" });
    const kpis = [
      [data.articles.length, "内容项目", "创作流水线在管", "Topics/self-media/content-projects/index.md"],
      [data.inbox.length, "待整理", "raw/inbox 未归位", "Topics/self-media/raw/inbox"],
      [data.knowledge.length, "知识对象", "source/knowledge 等", "Topics/self-media/knowledge"],
      [data.raw.length, "原始素材", "raw 证据层", "Topics/self-media/raw"],
      [data.outputs.length, "产出", "output 交付物", "Topics/self-media/outputs"],
      [data.active.length, "本周动过", "7 天内变更", "Topics"],
    ];
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
    this.renderCompletionStats(split);
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
    const grid = box.createDiv({ cls: "launchpad-heat-weeks" });
    const todayKey = dateKey(new Date());
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
        if (key === todayKey) cell.addClass("is-today");
      }
    }
    const legend = box.createDiv({ cls: "launchpad-heat-legend" });
    legend.createSpan({ text: "少" });
    for (let level = 0; level <= 5; level += 1) {
      const cell = legend.createDiv({ cls: "launchpad-heat-legend-cell" });
      cell.dataset.level = String(level);
    }
    legend.createSpan({ text: "多" });
    this.updateHeatmapRange();
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
    for (let index = 0; index < 4; index += 1) {
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

  updateCompletionStats() {
    const raw = this.summary.raw.length;
    const sources = this.pages.filter((page) => page.type === "source").length;
    const rangeStart = Date.now() - this.rhythmWeeks * 7 * 86400000;
    const rangeActiveDays = new Set(
      this.pages
        .filter((page) => page.mtime >= rangeStart)
        .map((page) => dateKeyFromTimestamp(page.mtime)),
    ).size;
    const writebacks = this.pages.filter((page) =>
      ["pending", "completed", "proposed"].includes(page.knowledge_writeback),
    );
    const definitions = [
      ["内容已发布", this.summary.articles.filter((page) => page.status === "published").length, this.summary.articles.length],
      ["知识回写", writebacks.filter((page) => page.knowledge_writeback === "completed").length, writebacks.length],
      ["素材升级", sources, sources + raw],
      [`近 ${this.rhythmWeeks} 周活跃`, rangeActiveDays, this.rhythmWeeks * 7],
    ];
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
    const grid = parent.createDiv({ cls: "launchpad-grid-2" });
    const inboxCard = grid.createDiv({ cls: "launchpad-card" });
    const inboxHeader = inboxCard.createDiv({ cls: "launchpad-card-header" });
    const inboxTitle = inboxHeader.createDiv({ cls: "launchpad-card-title" });
    addIcon(inboxTitle, "inbox");
    inboxTitle.createSpan({ text: "待整理" });
    inboxTitle.createSpan({ cls: "launchpad-badge", text: "raw/inbox" });
    const inboxBtn = addButton(inboxHeader, "收件箱 ↗");
    inboxBtn.addEventListener("click", () => this.view.openTarget("Topics/self-media/raw/inbox", "收件箱"));
    const inboxList = inboxCard.createDiv({ cls: "launchpad-breakdown-card" });
    if (!this.summary.inbox.length) {
      this.renderEmpty(inboxList, "收件箱是空的 · 没有积压");
    } else {
      for (const page of this.summary.inbox.slice(0, 6)) {
        const row = inboxList.createDiv({ cls: "launchpad-breakdown-row" });
        const left = row.createDiv({ cls: "launchpad-row-left" });
        left.createDiv({ cls: "launchpad-row-title", text: page.name });
        const right = row.createDiv({ cls: "launchpad-row-right" });
        right.createSpan({ text: `${daysBetween(new Date(), new Date(page.mtime))} 天前` });
        const convert = addButton(right, "转化", "launchpad-row-action");
        convert.addEventListener("click", (event) => {
          event.stopPropagation();
          new InboxConversionModal(this.app, this.plugin, this.view, page).open();
        });
        makeClickable(row, () => this.view.openTarget(page.path, page.name), `打开待整理：${page.name}`);
      }
    }

    const outputCard = grid.createDiv({ cls: "launchpad-card" });
    const outputHeader = outputCard.createDiv({ cls: "launchpad-card-header" });
    const outputTitle = outputHeader.createDiv({ cls: "launchpad-card-title" });
    addIcon(outputTitle, "sun");
    outputTitle.createSpan({ text: "最近产出" });
    outputTitle.createSpan({ cls: "launchpad-badge", text: "已发布" });
    const outputBtn = addButton(outputHeader, "产出目录 ↗");
    outputBtn.addEventListener("click", () =>
      this.view.openTarget("Topics/self-media/outputs/content/published", "产出目录"),
    );
    const outputList = outputCard.createDiv({ cls: "launchpad-breakdown-card" });
    const recent = this.pages
      .filter((page) => page.path.includes("outputs/content/published"))
      .sort((left, right) => right.mtime - left.mtime)
      .slice(0, 5);
    if (!recent.length) {
      this.renderEmpty(outputList, "还没有已发布产出");
    } else {
      for (const page of recent) {
        const row = outputList.createDiv({ cls: "launchpad-breakdown-row" });
        const left = row.createDiv({ cls: "launchpad-row-left" });
        left.createDiv({ cls: "launchpad-row-title", text: page.title });
        const right = row.createDiv({ cls: "launchpad-row-right" });
        if (page.platform) right.createSpan({ text: page.platform });
        right.createSpan({ cls: "launchpad-badge", text: formatShortDate(page.mtime) });
        makeClickable(row, () => this.view.openTarget(page.path, page.title), `打开产出：${page.title}`);
      }
    }
  }

  renderOverview() {
    this.renderActionCard(this.panels.overview);
    this.renderKpis(this.panels.overview);
    this.renderRhythm(this.panels.overview);
    this.renderWorkGrid(this.panels.overview);
  }

  renderCreate() {
    const buckets = buildStageBuckets(this.summary.articles);
    const flowCard = this.panels.create.createDiv({ cls: "launchpad-card" });
    const flowHeader = flowCard.createDiv({ cls: "launchpad-card-header" });
    const flowTitle = flowHeader.createDiv({ cls: "launchpad-card-title" });
    addIcon(flowTitle, "content");
    flowTitle.createSpan({ text: "内容流向" });
    flowTitle.createSpan({ cls: "launchpad-badge", text: "按阶段分布" });
    flowHeader.createDiv({ cls: "launchpad-badge", text: `共 ${this.summary.articles.length} 个内容项目` });
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
    const pipelineHeader = pipeline.createDiv({ cls: "launchpad-card-header" });
    const pipelineTitle = pipelineHeader.createDiv({ cls: "launchpad-card-title" });
    addIcon(pipelineTitle, "content");
    pipelineTitle.createSpan({ text: "创作流水线" });
    const dashboardButton = addButton(pipelineHeader, "作战大盘 ↗");
    dashboardButton.addEventListener("click", () =>
      this.view.openTarget("Topics/self-media/自媒体内容大盘.md", "作战大盘"),
    );
    const list = pipeline.createDiv({ cls: "launchpad-breakdown-card" });
    for (const [stage, rows] of buckets) {
      const groupRow = list.createDiv({ cls: "launchpad-breakdown-row" });
      const groupLeft = groupRow.createDiv({ cls: "launchpad-row-left" });
      groupLeft.createDiv({
        cls: `launchpad-badge${stage === "reviewing" ? " is-accent" : ""}`,
        text: STAGE_LABEL[stage] || stage,
      });
      groupLeft.createDiv({ cls: "launchpad-row-title", text: `${rows.length} 篇` });
      groupRow.addEventListener("click", () =>
        this.view.openTarget("Topics/self-media/content-projects/index.md", "内容项目索引"),
      );
      for (const article of rows.slice(0, 4)) {
        const row = list.createDiv({ cls: "launchpad-breakdown-row" });
        const left = row.createDiv({ cls: "launchpad-row-left" });
        left.createDiv({ cls: "launchpad-row-title", text: articleLabel(article) });
        const right = row.createDiv({ cls: "launchpad-row-right" });
        if (article.platform) right.createSpan({ text: article.platform });
        if (article.status) right.createSpan({ cls: "launchpad-badge", text: article.status });
        makeClickable(row, () => this.view.openTarget(article.path, article.title), `打开内容项目：${article.title}`);
      }
    }
  }

  renderKnowledge() {
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

  renderSystem() {
    const nav = this.panels.system.createDiv({ cls: "launchpad-card" });
    const header = nav.createDiv({ cls: "launchpad-card-header" });
    const title = header.createDiv({ cls: "launchpad-card-title" });
    addIcon(title, "package");
    title.createSpan({ text: "系统空间" });
    const grid = nav.createDiv({ cls: "launchpad-nav-grid" });
    const items = [
      ["Start Here", "五个动作与权威状态", "book", "Start Here.md"],
      ["内容作战大盘", "Topic 级内容总览", "content", "Topics/self-media/自媒体内容大盘.md"],
      ["内容总览 Base", "多维筛选数据库", "project", "Topics/self-media/自媒体内容总览.base"],
      ["Agent 契约", "AGENTS.md 红线与加载图", "settings", "AGENTS.md"],
      ["Core 知识区", "概念 · 方法 · 政策 · 模式", "layers", "Core"],
      ["Sidecar 工具区", "CLI · 工具 · 技能 · 索引", "package", "Sidecar"],
    ];
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
    const pulse = addButton(actions, "Crisp Pulse 看板");
    pulse.addEventListener("click", () => {
      if (!this.app.commands.executeCommandById("crisp-pulse:open-crisp-pulse-view")) {
        new Notice("Crisp Launchpad：Crisp Pulse 命令不可用");
      }
    });
    for (const [label, target] of [
      ["内容作战大盘", "Topics/self-media/自媒体内容大盘.md"],
      ["Start Here 契约", "Start Here.md"],
      ["Agent 契约 AGENTS", "AGENTS.md"],
    ]) {
      const button = addButton(actions, label);
      button.addEventListener("click", () => this.view.openTarget(target, label));
    }
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
    this.root = view.contentEl.createDiv({ cls: "now-board" });
    this.tasks = tasks;
  }

  render() {
    this.renderHeader();
    const openTasks = this.tasks.filter((task) => !task.done);
    const groups = [
      ["overdue", "逾期"],
      ["today", "今天"],
      ["waiting", "等待"],
      ["upcoming", "即将"],
      ["anytime", "随时"],
    ];
    const grid = this.root.createDiv({ cls: "now-board-grid" });
    for (const [bucket, label] of groups) {
      this.renderColumn(
        grid,
        label,
        openTasks.filter((task) => task.bucket === bucket),
        bucket,
      );
    }
    this.renderCompleted(openTasks);
  }

  renderHeader() {
    const header = this.root.createDiv({ cls: "now-board-header" });
    const title = header.createDiv({ cls: "now-board-title" });
    const icon = title.createDiv({ cls: "now-board-icon" });
    setIcon(icon, "check-square");
    const copy = title.createDiv();
    copy.createDiv({ cls: "now-board-heading", text: "Now 行动" });
    copy.createDiv({ cls: "now-board-subtitle", text: "以 Now/行动.md 为唯一数据源的图形看板" });

    const actions = header.createDiv({ cls: "now-board-actions" });
    const add = addButton(actions, "新增行动", "launchpad-btn is-primary");
    const refresh = addButton(actions, "刷新快照");
    const source = addButton(actions, "打开源文件");
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
    const counts = {
      overdue: openTasks.filter((task) => task.bucket === "overdue").length,
      today: openTasks.filter((task) => task.bucket === "today").length,
      waiting: openTasks.filter((task) => task.bucket === "waiting").length,
      upcoming: openTasks.filter((task) => task.bucket === "upcoming").length,
      anytime: openTasks.filter((task) => task.bucket === "anytime").length,
    };
    const stats = this.root.createDiv({ cls: "now-board-stats" });
    for (const [key, label] of [
      ["today", "今天"],
      ["overdue", "逾期"],
      ["waiting", "等待"],
      ["upcoming", "即将"],
      ["anytime", "随时"],
    ]) {
      const stat = stats.createDiv({ cls: "now-board-stat" });
      stat.createDiv({ cls: "now-board-stat-value", text: String(counts[key]) });
      stat.createDiv({ cls: "now-board-stat-label", text: label });
    }
  }

  renderColumn(parent, title, tasks, bucket) {
    const column = parent.createDiv({ cls: `now-board-column is-${bucket}` });
    const header = column.createDiv({ cls: "now-board-column-header" });
    header.createSpan({ text: title });
    header.createSpan({ cls: "now-board-count", text: String(tasks.length) });
    const list = column.createDiv({ cls: "now-board-list" });
    if (!tasks.length) {
      list.createDiv({ cls: "now-board-empty", text: "没有行动" });
      return;
    }
    for (const task of tasks) this.renderTaskCard(list, task);
  }

  renderTaskCard(parent, task) {
    const card = parent.createDiv({ cls: "now-task-card" });
    const checkbox = card.createEl("button", {
      cls: `now-task-checkbox${task.done ? " is-done" : ""}`,
      attr: { "aria-label": task.done ? "恢复行动" : "完成行动" },
    });
    setIcon(checkbox, "check");
    checkbox.addEventListener("click", async (event) => {
      event.stopPropagation();
      checkbox.disabled = true;
      try {
        await this.plugin.toggleNowTask(task.id);
      } catch (error) {
        new Notice(`Crisp Now：${error.message || error}`);
        checkbox.disabled = false;
      }
    });
    const body = card.createDiv({ cls: "now-task-body" });
    body.createDiv({ cls: "now-task-title", text: task.title });
    const meta = body.createDiv({ cls: "now-task-meta" });
    if (task.project) meta.createSpan({ cls: "launchpad-badge", text: task.project });
    if (task.due) meta.createSpan({ text: task.due });
    if (task.path !== NOW_ACTION_PATH) meta.createSpan({ text: task.path.replace(/^Now\//, "") });
    makeClickable(card, () => new NowTaskEditModal(this.app, this.plugin, this.view, task).open(), `编辑行动：${task.title}`);
  }

  renderCompleted(openTasks) {
    const completed = this.tasks.filter((task) => task.done);
    const details = this.root.createEl("details", { cls: "now-completed" });
    details.createEl("summary", {
      text: `已完成 ${completed.length} 条 · 未完成 ${openTasks.length} 条`,
    });
    const list = details.createDiv({ cls: "now-completed-list" });
    if (!completed.length) {
      list.createDiv({ cls: "now-board-empty", text: "还没有已完成行动" });
      return;
    }
    for (const task of completed) this.renderTaskCard(list, task);
  }
}

class NowTaskEditModal extends Modal {
  constructor(app, plugin, view, task) {
    super(app);
    this.plugin = plugin;
    this.view = view;
    this.task = { ...task };
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("crisp-now-edit-modal");
    this.contentEl.createEl("h2", { text: "编辑行动" });
    new Setting(this.contentEl)
      .setName("行动")
      .addText((text) =>
        text.setValue(this.task.title).onChange((value) => {
          this.task.title = value;
        }),
      );
    new Setting(this.contentEl)
      .setName("截止日期")
      .setDesc("格式 YYYY-MM-DD，留空表示没有日期。")
      .addText((text) =>
        text.setValue(this.task.due || "").onChange((value) => {
          this.task.due = value.trim();
        }),
      );
    new Setting(this.contentEl)
      .setName("项目标签")
      .addText((text) =>
        text.setValue(this.task.project || "").onChange((value) => {
          this.task.project = value.trim();
        }),
      );
    const actions = this.contentEl.createDiv({ cls: "launchpad-modal-actions" });
    const remove = addButton(actions, "删除", "launchpad-btn");
    const save = addButton(actions, "保存", "launchpad-btn is-primary");
    remove.addEventListener("click", async () => {
      try {
        remove.disabled = true;
        await this.plugin.deleteNowTask(this.task.id);
        this.close();
      } catch (error) {
        new Notice(`Crisp Now：${error.message || error}`);
        remove.disabled = false;
      }
    });
    save.addEventListener("click", async () => {
      try {
        save.disabled = true;
        await this.plugin.updateNowTask(this.task.id, this.task);
        this.close();
      } catch (error) {
        new Notice(`Crisp Now：${error.message || error}`);
        save.disabled = false;
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class CrispNowView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_NOW;
  }

  getDisplayText() {
    return "Crisp Now";
  }

  getIcon() {
    return "check-square";
  }

  async onOpen() {
    this.contentEl.addClass("crisp-now-view");
    await this.render();
  }

  async render() {
    this.contentEl.empty();
    const tasks = await this.plugin.readNowTasks();
    new NowBoardRenderer(this, tasks).render();
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
    return "layout-dashboard";
  }

  async onOpen() {
    this.contentEl.addClass("crisp-launchpad-view");
    await this.render();
  }

  async render() {
    const nonce = ++this.renderNonce;
    this.contentEl.empty();
    const root = this.contentEl.createDiv({ cls: "launchpad-wrapper" });
    const [actions, health, content, index, startHere, agents] = await Promise.all([
      this.readSnapshot("actions"),
      this.readSnapshot("health"),
      this.readSnapshot("content"),
      this.readSnapshot("index"),
      this.readText("Start Here.md"),
      this.readText("AGENTS.md"),
    ]);
    if (nonce !== this.renderNonce) return;
    new LaunchpadRenderer(
      this,
      root,
      { actions, health, content, index },
      collectPages(this.app),
      [startHere, agents],
    ).render();
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

class QuickCaptureModal extends Modal {
  constructor(app, plugin, view, initialMode = "capture") {
    super(app);
    this.plugin = plugin;
    this.view = view;
    this.initialMode = initialMode;
    this.text = "";
    this.topic = "self-media";
    this.inboxType = "scratch";
    this.due = "";
    this.project = "";
  }

  onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("crisp-launchpad-quick-modal");
    this.contentEl.createEl("h2", { text: this.initialMode === "action" ? "新建行动" : "速记" });
    this.contentEl.createDiv({
      cls: "launchpad-modal-hint",
      text: "内容先进入本地 Markdown；速记落 raw/inbox，行动落 Now/。",
    });

    new Setting(this.contentEl)
      .setName("内容")
      .setDesc("第一行会作为标题。")
      .addTextArea((text) => {
        text.inputEl.rows = 6;
        text.setPlaceholder("写下想法、链接说明或下一步行动…").onChange((value) => {
          this.text = value;
        });
      });

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

    new Setting(this.contentEl)
      .setName("截止日期")
      .setDesc("可选，格式 YYYY-MM-DD。")
      .addText((text) =>
        text.setPlaceholder("2026-09-20").onChange((value) => {
          this.due = value.trim();
        }),
      );

    new Setting(this.contentEl)
      .setName("项目标签")
      .setDesc("可选，对应 #project/名称。")
      .addText((text) =>
        text.setPlaceholder("工作台").onChange((value) => {
          this.project = value.trim();
        }),
      );

    const actions = this.contentEl.createDiv({ cls: "launchpad-modal-actions" });
    const capture = addButton(actions, "存为速记");
    const action = addButton(
      actions,
      "创建行动",
      this.initialMode === "action" ? "launchpad-btn is-primary" : "launchpad-btn is-accent",
    );
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
      } catch (error) {
        new Notice(`Crisp Launchpad：${error.message || error}`);
        action.disabled = false;
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
    recheck.disabled = this.busy;
    repair.disabled = this.busy;
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
        new Notice(`Crisp Launchpad：修复失败 · ${error.message || error}`);
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

class CrispLaunchpadSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    this.containerEl.empty();
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
      .setName("重新运行启动向导")
      .setDesc("重新检查 ANKS CLI、Now/ 和快照状态。")
      .addButton((button) =>
        button.setButtonText("运行向导").onClick(() => {
          new LaunchpadOnboardingModal(this.app, this.plugin).open();
        }),
      );
  }
}

class CrispLaunchpadPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_LAUNCHPAD, (leaf) => new CrispLaunchpadView(leaf, this));
    this.registerView(VIEW_TYPE_NOW, (leaf) => new CrispNowView(leaf, this));
    this.addRibbonIcon("layout-dashboard", "打开 Crisp Launchpad", () => this.activateView());
    this.addRibbonIcon("check-square", "打开 Crisp Now 行动看板", () => this.activateNowView());
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
      id: "refresh-crisp-launchpad-actions",
      name: "刷新 Crisp Launchpad 行动快照",
      callback: async () => {
        await this.refreshActionSnapshots();
      },
    });
    this.addCommand({
      id: "refresh-crisp-launchpad-system",
      name: "刷新 Crisp Launchpad 系统快照",
      callback: async () => {
        await this.refreshSystemSnapshots();
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
        window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => this.refreshViews(), 1200);
      }),
    );
    this.app.workspace.onLayoutReady(async () => {
      if (this.settings.openOnStartup) await this.activateView();
      if (!this.settings.hasCompletedOnboarding) {
        new LaunchpadOnboardingModal(this.app, this).open();
      }
    });
  }

  onunload() {
    window.clearTimeout(this.refreshTimer);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_LAUNCHPAD);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_NOW);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
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
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_NOW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_NOW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
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
  }

  async refreshActionSnapshots(options = {}) {
    if (!this.settings.allowSnapshotRefresh) {
      throw new Error("一键刷新已在设置中关闭");
    }
    await this.runAnks(["actions", "snapshot"]);
    if (!options.silent) new Notice("Crisp Launchpad：行动快照已刷新");
    this.refreshViews();
  }

  async refreshSystemSnapshots(options = {}) {
    if (!this.settings.allowSnapshotRefresh) {
      throw new Error("一键刷新已在设置中关闭");
    }
    await this.runAnks(["snapshot", "build"]);
    if (!options.silent) new Notice("Crisp Launchpad：系统快照已刷新");
    this.refreshViews();
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

  async createInboxCapture({ text, inboxType = "scratch", topic = "self-media" }) {
    if (!String(text ?? "").trim()) throw new Error("内容不能为空");
    const note = buildInboxNote(text, inboxType, new Date(), topic);
    await this.ensureFolder(note.folder);
    const path = await this.uniquePath(`${note.folder}/${note.filename}`);
    await this.app.vault.create(path, note.content);
    return path;
  }

  async createAction({ text, due = "", project = "", link = "" }) {
    const clean = String(text ?? "").trim();
    if (!clean) throw new Error("行动不能为空");
    const path = await this.ensureActionFile();
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("无法找到 Now/行动.md");
    const existing = await this.app.vault.read(file);
    const linkedText = link
      ? `${clean} [[${String(link).replace(/\.md$/i, "")}]]`
      : clean;
    await this.app.vault.modify(file, appendActionTask(existing, linkedText, due, project));
    return path;
  }

  async markProcessed(file) {
    if (!(file instanceof TFile)) throw new Error("原文不存在");
    const content = await this.app.vault.read(file);
    await this.app.vault.modify(file, markProcessedContent(content));
  }

  async convertInboxToTopic(file) {
    if (!(file instanceof TFile)) throw new Error("原文不存在");
    await this.runAnks([
      "topic",
      "--input",
      file.path,
      "--topic",
      inferTopicFromPath(file.path),
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

  async mutateNowTask(id, mutate) {
    const match = String(id).match(/^(.*):(\d+)$/);
    if (!match) throw new Error("行动标识无效");
    const path = match[1];
    const lineNumber = Number(match[2]);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error("行动文件不存在");
    const content = await this.app.vault.read(file);
    const lines = content.split(/\r?\n/);
    const index = lineNumber - 1;
    const current = parseNowTaskLine(lines[index] || "", path, lineNumber, new Date());
    if (!current) throw new Error("行动已被移动或删除");
    const result = mutate({ ...current });
    if (result === "delete") {
      lines.splice(index, 1);
    } else {
      const indent = (lines[index].match(/^\s*/) || [""])[0];
      lines[index] = `${indent}${taskLine(result)}`;
    }
    await this.app.vault.modify(file, lines.join("\n"));
    await this.refreshActionSnapshots({ silent: true });
  }

  async toggleNowTask(id) {
    return this.mutateNowTask(id, (task) =>
      parseNowTaskLine(
        taskLine({ ...task, done: !task.done }),
        task.path,
        task.line,
        new Date(),
      ),
    );
  }

  async updateNowTask(id, updates) {
    return this.mutateNowTask(id, (task) => ({
      ...task,
      title: String(updates.title || task.title).trim(),
      due: String(updates.due || "").trim(),
      project: String(updates.project || "").trim(),
    }));
  }

  async deleteNowTask(id) {
    return this.mutateNowTask(id, () => "delete");
  }

  listTopics() {
    const folder = this.app.vault.getAbstractFileByPath("Topics");
    if (!(folder instanceof TFolder)) return ["self-media"];
    return folder.children
      .filter((child) => child instanceof TFolder && !child.name.startsWith("."))
      .map((child) => child.name)
      .sort((left, right) => left.localeCompare(right));
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
    const vaultPath = this.app.vault.adapter.getBasePath?.();
    if (!vaultPath) {
      throw new Error("当前 Vault 不支持本地命令");
    }
    if (process.platform === "win32") {
      throw new Error("当前一键刷新仅支持 macOS / POSIX 环境");
    }
    const envPath = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      process.env.HOME ? `${process.env.HOME}/.local/bin` : "",
      process.env.PATH,
    ]
      .filter(Boolean)
      .join(":");
    await new Promise((resolve, reject) => {
      execFile(
        "sh",
        ["Sidecar/bin/anks", ...args],
        {
          cwd: vaultPath,
          timeout: 180000,
          maxBuffer: 1024 * 1024 * 8,
          env: { ...process.env, PATH: envPath },
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error((stderr || stdout || error.message || String(error)).trim()));
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
module.exports.TOTAL_HEATMAP_WEEKS = TOTAL_HEATMAP_WEEKS;
module.exports.actionItemMeta = actionItemMeta;
module.exports.buildStageBuckets = buildStageBuckets;
module.exports.collectPages = collectPages;
module.exports.appendActionTask = appendActionTask;
module.exports.buildInboxNote = buildInboxNote;
module.exports.heatLevel = heatLevel;
module.exports.inferTopicFromPath = inferTopicFromPath;
module.exports.normalizeRhythmWeeks = normalizeRhythmWeeks;
module.exports.parseHeroVersions = parseHeroVersions;
module.exports.markProcessedContent = markProcessedContent;
module.exports.normalizeProjectTag = normalizeProjectTag;
module.exports.parseNowTaskLine = parseNowTaskLine;
module.exports.parseNowTasks = parseNowTasks;
module.exports.snapshotAge = snapshotAge;
module.exports.snapshotAgeLabel = snapshotAgeLabel;
module.exports.summarizePages = summarizePages;
module.exports.taskLine = taskLine;
