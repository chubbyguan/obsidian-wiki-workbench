const TaskLogic = require("./task-logic");
const { formatDate, formatTime } = require("./date-utils");

const DEFAULT_GBRAIN_LINK_DENSITY_WARN = 0.01;
const DEFAULT_HEALTH_CACHE_MAX_AGE_HOURS = 12;
const DEFAULT_ACTIVITY_DAYS = 91;

const DEFAULT_ACTIVITY_WORKSPACES = [
  { key: "source", label: "素材库", path: "素材库", role: "原始输入", color: "#d6a646" },
  { key: "external", label: "外部输入", paths: ["wiki/📡 外部输入", "📡 外部输入"], role: "A+B 提炼", color: "#6690cc" },
  { key: "research", label: "行业研究", paths: ["wiki/📖 行业研究"], role: "行业判断", color: "#4f9a8a" },
  { key: "graph", label: "知识图谱", paths: ["wiki/🧬 知识图谱"], role: "概念关系", color: "#7f79d8" },
  { key: "creation", label: "内容创作", paths: ["wiki/✍️ 内容创作"], role: "选题流程", color: "#d18b44" },
  { key: "project", label: "项目", paths: ["wiki/项目"], role: "项目状态", color: "#c96d78" },
  { key: "agent", label: "Agent 记忆", paths: ["wiki/🧠 AI系统", "wiki/agent-memory"], role: "协作记忆", color: "#7464d8" },
  { key: "output", label: "产出", path: "产出", role: "草稿发布", color: "#9b7ad6" },
  { key: "daily", label: "日记", path: "日记", role: "每日回流", color: "#5da86f" },
  { key: "plan", label: "规划", path: "规划", role: "计划节奏", color: "#cc8a56" },
  { key: "account", label: "账号", path: "账号", role: "账号运营", color: "#5d8da8" },
  { key: "wiki", label: "wiki 其他", path: "wiki", role: "结构化知识", color: "#8a98aa" },
];

const PIPELINE_STEPS = [
  { key: "seed", label: "选题", patterns: ["Phase 0", "灵感", "选题"] },
  { key: "research", label: "调研", patterns: ["Phase 0.5", "调研"] },
  { key: "material_pack", label: "素材包", patterns: ["Phase 1", "素材"] },
  { key: "draft", label: "草稿", patterns: ["Phase 2", "结构", "Phase 3", "写作", "草稿"] },
  { key: "edit", label: "定稿", patterns: ["定稿", "终稿", "审稿"] },
  { key: "publish", label: "发布", patterns: ["Phase 4", "发布", "分发", "派生"] },
  { key: "archived", label: "回流", patterns: ["Phase 5", "回流", "闭环", "复盘"] },
];

function createEmptyStats() {
  return { total: 0, done: 0, open: 0, agent: 0, waiting: 0, blocked: 0, carryover: 0 };
}

function addStats(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += source[key] || 0;
  }
  return target;
}

function createCardSnapshot(card) {
  return {
    id: card && card.id,
    title: card && card.title,
    type: card && card.type,
    lineIndex: card && card.lineIndex,
  };
}

function createTaskSnapshot(card, task) {
  return {
    card: createCardSnapshot(card),
    lineIndex: task && task.lineIndex,
    checked: Boolean(task && task.checked),
    text: task && task.text,
  };
}

function findMatchingCard(data, cardLike) {
  if (!data || !cardLike || !Array.isArray(data.sections)) return null;
  const cards = data.sections.flatMap((section) => section.cards || []);
  if (cardLike.id) {
    const byId = cards.find((card) => card.id === cardLike.id);
    if (byId) return byId;
  }
  if (cardLike.title && cardLike.type) {
    const byTypeAndTitle = cards.find((card) => card.type === cardLike.type && card.title === cardLike.title);
    if (byTypeAndTitle) return byTypeAndTitle;
  }
  if (typeof cardLike.lineIndex === "number") {
    const byLine = cards.find((card) => card.lineIndex === cardLike.lineIndex);
    if (byLine) return byLine;
  }
  return cardLike.title ? cards.find((card) => card.title === cardLike.title) || null : null;
}

