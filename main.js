const {
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  setIcon,
} = require("obsidian");
const nodePath = require("path");

const WORKBENCH_PLUGIN_ID = "wiki-workbench";

function requireWorkbenchModule(fileName) {
  const adapter = globalThis.app && globalThis.app.vault && globalThis.app.vault.adapter;
  const basePath = adapter && (typeof adapter.getBasePath === "function" ? adapter.getBasePath() : adapter.basePath);
  const loadFresh = (modulePath) => {
    if (require.cache) {
      const normalizedPath = String(modulePath).replace(/\\/g, "/");
      for (const key of Object.keys(require.cache)) {
        const normalizedKey = key.replace(/\\/g, "/");
        if (normalizedKey === normalizedPath || normalizedKey.endsWith(`/${WORKBENCH_PLUGIN_ID}/${fileName}`)) {
          delete require.cache[key];
        }
      }
    }
    return require(modulePath);
  };
  if (basePath) {
    return loadFresh(nodePath.join(basePath, ".obsidian", "plugins", WORKBENCH_PLUGIN_ID, fileName));
  }
  return loadFresh(`./${fileName}`);
}

const TaskLogic = requireWorkbenchModule("task-logic.js");
const DashboardLogic = requireWorkbenchModule("dashboard-logic.js");
const DateUtils = requireWorkbenchModule("date-utils.js");

const {
  formatDate,
  formatTime,
  formatMonth,
  formatChineseDate,
  getChineseWeekday,
  getISOWeekString,
  sameDay,
} = DateUtils;
const WorkbenchDerive = requireWorkbenchModule("workbench-derive.js");

const {
  DEFAULT_HEALTH_CACHE_MAX_AGE_HOURS: HEALTH_CACHE_MAX_AGE_HOURS,
  DEFAULT_GBRAIN_LINK_DENSITY_WARN: GBRAIN_LINK_DENSITY_WARN,
} = WorkbenchDerive;

const VIEW_TYPE = "wiki-workbench-view";
const DEFAULT_SETTINGS = {
  dashboardFile: "dashboard.md",
  dailyFolder: "Journal",
  weeklyFolder: "Plans/Weekly",
  monthlyFolder: "Plans/Monthly",
  contentFlowPath: "Wiki/Content/workflow.md",
  projectIndexPath: "Wiki/Projects/index.md",
  healthCachePath: "Workbench/vault-health.json",
  autoAppendCompletedToDaily: true,
  completionLogHeading: "今日完成",
  workbenchTheme: "day",
};

const SECTION_TYPES = [
  { key: "focus", title: "今日行动", icon: "target", color: "#d6a646" },
  { key: "todo", title: "Todo 列表", icon: "check-square", color: "#6690cc" },
  { key: "content", title: "内容生成", icon: "pen-tool", color: "#9b7ad6" },
  { key: "life", title: "生活待办", icon: "heart-pulse", color: "#5da86f" },
];

const SECTION_DESCRIPTIONS = {
  focus: "先确认今天真正要推进什么",
  todo: "工作、项目、Agent 协作待办",
  content: "选题、草稿、发布、回流",
  life: "健康、家庭、个人行政、小习惯",
};

const WEEK_RHYTHM = ["选题", "写作", "分发", "储备", "发布", "复盘", "下周"];

const WORKBENCH_THEMES = [
  { key: "day", label: "白天", icon: "sun" },
  { key: "night", label: "晚上", icon: "moon" },
  { key: "island", label: "海岛", icon: "waves" },
  { key: "magazine", label: "杂志", icon: "newspaper" },
  { key: "cyberpunk", label: "赛博朋克", icon: "zap" },
  { key: "apple", label: "苹果", icon: "apple" },
];

