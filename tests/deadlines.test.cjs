// 行动面板「临近截止」（0.10.0）。失败模式：
// - 夏令时切换那天差出一天，或跨月、跨年算错天数；
// - 已完成、无截止、截止日格式不对的行动混进列表；
// - 逾期和今天截止的重复出现（它们已在「今天要做」里）；
// - 窗口外的行动混进来，或排序不是按剩余天数；
// - 上面「今天要做」已列出的行动在「临近截止」里再出现一次；
// - 工作台的行动行只显示日期，看不出还剩几天、逾期几天；
// - 逾期的和快到期的用同一种颜色，或已完成的行动还在倒计时。
const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");

if (typeof window === "undefined") global.window = global;
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "obsidian") {
    class Base {}
    return { Plugin: Base, ItemView: Base, PluginSettingTab: Base, Setting: Base, Notice: Base, Modal: Base, TFile: Base, TFolder: Base, Platform: { isMobile: false }, setIcon() {}, addIcon() {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const api = require("../main.js");
Module._load = originalLoad;

test("daysBetweenKeys counts calendar days across month, year and DST boundaries", () => {
  assert.equal(api.daysBetweenKeys("2026-11-11", "2026-11-11"), 0);
  assert.equal(api.daysBetweenKeys("2026-11-11", "2026-11-09"), -2);
  assert.equal(api.daysBetweenKeys("2026-11-30", "2026-12-01"), 1);
  assert.equal(api.daysBetweenKeys("2026-12-31", "2027-01-01"), 1);
  assert.equal(api.daysBetweenKeys("2026-03-07", "2026-03-09"), 2);
  assert.equal(api.daysBetweenKeys("2026-10-31", "2026-11-02"), 2);
});

test("countdown labels", () => {
  assert.equal(api.dueCountdownLabel(-2), "逾期 2 天");
  assert.equal(api.dueCountdownLabel(0), "今天截止");
  assert.equal(api.dueCountdownLabel(1), "明天截止");
  assert.equal(api.dueCountdownLabel(6), "还剩 6 天");
});

test("upcomingDeadlines keeps open tasks due in the next 7 days, nearest first", () => {
  const T = "2026-11-11";
  const task = (title, due, extra = {}) => ({ title, due, done: false, ...extra });
  const rows = api.upcomingDeadlines([
    task("逾期", "2026-11-10"),
    task("今天", "2026-11-11"),
    task("第七天", "2026-11-18"),
    task("第八天", "2026-11-19"),
    task("明天", "2026-11-12"),
    task("已完成", "2026-11-13", { done: true }),
    task("没截止", ""),
    task("格式坏", "11/13"),
    task("等待中", "2026-11-14", { waiting: true }),
  ], T);
  assert.deepEqual(rows.map((r) => [r.task.title, r.days]), [["明天", 1], ["等待中", 3], ["第七天", 7]]);
  assert.equal(api.DEADLINE_WINDOW_DAYS, 7);
  assert.deepEqual(api.upcomingDeadlines(null, T), []);
});

test("upcomingDeadlines skips actions already listed above", () => {
  const T = "2026-11-11";
  const tasks = [
    { id: "tempo:a", title: "今天做、明天交", due: "2026-11-12", done: false },
    { id: "tempo:b", title: "后天交", due: "2026-11-13", done: false },
  ];
  const rows = api.upcomingDeadlines(tasks, T, api.DEADLINE_WINDOW_DAYS, new Set(["tempo:a"]));
  assert.deepEqual(rows.map((r) => r.task.title), ["后天交"]);
});

test("workbench rows count down open actions and keep the plain date for done ones", () => {
  const T = "2026-11-11";
  assert.equal(api.actionItemMeta({ bucket: "overdue", due: "2026-11-09" }, T), "逾期 2 天");
  assert.equal(api.actionItemMeta({ bucket: "today", due: "2026-11-11" }, T), "今天截止");
  assert.equal(api.actionItemMeta({ bucket: "upcoming", due: "2026-11-12" }, T), "明天截止");
  assert.equal(api.actionItemMeta({ bucket: "upcoming", due: "2026-12-01" }, T), "还剩 20 天");
  assert.equal(api.actionItemMeta({ bucket: "done", done: true, due: "2026-11-09" }, T), "11-09");
  assert.equal(api.actionItemMeta({ bucket: "waiting", due: "" }, T), "等待");
  assert.equal(api.actionItemMeta({ bucket: "anytime" }, T), "随时");
});

test("due tone: overdue is its own tone, today to 3 days is soon, later is plain", () => {
  assert.equal(api.dueTone(-1), "is-overdue");
  assert.equal(api.dueTone(0), "is-soon");
  assert.equal(api.dueTone(3), "is-soon");
  assert.equal(api.dueTone(4), "");
  assert.equal(api.dueDaysLeft({ due: "2026-11-13", done: false }, "2026-11-11"), 2);
  assert.equal(api.dueDaysLeft({ due: "2026-11-13", done: true }, "2026-11-11"), null);
  assert.equal(api.dueDaysLeft({ due: "" }, "2026-11-11"), null);
});