function shouldRenderWorkbenchCard(card) {
  if (!card) return false;
  if (isCompletedContentCard(card)) return false;
  if (isCompletedOperationalCard(card)) return false;
  if (card.tasks.length > 0 || card.body.length > 0) return true;
  return !["today-done", "kb-governance"].includes(card.id || "");
}

function shouldShowTodoOverviewCard(card) {
  return Boolean(card && getOpenTasks(card).length > 0);
}

function isCompletedContentCard(card) {
  return Boolean(
    card
    && card.type === "content"
    && card.tasks.length > 0
    && card.tasks.every((task) => task.checked)
  );
}

function isCompletedOperationalCard(card) {
  return Boolean(
    card
    && card.type !== "content"
    && card.tasks.length > 0
    && card.tasks.every((task) => task.checked)
  );
}

function findFirstVisibleTask(data, predicate, options = {}) {
  if (!data || !Array.isArray(data.sections)) return null;
  for (const section of data.sections) {
    if (section.type === "content") continue;
    for (const card of section.cards) {
      if (!options.includeCompletedCards && !shouldRenderWorkbenchCard(card)) continue;
      const task = TaskLogic.prioritizeTasks(card.tasks).find(predicate);
      if (task) return { section, card, task };
    }
  }
  return null;
}

function collectStats(data) {
  const stats = createEmptyStats();
  if (!data || !Array.isArray(data.sections)) return stats;
  for (const section of data.sections) {
    addStats(stats, collectSectionStats(section));
  }
  return stats;
}

function collectTodayStats(data) {
  const stats = createEmptyStats();
  if (!data || !Array.isArray(data.sections)) return stats;
  for (const section of data.sections) {
    if (section.type === "content") continue;
    for (const card of section.cards) {
      addStats(stats, collectCardStats(card));
    }
  }
  return stats;
}

function collectAgentTaskGroups(data) {
  const groups = { agent: [], waiting: [], blocked: [], done: [] };
  if (!data || !Array.isArray(data.sections)) return groups;

  for (const section of data.sections) {
    for (const card of section.cards) {
      for (const task of card.tasks) {
        const meta = TaskLogic.getTaskMeta(task);
        const isAgent = meta.owner === "Agent";
        const isWaiting = meta.status === "waiting";
        const isBlocked = meta.status === "blocked";
        if (!isAgent && !isWaiting && !isBlocked) continue;

        const item = {
          section,
          card,
          task,
          label: isBlocked ? "阻塞" : isWaiting ? "等确认" : "待执行",
        };

        if (task.checked) {
          groups.done.push({ ...item, label: "完成" });
          continue;
        }
        if (isBlocked) groups.blocked.push(item);
        if (isWaiting) groups.waiting.push(item);
        if (isAgent) groups.agent.push(item);
      }
    }
  }

  const byPosition = (a, b) => a.task.lineIndex - b.task.lineIndex;
  groups.agent.sort(byPosition);
  groups.waiting.sort(byPosition);
  groups.blocked.sort(byPosition);
  groups.done.sort((a, b) => b.task.lineIndex - a.task.lineIndex);
  return groups;
}

function collectSectionStats(section) {
  const stats = createEmptyStats();
  if (!section || !Array.isArray(section.cards)) return stats;
  for (const card of section.cards) {
    addStats(stats, collectCardStats(card));
  }
  return stats;
}

function collectVisibleSectionStats(section) {
  const stats = createEmptyStats();
  if (!section || !Array.isArray(section.cards)) return stats;
  for (const card of section.cards.filter(shouldRenderWorkbenchCard)) {
    addStats(stats, collectCardStats(card));
  }
  return stats;
}

function collectCardStats(card) {
  const tasks = card && Array.isArray(card.tasks) ? card.tasks : [];
  const total = tasks.length;
  const done = tasks.filter((task) => task.checked).length;
  const openTasks = getOpenTasks(card);
  let agent = 0;
  let waiting = 0;
  let blocked = 0;
  let carryover = 0;
  for (const task of openTasks) {
    const meta = TaskLogic.getTaskMeta(task);
    if (meta.owner === "Agent") agent++;
    if (meta.status === "waiting") waiting++;
    if (meta.status === "blocked") blocked++;
    if (TaskLogic.getCarryoverDate(task)) carryover++;
  }
  return { total, done, open: total - done, agent, waiting, blocked, carryover };
}