module.exports = class WikiWorkbenchPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.registerView(VIEW_TYPE, (leaf) => new WorkbenchView(leaf, this));

    this.addRibbonIcon("layout-dashboard", "Wiki Workbench", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-workbench",
      name: "打开 Wiki 工作台",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "open-today-note",
      name: "打开今日日记",
      callback: () => this.openTodayNote(),
    });

    this.addCommand({
      id: "open-week-plan",
      name: "打开本周计划",
      callback: () => this.openWeekPlan(),
    });

    this.addCommand({
      id: "add-quick-task",
      name: "添加工作台任务",
      callback: () => this.quickAddTask(),
    });

    this.addCommand({
      id: "cycle-workbench-theme",
      name: "切换工作台主题",
      callback: () => this.cycleWorkbenchTheme(),
    });

    this.addSettingTab(new WorkbenchSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async setWorkbenchTheme(themeKey) {
    this.settings.workbenchTheme = normalizeThemeKey(themeKey);
    await this.saveSettings();
    this.refreshWorkbenchViews();
  }

  async cycleWorkbenchTheme() {
    const current = normalizeThemeKey(this.settings.workbenchTheme);
    const index = WORKBENCH_THEMES.findIndex((theme) => theme.key === current);
    const next = WORKBENCH_THEMES[(index + 1) % WORKBENCH_THEMES.length];
    await this.setWorkbenchTheme(next.key);
    new Notice(`已切换到${next.label}主题`);
  }

  refreshWorkbenchViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view && typeof leaf.view.render === "function") {
        leaf.view.render();
      }
    }
  }

  async activateView() {
    await this.ensureDashboardFile();
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async ensureDashboardFile() {
    const path = normalizeFilePath(this.settings.dashboardFile);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return file;
    return this.app.vault.create(path, createDefaultDashboardMarkdown());
  }

  async readDashboard() {
    const file = await this.ensureDashboardFile();
    return {
      file,
      markdown: await this.app.vault.read(file),
    };
  }

  async ensureDailyRollover() {
    if (this._rolloverInProgress) return false;
    this._rolloverInProgress = true;
    try {
      const today = formatDate(new Date());
      const file = await this.ensureDashboardFile();
      const markdown = await this.app.vault.read(file);
      if (DashboardLogic.getDashboardWorkbenchDate(markdown) === today) return false;

      const data = DashboardLogic.parseDashboard(markdown);
      const next = DashboardLogic.rolloverDashboardForDate(markdown, data, today);
      if (next === markdown) return false;
      await this.app.vault.modify(file, next);
      new Notice("工作台已切换到今天，昨日完成项已归档");
      return true;
    } finally {
      this._rolloverInProgress = false;
    }
  }

  async readHealthCache() {
    const path = normalizeVaultPath(this.settings.healthCachePath || DEFAULT_SETTINGS.healthCachePath);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return { missing: true, path };
    }

    try {
      return JSON.parse(await this.app.vault.read(file));
    } catch (error) {
      return {
        error: true,
        path,
        message: error && error.message ? error.message : String(error),
      };
    }
  }

  async readTodayDigest() {
    const path = this.getTodayNotePath(new Date());
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return { missing: true, path };
    }
    return WorkbenchDerive.parseDailyDigest(await this.app.vault.read(file), { path });
  }

  async writeDashboard(markdown) {
    const file = await this.ensureDashboardFile();
    await this.app.vault.modify(file, markdown);
  }

  async processDashboard(mutator) {
    const file = await this.ensureDashboardFile();
    let outcome = null;
    await this.app.vault.process(file, (markdown) => {
      const data = DashboardLogic.parseDashboard(markdown);
      outcome = mutator(markdown, data) || { markdown, changed: false };
      return outcome.markdown || markdown;
    });
    return outcome;
  }

  async appendCompletionToToday(taskText) {
    if (!this.settings.autoAppendCompletedToDaily) return false;
    const text = TaskLogic.cleanTaskLabel(taskText);
    if (!text) return false;

    const today = new Date();
    const path = this.getTodayNotePath(today);
    const file = await this.ensureNote(path, createDailyNote(formatDate(today)));
    const markdown = await this.app.vault.read(file);
    if (hasCompletionEntry(markdown, text, this.settings.completionLogHeading)) return false;

    const next = insertCompletionEntry(markdown, {
      heading: this.settings.completionLogHeading,
      text,
      source: this.settings.dashboardFile,
    });
    await this.app.vault.modify(file, next);
    return true;
  }

  async openTodayNote() {
    const today = new Date();
    const file = await this.ensureNote(this.getTodayNotePath(today), createDailyNote(formatDate(today)));
    await this.openFile(file);
  }

  async openWeekPlan() {
    const today = new Date();
    const week = getISOWeekString(today);
    const file = await this.ensureNote(this.getWeekPlanPath(today), createWeekPlan(week));
    await this.openFile(file);
  }

  async openMonthPlan() {
    const today = new Date();
    const month = formatMonth(today);
    const file = await this.ensureNote(this.getMonthPlanPath(today), createMonthPlan(month));
    await this.openFile(file);
  }

  getTodayNotePath(date = new Date()) {
    return normalizeFilePath(`${trimSlashes(this.settings.dailyFolder)}/${formatDate(date)}`);
  }

  getWeekPlanPath(date = new Date()) {
    return normalizeFilePath(`${trimSlashes(this.settings.weeklyFolder)}/${getISOWeekString(date)}`);
  }

  getMonthPlanPath(date = new Date()) {
    return normalizeFilePath(`${trimSlashes(this.settings.monthlyFolder)}/${formatMonth(date)}`);
  }

  async ensureNote(path, content) {
    const normalized = normalizeFilePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) return file;
    const parent = normalized.split("/").slice(0, -1).join("/");
    if (parent) await this.ensureFolder(parent);
    return this.app.vault.create(normalized, content);
  }

  async ensureFolder(path) {
    const parts = trimSlashes(path).split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  async openFile(file) {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  async openPath(path) {
    const resolved = replaceDateTokens(path);
    const normalized = normalizeFilePath(resolved);
    const today = new Date();
    if (normalized === this.getTodayNotePath(today)) {
      await this.openTodayNote();
      return;
    }
    if (normalized === this.getWeekPlanPath(today)) {
      await this.openWeekPlan();
      return;
    }
    if (normalized === this.getMonthPlanPath(today)) {
      await this.openMonthPlan();
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) {
      await this.openFile(file);
      return;
    }
    await this.app.workspace.openLinkText(resolved.replace(/\.md$/, ""), "", false);
  }

  async quickAddTask() {
    const modal = new TaskTextModal(this.app, "添加到 Todo 列表", async (text) => {
      const outcome = await this.processDashboard((markdown, data) => {
        const section = data.sections.find((item) => item.type === "todo") || data.sections[1];
        const card = section && section.cards.length ? section.cards[0] : null;
        if (!card) return { markdown, changed: false };
        return {
          markdown: DashboardLogic.insertTaskLine(markdown, card, text),
          changed: true,
        };
      });
      if (!outcome || !outcome.changed) {
        new Notice("没有找到 Todo 列表卡片");
        return;
      }
      new Notice("已添加到 Todo 列表");
    });
    modal.open();
  }
};

class WorkbenchView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.draggedTask = null;
    this.debounceTimer = null;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Wiki 工作台";
  }

  getIcon() {
    return "layout-dashboard";
  }

  async onOpen() {
    await this.render();
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.shouldRefreshForFile(file)) {
          this.scheduleRender();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (this.shouldRefreshForFile(file)) {
          this.scheduleRender();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (this.shouldRefreshForFile(file)) {
          this.scheduleRender();
        }
      })
    );
  }

  async onClose() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  scheduleRender() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.render(), 150);
  }

  shouldRefreshForFile(file) {
    if (!file || !file.path) return false;
    const dashboardPath = normalizeFilePath(this.plugin.settings.dashboardFile);
    const healthPath = normalizeVaultPath(this.plugin.settings.healthCachePath || DEFAULT_SETTINGS.healthCachePath);
    if (file.path === dashboardPath || file.path === healthPath) return true;
    if (file.path === this.plugin.getTodayNotePath(new Date())) return true;
    return file.extension === "md" && Boolean(WorkbenchDerive.getActivityWorkspaceForPath(file.path));
  }

  async render() {
    await this.plugin.ensureDailyRollover();
    const { file, markdown } = await this.plugin.readDashboard();
    this.file = file;
    this.markdown = markdown;
    this.data = DashboardLogic.parseDashboard(markdown);
    this.health = await this.plugin.readHealthCache();
    this.activity = WorkbenchDerive.collectVaultActivity(this.app.vault.getMarkdownFiles());
    this.dailyDigest = await this.plugin.readTodayDigest();

    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("wiki-workbench-root");
    this.applyTheme(root);

    this.renderHero(root);
    this.renderSummary(root);

    const main = root.createDiv({ cls: "cw-layout" });
    const content = main.createDiv({ cls: "cw-content" });
    const sidebar = main.createDiv({ cls: "cw-sidebar" });

    this.renderCoreCards(content);
    this.renderActivityLens(content);
    this.renderDailyTimeline(content);
    this.renderSections(content);
    this.renderSidebar(sidebar);
  }

  applyTheme(root) {
    const theme = getThemeDefinition(this.plugin.settings.workbenchTheme);
    for (const item of WORKBENCH_THEMES) root.removeClass(`cw-theme-${item.key}`);
    root.addClass(`cw-theme-${theme.key}`);
    root.setAttr("data-cw-theme", theme.key);
  }

  renderHero(root) {
    const hero = root.createDiv({ cls: "cw-hero" });
    const text = hero.createDiv({ cls: "cw-hero-text" });
    text.createDiv({ cls: "cw-eyebrow", text: "LLM WIKI · HERMES DAILY OPS" });
    text.createEl("h1", { text: "Wiki Workbench" });
    text.createEl("p", {
      text: "每天打开先看这里：今天推进什么、Agent 正在处理什么、内容卡在哪一步、生活事项有没有漏。",
    });

    const controls = hero.createDiv({ cls: "cw-hero-controls" });
    this.renderThemeSwitcher(controls);
    const actions = controls.createDiv({ cls: "cw-hero-actions" });
    this.createActionButton(actions, "刷新今日", "refresh-cw", "refresh-cw", () => this.render());
    this.createActionButton(actions, "今日日记", "calendar", "calendar", () => this.plugin.openTodayNote());
    this.createActionButton(actions, "本周计划", "calendar-days", "calendar-days", () => this.plugin.openWeekPlan());
    this.createActionButton(actions, "新建任务", "plus", "plus", () => this.addTaskToDefaultCard());
  }

  renderThemeSwitcher(parent) {
    const current = normalizeThemeKey(this.plugin.settings.workbenchTheme);
    const currentTheme = getThemeDefinition(current);
    const menu = parent.createEl("details", { cls: "cw-theme-menu" });
    const trigger = menu.createEl("summary", {
      cls: "cw-theme-trigger",
      attr: {
        title: `当前主题：${currentTheme.label}`,
        "aria-label": "切换工作台主题",
      },
    });
    const triggerIcon = trigger.createSpan({ cls: "cw-theme-trigger-icon" });
    setIcon(triggerIcon, "more-horizontal");
    trigger.createSpan({ cls: "cw-theme-current", text: currentTheme.label });

    const switcher = menu.createDiv({ cls: "cw-theme-popover", attr: { role: "menu", "aria-label": "工作台主题" } });
    for (const theme of WORKBENCH_THEMES) {
      const isActive = theme.key === current;
      const btn = switcher.createEl("button", {
        cls: `cw-theme-chip ${isActive ? "is-active" : ""}`,
        attr: {
          type: "button",
          title: theme.label,
          "aria-pressed": String(isActive),
          role: "menuitemradio",
        },
      });
      const icon = btn.createSpan({ cls: "cw-theme-chip-icon" });
      setIcon(icon, theme.icon);
      btn.createSpan({ text: theme.label });
      btn.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.plugin.setWorkbenchTheme(theme.key);
        menu.removeAttribute("open");
        new Notice(`已切换到${theme.label}主题`);
      });
    }
  }

  renderSummary(root) {
    const summary = root.createDiv({ cls: "cw-summary" });
    const now = new Date();
    const dateCard = summary.createDiv({ cls: "cw-summary-card cw-summary-date-card" });
    dateCard.createDiv({
      cls: "cw-summary-date",
      text: `${formatChineseDate(now)} · ${getChineseWeekday(now)}`,
    });

    const stats = WorkbenchDerive.collectTodayStats(this.data);
    const statRow = dateCard.createDiv({ cls: "cw-summary-stat-row" });
    statRow.createSpan({ cls: "cw-summary-stat", text: `待处理 ${stats.open}` });
    const doneButton = this.createSummaryJump(statRow, `已完成 ${stats.done}`, "查看已完成任务", () => {
      this.showTaskInbox("done");
    });
    if (stats.done === 0) doneButton.setAttr("disabled", "true");
    const openButton = this.createSummaryJump(statRow, `未完成 ${stats.open}`, "查看未完成任务", () => {
      this.showTaskInbox("open");
    });
    if (stats.open === 0) openButton.setAttr("disabled", "true");
    const carryButton = this.createSummaryJump(statRow, `遗留 ${stats.carryover}`, "处理遗留任务", () => {
      this.showTaskInbox("carryover");
    });
    if (stats.carryover === 0) carryButton.setAttr("disabled", "true");

    const flowCard = summary.createDiv({ cls: "cw-summary-card cw-flow-card" });
    this.renderKnowledgeFlow(flowCard);
  }

  renderCoreCards(container) {
    const title = container.createDiv({ cls: "cw-cockpit-title" });
    title.createEl("h2", { text: "今日驾驶舱" });
    title.createSpan({ text: "目标：先完成发布，再回填日记与复盘" });

    const grid = container.createDiv({ cls: "cw-core-grid" });
    for (const def of SECTION_TYPES) {
      const section = this.data.sections.find((item) => item.type === def.key);
      const stats = section ? WorkbenchDerive.collectVisibleSectionStats(section) : { total: 0, done: 0, open: 0, carryover: 0 };
      const primaryCard = WorkbenchDerive.getPrimaryCard(section, def.key);
      const module = grid.createDiv({ cls: `cw-module cw-module-${def.key}` });
      module.style.setProperty("--cw-accent", def.color);

      const head = module.createDiv({ cls: "cw-module-head" });
      const titleWrap = head.createDiv({ cls: "cw-module-title" });
      titleWrap.createDiv({
        cls: "cw-module-number",
        text: String(SECTION_TYPES.indexOf(def) + 1).padStart(2, "0"),
      });
      const titleText = titleWrap.createDiv();
      titleText.createEl("h2", { text: def.title });
      titleText.createDiv({ cls: "cw-module-subtitle", text: SECTION_DESCRIPTIONS[def.key] });

      head.createSpan({ cls: `cw-pill cw-pill-${def.key}`, text: def.key === "todo" ? `${stats.open} 项` : `${stats.done}/${stats.total}` });

      if (def.key === "content") {
        this.renderContentModule(module, section, primaryCard);
      } else if (def.key === "todo") {
        this.renderTodoModule(module, section);
      } else if (def.key === "focus") {
        this.renderFocusModule(module, section);
      } else {
        this.renderTaskPreview(module, primaryCard, 4);
      }

      const progress = module.createDiv({ cls: "cw-progress" });
      const bar = progress.createDiv({ cls: "cw-progress-bar" });
      bar.style.width = `${stats.total ? Math.round((stats.done / stats.total) * 100) : 0}%`;

      module.addEventListener("dblclick", () => {
        const target = this.containerEl.querySelector(`[data-section="${def.key}"]`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  renderKnowledgeFlow(container) {
    const activity = this.activity || WorkbenchDerive.collectVaultActivity(this.app.vault.getMarkdownFiles());
    const byKey = activity.byKey || {};
    const wikiWeek = ["external", "research", "graph", "creation", "project", "agent", "wiki"]
      .reduce((sum, key) => sum + (byKey[key] ? byKey[key].week : 0), 0);
    const steps = [
      ["素材库", byKey.source ? byKey.source.week : 0],
      ["wiki", wikiWeek],
      ["产出", byKey.output ? byKey.output.week : 0],
      ["日记", byKey.daily ? byKey.daily.week : 0],
    ];
    const flow = container.createDiv({ cls: "cw-knowledge-flow" });
    steps.forEach(([label, value], index) => {
      const step = flow.createDiv({ cls: "cw-flow-step" });
      step.createSpan({ cls: "cw-flow-dot" });
      step.createSpan({ text: `${label} 7日 ${value}` });
      if (index < steps.length - 1) flow.createSpan({ cls: "cw-flow-arrow", text: "→" });
    });
  }

  renderActivityLens(container) {
    const activity = this.activity || WorkbenchDerive.collectVaultActivity(this.app.vault.getMarkdownFiles());
    const title = container.createDiv({ cls: "cw-cockpit-title cw-activity-title" });
    title.createEl("h2", { text: "工作区统计" });
    title.createSpan({
      text: `覆盖 ${activity.workspaces.length} 个工作区，近 ${activity.heatmap.days} 天 ${activity.summary.activeDays} 个活跃日`,
    });

    const lens = container.createDiv({ cls: "cw-activity-lens" });
    this.renderWorkspaceStats(lens, activity);
    const workspaces = lens.createDiv({ cls: "cw-activity-grid" });
    const maxFiles = Math.max(...activity.workspaces.map((item) => item.files), 1);
    for (const workspace of activity.workspaces) {
      this.renderWorkspaceActivityCard(workspaces, workspace, maxFiles);
    }
    this.renderActivityHeatmap(lens, activity);
  }

  renderWorkspaceStats(container, activity) {
    const summary = activity.summary || {};
    const busiest = summary.busiestWorkspace && summary.busiestWorkspace.files > 0 ? summary.busiestWorkspace : null;
    const latest = summary.latestFile;
    const stats = container.createDiv({ cls: "cw-workspace-stat-strip" });
    this.renderWorkspaceStat(stats, "工作区文件", String(summary.files || 0), `vault Markdown ${summary.vaultFiles || 0}`);
    this.renderWorkspaceStat(stats, "本周沉淀", String(summary.week || 0), "最近 7 天修改");
    this.renderWorkspaceStat(stats, "本月沉淀", String(summary.month || 0), "最近 30 天修改");
    this.renderWorkspaceStat(stats, "活跃天数", String(summary.activeDays || 0), `近 ${activity.heatmap.days} 天`);
    this.renderWorkspaceStat(
      stats,
      "最活跃",
      busiest ? busiest.label : "暂无",
      busiest ? `7日 ${busiest.week} · 共 ${busiest.files}` : "等待沉淀"
    );
    this.renderWorkspaceStat(
      stats,
      "最近更新",
      latest ? latest.workspace.label : "暂无",
      latest ? formatRelativeTime(latest.mtime) : "没有记录"
    );
  }

  renderWorkspaceStat(container, label, value, hint) {
    const item = container.createDiv({ cls: "cw-workspace-stat" });
    item.createSpan({ cls: "cw-workspace-stat-label", text: label });
    item.createEl("strong", { text: value });
    item.createSpan({ cls: "cw-workspace-stat-hint", text: hint });
  }

  renderWorkspaceActivityCard(container, workspace, maxFiles) {
    const card = container.createDiv({
      cls: `cw-activity-card cw-activity-${workspace.key} is-${workspace.state}`,
      attr: {
        role: workspace.latest ? "button" : "group",
        tabindex: workspace.latest ? "0" : "-1",
        title: workspace.latest ? `打开最近文件：${workspace.latest.path}` : `${workspace.label} 暂无 Markdown 文件`,
      },
    });
    card.style.setProperty("--cw-accent", workspace.color);
    if (workspace.latest) {
      const open = () => this.plugin.openPath(workspace.latest.path);
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
    }

    const head = card.createDiv({ cls: "cw-activity-card-head" });
    head.createSpan({ cls: "cw-activity-label", text: workspace.label });
    head.createSpan({ cls: `cw-activity-state cw-activity-state-${workspace.state}`, text: getActivityStateLabel(workspace.state) });
    const numbers = card.createDiv({ cls: "cw-activity-numbers" });
    numbers.createEl("strong", { text: String(workspace.files) });
    numbers.createSpan({ text: `${workspace.role || "工作区"} · 7日 ${workspace.week} · 30日 ${workspace.month}` });
    const bar = card.createDiv({ cls: "cw-activity-bar" });
    bar.createDiv({
      cls: "cw-activity-fill",
      attr: { style: `width:${Math.max(3, Math.round((workspace.files / maxFiles) * 100))}%` },
    });
    card.createDiv({
      cls: "cw-activity-latest",
      text: workspace.latest
        ? `${formatRelativeTime(workspace.latest.mtime)} · ${formatShortPath(workspace.latest.path)}`
        : "暂无最近文件",
    });
  }

  renderActivityHeatmap(container, activity) {
    const box = container.createDiv({ cls: "cw-activity-heatmap" });
    const head = box.createDiv({ cls: "cw-activity-heatmap-head" });
    head.createSpan({ text: `${activity.heatmap.days} 天贡献热力图` });
    head.createEl("small", {
      text: `${activity.heatmap.startDate} → ${activity.heatmap.endDate} · ${activity.heatmap.total} 次活跃`,
    });
    const body = box.createDiv({ cls: "cw-heatmap-body" });
    const grid = body.createDiv({ cls: "cw-heat-grid" });
    grid.style.setProperty("--cw-heat-columns", String(activity.heatmap.columns || Math.ceil(activity.heatmap.days / 7)));
    for (const cell of activity.heatmap.cells) {
      grid.createDiv({
        cls: `cw-heat-cell level-${cell.level} ${cell.date === formatDate(new Date()) ? "is-today" : ""}`,
        attr: { title: `${cell.date}: ${cell.count} 个活跃文件` },
      });
    }
    const legend = box.createDiv({ cls: "cw-heat-legend" });
    legend.createSpan({ text: "少" });
    for (let level = 0; level <= 4; level++) {
      legend.createSpan({ cls: `cw-heat-cell level-${level}` });
    }
    legend.createSpan({ text: "多" });
  }

  renderTaskPreview(container, card, limit) {
    const list = container.createDiv({ cls: "cw-preview-list" });
    if (!card || card.tasks.length === 0) {
      list.createDiv({ cls: "cw-empty-task", text: "暂无任务" });
      return;
    }
    const tasks = TaskLogic.prioritizeTasks(WorkbenchDerive.getOpenTasks(card)).slice(0, limit);
    if (tasks.length === 0) {
      list.createDiv({ cls: "cw-empty-task", text: card.tasks.length > 0 ? "未完成项已清空" : "暂无任务" });
      return;
    }
    for (const task of tasks) {
      this.renderCompactTask(list, card, task);
    }
  }

  renderTodoModule(container, section) {
    const wrap = container.createDiv({ cls: "cw-todo-board" });
    if (!section || section.cards.length === 0) {
      wrap.createDiv({ cls: "cw-empty-task", text: "暂无 Todo 分组" });
      return;
    }
    const visibleCards = section.cards.filter(WorkbenchDerive.shouldShowTodoOverviewCard).slice(0, 5);
    if (visibleCards.length === 0) {
      wrap.createDiv({ cls: "cw-empty-task", text: "暂无 Todo 分组" });
      return;
    }
    for (const card of visibleCards) {
      const stats = WorkbenchDerive.collectCardStats(card);
      const openTask = TaskLogic.prioritizeTasks(WorkbenchDerive.getOpenTasks(card))[0];
      const kind = WorkbenchDerive.getTodoCardKind(card);
      const row = wrap.createDiv({
        cls: `cw-todo-row cw-todo-row-${kind.key}`,
        attr: { role: "button", tabindex: "0", title: `打开 ${card.title}` },
      });
      row.style.setProperty("--cw-accent", kind.color);
      row.addEventListener("click", () => this.scrollToCard(card));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.scrollToCard(card);
        }
      });

      const main = row.createDiv({ cls: "cw-todo-row-main" });
      const head = main.createDiv({ cls: "cw-todo-row-head" });
      head.createSpan({ cls: "cw-todo-row-name", text: card.title });
      head.createSpan({ cls: "cw-todo-row-tag", text: kind.label });
      const text = main.createDiv({ cls: "cw-todo-row-task" });
      if (openTask) renderInline(text, TaskLogic.cleanTaskLabel(openTask.text), (target) => this.plugin.openPath(target));
      else text.setText("未完成项已清空");

      const meta = row.createDiv({ cls: "cw-todo-row-meta" });
      meta.createSpan({ cls: "cw-mini-badge", text: `${stats.done}/${stats.total}` });
      if (stats.carryover > 0) meta.createSpan({ cls: "cw-mini-badge cw-mini-badge-carry", text: `续 ${stats.carryover}` });
      if (stats.agent > 0) meta.createSpan({ cls: "cw-mini-badge cw-mini-badge-violet", text: `H ${stats.agent}` });
      if (stats.waiting > 0) meta.createSpan({ cls: "cw-mini-badge cw-mini-badge-rose", text: `等 ${stats.waiting}` });
    }
  }

  renderFocusModule(container, section) {
    const wrap = container.createDiv({ cls: "cw-focus-board" });
    if (!section) {
      wrap.createDiv({ cls: "cw-empty-task", text: "今日行动还没初始化" });
      return;
    }
    const focusCard = section.cards.find((card) => card.id === "focus-today") || section.cards[0];
    const doneCard = section.cards.find((card) => card.id === "today-done");
    const focusItems = collectFocusPreviewItems(section, focusCard);

    // 1. focus-today: 今日最重要的三件事(空时友好提示)
    const focusBlock = wrap.createDiv({ cls: "cw-focus-block" });
    focusBlock.createDiv({ cls: "cw-focus-block-title", text: "今日最重要的三件事" });
    if (focusItems.length > 0) {
      const list = focusBlock.createDiv({ cls: "cw-preview-list" });
      for (const item of focusItems.slice(0, 3)) {
        this.renderCompactTask(list, item.card, item.task);
      }
    } else if (focusCard && focusCard.tasks.length > 0) {
      focusBlock.createDiv({ cls: "cw-empty-task", text: "今日三件事已全部完成 ✅" });
    } else {
      focusBlock.createDiv({
        cls: "cw-empty-task cw-focus-empty",
        text: "还没填今天最重要的三件事 — 在 dashboard.md 的 focus-today 卡里加 3 条 - [ ] 任务",
      });
    }

    // 2. today-done: 最近 5 条已完成(折叠更早的)
    if (doneCard && doneCard.tasks.length > 0) {
      const doneBlock = wrap.createDiv({ cls: "cw-focus-block cw-focus-done-block" });
      const completed = doneCard.tasks.filter((task) => task.checked);
      const headerRow = doneBlock.createDiv({ cls: "cw-focus-block-title-row" });
      headerRow.createDiv({ cls: "cw-focus-block-title", text: `今日已完成 ${completed.length} 项` });
      headerRow.createSpan({ cls: "cw-focus-block-hint", text: "cron 自动汇总 · 仅显示最近 5 条" });
      const recent = completed.slice(-5).reverse();
      const list = doneBlock.createDiv({ cls: "cw-preview-list" });
      for (const task of recent) {
        this.renderCompactTask(list, doneCard, task);
      }
      if (completed.length > 5) {
        doneBlock.createDiv({ cls: "cw-focus-more", text: `…还有 ${completed.length - 5} 条,展开 dashboard.md 查看全部` });
      }
    }
  }

  renderContentModule(container, section, primaryCard) {
    const card = WorkbenchDerive.pickContentCard(section) || primaryCard;
    const intro = container.createDiv({ cls: "cw-content-current" });
    intro.createSpan({ text: "当前主线：" });
    intro.createEl("strong", { text: card ? card.title : "等待确认" });
    if (card && card.status) intro.createSpan({ cls: "cw-mini-badge cw-mini-badge-violet", text: card.status });

    this.renderPipeline(container, card);

    const list = container.createDiv({ cls: "cw-preview-list" });
    if (card) {
      const tasks = TaskLogic.prioritizeTasks(WorkbenchDerive.getOpenTasks(card)).slice(0, 2);
      for (const task of tasks) this.renderCompactTask(list, card, task);
      if (tasks.length === 0) list.createDiv({ cls: "cw-empty-task", text: "内容任务已完成" });
    }
    this.renderChannelChips(container, card);
  }

  renderPipeline(container, card) {
    const state = WorkbenchDerive.buildPipelineState(card);
    const pipe = container.createDiv({ cls: "cw-pipeline" });
    for (const step of state.steps) {
      const item = pipe.createDiv({ cls: `cw-pipeline-step ${step.done ? "is-done" : ""} ${step.active ? "is-active" : ""}` });
      item.createSpan({ text: step.label });
      item.createEl("small", { text: step.done ? "✓" : step.active ? "now" : "next" });
    }
  }

  renderChannelChips(container, card) {
    const chips = WorkbenchDerive.getChannelChips(card);
    if (chips.length === 0) return;
    const row = container.createDiv({ cls: "cw-channel-row" });
    for (const chip of chips) {
      row.createSpan({ cls: `cw-channel-chip cw-channel-${chip.key}`, text: chip.label });
    }
  }

  renderCompactTask(container, card, task) {
    const row = container.createDiv({
      cls: `cw-compact-task ${task.checked ? "is-done" : ""}`,
      attr: { "data-task-line": String(task.lineIndex) },
    });
    const checkbox = row.createEl("input", { type: "checkbox", cls: "cw-task-checkbox" });
    checkbox.checked = task.checked;
    checkbox.addEventListener("change", async () => {
      await this.toggleTask(card, task, checkbox.checked);
    });
    const text = row.createDiv({ cls: "cw-compact-task-text" });
    renderInline(text, TaskLogic.cleanTaskLabel(task.text), (target) => this.plugin.openPath(target));
    const badge = WorkbenchDerive.getTaskBadge(task);
    row.createSpan({ cls: `cw-mini-badge ${badge.cls}`, text: badge.label });
  }

  renderDailyTimeline(container) {
    const timeline = container.createDiv({ cls: "cw-timeline" });
    const items = [
      ["上午 · 发布", "公众号群发，检查标题、摘要、排版和首屏节奏。"],
      ["下午 · 分发", "X Thread、小红书拆分、即刻切片，人工终审后发布。"],
      ["晚上 · 回流", "把完成情况写回日记，准备周六复盘材料。"],
    ];
    for (const [title, text] of items) {
      const card = timeline.createDiv({ cls: "cw-time-card" });
      card.createEl("strong", { text: title });
      card.createEl("p", { text });
    }
  }

  renderSections(container) {
    const sections = container.createDiv({ cls: "cw-sections" });
    for (const def of SECTION_TYPES) {
      const section = this.data.sections.find((item) => item.type === def.key);
      const block = sections.createDiv({ cls: "cw-section", attr: { "data-section": def.key } });
      const header = block.createDiv({ cls: "cw-section-header" });
      const title = header.createDiv({ cls: "cw-section-title" });
      const icon = title.createSpan({ cls: "cw-section-icon" });
      setIcon(icon, def.icon);
      title.createEl("h2", { text: def.title });
      this.createIconButton(header, "添加任务", "plus", () => this.addTaskToSection(def.key));

      const cardsWrap = block.createDiv({ cls: "cw-cards" });
      if (!section || section.cards.length === 0) {
        cardsWrap.createDiv({ cls: "cw-empty", text: "这里还没有卡片。" });
        continue;
      }
      const visibleCards = section.cards.filter(WorkbenchDerive.shouldRenderWorkbenchCard);
      const completedCards = section.cards.filter(WorkbenchDerive.isCompletedOperationalCard);
      if (visibleCards.length === 0 && completedCards.length === 0) {
        cardsWrap.createDiv({ cls: "cw-empty", text: "这里还没有卡片。" });
        continue;
      }
      for (const card of visibleCards) {
        this.renderCard(cardsWrap, card, def);
      }
      if (completedCards.length > 0) {
        this.renderCompletedCardDrawer(cardsWrap, completedCards, def);
      }
    }
  }

  renderCard(container, card, def) {
    const el = container.createDiv({ cls: "cw-card", attr: { "data-card-id": card.id } });
    el.style.setProperty("--cw-accent", def.color);

    const head = el.createDiv({ cls: "cw-card-head" });
    const titleWrap = head.createDiv({ cls: "cw-card-title-wrap" });
    titleWrap.createEl("h3", { text: card.title });
    if (card.status || card.next) {
      const meta = titleWrap.createDiv({ cls: "cw-card-meta" });
      if (card.status) meta.createSpan({ text: `状态：${card.status}` });
      if (card.next) meta.createSpan({ text: `下一步：${card.next}` });
    }

    const actions = head.createDiv({ cls: "cw-card-actions" });
    if (card.link) {
      this.createIconButton(actions, "打开关联笔记", "external-link", () => {
        this.plugin.openPath(stripWikiLink(card.link));
      });
    }
    this.createIconButton(actions, "添加任务", "plus", () => this.addTaskToCard(card));

    const stats = WorkbenchDerive.collectCardStats(card);
    const progress = el.createDiv({ cls: "cw-card-progress" });
    progress.createSpan({ text: `${stats.done}/${stats.total}` });
    const track = progress.createDiv({ cls: "cw-progress" });
    const bar = track.createDiv({ cls: "cw-progress-bar" });
    bar.style.width = `${stats.total ? Math.round((stats.done / stats.total) * 100) : 0}%`;

    if (card.body.length > 0) {
      const body = el.createDiv({ cls: "cw-card-body" });
      for (const line of card.body) {
        if (line.trim()) body.createDiv({ text: line });
      }
    }

    const taskList = el.createDiv({ cls: "cw-task-list" });
    const openTasks = TaskLogic.prioritizeTasks(WorkbenchDerive.getOpenTasks(card));
    const completedTasks = card.tasks.filter((task) => task.checked);
    if (card.tasks.length === 0) {
      taskList.createDiv({ cls: "cw-empty-task", text: "暂无任务" });
    }
    if (card.tasks.length > 0 && openTasks.length === 0) {
      taskList.createDiv({ cls: "cw-empty-task cw-empty-task-done", text: "未完成项已清空" });
    }
    for (const task of openTasks) {
      this.renderTask(taskList, card, task);
    }
    if (completedTasks.length > 0) {
      this.renderCompletedTasks(el, card, completedTasks);
    }
  }

  renderCompletedTasks(container, card, tasks) {
    const details = container.createEl("details", { cls: "cw-completed-panel" });
    const summary = details.createEl("summary", { text: `已完成 ${tasks.length} 项` });
    summary.setAttr("title", "展开查看已完成任务，可取消勾选");
    const list = details.createDiv({ cls: "cw-task-list cw-completed-list" });
    for (const task of TaskLogic.prioritizeTasks(tasks)) {
      this.renderTask(list, card, task);
    }
  }

  renderCompletedCardDrawer(container, cards, def) {
    const details = container.createEl("details", { cls: "cw-section-completed-panel" });
    details.createEl("summary", { text: `已完成分组 ${cards.length} 个` });
    const wrap = details.createDiv({ cls: "cw-section-completed-list" });
    for (const card of cards) {
      const item = wrap.createDiv({ cls: "cw-completed-card", attr: { "data-card-id": card.id } });
      item.style.setProperty("--cw-accent", def.color);
      item.createDiv({ cls: "cw-completed-card-title", text: `${card.title} · ${card.tasks.length} 项` });
      const list = item.createDiv({ cls: "cw-task-list cw-completed-list" });
      for (const task of TaskLogic.prioritizeTasks(card.tasks)) {
        this.renderTask(list, card, task);
      }
    }
  }

  renderTask(container, card, task) {
    const row = container.createDiv({
      cls: `cw-task ${task.checked ? "is-done" : ""}`,
      attr: {
        draggable: "true",
        "data-line": String(task.lineIndex),
        "data-task-line": String(task.lineIndex),
      },
    });

    row.addEventListener("dragstart", (event) => {
      this.draggedTask = WorkbenchDerive.createTaskSnapshot(card, task);
      row.addClass("is-dragging");
      if (event.dataTransfer) event.dataTransfer.setData("text/plain", String(task.lineIndex));
    });
    row.addEventListener("dragend", () => row.removeClass("is-dragging"));
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      row.addClass("is-drag-over");
    });
    row.addEventListener("dragleave", () => row.removeClass("is-drag-over"));
    row.addEventListener("drop", async (event) => {
      event.preventDefault();
      row.removeClass("is-drag-over");
      const target = WorkbenchDerive.createTaskSnapshot(card, task);
      if (this.draggedTask && this.draggedTask.lineIndex !== target.lineIndex) {
        await this.reorderTask(this.draggedTask, target);
      }
      this.draggedTask = null;
    });

    const checkbox = row.createEl("input", { type: "checkbox", cls: "cw-task-checkbox" });
    checkbox.checked = task.checked;
    checkbox.addEventListener("change", async () => {
      await this.toggleTask(card, task, checkbox.checked);
    });

    const text = row.createDiv({ cls: "cw-task-text" });
    renderInline(text, TaskLogic.cleanTaskLabel(task.text), (target) => this.plugin.openPath(target));
    const carryoverDate = TaskLogic.getCarryoverDate(task);
    if (carryoverDate && !task.checked) text.createSpan({ cls: "cw-inline-badge cw-inline-badge-carry", text: `续办 ${carryoverDate.slice(5)}` });

    const controls = row.createDiv({ cls: "cw-task-controls" });
    this.createIconButton(controls, "编辑", "pencil", () => this.editTask(card, task));
    this.createIconButton(controls, "删除", "trash-2", () => this.deleteTask(card, task));
  }

  renderSidebar(sidebar) {
    this.renderAgentStatus(sidebar);
    this.renderWeekCalendar(sidebar);
    this.renderDailyDigest(sidebar);
    this.renderHealthLight(sidebar);
    this.renderRecentDeposits(sidebar);
    this.renderQuickActions(sidebar);
  }

  renderWeekCalendar(sidebar) {
    const box = sidebar.createDiv({ cls: "cw-side-box" });
    box.createEl("h3", { text: `${getISOWeekString(new Date()).replace(/^\d{4}-/, "")} 周历` });
    const row = box.createDiv({ cls: "cw-week" });
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      const cell = row.createDiv({ cls: `cw-week-cell ${sameDay(date, now) ? "is-today" : ""}` });
      cell.createDiv({ cls: "cw-week-label", text: "一二三四五六日"[i] });
      cell.createDiv({ cls: "cw-week-date", text: WEEK_RHYTHM[i] });
    }
  }

  renderQuickActions(sidebar) {
    const box = sidebar.createDiv({ cls: "cw-side-box" });
    box.createEl("h3", { text: "快捷入口" });
    const actions = normalizeQuickActions(this.data.quickActions, this.plugin);
    for (const action of actions) {
      this.createActionButton(box, action.name, action.icon, `qa-${DashboardLogic.slugify(action.name)}`, () => this.runQuickAction(action));
    }
  }

  async runQuickAction(action) {
    if (action.type === "command" && action.target) {
      const executed = this.app.commands.executeCommandById(action.target);
      if (!executed) new Notice(`没有找到命令：${action.target}`);
      return;
    }
    if (!action.target) {
      new Notice("快捷入口缺少 target");
      return;
    }
    await this.plugin.openPath(action.target);
  }

  renderAgentStatus(sidebar) {
    const groups = WorkbenchDerive.collectAgentTaskGroups(this.data);
    const stats = {
      agent: groups.agent.length,
      waiting: groups.waiting.length,
      done: groups.done.length,
      blocked: groups.blocked.length,
    };
    const box = sidebar.createDiv({ cls: "cw-side-box" });
    box.createEl("h3", { text: "Agent 协作" });
    const metrics = box.createDiv({ cls: "cw-side-metrics" });
    this.renderSideMetric(metrics, String(stats.agent), "待执行", () => this.jumpToAgentGroup(groups.agent));
    this.renderSideMetric(metrics, String(stats.waiting), "等确认", () => this.jumpToAgentGroup(groups.waiting));
    this.renderSideMetric(metrics, String(stats.done), "已完成", () => this.jumpToAgentGroup(groups.done));
    this.renderSideMetric(metrics, String(stats.blocked), "阻塞", () => this.jumpToAgentGroup(groups.blocked));
    const compact = box.createDiv({ cls: "cw-agent-compact" });
    compact.createDiv({ text: "Agent 明细已合并到主区域的 Todo 列表。" });
    const jump = compact.createDiv({ cls: "cw-agent-jump", attr: { role: "button", tabindex: "0" } });
    jump.createSpan({ text: "查看 Todo 列表" });
    jump.addEventListener("click", () => this.scrollToSection("todo"));
    jump.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.scrollToSection("todo");
      }
    });
    box.createDiv({ cls: "cw-agent-note", text: this.getAgentSuggestion(stats) });
  }

  renderAgentQueue(container, groups) {
    const queue = container.createDiv({ cls: "cw-agent-queue" });
    this.renderAgentGroup(queue, "Agent 队列", groups.agent, "当前没有 Agent 待执行任务");
    this.renderAgentGroup(queue, "等你确认", groups.waiting, "当前没有等待确认项");
    this.renderAgentGroup(queue, "已完成", groups.done, "还没有记录 Agent 已完成任务");
  }

  renderAgentGroup(container, title, items, emptyText) {
    const group = container.createDiv({ cls: "cw-agent-group" });
    const head = group.createDiv({ cls: "cw-agent-group-head" });
    head.createEl("h4", { text: title });
    head.createSpan({ text: `${items.length}` });
    if (items.length === 0) {
      group.createDiv({ cls: "cw-agent-empty", text: emptyText });
      return;
    }
    for (const item of items.slice(0, 4)) {
      const task = group.createDiv({
        cls: `cw-agent-task ${item.task.checked ? "is-done" : ""}`,
        attr: { role: "button", tabindex: "0", title: TaskLogic.cleanTaskLabel(item.task.text) },
      });
      const text = task.createDiv({ cls: "cw-agent-task-title" });
      renderInline(text, TaskLogic.cleanTaskLabel(item.task.text), (target) => this.plugin.openPath(target));
      task.createDiv({ cls: "cw-agent-task-meta", text: `${item.card.title} · ${item.task.checked ? "完成" : item.label}` });
      task.addEventListener("click", () => this.scrollToCard(item.card));
      task.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.scrollToCard(item.card);
        }
      });
    }
    if (items.length > 4) {
      group.createDiv({ cls: "cw-agent-more", text: `还有 ${items.length - 4} 项在下方卡片里` });
    }
  }

  renderDailyDigest(sidebar) {
    const box = sidebar.createDiv({ cls: "cw-side-box" });
    const head = box.createDiv({ cls: "cw-side-box-head" });
    head.createEl("h3", { text: "今日日志" });
    const open = head.createEl("button", { cls: "cw-mini-icon-btn", attr: { type: "button", title: "打开今日日记" } });
    setIcon(open, "external-link");
    open.addEventListener("click", () => this.plugin.openTodayNote());

    const digest = this.dailyDigest;
    if (!digest || digest.missing) {
      box.createDiv({ cls: "cw-side-hint", text: "今日日记还没有创建，点击右上角可以打开并生成。" });
      return;
    }
    if (digest.isEmpty) {
      box.createDiv({ cls: "cw-side-hint", text: "今日日记已有文件，但还没有完成、计划或 Agent 复盘内容。" });
      return;
    }
    for (const section of digest.visibleSections.slice(0, 3)) {
      this.renderDigestSection(box, section);
    }
  }

  renderDigestSection(container, section) {
    const group = container.createDiv({ cls: `cw-digest-section cw-digest-${section.key}` });
    group.createDiv({ cls: "cw-digest-label", text: section.label });
    for (const item of section.items) {
      const row = group.createDiv({ cls: "cw-digest-item" });
      renderInline(row, item, (target) => this.plugin.openPath(target));
    }
  }

  renderRecentDeposits(sidebar) {
    const box = sidebar.createDiv({ cls: "cw-side-box" });
    box.createEl("h3", { text: "最近沉淀" });
    const activity = this.activity || WorkbenchDerive.collectVaultActivity(this.app.vault.getMarkdownFiles());
    const files = activity.recentFiles.slice(0, 6);
    if (files.length === 0) {
      box.createDiv({ cls: "cw-side-hint", text: "最近 90 天没有工作区 Markdown 活跃记录。" });
      return;
    }
    for (const file of files) {
      const item = box.createDiv({ cls: "cw-recent-file" });
      item.createSpan({ text: file.basename });
      item.createEl("small", { text: `${file.workspace.label} · ${formatRelativeTime(file.mtime)} · ${formatShortPath(file.path)}` });
      item.addEventListener("click", () => this.plugin.openPath(file.path));
    }
  }

  renderHealthLight(sidebar) {
    const snapshot = this.getVaultSnapshot();
    const health = this.health;
    const summary = WorkbenchDerive.getHealthSummary(health);
    const warnings = WorkbenchDerive.getHealthIssueCount(health, "warning");
    const errors = WorkbenchDerive.getHealthIssueCount(health, "error");
    const stale = WorkbenchDerive.isHealthCacheStale(health, HEALTH_CACHE_MAX_AGE_HOURS);
    const gbrain = WorkbenchDerive.getGbrainRelationHealth(health, GBRAIN_LINK_DENSITY_WARN);
    const box = sidebar.createDiv({ cls: "cw-side-box cw-health-light" });
    box.createEl("h3", { text: "知识库健康" });
    this.renderHealthRow(box, "Vault 文件", String(summary && summary.files ? summary.files : snapshot.files));
    this.renderHealthRow(box, "素材库", String(snapshot.source));
    this.renderHealthRow(box, "wiki 页面", String(summary && summary.wiki_files ? summary.wiki_files : snapshot.wiki));
    this.renderHealthRow(box, "产出文件", String(snapshot.output));
    if (summary) {
      const hasBlockingIssues = warnings > 0 || errors > 0 || stale;
      const healthLabel = stale && warnings === 0 && errors === 0 ? "缓存过期" : hasBlockingIssues ? "健康警告" : "健康状态";
      const healthValue = stale && warnings === 0 && errors === 0 ? `超过 ${HEALTH_CACHE_MAX_AGE_HOURS}h` : hasBlockingIssues ? `${warnings} warning / ${errors} error` : "通过";
      this.renderHealthRow(
        box,
        healthLabel,
        healthValue,
        hasBlockingIssues ? "warn" : "ok"
      );
      this.renderHealthRow(box, "GBrain 关系", gbrain.label, gbrain.state);
      if (stale) {
        const item = box.createDiv({ cls: "cw-health-issue" });
        item.createSpan({ text: "cache_stale" });
        item.createEl("small", { text: `健康缓存超过 ${HEALTH_CACHE_MAX_AGE_HOURS} 小时未刷新，建议运行 python3 tools/update_workbench_health_cache.py` });
      }
      if (hasBlockingIssues) {
        const issues = WorkbenchDerive.getHealthIssues(health).slice(0, 2);
        for (const issue of issues) {
          const item = box.createDiv({ cls: "cw-health-issue" });
          item.createSpan({ text: issue.check || issue.level || "issue" });
          item.createEl("small", { text: `${formatShortPath(issue.path || "")} · ${issue.detail || ""}` });
        }
      }
      box.createDiv({
        cls: "cw-side-hint",
        text: `缓存：${WorkbenchDerive.formatHealthTime(health.generatedAt)} · ${gbrain.hint} · 工作台只读观察结构，不移动素材库、不改 LLM Wiki 目录。`,
      });
      return;
    }

    if (health && health.error) {
      this.renderHealthRow(box, "健康缓存", "解析失败", "warn");
      box.createDiv({ cls: "cw-side-hint", text: `${health.path}: ${health.message}` });
      return;
    }

    this.renderHealthRow(box, "健康缓存", "未生成", "warn");
    box.createDiv({
      cls: "cw-side-hint",
      text: `运行 python3 tools/update_workbench_health_cache.py 后，这里会显示健康检查门禁。`,
    });
  }

  renderSideMetric(container, value, label, callback) {
    const item = container.createEl("button", {
      cls: "cw-side-metric",
      attr: { type: "button", title: `查看${label}` },
    });
    item.createEl("strong", { text: value });
    item.createSpan({ text: label });
    item.addEventListener("click", () => callback && callback());
  }

  jumpToAgentGroup(items) {
    if (items && items.length > 0) {
      this.scrollToCard(items[0].card);
      return;
    }
    this.scrollToSection("todo");
  }

  scrollToSection(sectionType) {
    const target = this.containerEl.querySelector(`[data-section="${sectionType}"]`);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  scrollToCard(card) {
    if (!card) {
      this.scrollToSection("todo");
      return;
    }
    const target = Array.from(this.containerEl.querySelectorAll(".cw-card, .cw-completed-card"))
      .find((item) => item.getAttribute("data-card-id") === card.id);
    if (!target) {
      this.scrollToSection(card.type || "todo");
      return;
    }
    const details = target.closest("details");
    if (details) details.open = true;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.addClass("is-focus-flash");
    setTimeout(() => target.removeClass("is-focus-flash"), 1600);
  }

  scrollToTask(card, task) {
    if (!task) {
      this.scrollToCard(card);
      return;
    }
    const target = this.containerEl.querySelector(`.cw-task[data-task-line="${task.lineIndex}"]`)
      || this.containerEl.querySelector(`.cw-compact-task[data-task-line="${task.lineIndex}"]`);
    if (!target) {
      this.scrollToCard(card);
      return;
    }
    const details = target.closest("details");
    if (details) details.open = true;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.addClass("is-focus-flash");
    setTimeout(() => target.removeClass("is-focus-flash"), 1600);
  }

  renderHealthRow(container, label, value, state = "") {
    const row = container.createDiv({ cls: "cw-health-row" });
    row.createSpan({ text: label });
    const right = row.createSpan({ cls: state === "warn" ? "cw-health-warn" : state === "ok" ? "cw-health-ok" : "" });
    if (state === "warn") right.createSpan({ cls: "cw-dot is-yellow" });
    if (state === "ok") right.createSpan({ cls: "cw-dot is-green" });
    right.appendText(value);
  }

  createSummaryJump(parent, label, title, callback) {
    const button = parent.createEl("button", {
      cls: "cw-summary-jump",
      attr: { type: "button", title },
    });
    button.createSpan({ text: label });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      callback();
    });
    return button;
  }

  jumpToFirstTask(predicate, options = {}) {
    const match = WorkbenchDerive.findFirstVisibleTask(this.data, predicate, options);
    if (!match) {
      new Notice("当前没有符合条件的任务");
      return;
    }
    this.scrollToTask(match.card, match.task);
  }

  showTaskInbox(kind) {
    const config = this.getTaskInboxConfig(kind);
    const items = this.collectTaskInboxItems(kind);
    if (items.length === 0) {
      new Notice(config.emptyText);
      return;
    }
    new WorkbenchTaskListModal(this.app, this, config, items).open();
  }

  getTaskInboxConfig(kind) {
    if (kind === "carryover") {
      return {
        kind,
        title: "遗留任务处理",
        subtitle: "这些任务从之前的工作日滚入今天，建议逐项决定继续、延期、取消或交给 Agent。",
        emptyText: "当前没有遗留任务",
      };
    }
    if (kind === "done") {
      return {
        kind,
        title: "今日已完成",
        subtitle: "这里列出当前工作台中的已完成事项，可定位回原卡片复核。",
        emptyText: "当前没有已完成任务",
      };
    }
    return {
      kind: "open",
      title: "未完成任务",
      subtitle: "这里汇总今日行动、Todo 和生活待办中的未完成项，可直接定位处理。",
      emptyText: "当前没有未完成任务",
    };
  }

  collectTaskInboxItems(kind) {
    if (!this.data || !Array.isArray(this.data.sections)) return [];
    const items = [];
    for (const section of this.data.sections) {
      if (section.type === "content") continue;
      for (const card of section.cards) {
        for (const task of card.tasks) {
          const carryoverDate = TaskLogic.getCarryoverDate(task);
          if (kind === "done" && !task.checked) continue;
          if (kind === "carryover" && (task.checked || !carryoverDate)) continue;
          if (kind !== "done" && kind !== "carryover" && task.checked) continue;
          items.push({
            section,
            card,
            task,
            carryoverDate,
            carryoverAge: carryoverDate ? getCarryoverAge(carryoverDate) : 0,
            meta: TaskLogic.getTaskMeta(task),
          });
        }
      }
    }
    return items.sort((a, b) => {
      if (kind === "done") return b.task.lineIndex - a.task.lineIndex;
      if (a.carryoverAge !== b.carryoverAge) return b.carryoverAge - a.carryoverAge;
      const prioritized = TaskLogic.prioritizeTasks([a.task, b.task]);
      if (prioritized[0] === a.task && prioritized[0] !== b.task) return -1;
      if (prioritized[0] === b.task && prioritized[0] !== a.task) return 1;
      return a.task.lineIndex - b.task.lineIndex;
    });
  }

  async completeInboxTask(card, task) {
    await this.toggleTask(card, task, true);
  }

  async continueCarryoverTask(card, task) {
    const outcome = await this.mutateTask(card, task, (latestTask) => ({
      checked: false,
      text: TaskLogic.continueTaskText(latestTask.text),
    }));
    new Notice(outcome && outcome.changed ? "已放回今日任务" : "任务已变化，请刷新后再试");
  }

  async deferTask(card, task) {
    const date = formatDate(addDays(new Date(), 1));
    const outcome = await this.mutateTask(card, task, (latestTask) => ({
      checked: false,
      text: TaskLogic.deferTaskText(latestTask.text, date),
    }));
    new Notice(outcome && outcome.changed ? `已延期到 ${date}` : "任务已变化，请刷新后再试");
  }

  async delegateTaskToAgent(card, task) {
    const outcome = await this.mutateTask(card, task, (latestTask) => ({
      checked: false,
      text: TaskLogic.delegateTaskText(latestTask.text),
    }));
    new Notice(outcome && outcome.changed ? "已交给 Agent" : "任务已变化，请刷新后再试");
  }

  async cancelTaskFromInbox(card, task) {
    const confirmed = confirm(`取消任务：${TaskLogic.cleanTaskLabel(task.text)}`);
    if (!confirmed) return;
    const outcome = await this.mutateTask(card, task, (latestTask) => ({
      checked: true,
      text: TaskLogic.cancelTaskText(latestTask.text),
    }));
    new Notice(outcome && outcome.changed ? "已标记为取消" : "任务已变化，请刷新后再试");
  }

  async mutateTask(card, task, mutate) {
    const snapshot = WorkbenchDerive.createTaskSnapshot(card, task);
    return this.plugin.processDashboard((markdown, data) => {
      const latestCard = WorkbenchDerive.findMatchingCard(data, snapshot.card);
      const latestTask = TaskLogic.findMatchingTask(markdown, latestCard, snapshot);
      if (!latestTask) return { markdown, changed: false, reason: "task-missing" };

      const next = mutate(latestTask);
      if (!next) return { markdown, changed: false, taskText: latestTask.text };
      const nextText = next.text === undefined ? latestTask.text : next.text;
      const nextChecked = next.checked === undefined ? latestTask.checked : Boolean(next.checked);
      const update = DashboardLogic.updateTaskLineInMarkdown(markdown, latestTask.lineIndex, nextText, nextChecked);
      return { ...update, taskText: nextText, wasChecked: next.wasChecked };
    });
  }

  getAgentSuggestion(stats) {
    if (stats.waiting > 0) return "建议：先处理等你确认的事项，Agent 才能继续向下推进。";
    if (stats.agent > 0) return "建议：把可交给 Agent 的素材扫描、拆稿和复盘先派出去。";
    return "建议：先完成今日行动，再把完成情况写回日记。";
  }

  getVaultSnapshot() {
    const files = this.app.vault.getFiles();
    return {
      files: files.length,
      source: files.filter((file) => file.path.startsWith("素材库/")).length,
      wiki: files.filter((file) => file.path.startsWith("wiki/") && file.extension === "md").length,
      output: files.filter((file) => file.path.startsWith("产出/")).length,
    };
  }

  createActionButton(parent, label, iconName, cls, callback) {
    const btn = parent.createEl("button", { cls: `cw-btn ${cls || ""}` });
    const icon = btn.createSpan({ cls: "cw-btn-icon" });
    setIcon(icon, iconName);
    btn.createSpan({ text: label });
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      callback();
    });
    return btn;
  }

  createIconButton(parent, label, iconName, callback) {
    const btn = parent.createEl("button", { cls: "cw-icon-btn", attr: { "aria-label": label, title: label } });
    setIcon(btn, iconName);
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      callback();
    });
    return btn;
  }

  async addTaskToDefaultCard() {
    await this.addTaskToSection("todo");
  }

  async addTaskToSection(sectionType) {
    const section = this.data.sections.find((item) => item.type === sectionType);
    const card = section && section.cards.length ? section.cards[0] : null;
    if (!card) {
      new Notice("这个模块还没有卡片");
      return;
    }
    await this.addTaskToCard(card);
  }

  async addTaskToCard(card) {
    const cardSnapshot = WorkbenchDerive.createCardSnapshot(card);
    const modal = new TaskTextModal(this.app, `添加到 ${card.title}`, async (text) => {
      const outcome = await this.plugin.processDashboard((markdown, data) => {
        const latestCard = WorkbenchDerive.findMatchingCard(data, cardSnapshot);
        if (!latestCard) return { markdown, changed: false, reason: "card-missing" };
        return {
          markdown: DashboardLogic.insertTaskLine(markdown, latestCard, text),
          changed: true,
        };
      });
      new Notice(outcome && outcome.changed ? "已添加任务" : "没有找到对应卡片");
    });
    modal.open();
  }

  async toggleTask(card, task, checked) {
    const outcome = await this.mutateTask(card, task, (t) => {
      if (t.checked === checked) return null;
      return { checked, wasChecked: t.checked };
    });
    if (!outcome) {
      new Notice("任务已变化，请刷新工作台后再试");
      return;
    }
    if (outcome.changed && checked && !outcome.wasChecked) {
      const appended = await this.plugin.appendCompletionToToday(outcome.taskText);
      if (appended) new Notice("已写入今日日记");
    }
  }

  async editTask(card, task) {
    const modal = new TaskTextModal(this.app, "编辑任务", async (text) => {
      const outcome = await this.mutateTask(card, task, (latestTask) => {
        const carryover = TaskLogic.getCarryoverDate(latestTask);
        const nextText = carryover && !/\[遗留:\d{4}-\d{2}-\d{2}\]/.test(text) ? `${text} [遗留:${carryover}]` : text;
        return { text: nextText };
      });
      if (!outcome || !outcome.changed) new Notice("任务已变化，请刷新工作台后再试");
    }, TaskLogic.cleanTaskLabel(task.text));
    modal.open();
  }

  async deleteTask(card, task) {
    const confirmed = confirm(`删除任务：${task.text}`);
    if (!confirmed) return;
    const snapshot = WorkbenchDerive.createTaskSnapshot(card, task);
    const outcome = await this.plugin.processDashboard((markdown, data) => {
      const latestCard = WorkbenchDerive.findMatchingCard(data, snapshot.card);
      const latestTask = TaskLogic.findMatchingTask(markdown, latestCard, snapshot);
      if (!latestTask) return { markdown, changed: false, reason: "task-missing" };

      const lines = markdown.split("\n");
      lines.splice(latestTask.lineIndex, 1);
      return { markdown: lines.join("\n"), changed: true };
    });
    if (!outcome || !outcome.changed) new Notice("任务已变化，请刷新工作台后再试");
  }

  async reorderTask(source, target) {
    const outcome = await this.plugin.processDashboard((markdown, data) => {
      const sourceCard = WorkbenchDerive.findMatchingCard(data, source.card);
      const targetCard = WorkbenchDerive.findMatchingCard(data, target.card);
      if (!sourceCard || !targetCard) return { markdown, changed: false, reason: "card-missing" };
      if (sourceCard.id !== targetCard.id) return { markdown, changed: false, reason: "cross-card" };

      const sourceTask = TaskLogic.findMatchingTask(markdown, sourceCard, source);
      const targetTask = TaskLogic.findMatchingTask(markdown, targetCard, target);
      if (!sourceTask || !targetTask) return { markdown, changed: false, reason: "task-missing" };
      if (sourceTask.lineIndex === targetTask.lineIndex) return { markdown, changed: false, reason: "same-task" };

      const lines = markdown.split("\n");
      const [line] = lines.splice(sourceTask.lineIndex, 1);
      let insertAt = targetTask.lineIndex;
      if (sourceTask.lineIndex < targetTask.lineIndex) insertAt -= 1;
      lines.splice(insertAt, 0, line);
      return { markdown: lines.join("\n"), changed: true };
    });

    if (!outcome || !outcome.changed) {
      if (outcome && outcome.reason === "cross-card") new Notice("暂不支持跨卡片拖拽");
      else if (outcome && outcome.reason !== "same-task") new Notice("任务已变化，请刷新工作台后再试");
    }
  }
}

