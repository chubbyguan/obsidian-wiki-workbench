# Chubby Wiki Workbench

Obsidian daily workbench for `wiki-guanbuGuo`. It keeps the vault structure unchanged and treats `dashboard.md` as the editable workbench source.

## Current Modules

- Daily cockpit: focus work, Todo, content generation, and life tasks.
- Hermes collaboration: delegated tasks, waiting confirmations, blockers, and completed work.
- Task inbox: unfinished and carryover task drawers with locate, complete, continue, defer, cancel, and delegate-to-Hermes actions.
- LLM Wiki workspace stats: activity across source material, wiki subspaces, output, diary, plans, account ops, and Hermes memory.
- 91-day contribution heatmap plus recent deposits for spotting whether the knowledge loop is moving.
- Daily rollover and completion logging back into `日记/`.

## Files

- `main.js` - Obsidian plugin lifecycle, rendering, commands, modals, and vault writes.
- `dashboard-logic.js` - Markdown dashboard parsing, quick actions, card insertion, and daily rollover policy.
- `task-logic.js` - Task metadata, display cleanup, matching, and prioritization.
- `workbench-derive.js` - Derived view data: card matching, stats, Hermes groups, content pipeline, badges, channels, and health summaries.
- `styles.css` - Layout and theme system.
- `test/workbench-logic.test.js` - Node tests for the core markdown/task logic.

## Verification

From this plugin directory:

```bash
npm test
npm run check
```

Inside the `wiki-guanbuGuo` vault, the Obsidian DOM smoke test is:

```bash
tools/obsidian_workbench_cli_check.sh
```

The CLI check starts Obsidian if the app is not reachable, reloads the plugin, opens the workbench view, checks the DOM, prints captured errors, and saves a screenshot to `产出/工作台设计/chubby-workbench-cli-check.png`.

Manual commands:

```bash
open -a Obsidian /Users/guandeyu/Documents/wiki-guanbuGuo
obsidian plugin:reload id=chubby-wiki-workbench
obsidian command id=chubby-wiki-workbench:open-workbench
obsidian eval code="(() => ({ root: !!document.querySelector('.chubby-workbench-root'), summaryButtons: document.querySelectorAll('.cw-summary-jump').length }))()"
obsidian dev:errors
```

## Notes

The plugin is still a no-build CommonJS plugin so it can be edited directly in the vault. It is desktop-only because the loader resolves local vault paths. If the codebase keeps growing, the next engineering step is a TypeScript + esbuild bundle, with these logic files becoming typed modules.
