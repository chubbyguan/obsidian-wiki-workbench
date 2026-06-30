# Chubby Wiki Workbench

`Chubby Wiki Workbench` 是给 `wiki-guanbuGuo` vault 使用的 Obsidian 日常工作台插件。它不改变现有知识库结构，而是把 `dashboard.md` 渲染成一个可交互的执行驾驶舱，用来管理今日行动、Todo、内容生成、生活待办、Hermes 协作任务和知识库活跃状态。

这个插件当前是 **desktop-only**、**no-build CommonJS** 形态：源码可以直接放在 Obsidian 插件目录里运行，不需要 TypeScript 编译或打包。

## 功能

- 今日驾驶舱：今日行动、Todo、内容生成、生活待办四个核心模块。
- 今日行动：首页显示“今日最重要的三件事”和最近完成项。
- Todo 管理：支持勾选、编辑、删除、拖拽排序、添加任务。
- Hermes 协作：识别 `[owner:Hermes]`、`[status:waiting-confirm]`、阻塞、延期、取消等任务状态。
- 任务 inbox：汇总未完成、遗留、已完成任务，并支持继续、延期、取消、交给 Hermes。
- 内容流水线：展示选题、调研、素材包、草稿、定稿、发布、回流阶段。
- 知识库活跃镜头：统计素材库、wiki、产出、日记、规划等工作区最近活跃情况。
- 91 天热力图：快速查看知识库沉淀节奏。
- 日 rollover：每天自动切换工作台日期，清理今日完成、保留内容流水线、重置健康习惯、给未完成任务打 `[遗留:YYYY-MM-DD]`。
- 日记回流：任务完成时可写入 `日记/YYYY-MM-DD.md` 的 `## 今日完成`。

## 安装

把仓库内容放到 Obsidian vault 的插件目录：

```bash
mkdir -p /path/to/vault/.obsidian/plugins/chubby-wiki-workbench
cp -R ./* /path/to/vault/.obsidian/plugins/chubby-wiki-workbench/
```

在 Obsidian 里打开：

1. `Settings -> Community plugins`
2. 关闭 Safe mode（如有）
3. 启用 `Chubby Wiki Workbench`
4. 点击左侧 ribbon 的工作台图标，或运行命令 `打开 Wiki 工作台`

在当前 vault 中，插件路径是：

```text
/Users/guandeyu/Documents/wiki-guanbuGuo/.obsidian/plugins/chubby-wiki-workbench
```

## 数据文件

默认读取和写入：

| 用途 | 默认路径 |
| --- | --- |
| 工作台数据 | `dashboard.md` |
| 日记 | `日记/YYYY-MM-DD.md` |
| 周计划 | `规划/周计划/YYYY-Www.md` |
| 月计划 | `规划/月计划/YYYY-MM.md` |
| 内容流程 | `wiki/✍️ 内容创作/流程/v7-workflow.md` |
| 项目索引 | `wiki/项目/项目-index.md` |
| 健康缓存 | `产出/工作台数据/vault-health.json` |

`data.json` 是 Obsidian 插件本地设置文件，包含当前主题、路径配置等个人设置，不应该提交到公开/独立插件仓库。

## Dashboard 协议

`dashboard.md` 使用普通 Markdown 作为数据源。二级标题是模块，三级标题是卡片，任务使用 Markdown checkbox。

```markdown
## 今日行动

### 今日最重要的三件事
id: focus-today
type: focus
- [ ] 确认今天最重要的一件事
- [ ] 推进当前主线稿件
- [ ] 晚上回填复盘

### 今日完成
id: today-done
type: focus
- [x] 发布一篇内容

## Todo 列表

### Hermes 队列
id: hermes-queue
type: task
- [ ] [owner:Hermes] [status:todo] 拉取本周素材包
- [ ] [owner:关德宇] [status:waiting-confirm] 审核选题
```

任务元数据约定：

```markdown
- [ ] [owner:Hermes] [status:todo] 生成本周数据复盘报告
- [ ] [owner:关德宇] [status:waiting-confirm] 审核 Hermes 推荐的 5 个选题
- [ ] 阻塞：缺少原始素材链接
- [ ] 旧任务 [遗留:2026-06-29]
- [ ] 延期任务 📅 2026-07-01
```

兼容 Hermes/cron 写入的完成格式：

```markdown
- ✅ 08:16 笔记同步完成
- ☑ 知识库批量处理完成
- ✔ 18:00 日记补写完成
```

这些 emoji 完成项会被解析为已完成任务；如果在 UI 里编辑或取消勾选，会被规范化写回为 checkbox 任务。

如果某个 `##` 模块下面直接出现任务、但没有 `###` 卡片标题，插件会自动生成一个 `未分组任务` 卡片承接这些任务，避免任务被忽略。

## 文件结构

```text
README.md                    插件说明
manifest.json                Obsidian 插件 manifest
package.json                 Node 测试脚本
main.js                      插件入口、渲染、命令、弹窗、vault 写回
dashboard-logic.js           dashboard markdown 解析、插入、rollover、任务行写回
task-logic.js                任务元数据、标签清理、匹配、排序、状态操作
workbench-derive.js          派生统计、内容流水线、健康状态、活跃镜头
date-utils.js                日期工具
styles.css                   布局与主题
test/workbench-logic.test.js 核心逻辑测试
```

## 验证

在插件目录或独立仓库目录运行：

```bash
npm test
npm run check
```

在 `wiki-guanbuGuo` vault 根目录运行 Obsidian DOM smoke test：

```bash
tools/obsidian_workbench_cli_check.sh
```

这个脚本会：

- 启动或连接 Obsidian
- reload `chubby-wiki-workbench`
- 打开工作台视图
- 检查 DOM 是否 ready
- 输出 `obsidian dev:errors`
- 保存截图到 `产出/工作台设计/chubby-workbench-cli-check.png`

也可以手动验证：

```bash
open -a Obsidian /Users/guandeyu/Documents/wiki-guanbuGuo
obsidian plugin:reload id=chubby-wiki-workbench
obsidian command id=chubby-wiki-workbench:open-workbench
obsidian eval code="(() => ({ root: !!document.querySelector('.chubby-workbench-root'), summaryButtons: document.querySelectorAll('.cw-summary-jump').length }))()"
obsidian dev:errors
```

## 发布范围

独立 GitHub 仓库只应该包含插件运行所需文件：

- `README.md`
- `manifest.json`
- `package.json`
- `main.js`
- `dashboard-logic.js`
- `task-logic.js`
- `workbench-derive.js`
- `date-utils.js`
- `styles.css`
- `test/workbench-logic.test.js`
- `.gitignore`

不要提交：

- `data.json`
- vault 里的 `dashboard.md`
- vault 的素材库、wiki、日记、规划、产出内容
- `.obsidian` 其他插件或用户设置

## 当前状态

- 版本：`0.6.12`
- 运行形态：no-build CommonJS
- Obsidian：desktop-only
- 测试：Node 逻辑测试 + Obsidian DOM smoke test
- 主仓库：`https://github.com/chubbyguan/chubby-wiki-workbench`

## 后续建议

- 如果插件继续增长，把 `main.js` 的渲染层继续拆分。
- 如果要公开给别人使用，改造成 TypeScript + esbuild，并移除对特定 vault 路径的默认假设。
- 如果要做正式发布，补 `versions.json` 和 release zip。