class WorkbenchTaskListModal extends Modal {
  constructor(app, view, config, items) {
    super(app);
    this.view = view;
    this.config = config;
    this.items = items;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("cw-task-inbox-modal");
    const head = contentEl.createDiv({ cls: "cw-task-inbox-head" });
    head.createEl("h2", { text: this.config.title });
    head.createDiv({ cls: "cw-task-inbox-subtitle", text: this.config.subtitle });
    head.createDiv({ cls: "cw-task-inbox-count", text: `${this.items.length} 项` });

    const list = contentEl.createDiv({ cls: "cw-task-inbox-list" });
    for (const item of this.items) {
      this.renderItem(list, item);
    }
  }

  renderItem(container, item) {
    const row = container.createDiv({ cls: "cw-task-inbox-item" });
    const main = row.createDiv({ cls: "cw-task-inbox-main" });
    const meta = main.createDiv({ cls: "cw-task-inbox-meta" });
    meta.createSpan({ text: item.section.title });
    meta.createSpan({ text: item.card.title });
    if (item.meta.owner) meta.createSpan({ cls: "cw-task-inbox-owner", text: item.meta.owner });
    if (item.meta.status && item.meta.status !== "todo") meta.createSpan({ cls: "cw-task-inbox-status", text: getTaskStatusLabel(item.meta.status) });
    if (item.carryoverDate) {
      const age = item.carryoverAge > 0 ? `${item.carryoverAge} 天` : "今天";
      meta.createSpan({ cls: "cw-task-inbox-carry", text: `遗留 ${item.carryoverDate.slice(5)} · ${age}` });
    }

    const text = main.createDiv({ cls: `cw-task-inbox-text ${item.task.checked ? "is-done" : ""}` });
    renderInline(text, TaskLogic.cleanTaskLabel(item.task.text), (target) => this.view.plugin.openPath(target));

    const actions = row.createDiv({ cls: "cw-task-inbox-actions" });
    this.createAction(actions, "定位", "locate-fixed", async () => {
      this.close();
      this.view.scrollToTask(item.card, item.task);
    });
    if (!item.task.checked) {
      this.createAction(actions, "完成", "check", async () => {
        await this.view.completeInboxTask(item.card, item.task);
        this.close();
      });
    }
    if (this.config.kind === "carryover" && !item.task.checked) {
      this.createAction(actions, "继续", "play", async () => {
        await this.view.continueCarryoverTask(item.card, item.task);
        this.close();
      });
      this.createAction(actions, "延期", "calendar-plus", async () => {
        await this.view.deferTask(item.card, item.task);
        this.close();
      });
      this.createAction(actions, "交给 Agent", "send", async () => {
        await this.view.delegateTaskToAgent(item.card, item.task);
        this.close();
      });
      this.createAction(actions, "取消", "circle-slash", async () => {
        await this.view.cancelTaskFromInbox(item.card, item.task);
        this.close();
      }, "is-danger");
    }
  }

