const assert = require("node:assert/strict");

const DashboardLogic = require("../dashboard-logic");
const TaskLogic = require("../task-logic");
const WorkbenchDerive = require("../workbench-derive");
const DateUtils = require("../date-utils");

const sampleDashboard = `---
title: Wiki Workbench
workbenchDate: "2026-06-06"
quickActions:
  - name: "今日日记"
    icon: "calendar"
    target: "日记/2026-06-06.md"
---

## 01 今日行动

### 重点跟进
id: focus-today
type: focus
- [x] 安装 Obsidian Dataview 插件
- [ ] 扫描本周入库素材，推荐 5 个选题

### 今日完成
id: today-done
type: focus
- [x] 创建 Wiki 工作台首页

## 02 Todo 列表

### Agent 队列
id: agent-queue
type: todo
- [ ] [owner:Agent] [status:todo] 生成本周数据复盘报告
- [ ] [owner:User] [status:waiting-confirm] 审核 Agent 推荐的 5 个选题
- [x] [owner:Agent] [status:done] 拉取选题完整素材包

## 03 内容生成

### Agent 踩坑实录
id: content-agent-pitfall
type: content
status: draft-final
next: 发布后回流日记和内容复盘
- [x] Phase 0 灵感
- [x] Phase 1 素材
- [ ] Phase 2 结构

## 04 生活待办

### 健康习惯
id: health-habits
type: life
- [x] 喝水 8 杯
- [ ] 站立拉伸
`;

function flattenCards(data) {
  return data.sections.flatMap((section) => section.cards);
}

function findCard(data, id) {
  return flattenCards(data).find((card) => card.id === id);
}

