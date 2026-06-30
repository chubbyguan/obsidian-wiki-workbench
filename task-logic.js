function extractTaskText(line) {
  const match = String(line || "").match(/^\s*- \[[ xX]\]\s+(.*)$/);
  return match ? match[1].trim() : String(line || "").trim();
}

function cleanTaskLabel(text) {
  return String(text || "")
    .replace(/\[owner:[^\]]+\]\s*/gi, "")
    .replace(/\[status:[^\]]+\]\s*/gi, "")
    .replace(/\[Hermes\]\s*/g, "")
    .replace(/\[等待我确认\]\s*/g, "")
    .replace(/\s*\[遗留:\d{4}-\d{2}-\d{2}\]/g, "")
    .replace(/📅\s*\d{4}-\d{2}-\d{2}/g, "")
    .replace(/[⏫🔴🟡🟢]\s*/g, "")
    .trim();
}

function getCarryoverDate(task) {
  const match = String(task && task.text ? task.text : "").match(/\[遗留:(\d{4}-\d{2}-\d{2})\]/);
  return match ? match[1] : "";
}

function getTaskMeta(taskOrText) {
  const text = String(taskOrText && taskOrText.text !== undefined ? taskOrText.text : taskOrText || "");
  const ownerMatch = text.match(/\[owner:([^\]]+)\]/i);
  const statusMatch = text.match(/\[status:([^\]]+)\]/i);
  const rawOwner = ownerMatch ? ownerMatch[1].trim() : "";
  const rawStatus = statusMatch ? statusMatch[1].trim().toLowerCase() : "";
  let owner = rawOwner;
  let status = rawStatus;

  if (!owner && text.includes("[Hermes]")) owner = "Hermes";
  if (!owner && text.includes("[等待我确认]")) owner = "关德宇";
  if (!status && text.includes("[等待我确认]")) status = "waiting";
  if (!status && (text.includes("阻塞") || text.includes("卡住"))) status = "blocked";
  if (!status) status = "todo";

  const normalizedStatus = status.replace(/[_\s]+/g, "-");
  const normalizedOwner = owner.toLowerCase() === "hermes" ? "Hermes" : owner;
  return {
    owner: normalizedOwner,
    status: normalizedStatus.includes("blocked") || normalizedStatus.includes("阻塞")
      ? "blocked"
      : normalizedStatus.includes("waiting") || normalizedStatus.includes("confirm") || normalizedStatus.includes("确认")
        ? "waiting"
        : normalizedStatus,
  };
}

function normalizeTaskMatchText(text) {
  return cleanTaskLabel(text)
    .replace(/\s+/g, "")
    .toLowerCase();
}

function getTaskFingerprint(taskOrText) {
  const text = String(taskOrText && taskOrText.text !== undefined ? taskOrText.text : taskOrText || "");
  const meta = getTaskMeta(text);
  return [
    normalizeTaskMatchText(text),
    meta.owner || "",
    meta.status || "",
    getCarryoverDate({ text }),
  ].join("|");
}

function removeCarryover(text) {
  return String(text || "").replace(/\s*\[遗留:\d{4}-\d{2}-\d{2}\]/g, "").trim();
}

function upsertMeta(text, key, value) {
  const source = String(text || "").trim();
  const token = `[${key}:${value}]`;
  const pattern = new RegExp(`\\[${escapeRegExp(key)}:[^\\]]+\\]\\s*`, "i");
  if (pattern.test(source)) return source.replace(pattern, `${token} `).replace(/\s+/g, " ").trim();
  return `${token} ${source}`.trim();
}

function removeDueDate(text) {
  return String(text || "").replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/g, "").trim();
}

function setDueDate(text, date) {
  const base = removeDueDate(text);
  return date ? `${base} 📅 ${date}`.trim() : base;
}

function continueTaskText(text) {
  return upsertMeta(removeCarryover(removeDueDate(text)), "status", "todo");
}

function deferTaskText(text, date) {
  return setDueDate(upsertMeta(text, "status", "deferred"), date);
}

function cancelTaskText(text) {
  return upsertMeta(removeDueDate(text), "status", "canceled");
}

function delegateTaskText(text) {
  return upsertMeta(upsertMeta(text, "owner", "Hermes"), "status", "todo");
}

function findMatchingTask(markdown, card, taskLike) {
  if (!markdown || !card || !taskLike) return null;
  if (typeof taskLike.lineIndex === "number") {
    const line = markdown.split("\n")[taskLike.lineIndex];
    if (line && extractTaskText(line) === taskLike.text) {
      const byLine = card.tasks.find((task) => task.lineIndex === taskLike.lineIndex);
      if (byLine) return byLine;
    }
  }

  const byTextAndState = card.tasks.find((task) => task.text === taskLike.text && task.checked === taskLike.checked);
  if (byTextAndState) return byTextAndState;

  const byText = card.tasks.find((task) => task.text === taskLike.text);
  if (byText) return byText;

  const normalized = normalizeTaskMatchText(taskLike.text);
  if (normalized) {
    const byNormalized = card.tasks.find((task) => normalizeTaskMatchText(task.text) === normalized);
    if (byNormalized) return byNormalized;
  }

  const fingerprint = getTaskFingerprint(taskLike);
  return card.tasks.find((task) => getTaskFingerprint(task) === fingerprint) || null;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function prioritizeTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    if (Boolean(getCarryoverDate(a)) !== Boolean(getCarryoverDate(b))) return getCarryoverDate(a) ? -1 : 1;
    const score = (task) => {
      let value = 0;
      const meta = getTaskMeta(task);
      if (meta.status === "waiting") value -= 4;
      if (meta.owner === "Hermes") value -= 3;
      if (task.text.includes("今天") || task.text.includes("发布")) value -= 2;
      if (meta.status === "blocked") value -= 5;
      return value;
    };
    return score(a) - score(b);
  });
}

module.exports = {
  cleanTaskLabel,
  cancelTaskText,
  continueTaskText,
  deferTaskText,
  delegateTaskText,
  extractTaskText,
  findMatchingTask,
  getCarryoverDate,
  getTaskFingerprint,
  getTaskMeta,
  normalizeTaskMatchText,
  prioritizeTasks,
  removeCarryover,
  removeDueDate,
  setDueDate,
  upsertMeta,
};