  createAction(parent, label, iconName, callback, extraClass = "") {
    const button = parent.createEl("button", {
      cls: `cw-task-inbox-action ${extraClass}`,
      attr: { type: "button", title: label },
    });
    setIcon(button.createSpan({ cls: "cw-task-inbox-action-icon" }), iconName);
    button.createSpan({ text: label });
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await callback();
    });
    return button;
  }
}

class TaskTextModal extends Modal {
  constructor(app, title, onSubmit, initialValue = "") {
    super(app);
    this.title = title;
    this.onSubmit = onSubmit;
    this.initialValue = initialValue;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title });
    const input = contentEl.createEl("textarea", { cls: "cw-task-input" });
    input.value = this.initialValue;
    input.focus();
    const actions = contentEl.createDiv({ cls: "cw-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    const submit = actions.createEl("button", { text: "保存", cls: "mod-cta" });
    cancel.addEventListener("click", () => this.close());
    submit.addEventListener("click", async () => {
      const value = input.value.trim();
      if (!value) return;
      await this.onSubmit(value);
      this.close();
    });
    input.addEventListener("keydown", async (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        submit.click();
      }
    });
  }
}

class WorkbenchSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Wiki Workbench" });

    this.addTextSetting("工作台文件", "dashboard.md", "dashboardFile");
    this.addTextSetting("日记目录", "Journal", "dailyFolder");
    this.addTextSetting("周计划目录", "Plans/Weekly", "weeklyFolder");
    this.addTextSetting("月计划目录", "Plans/Monthly", "monthlyFolder");
    this.addTextSetting("内容流程", "Wiki/Content/workflow.md", "contentFlowPath");
    this.addTextSetting("项目索引", "Wiki/Projects/index.md", "projectIndexPath");
    this.addTextSetting("健康缓存", "Workbench/vault-health.json", "healthCachePath");
    this.addTextSetting("完成记录标题", "今日完成", "completionLogHeading");
    this.addThemeSetting();
    this.addToggleSetting("勾选完成后写入今日日记", "autoAppendCompletedToDaily");
  }

  addTextSetting(name, placeholder, key) {
    new Setting(this.containerEl)
      .setName(name)
      .addText((text) => {
        text
          .setPlaceholder(placeholder)
          .setValue(this.plugin.settings[key])
          .onChange(async (value) => {
            this.plugin.settings[key] = value.trim() || placeholder;
            await this.plugin.saveSettings();
          });
      });
  }

  addToggleSetting(name, key) {
    new Setting(this.containerEl)
      .setName(name)
      .addToggle((toggle) => {
        toggle
          .setValue(Boolean(this.plugin.settings[key]))
          .onChange(async (value) => {
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
          });
      });
  }

  addThemeSetting() {
    new Setting(this.containerEl)
      .setName("工作台主题")
      .setDesc("可在工作台顶部直接切换，也可以在这里固定默认主题。")
      .addDropdown((dropdown) => {
        for (const theme of WORKBENCH_THEMES) {
          dropdown.addOption(theme.key, theme.label);
        }
        dropdown
          .setValue(normalizeThemeKey(this.plugin.settings.workbenchTheme))
          .onChange(async (value) => {
            await this.plugin.setWorkbenchTheme(value);
          });
      });
  }
}