function run(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

run("parseDashboard extracts quick actions, sections, cards, and tasks", () => {
  const data = DashboardLogic.parseDashboard(sampleDashboard);
  assert.equal(data.quickActions.length, 1);
  assert.equal(data.quickActions[0].name, "今日日记");
  assert.deepEqual(data.sections.map((section) => section.type), ["focus", "todo", "content", "life"]);

  const focus = findCard(data, "focus-today");
  assert.equal(focus.tasks.length, 2);
  assert.equal(focus.tasks[0].checked, true);
  assert.equal(focus.tasks[1].text, "扫描本周入库素材，推荐 5 个选题");

  const content = findCard(data, "content-agent-pitfall");
  assert.equal(content.status, "draft-final");
  assert.equal(content.next, "发布后回流日记和内容复盘");
});

run("parseDashboard preserves loose section-level tasks in an implicit card", () => {
  const data = DashboardLogic.parseDashboard(`## Todo 列表

- [ ] 修复健康检查断链

### 重点跟进
id: work-follow-up
- [ ] 正常卡片任务
`);
  const section = data.sections[0];
  assert.equal(section.cards.length, 2);
  assert.equal(section.cards[0].title, "未分组任务");
  assert.equal(section.cards[0].id, "todo-未分组任务");
  assert.equal(section.cards[0].tasks[0].text, "修复健康检查断链");
  assert.equal(section.cards[1].id, "work-follow-up");
});

run("rollover removes daily done tasks, carries open work, keeps content, and resets habits", () => {
  const data = DashboardLogic.parseDashboard(sampleDashboard);
  const rolled = DashboardLogic.rolloverDashboardForDate(sampleDashboard, data, "2026-06-07");

  assert.equal(DashboardLogic.getDashboardWorkbenchDate(rolled), "2026-06-07");
  assert(!rolled.includes("- [x] 安装 Obsidian Dataview 插件"));
  assert(!rolled.includes("- [x] 创建 Wiki 工作台首页"));
  assert(rolled.includes("- [ ] 扫描本周入库素材，推荐 5 个选题 [遗留:2026-06-06]"));
  assert(rolled.includes("- [ ] [owner:Agent] [status:todo] 生成本周数据复盘报告 [遗留:2026-06-06]"));
  assert(rolled.includes("- [x] Phase 0 灵感"));
  assert(rolled.includes("- [x] Phase 1 素材"));
  assert(rolled.includes("- [ ] 喝水 8 杯"));
});

run("task metadata supports structured and legacy Agent markers", () => {
  assert.deepEqual(TaskLogic.getTaskMeta("[owner:Agent] [status:todo] 拉取素材"), {
    owner: "Agent",
    status: "todo",
  });
  assert.deepEqual(TaskLogic.getTaskMeta("[owner:User] [status:waiting-confirm] 审核选题"), {
    owner: "User",
    status: "waiting",
  });
  assert.deepEqual(TaskLogic.getTaskMeta("[Agent] 生成复盘报告"), {
    owner: "Agent",
    status: "todo",
  });
  assert.deepEqual(TaskLogic.getTaskMeta("[等待我确认] 确认选题"), {
    owner: "User",
    status: "waiting",
  });
  assert.equal(TaskLogic.getTaskMeta("阻塞：缺少素材").status, "blocked");
});

run("cleanTaskLabel hides workbench metadata from UI labels", () => {
  assert.equal(
    TaskLogic.cleanTaskLabel("[owner:Agent] [status:waiting-confirm] 审核选题 [遗留:2026-06-06] 📅 2026-06-08"),
    "审核选题",
  );
});

run("task action helpers update metadata without duplicating tokens", () => {
  assert.equal(
    TaskLogic.continueTaskText("[owner:Agent] [status:deferred] 拉素材 [遗留:2026-06-06] 📅 2026-06-08"),
    "[owner:Agent] [status:todo] 拉素材",
  );
  assert.equal(
    TaskLogic.deferTaskText("[status:todo] 审核选题 [遗留:2026-06-06]", "2026-06-09"),
    "[status:deferred] 审核选题 [遗留:2026-06-06] 📅 2026-06-09",
  );
  assert.equal(
    TaskLogic.cancelTaskText("[status:todo] 旧任务 📅 2026-06-08"),
    "[status:canceled] 旧任务",
  );
  assert.equal(
    TaskLogic.delegateTaskText("[owner:User] [status:waiting-confirm] 拉素材"),
    "[owner:Agent] [status:todo] 拉素材",
  );
});

run("prioritizeTasks brings blocked, waiting, Agent, and carryover items forward", () => {
  const ordered = TaskLogic.prioritizeTasks([
    { checked: false, text: "普通任务" },
    { checked: true, text: "已完成任务" },
    { checked: false, text: "[owner:Agent] 生成复盘报告" },
    { checked: false, text: "[status:waiting-confirm] 审核选题" },
    { checked: false, text: "昨天未完成 [遗留:2026-06-06]" },
    { checked: false, text: "阻塞：缺少链接" },
  ]);
  assert.equal(ordered[0].text, "昨天未完成 [遗留:2026-06-06]");
  assert.equal(ordered[1].text, "阻塞：缺少链接");
  assert.equal(ordered[ordered.length - 1].text, "已完成任务");
});

run("findMatchingTask recovers from stale line indexes", () => {
  const changed = sampleDashboard.replace(
    "- [ ] 扫描本周入库素材，推荐 5 个选题",
    "- [ ] [owner:Agent] [status:todo] 扫描本周入库素材，推荐 5 个选题 [遗留:2026-06-06]",
  );
  const data = DashboardLogic.parseDashboard(changed);
  const card = findCard(data, "focus-today");
  const stale = {
    lineIndex: 999,
    checked: false,
    text: "扫描本周入库素材，推荐 5 个选题",
  };
  const matched = TaskLogic.findMatchingTask(changed, card, stale);
  assert(matched);
  assert(matched.text.includes("扫描本周入库素材"));
});

run("insertTaskLine appends new work to the target card", () => {
  const data = DashboardLogic.parseDashboard(sampleDashboard);
  const focus = findCard(data, "focus-today");
  const updated = DashboardLogic.insertTaskLine(sampleDashboard, focus, "确认今天真正要推进什么");
  const reparsed = DashboardLogic.parseDashboard(updated);
  assert(findCard(reparsed, "focus-today").tasks.some((task) => task.text === "确认今天真正要推进什么"));
});

run("insertTaskLine appends at end when card is at the bottom of the file", () => {
  const data = DashboardLogic.parseDashboard(sampleDashboard);
  const health = findCard(data, "health-habits");
  const updated = DashboardLogic.insertTaskLine(sampleDashboard, health, "冥想 10 分钟");
  const reparsed = DashboardLogic.parseDashboard(updated);
  assert(findCard(reparsed, "health-habits").tasks.some((task) => task.text === "冥想 10 分钟"));
});

run("updateTaskLine rewrites checkbox and Agent emoji task lines", () => {
  assert.deepEqual(DashboardLogic.updateTaskLine("- [ ] 拉素材", "完成素材", true), {
    line: "- [x] 完成素材",
    changed: true,
    supported: true,
  });
  assert.deepEqual(DashboardLogic.updateTaskLine("  - ✅ 08:00 笔记同步", "08:00 笔记同步", false), {
    line: "  - [ ] 08:00 笔记同步",
    changed: true,
    supported: true,
  });
  assert.deepEqual(DashboardLogic.updateTaskLine("- 普通列表", "任务", true), {
    line: "- 普通列表",
    changed: false,
    supported: false,
  });
});

run("updateTaskLineInMarkdown updates one real newline-delimited task line", () => {
  const markdown = "### 今日完成\n- ✅ 08:00 笔记同步\n- [ ] 复盘";
  const result = DashboardLogic.updateTaskLineInMarkdown(markdown, 1, "08:00 笔记同步", false);
  assert.equal(result.changed, true);
  assert.equal(result.markdown, "### 今日完成\n- [ ] 08:00 笔记同步\n- [ ] 复盘");
});

run("setDashboardWorkbenchDate inserts date into existing frontmatter", () => {
  const md = "---\ntitle: test\n---\n\n## 今日行动\n";
  const result = DashboardLogic.setDashboardWorkbenchDate(md, "2026-06-10");
  assert(result.includes('workbenchDate: "2026-06-10"'));
  assert.equal(DashboardLogic.getDashboardWorkbenchDate(result), "2026-06-10");
});

run("setDashboardWorkbenchDate updates existing date without duplicating", () => {
  const result = DashboardLogic.setDashboardWorkbenchDate(sampleDashboard, "2026-06-10");
  assert.equal(DashboardLogic.getDashboardWorkbenchDate(result), "2026-06-10");
  const occurrences = result.match(/workbenchDate:/g);
  assert.equal(occurrences.length, 1);
});

run("setDashboardWorkbenchDate creates frontmatter when missing", () => {
  const md = "## 今日行动\n\n### 任务\n- [ ] 测试\n";
  const result = DashboardLogic.setDashboardWorkbenchDate(md, "2026-06-10");
  assert(result.startsWith("---\n"));
  assert.equal(DashboardLogic.getDashboardWorkbenchDate(result), "2026-06-10");
});

run("getDailyRolloverPolicy returns correct policy per card type", () => {
  assert.equal(DashboardLogic.getDailyRolloverPolicy({ id: "today-done", title: "", type: "" }), "clear");
  assert.equal(DashboardLogic.getDailyRolloverPolicy({ id: "", title: "今日完成", type: "" }), "clear");
  assert.equal(DashboardLogic.getDailyRolloverPolicy({ id: "", title: "", type: "content" }), "keep");
  assert.equal(DashboardLogic.getDailyRolloverPolicy({ id: "health-habits", title: "", type: "life" }), "reset");
  assert.equal(DashboardLogic.getDailyRolloverPolicy({ id: "", title: "", type: "focus" }), "removeDone");
  assert.equal(DashboardLogic.getDailyRolloverPolicy({ id: "", title: "", type: "todo" }), "removeDone");
  assert.equal(DashboardLogic.getDailyRolloverPolicy({ id: "", title: "", type: "life" }), "removeDone");
  assert.equal(DashboardLogic.getDailyRolloverPolicy({ id: "", title: "", type: "unknown" }), "keep");
});

run("shouldMarkCarryover only marks uncompleted tasks in removeDone cards without existing carryover", () => {
  const removeDoneCard = { id: "", title: "", type: "todo" };
  assert.equal(DashboardLogic.shouldMarkCarryover(removeDoneCard, { checked: false, text: "未完成任务" }), true);
  assert.equal(DashboardLogic.shouldMarkCarryover(removeDoneCard, { checked: true, text: "已完成任务" }), false);
  assert.equal(DashboardLogic.shouldMarkCarryover(removeDoneCard, { checked: false, text: "已有标记 [遗留:2026-06-01]" }), false);

  const keepCard = { id: "", title: "", type: "content" };
  assert.equal(DashboardLogic.shouldMarkCarryover(keepCard, { checked: false, text: "内容任务" }), false);
});

run("markTaskCarryover appends [遗留:date] without double-marking", () => {
  assert.equal(
    DashboardLogic.markTaskCarryover("- [ ] 未完成任务", "2026-06-06"),
    "- [ ] 未完成任务 [遗留:2026-06-06]",
  );
  assert.equal(
    DashboardLogic.markTaskCarryover("- [ ] 已标记 [遗留:2026-06-01]", "2026-06-06"),
    "- [ ] 已标记 [遗留:2026-06-01]",
  );
  assert.equal(DashboardLogic.markTaskCarryover("", "2026-06-06"), "");
  assert.equal(DashboardLogic.markTaskCarryover("- [ ] 任务", ""), "- [ ] 任务");
});

run("rollover resets emoji-completed life habits to unchecked checkbox tasks", () => {
  const markdown = `---
workbenchDate: "2026-06-06"
---

## 生活待办

### 健康习惯
id: health-habits
type: life
- ✅ 喝水 800ml
`;
  const data = DashboardLogic.parseDashboard(markdown);
  const rolled = DashboardLogic.rolloverDashboardForDate(markdown, data, "2026-06-07");
  assert(rolled.includes("- [ ] 喝水 800ml"));
  assert(!rolled.includes("- ✅ 喝水 800ml"));
});

run("inferSectionType classifies section titles correctly", () => {
  assert.equal(DashboardLogic.inferSectionType("今日行动"), "focus");
  assert.equal(DashboardLogic.inferSectionType("今日任务"), "focus");
  assert.equal(DashboardLogic.inferSectionType("01 Todo 列表"), "todo");
  assert.equal(DashboardLogic.inferSectionType("待办事项"), "todo");
  assert.equal(DashboardLogic.inferSectionType("内容生成"), "content");
  assert.equal(DashboardLogic.inferSectionType("进度追踪"), "content");
  assert.equal(DashboardLogic.inferSectionType("生活待办"), "life");
  assert.equal(DashboardLogic.inferSectionType("健康"), "life");
  assert.equal(DashboardLogic.inferSectionType("随机标题"), "todo");
});

run("stripYamlValue removes surrounding quotes", () => {
  assert.equal(DashboardLogic.stripYamlValue('"hello world"'), "hello world");
  assert.equal(DashboardLogic.stripYamlValue("'single quotes'"), "single quotes");
  assert.equal(DashboardLogic.stripYamlValue("no quotes"), "no quotes");
  assert.equal(DashboardLogic.stripYamlValue(""), "");
  assert.equal(DashboardLogic.stripYamlValue(null), "");
});

run("cleanTitle strips leading non-letter/non-number characters", () => {
  assert.equal(DashboardLogic.cleanTitle("01 今日行动"), "01 今日行动");
  assert.equal(DashboardLogic.cleanTitle("## 02 Todo"), "02 Todo");
  assert.equal(DashboardLogic.cleanTitle("✍️ 内容创作"), "内容创作");
  assert.equal(DashboardLogic.cleanTitle("普通标题"), "普通标题");
  assert.equal(DashboardLogic.cleanTitle(""), "");
});

run("slugify produces safe lowercase slugs", () => {
  assert.equal(DashboardLogic.slugify("Todo 列表"), "todo-列表");
  assert.equal(DashboardLogic.slugify("Agent 踩坑实录"), "agent-踩坑实录");
  assert.equal(DashboardLogic.slugify(""), "card");
  assert.equal(DashboardLogic.slugify(null), "card");
  assert(DashboardLogic.slugify("a".repeat(100)).length <= 40);
});

run("derive stats separates all work from today's operational work", () => {
  const data = DashboardLogic.parseDashboard(sampleDashboard);
  assert.deepEqual(WorkbenchDerive.collectStats(data), {
    total: 11,
    done: 6,
    open: 5,
    agent: 1,
    waiting: 1,
    blocked: 0,
    carryover: 0,
  });
  assert.deepEqual(WorkbenchDerive.collectTodayStats(data), {
    total: 8,
    done: 4,
    open: 4,
    agent: 1,
    waiting: 1,
    blocked: 0,
    carryover: 0,
  });
  assert.deepEqual(WorkbenchDerive.collectCardStats(findCard(data, "agent-queue")), {
    total: 3,
    done: 1,
    open: 2,
    agent: 1,
    waiting: 1,
    blocked: 0,
    carryover: 0,
  });
});

run("derive helpers classify cards, visible tasks, pipeline, channels, and badges", () => {
  const data = DashboardLogic.parseDashboard(sampleDashboard);
  const focus = findCard(data, "focus-today");
  const content = findCard(data, "content-agent-pitfall");

  assert.equal(WorkbenchDerive.findMatchingCard(data, { id: "focus-today" }), focus);
  assert.equal(WorkbenchDerive.findMatchingCard(data, { title: "重点跟进", type: "focus" }), focus);
  assert.equal(WorkbenchDerive.getPrimaryCard(data.sections[0], "focus"), focus);
  assert.equal(WorkbenchDerive.pickContentCard(data.sections[2]), content);
  assert.equal(WorkbenchDerive.shouldRenderWorkbenchCard(findCard(data, "today-done")), false);

  const firstOpen = WorkbenchDerive.findFirstVisibleTask(data, (task) => !task.checked);
  assert.equal(firstOpen.card.id, "focus-today");
  assert.equal(firstOpen.task.text, "扫描本周入库素材，推荐 5 个选题");

  const pipeline = WorkbenchDerive.buildPipelineState({ ...content, status: "draft" });
  assert.equal(pipeline.steps.length, 7);
  assert.equal(pipeline.steps.find((step) => step.key === "draft").active, true);

  const channels = WorkbenchDerive.getChannelChips({
    title: "发布派生",
    next: "newsletter + social thread",
    tasks: [],
  }).map((chip) => chip.key);
  assert.deepEqual(channels, ["longform", "social"]);

  assert.equal(WorkbenchDerive.getTodoCardKind({ title: "Agent 队列", tasks: [{ text: "[owner:Agent] 拉素材" }] }).key, "agent");
  assert.equal(WorkbenchDerive.getTaskBadge({ checked: false, text: "审核选题 [status:waiting-confirm]" }).label, "等确认");
  assert.equal(WorkbenchDerive.getTaskBadge({ checked: false, text: "昨天未完成 [遗留:2026-06-06]" }).label, "续 06-06");
});

run("derive health helpers summarize issue and relation graph state", () => {
  const health = {
    generatedAt: "2026-06-07T00:00:00.000Z",
    summary: { files: 3884, markdown_files: 1447, warning: 1, error: 0 },
    issues: [
      { level: "info", check: "low_wikilinks" },
      { level: "warning", check: "relation_links_sparse", path: "Knowledge graph" },
      { level: "error", check: "broken_link", path: "Wiki/a.md" },
    ],
    relations: { links: "6", pages: "4027" },
  };

  assert.equal(WorkbenchDerive.getHealthSummary(health).files, 3884);
  assert.equal(WorkbenchDerive.getHealthIssueCount(health, "warning"), 1);
  assert.deepEqual(WorkbenchDerive.getHealthIssues(health).map((issue) => issue.check), ["broken_link", "relation_links_sparse"]);
  assert.deepEqual(WorkbenchDerive.getRelationGraphHealth(health), {
    label: "6 / 4027",
    state: "warn",
    hint: "知识关系层偏稀",
  });
  assert.equal(WorkbenchDerive.parseHealthNumber("4,027 pages"), 4027);
  assert.equal(WorkbenchDerive.isHealthCacheStale(health, 12, Date.parse("2026-06-07T06:00:00.000Z")), false);
  assert.equal(WorkbenchDerive.isHealthCacheStale(health, 4, Date.parse("2026-06-07T06:00:00.000Z")), true);
});

run("formatAgentQueueMarkdown exports agent collaboration protocol", () => {
  const data = DashboardLogic.parseDashboard(`---
dashboard: true
---

## Todo 列表

### Agent 队列
id: agent
type: task
- [ ] [owner:Agent] [status:todo] Summarize source notes
- [ ] [owner:User] [status:waiting-confirm] Review [[Wiki/output]]
- [ ] [owner:Agent] [status:blocked] Draft blocked by missing links
- [x] [owner:Agent] [status:done] Indexed weekly notes
`);

  const exported = WorkbenchDerive.formatAgentQueueMarkdown(data, {
    dashboardFile: "dashboard.md",
    generatedAt: "2026-06-07T00:00:00.000Z",
  });
  assert(exported.includes("## Ready For Agent"));
  assert(exported.includes("[owner:Agent] [status:todo] Summarize source notes"));
  assert(exported.includes("## Waiting For Human"));
  assert(exported.includes("[owner:User] [status:waiting-confirm] Review [[Wiki/output]]"));
  assert(exported.includes("## Blocked"));
  assert(exported.includes("line 10"));
});

run("derive vault activity summarizes configured workspaces and recent deposits", () => {
  const now = Date.parse("2026-06-07T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  const files = [
    { path: "Inbox/clips/a.md", basename: "a", extension: "md", stat: { mtime: now - day } },
    { path: "Inbox/clips/b.md", basename: "b", extension: "md", stat: { mtime: now - 10 * day } },
    { path: "Wiki/Research/a.md", basename: "research", extension: "md", stat: { mtime: now - 2 * day } },
    { path: "Content/Drafts/post.md", basename: "post", extension: "md", stat: { mtime: now - 40 * day } },
    { path: "Journal/2026-06-07.md", basename: "2026-06-07", extension: "md", stat: { mtime: now } },
    { path: ".obsidian/plugins/demo.md", basename: "demo", extension: "md", stat: { mtime: now } },
    { path: "random.md", basename: "random", extension: "md", stat: { mtime: now } },
  ];

  const activity = WorkbenchDerive.collectVaultActivity(files, { now, days: 7 });
  assert.equal(activity.summary.files, 5);
  assert.equal(activity.summary.vaultFiles, 6);
  assert.equal(activity.byKey.inbox.files, 2);
  assert.equal(activity.byKey.inbox.week, 1);
  assert.equal(activity.byKey.knowledge.files, 1);
  assert.equal(activity.byKey.content.state, "cold");
  assert.equal(activity.summary.busiestWorkspace.key, "inbox");
  assert.equal(activity.recentFiles[0].path, "Journal/2026-06-07.md");
  assert.equal(activity.heatmap.cells.length, 7);
  assert.equal(activity.heatmap.columns, 1);
  assert.equal(activity.heatmap.total, 3);
  assert(activity.heatmap.cells.some((cell) => cell.date === "2026-06-07" && cell.count > 0));
  assert.equal(WorkbenchDerive.getActivityWorkspaceForPath("Wiki/Projects/index.md").key, "projects");
  assert.equal(WorkbenchDerive.getActivityWorkspaceForPath("Projects/client-a.md").key, "projects");
});

run("parseDailyDigest extracts daily completion, plans, Agent, and AI summary", () => {
  const digest = WorkbenchDerive.parseDailyDigest(`---
title: "2026-06-07"
---
# 2026-06-07 日记

## 今日完成

- [x] 发布 Agent 踩坑实录
- [x] [[Content/Drafts/post|草稿]] 回流

## 明日计划

- [ ] 复盘渠道数据

## Agent 复盘

- Agent 已拉取素材包

## 🤖 AI 今日摘要

### 今日输出
- 工作台活跃镜头完成
`);

  assert.equal(digest.missing, false);
  assert.equal(digest.isEmpty, false);
  assert.deepEqual(digest.sections.find((section) => section.key === "completed").items, [
    "发布 Agent 踩坑实录",
    "[[Content/Drafts/post|草稿]] 回流",
  ]);
  assert.deepEqual(digest.sections.find((section) => section.key === "tomorrow").items, ["复盘渠道数据"]);
  assert.deepEqual(digest.sections.find((section) => section.key === "agent").items, ["Agent 已拉取素材包"]);
  assert.deepEqual(digest.sections.find((section) => section.key === "ai").items, ["今日输出", "工作台活跃镜头完成"]);
});

run("formatDate pads month and day to two digits", () => {
  assert.equal(DateUtils.formatDate(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(DateUtils.formatDate(new Date(2026, 11, 31)), "2026-12-31");
});

run("formatTime pads hours and minutes to two digits", () => {
  assert.equal(DateUtils.formatTime(new Date(2026, 0, 1, 9, 5)), "09:05");
  assert.equal(DateUtils.formatTime(new Date(2026, 0, 1, 23, 59)), "23:59");
});

run("formatMonth produces YYYY-MM", () => {
  assert.equal(DateUtils.formatMonth(new Date(2026, 0, 15)), "2026-01");
  assert.equal(DateUtils.formatMonth(new Date(2026, 9, 1)), "2026-10");
});

run("formatChineseDate produces readable Chinese date", () => {
  assert.equal(DateUtils.formatChineseDate(new Date(2026, 5, 7)), "2026年6月7日");
});

run("getChineseWeekday returns correct weekday", () => {
  assert.equal(DateUtils.getChineseWeekday(new Date(2026, 5, 7)), "星期日");
  assert.equal(DateUtils.getChineseWeekday(new Date(2026, 5, 8)), "星期一");
  assert.equal(DateUtils.getChineseWeekday(new Date(2026, 5, 13)), "星期六");
});

run("getISOWeekString handles year boundaries correctly", () => {
  assert.equal(DateUtils.getISOWeekString(new Date(2026, 0, 1)), "2026-W01");
  assert.equal(DateUtils.getISOWeekString(new Date(2025, 11, 29)), "2026-W01");
  assert.equal(DateUtils.getISOWeekString(new Date(2026, 5, 7)), "2026-W23");
});

run("sameDay compares dates by calendar day", () => {
  const a = new Date(2026, 5, 7, 0, 0);
  const b = new Date(2026, 5, 7, 23, 59);
  const c = new Date(2026, 5, 8, 0, 0);
  assert.equal(DateUtils.sameDay(a, b), true);
  assert.equal(DateUtils.sameDay(a, c), false);
});

run("focus section exposes both focus-today and today-done cards for the renderer", () => {
  const data = DashboardLogic.parseDashboard(sampleDashboard);
  const focusSection = data.sections.find((section) => section.type === "focus");
  assert.ok(focusSection, "focus section should be inferred from 今日行动 heading");
  const ids = focusSection.cards.map((card) => card.id);
  assert.ok(ids.includes("focus-today"), "focus-today card must be present");
  assert.ok(ids.includes("today-done"), "today-done card must be present so renderFocusModule can show recent completions");
});

run("renderFocusModule picks focus-today for open work and today-done for completed", () => {
  const data = DashboardLogic.parseDashboard(sampleDashboard);
  const focusSection = data.sections.find((section) => section.type === "focus");
  const focusCard = focusSection.cards.find((card) => card.id === "focus-today");
  const doneCard = focusSection.cards.find((card) => card.id === "today-done");
  const focusOpen = WorkbenchDerive.getOpenTasks(focusCard);
  const focusCompleted = focusCard.tasks.filter((task) => task.checked);
  const doneCompleted = doneCard.tasks.filter((task) => task.checked);
  // focus-today 应该至少能挑出未完成项作为"今日三件事"
  assert.equal(focusOpen.length, 1, "focus-today has 1 open task — the three things candidate");
  assert.equal(focusCompleted.length, 1, "focus-today has 1 already-completed task");
  // today-done 应该只承载已完成的任务作为"今日已完成"
  assert.equal(doneCompleted.length, 1, "today-done has 1 completed task to surface in recent list");
});

run("Agent-style emoji tasks (- ✅ / - ☑ / - ✔) are parsed as completed tasks", () => {
  const markdown = `---
workbenchDate: "2026-06-17"
---

## 今日行动

### 今日完成
id: today-done
- ✅ 11:00 Cron Job大清理
- ☑ 知识库批量处理
- ✔ 18:00 6月1-7日日记补写
`;
  const data = DashboardLogic.parseDashboard(markdown);
  const doneCard = data.sections[0].cards[0];
  assert.equal(doneCard.id, "today-done");
  assert.equal(doneCard.tasks.length, 3, "all 3 emoji-prefixed tasks should be parsed as tasks, not body");
  assert.ok(doneCard.tasks.every((task) => task.checked), "all emoji tasks should be marked completed");
  assert.equal(doneCard.tasks[0].text, "11:00 Cron Job大清理");
  assert.equal(doneCard.tasks[2].text, "18:00 6月1-7日日记补写");
});
