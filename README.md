# Wiki Workbench for Obsidian

`Wiki Workbench` is a desktop Obsidian plugin that turns a Markdown dashboard file into an interactive daily cockpit. It is designed for personal knowledge bases that use plain Markdown for tasks, journals, plans, content pipelines, and agent-assisted workflows.

The plugin keeps your vault structure intact. It reads and writes normal Markdown files instead of introducing a database or external service.

## Features

- Daily cockpit for focus work, Todo items, content production, and life tasks.
- Interactive task actions: check, edit, delete, add, reorder, defer, cancel, and delegate to an agent.
- Agent workflow tracking through owner/status metadata such as `[owner:Agent]` and `[status:waiting-confirm]`.
- Carryover inbox for unfinished tasks from previous days.
- Daily rollover: clears completed daily work, keeps content pipelines, resets recurring habits, and marks unfinished tasks with `[carryover:YYYY-MM-DD]`.
- Content pipeline view for idea, research, material pack, draft, edit, publish, and archive stages.
- Vault activity lens with workspace stats, recent files, and a 91-day activity heatmap.
- Journal backfill: completed tasks can be appended to a daily note.
- Compatibility with emoji-style completed tasks such as `- ✅ 08:16 Sync completed`.

## Install

Clone or copy this repository into an Obsidian vault plugin directory:

```bash
mkdir -p /path/to/vault/.obsidian/plugins/wiki-workbench
cp -R ./* /path/to/vault/.obsidian/plugins/wiki-workbench/
```

Then enable it in Obsidian:

1. Open `Settings -> Community plugins`.
2. Enable community plugins if needed.
3. Enable `Wiki Workbench`.
4. Open the workbench from the ribbon icon or the command palette.

## Default Files

The plugin defaults can be changed in the plugin settings tab.

| Purpose | Default path |
| --- | --- |
| Dashboard source | `dashboard.md` |
| Daily notes | `Journal/YYYY-MM-DD.md` |
| Weekly plans | `Plans/Weekly/YYYY-Www.md` |
| Monthly plans | `Plans/Monthly/YYYY-MM.md` |
| Content workflow | `Wiki/Content/workflow.md` |
| Project index | `Wiki/Projects/index.md` |
| Health cache | `Workbench/vault-health.json` |

`data.json` is an Obsidian local settings file. Do not publish it if it contains personal paths or preferences.

## Configuration

Open `Settings -> Wiki Workbench` in Obsidian after enabling the plugin.

| Setting | What it controls | Recommended value |
| --- | --- | --- |
| 工作台文件 | The Markdown file used as the workbench database. | `dashboard.md` |
| 日记目录 | Folder for daily notes created/opened by the plugin. | `Journal` |
| 周计划目录 | Folder for weekly plans. | `Plans/Weekly` |
| 月计划目录 | Folder for monthly plans. | `Plans/Monthly` |
| 内容流程 | A note that describes your content workflow. | `Wiki/Content/workflow.md` |
| 项目索引 | A project index note opened from quick actions. | `Wiki/Projects/index.md` |
| 健康缓存 | Optional JSON health snapshot used by the sidebar. | `Workbench/vault-health.json` |
| 完成记录标题 | Heading in daily notes where completed tasks are appended. | `今日完成` |
| 主题 | Visual theme for the workbench. | Any built-in theme |
| 勾选完成后写入今日日记 | Whether completed tasks are appended to the daily note. | Enabled |

Minimum setup:

1. Create a folder structure that matches the settings you choose.
2. Create `dashboard.md`, or let the plugin create its default dashboard.
3. Keep the dashboard path stable. The plugin writes task changes back to this file by line.
4. Keep daily notes as normal Markdown. The plugin creates missing daily notes automatically.

Recommended vault structure:

```text
dashboard.md
Journal/
Plans/
  Weekly/
  Monthly/
Wiki/
  Content/
    workflow.md
  Projects/
    index.md
Workbench/
  vault-health.json
```

The default dashboard template uses Chinese section titles because the current UI labels are Chinese. You can still use English card titles and task text. Section type detection recognizes common Chinese section names today; for the most reliable rendering, keep the four top-level sections as shown below:

```markdown
## 今日行动
## Todo 列表
## 内容生成
## 生活待办
```

## Dashboard Format

`dashboard.md` is plain Markdown. Level 2 headings are sections, level 3 headings are cards, and tasks use Markdown checkboxes.

```markdown
## Focus

### Top Three
id: focus-today
type: focus
- [ ] Pick the most important task for today
- [ ] Move the main content draft forward
- [ ] Write a short daily review

### Completed Today
id: today-done
type: focus
- [x] Published a note

## Todo

### Agent Queue
id: agent-queue
type: task
- [ ] [owner:Agent] [status:todo] Prepare a source summary
- [ ] [owner:User] [status:waiting-confirm] Review topic candidates
```

Task metadata examples:

```markdown
- [ ] [owner:Agent] [status:todo] Generate a weekly review
- [ ] [owner:User] [status:waiting-confirm] Review the agent output
- [ ] Blocked: missing source links
- [ ] Old task [carryover:2026-06-29]
- [ ] Deferred task 📅 2026-07-01
```

Emoji-style completed tasks are also parsed:

```markdown
- ✅ 08:16 Sync completed
- ☑ Batch processing completed
- ✔ 18:00 Journal backfill completed
```

If a task appears directly under a section without a card heading, the parser creates an implicit `Ungrouped Tasks` card so the task is not dropped.