function normalizeThemeKey(value) {
  const key = String(value || "").trim();
  return WORKBENCH_THEMES.some((theme) => theme.key === key) ? key : WORKBENCH_THEMES[0].key;
}

function getThemeDefinition(value) {
  const key = normalizeThemeKey(value);
  return WORKBENCH_THEMES.find((theme) => theme.key === key) || WORKBENCH_THEMES[0];
}

function normalizeQuickActions(actions, plugin) {
  const source = Array.isArray(actions) && actions.length > 0 ? actions : getDefaultQuickActions(plugin);
  return source
    .map((action) => ({
      name: action.name || action.label || action.target || "快捷入口",
      icon: action.icon || "external-link",
      type: action.type || "file",
      target: action.target || "",
    }))
    .filter((action) => action.name && action.target);
}

function getDefaultQuickActions(plugin) {
  const today = formatDate(new Date());
  const week = getISOWeekString(new Date());
  const month = formatMonth(new Date());
  return [
    {
      name: "今日日记",
      icon: "calendar",
      type: "file",
      target: `${trimSlashes(plugin.settings.dailyFolder)}/${today}.md`,
    },
    {
      name: "本周计划",
      icon: "calendar-days",
      type: "file",
      target: `${trimSlashes(plugin.settings.weeklyFolder)}/${week}.md`,
    },
    {
      name: "本月计划",
      icon: "calendar-range",
      type: "file",
      target: `${trimSlashes(plugin.settings.monthlyFolder)}/${month}.md`,
    },
    {
      name: "内容流程",
      icon: "pen-tool",
      type: "file",
      target: plugin.settings.contentFlowPath,
    },
    {
      name: "项目索引",
      icon: "folder-kanban",
      type: "file",
      target: plugin.settings.projectIndexPath,
    },
  ];
}