function getOpenTasks(card) {
  return card && Array.isArray(card.tasks) ? card.tasks.filter((task) => !task.checked) : [];
}

function getPrimaryCard(section, sectionType) {
  if (!section || section.cards.length === 0) return null;
  if (sectionType === "focus") {
    return section.cards.find((card) => card.id === "focus-today") || section.cards[0];
  }
  if (sectionType === "life") {
    return section.cards.find((card) => card.id === "health-habits") || section.cards[0];
  }
  return section.cards[0];
}

function pickContentCard(section) {
  if (!section || section.cards.length === 0) return null;
  const candidates = section.cards.filter((card) => collectCardStats(card).open > 0);
  if (candidates.length === 0) return section.cards[0];
  candidates.sort((a, b) => {
    const aStats = collectCardStats(a);
    const bStats = collectCardStats(b);
    const aRatio = aStats.total ? aStats.done / aStats.total : 0;
    const bRatio = bStats.total ? bStats.done / bStats.total : 0;
    if (aRatio !== bRatio) return bRatio - aRatio;
    if (a.title.includes("Agent") !== b.title.includes("Agent")) return a.title.includes("Agent") ? -1 : 1;
    return a.lineIndex - b.lineIndex;
  });
  return candidates[0];
}

function buildPipelineState(card, pipelineSteps = PIPELINE_STEPS) {
  if (!card) {
    return { steps: pipelineSteps.map((step, index) => ({ ...step, done: false, active: index === 0 })) };
  }
  const steps = pipelineSteps.map((step) => {
    const matched = card.tasks.filter((task) => step.patterns.some((pattern) => task.text.includes(pattern)));
    const done = matched.length > 0 && matched.every((task) => task.checked);
    return { ...step, done };
  });
  let activeIndex = steps.findIndex((step) => !step.done);
  if (activeIndex === -1) activeIndex = steps.length - 1;

  const statusIndex = pipelineSteps.findIndex((step) => step.key === card.status);
  if (statusIndex >= 0) activeIndex = statusIndex;

  return {
    steps: steps.map((step, index) => ({
      ...step,
      active: index === activeIndex,
      done: index < activeIndex ? true : step.done,
    })),
  };
}

function getChannelChips(card) {
  if (!card) return [];
  const text = [...card.tasks.map((task) => task.text), card.title, card.next || ""].join(" ");
  const channels = [
    { key: "wechat", label: "公众号", patterns: ["公众号", "长文"] },
    { key: "jike", label: "即刻", patterns: ["即刻"] },
    { key: "x", label: "X Thread", patterns: ["X ", "Twitter", "Thread"] },
    { key: "xiaohongshu", label: "小红书", patterns: ["小红书"] },
  ];
  return channels.filter((channel) => channel.patterns.some((pattern) => text.includes(pattern)));
}

function getTodoCardKind(card) {
  const title = card && card.title ? card.title : "";
  const text = card ? [title, ...card.tasks.map((task) => task.text)].join(" ") : "";
  const metas = card ? card.tasks.map(TaskLogic.getTaskMeta) : [];
  if (title.includes("等待") || text.includes("[等待我确认]") || metas.some((meta) => meta.status === "waiting")) {
    return { key: "waiting", label: "等你确认", color: "#c96d78" };
  }
  if (title.includes("治理") || text.includes("GBrain") || text.includes("健康检查")) {
    return { key: "governance", label: "治理", color: "#d6a646" };
  }
  if (title.includes("Agent") || text.includes("[Agent]") || metas.some((meta) => meta.owner === "Agent")) {
    return { key: "agent", label: "Agent 队列", color: "#7464d8" };
  }
  return { key: "follow", label: "重点跟进", color: "#6690cc" };
}

