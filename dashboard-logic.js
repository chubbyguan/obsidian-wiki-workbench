const { getCarryoverDate } = require("./task-logic");

function parseDashboard(markdown) {
  const frontmatter = parseDashboardFrontmatter(markdown);
  const lines = markdown.split("\n");
  const sections = [];
  let currentSection = null;
  let currentCard = null;
  let inFrontmatter = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.trim() === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (line.trim() === "---") inFrontmatter = false;
      continue;
    }

    const sectionMatch = line.match(/^##\s+(.+?)\s*$/);
    if (sectionMatch) {
      if (currentCard) currentCard.endLine = i;
      currentCard = null;
      const title = cleanTitle(sectionMatch[1]);
      currentSection = {
        title,
        type: inferSectionType(title),
        lineIndex: i,
        cards: [],
      };
      sections.push(currentSection);
      continue;
    }

    const cardMatch = line.match(/^###\s+(.+?)\s*$/);
    if (cardMatch && currentSection) {
      if (currentCard) currentCard.endLine = i;
      currentCard = {
        id: "",
        title: cleanTitle(cardMatch[1]),
        type: currentSection.type,
        lineIndex: i,
        endLine: lines.length,
        tasks: [],
        body: [],
        meta: {},
      };
      currentSection.cards.push(currentCard);
      continue;
    }

    if (!currentCard) continue;

    const metaMatch = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (metaMatch && currentCard.tasks.length === 0 && currentCard.body.length === 0) {
      const key = metaMatch[1];
      const value = metaMatch[2].trim();
      currentCard.meta[key] = value;
      if (key === "id") currentCard.id = value;
      if (key === "type") currentCard.type = value;
      if (key === "status") currentCard.status = value;
      if (key === "next") currentCard.next = value;
      if (key === "link") currentCard.link = value;
      continue;
    }

    const taskMatch = line.match(/^(\s*)- \[([ xX])\]\s+(.*)$/);
    if (!taskMatch) {
      // 也匹配 Hermes 写入的「- ✅ 时间 任务」格式,转成 checked=true 的 task
      const emojiMatch = line.match(/^(\s*)- (✅|☑|✔)\s+(.*)$/);
      if (emojiMatch) {
        currentCard.tasks.push({
          lineIndex: i,
          checked: true,
          text: emojiMatch[3],
        });
        continue;
      }
    } else {
      currentCard.tasks.push({
        lineIndex: i,
        checked: taskMatch[2].toLowerCase() === "x",
        text: taskMatch[3],
      });
      continue;
    }

    if (line.trim()) currentCard.body.push(line);
  }

  if (currentCard) currentCard.endLine = lines.length;

  for (const section of sections) {
    for (const card of section.cards) {
      if (!card.id) card.id = `${section.type}-${slugify(card.title)}`;
    }
  }

  return { sections, quickActions: frontmatter.quickActions };
}

function parseDashboardFrontmatter(markdown) {
  const lines = markdown.split("\n");
  if (lines[0] !== "---") return { quickActions: [] };

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return { quickActions: [] };
  const frontmatterLines = lines.slice(1, end);
  return {
    quickActions: parseQuickActionsFromFrontmatter(frontmatterLines),
  };
}

function parseQuickActionsFromFrontmatter(lines) {
  const actions = [];
  let inQuickActions = false;
  let current = null;

  for (const line of lines) {
    if (!inQuickActions) {
      if (/^quickActions:\s*$/.test(line)) inQuickActions = true;
      continue;
    }

    if (line.trim() && !/^\s/.test(line)) break;

    const itemMatch = line.match(/^\s*-\s+([a-zA-Z][\w-]*):\s*(.*)$/);
    if (itemMatch) {
      if (current) actions.push(current);
      current = {};
      current[itemMatch[1]] = stripYamlValue(itemMatch[2]);
      continue;
    }

    const propMatch = line.match(/^\s+([a-zA-Z][\w-]*):\s*(.*)$/);
    if (propMatch && current) {
      current[propMatch[1]] = stripYamlValue(propMatch[2]);
    }
  }

  if (current) actions.push(current);
  return actions.filter((action) => action.name && action.target);
}