function hasCompletionEntry(markdown, taskText, heading) {
  const section = extractMarkdownSection(markdown, heading);
  const target = normalizeCompletionText(taskText);
  if (!target) return true;
  return section.some((line) => normalizeCompletionText(line).includes(target));
}

function insertCompletionEntry(markdown, { heading, text, source }) {
  const now = new Date();
  const entry = `- [x] ${text} ✅ ${formatTime(now)} #workbench source:[[${source.replace(/\.md$/, "")}]]`;
  const lines = markdown.split("\n");
  let headingIndex = lines.findIndex((line) => line.trim() === `## ${heading}`);

  if (headingIndex === -1) {
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(`## ${heading}`, "", entry);
    return lines.join("\n");
  }

  let insertAt = headingIndex + 1;
  while (insertAt < lines.length && lines[insertAt].trim() === "") insertAt += 1;

  const nextHeading = findNextHeading(lines, headingIndex + 1, 2);
  const placeholderIndex = findEmptyListPlaceholder(lines, headingIndex + 1, nextHeading);
  if (placeholderIndex !== -1) {
    lines[placeholderIndex] = entry;
    return lines.join("\n");
  }

  lines.splice(insertAt, 0, entry);
  return lines.join("\n");
}

function extractMarkdownSection(markdown, heading) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return [];
  const end = findNextHeading(lines, start + 1, 2);
  return lines.slice(start + 1, end);
}