function getTaskBadge(task) {
  if (task.checked) return { label: "完成", cls: "cw-mini-badge-green" };
  const carryoverDate = TaskLogic.getCarryoverDate(task);
  if (carryoverDate) return { label: `续 ${carryoverDate.slice(5)}`, cls: "cw-mini-badge-carry" };
  const meta = TaskLogic.getTaskMeta(task);
  if (meta.status === "waiting") return { label: "等确认", cls: "cw-mini-badge-rose" };
  if (meta.owner === "Agent") return { label: "Agent", cls: "cw-mini-badge-violet" };
  if (task.text.includes("今天") || task.text.includes("发布")) return { label: "今天", cls: "cw-mini-badge-rose" };
  const due = task.text.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
  if (due) return { label: due[1].slice(5), cls: "cw-mini-badge-amber" };
  return { label: "待办", cls: "cw-mini-badge-blue" };
}

function getHealthSummary(health) {
  if (!health || health.missing || health.error || !health.summary) return null;
  return health.summary;
}

function getHealthIssues(health, level = "") {
  if (!health || !Array.isArray(health.issues)) return [];
  const issues = level ? health.issues.filter((issue) => issue.level === level) : health.issues;
  return issues
    .filter((issue) => issue.level === "error" || issue.level === "warning")
    .sort((a, b) => {
      const score = (issue) => (issue.level === "error" ? 0 : 1);
      return score(a) - score(b);
    });
}

function getHealthIssueCount(health, level) {
  const summary = getHealthSummary(health);
  if (summary && summary[level] !== undefined) return Number(summary[level]) || 0;
  return getHealthIssues(health, level).length;
}

function getHealthGbrainLinks(health) {
  if (!health || !health.gbrain || health.gbrain.Links === undefined) return "未读取";
  return String(health.gbrain.Links);
}

function getGbrainRelationHealth(health, densityWarn = DEFAULT_GBRAIN_LINK_DENSITY_WARN) {
  if (!health || !health.gbrain) {
    return { label: "未读取", state: "warn", hint: "GBrain 未读取" };
  }
  const links = parseHealthNumber(health.gbrain.Links);
  const pages = parseHealthNumber(health.gbrain.Pages);
  if (links === null) {
    return { label: "未读取", state: "warn", hint: "GBrain Links 未读取" };
  }
  if (links === 0) {
    return { label: "0", state: "warn", hint: "GBrain 关系层未闭环" };
  }
  if (pages && links / pages < densityWarn) {
    return {
      label: `${links} / ${pages}`,
      state: "warn",
      hint: "GBrain 关系层偏稀",
    };
  }
  return {
    label: pages ? `${links} / ${pages}` : String(links),
    state: "ok",
    hint: "GBrain 关系层已读取",
  };
}

function isHealthCacheStale(health, maxAgeHours = DEFAULT_HEALTH_CACHE_MAX_AGE_HOURS, now = Date.now()) {
  if (!health || !health.generatedAt) return true;
  const generated = new Date(health.generatedAt);
  if (Number.isNaN(generated.getTime())) return true;
  return now - generated.getTime() > maxAgeHours * 60 * 60 * 1000;
}

function parseHealthNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const match = String(value).replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function formatHealthTime(value) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${formatDate(date)} ${formatTime(date)}`;
}

function collectVaultActivity(files, options = {}) {
  const now = normalizeTime(options.now || Date.now());
  const roots = normalizeActivityWorkspaces(options.roots || DEFAULT_ACTIVITY_WORKSPACES);
  const days = Number(options.days || DEFAULT_ACTIVITY_DAYS);
  const allMarkdownFiles = normalizeActivityFiles(files);
  const weekCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const monthCutoff = now - 30 * 24 * 60 * 60 * 1000;
  const byKey = {};

  // Build workspace map in a single pass (was O(n×m), now O(n))
  const fileWorkspace = new Map();
  const markdownFiles = [];
  for (const file of allMarkdownFiles) {
    const ws = getActivityWorkspaceForPath(file.path, roots);
    if (ws) {
      fileWorkspace.set(file.path, ws);
      markdownFiles.push(file);
    }
  }

  for (const root of roots) {
    const rootFiles = markdownFiles.filter((file) => fileWorkspace.get(file.path).key === root.key);
    const latest = rootFiles.reduce((winner, file) => (!winner || file.mtime > winner.mtime ? file : winner), null);
    byKey[root.key] = {
      ...root,
      files: rootFiles.length,
      week: rootFiles.filter((file) => file.mtime >= weekCutoff).length,
      month: rootFiles.filter((file) => file.mtime >= monthCutoff).length,
      share: markdownFiles.length ? rootFiles.length / markdownFiles.length : 0,
      latest,
      state: getActivityState(latest, now),
    };
  }

  const recentFiles = markdownFiles
    .slice()
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, Number(options.recentLimit || 8))
    .map((file) => ({
      ...file,
      workspace: fileWorkspace.get(file.path),
    }));
  const heatmap = buildActivityHeatmap(markdownFiles, { days, now });
  const activeDays = heatmap.cells.filter((cell) => cell.count > 0).length;
  const workspaces = roots.map((root) => byKey[root.key]);
  const busiestWorkspace = workspaces
    .slice()
    .sort((a, b) => b.week - a.week || b.month - a.month || b.files - a.files)[0] || null;

  return {
    roots,
    byKey,
    workspaces,
    recentFiles,
    heatmap,
    summary: {
      files: markdownFiles.length,
      vaultFiles: allMarkdownFiles.length,
      week: markdownFiles.filter((file) => file.mtime >= weekCutoff).length,
      month: markdownFiles.filter((file) => file.mtime >= monthCutoff).length,
      activeDays,
      hotWorkspaces: workspaces.filter((workspace) => workspace.state === "hot").length,
      quietWorkspaces: workspaces.filter((workspace) => workspace.state === "cold" || workspace.state === "empty").length,
      busiestWorkspace,
      latestFile: recentFiles[0] || null,
    },
  };
}

function buildActivityHeatmap(files, options = {}) {
  const nowDate = startOfDay(new Date(normalizeTime(options.now || Date.now())));
  const days = Math.max(1, Number(options.days || DEFAULT_ACTIVITY_DAYS));
  const start = new Date(nowDate);
  start.setDate(nowDate.getDate() - days + 1);
  const counts = new Map();

  for (const file of normalizeActivityFiles(files)) {
    const day = formatDate(new Date(file.mtime));
    counts.set(day, (counts.get(day) || 0) + 1);
  }

  const cells = [];
  for (let index = 0; index < days; index++) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = formatDate(date);
    const count = counts.get(key) || 0;
    cells.push({ date: key, count, level: getHeatmapLevel(count) });
  }
  const total = cells.reduce((sum, cell) => sum + cell.count, 0);
  const activeDays = cells.filter((cell) => cell.count > 0).length;
  return {
    days,
    cells,
    max: cells.reduce((max, cell) => Math.max(max, cell.count), 0),
    total,
    activeDays,
    columns: Math.ceil(days / 7),
    startDate: formatDate(start),
    endDate: formatDate(nowDate),
  };
}

function parseDailyDigest(markdown, options = {}) {
  if (!markdown) return { missing: true, sections: [] };
  const sections = [
    {
      key: "completed",
      label: "今日完成",
      headings: ["今日完成", "✅ 今日完成", "📝 今日完成"],
      limit: 4,
    },
    {
      key: "todo",
      label: "今日待办",
      headings: ["今日待办", "📋 今日待办"],
      limit: 4,
    },
    {
      key: "tomorrow",
      label: "明日计划",
      headings: ["明日计划", "📝 明日计划"],
      limit: 3,
    },
    {
      key: "agent",
      label: "Agent 复盘",
      headings: ["Agent 复盘", "🤖 Agent 复盘"],
      limit: 3,
    },
    {
      key: "ai",
      label: "AI 摘要",
      headings: ["🤖 AI 今日摘要", "AI 今日摘要"],
      limit: 4,
    },
  ].map((section) => ({
    key: section.key,
    label: section.label,
    items: extractDailySectionItems(markdown, section.headings, section.limit),
  }));

  const visibleSections = sections.filter((section) => section.items.length > 0);
  return {
    missing: false,
    sections,
    visibleSections,
    isEmpty: visibleSections.length === 0,
    path: options.path || "",
  };
}

function extractDailySectionItems(markdown, headings, limit) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => headings.some((heading) => normalizeHeading(line) === normalizeHeading(heading)));
  if (start === -1) return [];
  const items = [];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (/^##\s+/.test(line)) break;
    const item = cleanDailyDigestLine(line);
    if (item) items.push(item);
    if (items.length >= limit) break;
  }
  return items;
}

function cleanDailyDigestLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed === "-" || trimmed === "- [ ]" || trimmed === "- [x]") return "";
  if (/^<!--.*-->$/.test(trimmed)) return "";
  return trimmed
    .replace(/^#{3,6}\s+/, "")
    .replace(/^- \[[ xX]\]\s+/, "")
    .replace(/^[-*]\s+/, "")
    .trim();
}

function normalizeActivityFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .map((file) => {
      const path = String(file && file.path ? file.path : "");
      const extension = file && file.extension ? file.extension : path.split(".").pop();
      const stat = (file && file.stat) || {};
      const mtime = Number((file && file.mtime) || stat.mtime || stat.ctime || 0);
      const ctime = Number((file && file.ctime) || stat.ctime || mtime || 0);
      return {
        path,
        basename: file && file.basename ? file.basename : path.split("/").pop().replace(/\.md$/i, ""),
        extension,
        mtime,
        ctime,
      };
    })
    .filter((file) => file.path && file.extension === "md" && !file.path.startsWith("."));
}

function normalizeActivityWorkspaces(roots) {
  return roots.map((root) => ({
    ...root,
    path: normalizeActivityPath(root.path || (Array.isArray(root.paths) ? root.paths[0] : "")),
    paths: normalizeActivityWorkspacePaths(root),
  })).filter((root) => root.key && root.paths.length > 0);
}

function getActivityWorkspaceForPath(path, roots = DEFAULT_ACTIVITY_WORKSPACES) {
  const normalized = normalizeActivityPath(path);
  return normalizeActivityWorkspaces(roots).find((root) => (
    root.paths.some((rootPath) => normalized === rootPath || normalized.startsWith(`${rootPath}/`))
  )) || null;
}

function getActivityState(latest, now) {
  if (!latest) return "empty";
  const age = now - latest.mtime;
  if (age <= 7 * 24 * 60 * 60 * 1000) return "hot";
  if (age <= 30 * 24 * 60 * 60 * 1000) return "warm";
  return "cold";
}

function getHeatmapLevel(count) {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 12) return 3;
  return 4;
}

function normalizeActivityWorkspacePaths(root) {
  const paths = Array.isArray(root.paths) ? root.paths : [root.path];
  return paths.map(normalizeActivityPath).filter(Boolean);
}

function normalizeActivityPath(path) {
  return String(path || "").replace(/^\/+|\/+$/g, "");
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function normalizeTime(value) {
  if (value instanceof Date) return value.getTime();
  return Number(value);
}

function normalizeHeading(line) {
  return String(line || "").replace(/^#+\s*/, "").trim();
}

module.exports = {
  buildPipelineState,
  buildActivityHeatmap,
  collectVaultActivity,
  collectCardStats,
  collectAgentTaskGroups,
  collectSectionStats,
  collectStats,
  collectTodayStats,
  collectVisibleSectionStats,
  createCardSnapshot,
  createTaskSnapshot,
  DEFAULT_ACTIVITY_DAYS,
  DEFAULT_ACTIVITY_WORKSPACES,
  DEFAULT_GBRAIN_LINK_DENSITY_WARN,
  DEFAULT_HEALTH_CACHE_MAX_AGE_HOURS,
  extractDailySectionItems,
  findFirstVisibleTask,
  findMatchingCard,
  formatHealthTime,
  getActivityWorkspaceForPath,
  getChannelChips,
  getGbrainRelationHealth,
  getHealthGbrainLinks,
  getHealthIssueCount,
  getHealthIssues,
  getHealthSummary,
  getOpenTasks,
  getPrimaryCard,
  getTaskBadge,
  getTodoCardKind,
  isCompletedContentCard,
  isCompletedOperationalCard,
  isHealthCacheStale,
  parseHealthNumber,
  parseDailyDigest,
  pickContentCard,
  shouldRenderWorkbenchCard,
  shouldShowTodoOverviewCard,
};
