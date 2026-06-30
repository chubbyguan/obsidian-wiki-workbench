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