function stripYamlValue(value) {
  const text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function insertTaskLine(markdown, card, text) {
  const lines = markdown.split("\n");
  const insertAt = Math.max(card.endLine, card.lineIndex + 1);
  const line = `- [ ] ${text}`;
  if (insertAt >= lines.length) {
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(line);
  } else {
    lines.splice(insertAt, 0, line);
  }
  return lines.join("\n");
}

function updateTaskLine(line, text, checked) {
  const source = String(line || "");
  const checkboxMatch = source.match(/^(\s*)- \[[ xX]\]\s+.*$/);
  const emojiMatch = source.match(/^(\s*)- (✅|☑|✔)\s+.*$/);
  const match = checkboxMatch || emojiMatch;
  if (!match) return { line: source, changed: false, supported: false };
  const nextLine = `${match[1]}- [${checked ? "x" : " "}] ${text}`;
  return { line: nextLine, changed: nextLine !== source, supported: true };
}

function updateTaskLineInMarkdown(markdown, lineIndex, text, checked) {
  const lines = String(markdown || "").split("\n");
  const line = lines[lineIndex];
  if (line === undefined) {
    return { markdown, changed: false, reason: "line-missing" };
  }
  const update = updateTaskLine(line, text, checked);
  if (!update.supported) {
    return { markdown, changed: false, reason: "unsupported-task-line" };
  }
  lines[lineIndex] = update.line;
  return { markdown: lines.join("\n"), changed: true };
}

function getDashboardWorkbenchDate(markdown) {
  const lines = String(markdown || "").split("\n");
  if (lines[0] !== "---") return "";
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return "";
  for (let i = 1; i < end; i++) {
    const match = lines[i].match(/^workbenchDate:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/);
    if (match) return match[1];
  }
  return "";
}

function setDashboardWorkbenchDate(markdown, date) {
  const lines = String(markdown || "").split("\n");
  if (lines[0] !== "---") {
    return `---\nworkbenchDate: "${date}"\n---\n\n${markdown}`;
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return markdown;
  for (let i = 1; i < end; i++) {
    if (/^workbenchDate:\s*/.test(lines[i])) {
      lines[i] = `workbenchDate: "${date}"`;
      return lines.join("\n");
    }
  }
  lines.splice(end, 0, `workbenchDate: "${date}"`);
  return lines.join("\n");
}

function rolloverDashboardForDate(markdown, data, today) {
  const lines = markdown.split("\n");
  const remove = new Set();
  const previousDate = getDashboardWorkbenchDate(markdown) || "";

  for (const section of data.sections) {
    for (const card of section.cards) {
      const policy = getDailyRolloverPolicy(card);
      if (policy === "keep") continue;

      for (const task of card.tasks) {
        if (policy === "clear") {
          remove.add(task.lineIndex);
          continue;
        }
        if (!task.checked) {
          if (shouldMarkCarryover(card, task) && previousDate && previousDate !== today) {
            lines[task.lineIndex] = markTaskCarryover(lines[task.lineIndex], previousDate);
          }
          continue;
        }
        if (policy === "reset") {
          const update = updateTaskLine(lines[task.lineIndex], task.text, false);
          if (update.supported) lines[task.lineIndex] = update.line;
          continue;
        }
        if (policy === "removeDone") {
          remove.add(task.lineIndex);
        }
      }
    }
  }

  const compacted = lines.filter((_, index) => !remove.has(index)).join("\n");
  return setDashboardWorkbenchDate(compacted, today);
}

function getDailyRolloverPolicy(card) {
  const id = card.id || "";
  const title = card.title || "";
  const type = card.type || "";
  if (id === "today-done" || title.includes("今日完成")) return "clear";
  if (type === "content") return "keep";
  if (id === "health-habits") return "reset";
  if (type === "focus" || type === "task" || type === "todo" || type === "life") return "removeDone";
  return "keep";
}

function shouldMarkCarryover(card, task) {
  if (!card || !task || task.checked) return false;
  const policy = getDailyRolloverPolicy(card);
  if (policy !== "removeDone") return false;
  return !getCarryoverDate(task);
}

function markTaskCarryover(line, date) {
  if (!line || !date || /\[遗留:\d{4}-\d{2}-\d{2}\]/.test(line)) return line;
  return `${line} [遗留:${date}]`;
}

function inferSectionType(title) {
  const value = cleanTitle(title);
  if (value.includes("今日行动") || value.includes("今日任务")) return "focus";
  if (value.includes("Todo") || value.includes("待办事项") || value.includes("工作待办")) return "todo";
  if (value.includes("内容生成") || value.includes("内容生产") || value.includes("进度追踪")) return "content";
  if (value.includes("生活待办") || value.includes("健康") || value.includes("生活")) return "life";
  return "todo";
}

function cleanTitle(title) {
  return title.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "")
    .slice(0, 40) || "card";
}

module.exports = {
  cleanTitle,
  getDashboardWorkbenchDate,
  getDailyRolloverPolicy,
  inferSectionType,
  insertTaskLine,
  markTaskCarryover,
  parseDashboard,
  parseDashboardFrontmatter,
  parseQuickActionsFromFrontmatter,
  rolloverDashboardForDate,
  setDashboardWorkbenchDate,
  shouldMarkCarryover,
  slugify,
  stripYamlValue,
  updateTaskLine,
  updateTaskLineInMarkdown,
};