## AI Agent Collaboration

The plugin does not run an AI model. It coordinates with any external AI agent by sharing Markdown files. An agent can be Codex, Claude Code, a local script, a scheduled job, or any automation that can read and write the vault.

### Core protocol

Use task metadata tokens inside `dashboard.md`:

```markdown
- [ ] [owner:Agent] [status:todo] Summarize new source notes
- [ ] [owner:User] [status:waiting-confirm] Review the agent summary
- [ ] [owner:Agent] [status:blocked] Draft newsletter, blocked by missing source links
- [ ] [owner:Agent] [status:deferred] Rewrite intro 📅 2026-07-01
- [x] [owner:Agent] [status:done] Backfilled yesterday's journal
```

Supported conventions:

| Token | Meaning |
| --- | --- |
| `[owner:Agent]` | The task is assigned to an AI agent or automation. |
| `[owner:User]` | The task needs a human decision or review. |
| `[status:todo]` | Ready to execute. |
| `[status:waiting-confirm]` | Waiting for human confirmation. Rendered as waiting. |
| `[status:blocked]` | Blocked by missing input, access, or a decision. |
| `[status:deferred]` | Deferred, usually with a due date. |
| `[status:canceled]` | Canceled but kept for traceability. |
| `[status:done]` | Completed. |
| `📅 YYYY-MM-DD` | Due date or defer date. |
| `[遗留:YYYY-MM-DD]` | Carryover marker written by daily rollover. |

Legacy shorthand is also recognized:

```markdown
- [ ] [Agent] Pull source notes
- [ ] [等待我确认] Approve the topic list
```

For new integrations, prefer the explicit `[owner:*]` and `[status:*]` tokens.

### Recommended workflow

1. Human creates or delegates a task:

   ```markdown
   - [ ] [owner:Agent] [status:todo] Summarize the new research notes
   ```

2. Agent reads `dashboard.md`, finds `[owner:Agent] [status:todo]`, and does the work in normal vault files.

3. Agent updates the task when output is ready:

   ```markdown
   - [ ] [owner:User] [status:waiting-confirm] Review summary: [[Wiki/Research/agent-summary]]
   ```

4. Human reviews the linked output. If accepted, check the task in the workbench. If it needs more work, assign it back:

   ```markdown
   - [ ] [owner:Agent] [status:todo] Revise summary with clearer source links
   ```

5. Agent can mark finished automation work directly:

   ```markdown
   - [x] [owner:Agent] [status:done] Indexed weekly notes
   ```

The UI also has an action to delegate a task to the agent. That action rewrites the task to `[owner:Agent] [status:todo]`.

### Agent output rules

For reliable collaboration, ask your agent to follow these rules:

- Do not edit source files that should be read-only in your vault.
- Prefer creating or updating linked notes, then point the dashboard task to the note with a wikilink.
- When work requires human review, use `[owner:User] [status:waiting-confirm]`.
- When blocked, keep the task open and use `[status:blocked]` with a short reason.
- Do not delete tasks silently. Use `[status:canceled]` or add a short note if a task is no longer relevant.
- Keep one task per line. The plugin writes task updates by line.
- Keep metadata tokens at the beginning of the task when possible.

### Daily note sections for agent summaries

The sidebar daily digest reads these headings from the daily note:

```markdown
## 今日完成
## 今日待办
## 明日计划
## Agent 复盘
## AI 今日摘要
```

An agent can append a short review like this:

```markdown
## Agent 复盘

- Finished source scan for the weekly plan.
- Waiting for human confirmation on 3 candidate topics.
- Blocked on one item because source links are missing.
```

### External automation example

A simple external agent loop can be:

1. Read `dashboard.md`.
2. Parse unchecked tasks containing `[owner:Agent]`.
3. Work only on tasks with `[status:todo]`.
4. Write outputs to normal Markdown notes.
5. Replace the task line with `[owner:User] [status:waiting-confirm] ... [[output-note]]`.
6. Leave blocked work as `[owner:Agent] [status:blocked] ...`.

No Obsidian plugin API is required for this workflow.

## Files

```text
README.md                    Plugin documentation
manifest.json                Obsidian plugin manifest
package.json                 Node test scripts
main.js                      Plugin lifecycle, rendering, commands, modals, vault writes
dashboard-logic.js           Dashboard parsing, task insertion, rollover, task-line writes
task-logic.js                Task metadata, label cleanup, matching, sorting, status actions
workbench-derive.js          Derived stats, pipeline state, health state, activity lens
date-utils.js                Date helpers
styles.css                   Layout and themes
test/workbench-logic.test.js Core logic tests
```

## Verify

Run from the plugin directory:

```bash
npm test
npm run check
```

For an Obsidian DOM smoke test, use your own Obsidian automation setup or manually verify that:

- the plugin loads without console errors
- the workbench view opens from the command palette
- the dashboard renders
- task check/edit/add actions update `dashboard.md`

## Publishing Notes

Files suitable for a public repository:

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

Do not publish:

- `data.json`
- your personal `dashboard.md`
- vault content such as journals, source material, drafts, account notes, or private plans
- other `.obsidian` user settings

## Status

- Version: `0.6.12`
- Runtime: no-build CommonJS
- Platform: Obsidian desktop
- Tests: Node logic tests

## Future Work

- Split more rendering code out of `main.js`.
- Add `versions.json` and release packaging for formal Obsidian plugin distribution.
- Consider TypeScript and a small build step if the codebase continues to grow.