function findNextHeading(lines, start, level) {
  const pattern = new RegExp(`^#{1,${level}}\\s+`);
  for (let i = start; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i;
  }
  return lines.length;
}

function findEmptyListPlaceholder(lines, start, end) {
  for (let i = start; i < end; i++) {
    if (/^\s*-\s*$/.test(lines[i])) return i;
  }
  return -1;
}

function normalizeCompletionText(text) {
  return TaskLogic.cleanTaskLabel(text)
    .replace(/#\S+/g, "")
    .replace(/source:\[\[[^\]]+\]\]/g, "")
    .replace(/✅\s*\d{2}:\d{2}/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function collectFocusPreviewItems(section, focusCard) {
  if (!section || !Array.isArray(section.cards)) return [];
  const sourceCards = focusCard && focusCard.tasks.length > 0
    ? [focusCard]
    : section.cards.filter((card) => card.id !== "today-done");
  const items = [];
  for (const card of sourceCards) {
    for (const task of WorkbenchDerive.getOpenTasks(card)) {
      items.push({ card, task });
    }
  }
  const byTask = new Map(items.map((item) => [item.task, item]));
  return TaskLogic.prioritizeTasks(items.map((item) => item.task))
    .map((task) => byTask.get(task))
    .filter(Boolean);
}

function formatShortPath(path) {
  const parts = String(path || "").split("/");
  if (parts.length <= 2) return path;
  return `${parts[0]}/.../${parts[parts.length - 1]}`;
}

function formatRelativeTime(value) {
  const time = Number(value);
  if (!time) return "未知";
  const diff = Date.now() - time;
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 60) return minutes <= 1 ? "刚刚" : `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

function getActivityStateLabel(state) {
  if (state === "hot") return "活跃";
  if (state === "warm") return "温热";
  if (state === "cold") return "沉寂";
  return "空";
}

function getTaskStatusLabel(status) {
  if (status === "waiting") return "等确认";
  if (status === "blocked") return "阻塞";
  if (status === "deferred") return "已延期";
  if (status === "canceled") return "已取消";
  if (status === "done") return "已完成";
  return status || "待执行";
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getCarryoverAge(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

function renderInline(parent, text, openPath) {
  const linkRegex = /\[\[([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.appendText(text.slice(lastIndex, match.index));
    }
    const raw = match[1];
    const [target, label] = raw.split("|");
    const link = parent.createEl("a", { text: label || target, cls: "cw-wikilink" });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPath(target);
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parent.appendText(text.slice(lastIndex));
}

function createDefaultDashboardMarkdown() {
  const today = formatDate(new Date());
  return `---
dashboard: true
workbench: wiki
workbenchDate: "${today}"
version: 0.6
banner:
  quote: "该做的在上，该想的在下。"
  author: "Wiki"
quickActions:
  - name: "今日日记"
    icon: "calendar"
    type: file
    target: "Journal/{{today}}.md"
  - name: "本周计划"
    icon: "calendar-days"
    type: file
    target: "Plans/Weekly/{{week}}.md"
  - name: "本月计划"
    icon: "calendar-range"
    type: file
    target: "Plans/Monthly/{{month}}.md"
  - name: "内容流程"
    icon: "pen-tool"
    type: file
    target: "Wiki/Content/workflow.md"
  - name: "项目索引"
    icon: "folder-kanban"
    type: file
    target: "Wiki/Projects/index.md"
columns:
  - name: 今日行动
    color: "#d6a646"
    type: focus
  - name: Todo 列表
    color: "#6690cc"
    type: todo
  - name: 内容生成
    color: "#9b7ad6"
    type: content
  - name: 生活待办
    color: "#5da86f"
    type: life
---

## 今日行动

### 今日最重要的三件事
id: focus-today
type: focus
- [ ] 从本周计划里确认今天最重要的 1 件事
- [ ] 打开今日日记，写下今天的判断
- [ ] 晚上让 Agent 回填今日复盘

## Todo 列表

### 重点跟进
id: work-follow-up
type: task
- [ ] 5 月复盘填写 📅 ${today}

### Agent 待办
id: agent-todo
type: task
- [ ] [Agent] 根据周计划刷新今日行动

## 内容生成

### 本周内容流水线
id: content-week
type: content
link: [[Plans/Weekly/{{week}}]]
status: planning
next: 确认本周主线稿件
- [ ] 公众号长文推进
- [ ] 即刻日更
- [ ] 小红书笔记拆分

## 生活待办

### 健康习惯
id: health-habits
type: life
- [ ] 喝水 800ml
- [ ] 保健品
- [ ] 运动 30 分钟
`;
}

function createDailyNote(date) {
  return `---
title: "${date}"
date: "${date}"
type: diary
tags: [diary]
created: "${date}"
updated: "${date}"
summary: 今日记录与工作台完成回流
source: self
mood:
weather:
---

# ${date} 日记

## 今日完成

-

## 今日待办

-

## 想法与洞察

-

## 明日计划

- [ ]

## Agent 复盘

`;
}

function createWeekPlan(week) {
  return `---
title: ${week} 周计划
type: plan
tags: [规划, 周计划]
created: ${formatDate(new Date())}
updated: ${formatDate(new Date())}
summary: ${week} 周计划
source: self
week: ${week}
---

# ${week} 周计划

## 本周重点

- [ ]

## 每日记录

`;
}

function createMonthPlan(month) {
  return `---
title: ${month} 月计划
type: plan
tags: [规划, 月计划]
created: ${formatDate(new Date())}
updated: ${formatDate(new Date())}
summary: ${month} 月计划
source: self
month: ${month}
status: active
---

# ${month} 月计划

## 月度目标

- [ ]
`;
}

function normalizeFilePath(path) {
  const trimmed = trimSlashes(path);
  return trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
}

function normalizeVaultPath(path) {
  return trimSlashes(path);
}

function trimSlashes(path) {
  return String(path || "").replace(/^\/+|\/+$/g, "");
}

function stripWikiLink(value) {
  return String(value || "")
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .trim();
}

function replaceDateTokens(value) {
  const now = new Date();
  return String(value || "")
    .replace(/\{\{today\}\}/g, formatDate(now))
    .replace(/\{\{week\}\}/g, getISOWeekString(now))
    .replace(/\{\{month\}\}/g, formatMonth(now));
}
