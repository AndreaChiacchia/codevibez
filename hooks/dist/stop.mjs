// src/events.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// src/redact.ts
var MAX_LINE = 8e3;
function capSerialized(line, fallback) {
  return line.length <= MAX_LINE ? line : fallback();
}

// src/events.ts
function defaultEventsDir() {
  return process.env.CODEVIBEZ_DIR ?? join(homedir(), ".codevibez", "events");
}
function sessionFileName(session) {
  const flattened = session.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+/, "");
  return `${flattened === "" ? "session" : flattened}.jsonl`;
}
function appendEvent(dir, event) {
  try {
    mkdirSync(dir, { recursive: true });
    const line = capSerialized(JSON.stringify(event), () => JSON.stringify({ ...event, raw: { codevibez_note: "payload omitted, too large" } }));
    appendFileSync(join(dir, sessionFileName(event.session)), `${line}
`, "utf8");
  } catch {
  }
}

// ../codevibez-cli/packages/core/dist/event.js
var KINDS = /* @__PURE__ */ new Set([
  "prompt",
  "tool.pre",
  "tool.post",
  "agent.done"
]);
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isOptionalString(value) {
  return value === void 0 || typeof value === "string";
}
function isOutcome(value) {
  if (!isRecord(value) || typeof value.ok !== "boolean")
    return false;
  return (value.exitCode === void 0 || typeof value.exitCode === "number") && isOptionalString(value.stdout) && isOptionalString(value.stderr);
}
function parseEvent(jsonlLine) {
  try {
    const value = JSON.parse(jsonlLine);
    if (!isRecord(value))
      return null;
    if (value.v !== 1)
      return null;
    if (typeof value.ts !== "string" || typeof value.session !== "string") {
      return null;
    }
    if (value.agent !== "claude-code" && value.agent !== "codex")
      return null;
    if (typeof value.kind !== "string" || !KINDS.has(value.kind))
      return null;
    if (!isOptionalString(value.tool) || !isOptionalString(value.text)) {
      return null;
    }
    if (value.raw !== void 0 && !isRecord(value.raw))
      return null;
    if (value.outcome !== void 0 && !isOutcome(value.outcome))
      return null;
    return {
      ...value,
      v: 1,
      ts: value.ts,
      session: value.session,
      agent: value.agent,
      kind: value.kind
    };
  } catch {
    return null;
  }
}

// src/flair.ts
function effectiveFlair(configured) {
  if (process.env.NO_COLOR !== void 0 && process.env.NO_COLOR !== "") return "off";
  return configured;
}
function titleSequence(text, lead = "") {
  const short = text.length > 60 ? `${text.slice(0, 59)}\u2026` : text;
  return `\x1B]2;${lead}${short} \xB7 codevibez\x07`;
}

// src/summary.ts
import { openSync, readSync, closeSync, statSync } from "node:fs";
import { join as join2 } from "node:path";
function readTail(path, maxBytes = 256 * 1024) {
  let fd = null;
  try {
    const size = statSync(path).size;
    const length = Math.min(size, maxBytes);
    const start = size - length;
    const buffer = Buffer.allocUnsafe(length);
    fd = openSync(path, "r");
    readSync(fd, buffer, 0, length, start);
    const text = buffer.toString("utf8");
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } catch {
    return "";
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
      }
    }
  }
}
function lastAssistantText(transcriptPath, budget) {
  if (budget.spent()) return null;
  const lines = readTail(transcriptPath).trim().split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const raw = lines[index];
    if (raw === void 0 || raw === "") continue;
    try {
      const value = JSON.parse(raw);
      const record = typeof value === "object" && value !== null ? value : {};
      const message = typeof record.message === "object" && record.message !== null ? record.message : record;
      if ((record.type === "assistant" || message.role === "assistant") && Array.isArray(message.content)) {
        const text = message.content.filter((block) => typeof block === "object" && block !== null && block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n").trim();
        if (text !== "") return text.slice(0, 4e3);
      }
    } catch {
    }
  }
  return null;
}
function readSessionEvents(dir, session, budget) {
  if (budget.spent()) return [];
  const text = readTail(join2(dir, sessionFileName(session)));
  const events = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const event = parseEvent(line);
    if (event) events.push(event);
  }
  return events;
}
function inlineDoneCloser(events) {
  let written = /* @__PURE__ */ new Set();
  let updated = /* @__PURE__ */ new Set();
  let checks = null;
  for (const event of events) {
    if (event.kind !== "tool.post" || event.outcome?.ok !== true) continue;
    const path = typeof event.raw?.file_path === "string" ? event.raw.file_path : null;
    if (event.tool === "Write" && path) written.add(path);
    if ((event.tool === "Edit" || event.tool === "MultiEdit") && path) updated.add(path);
  }
  for (const event of events) {
    if (event.kind !== "tool.post") continue;
    const command = typeof event.raw?.command === "string" ? event.raw.command : "";
    if (!/\btest\b|\bvitest\b|\bjest\b|\bpytest\b/.test(command)) continue;
    checks = event.outcome?.ok === true ? "checks passing" : "checks failing";
  }
  const parts = [];
  const changed = written.size + updated.size;
  if (changed > 0) parts.push(`${changed} ${changed === 1 ? "file" : "files"} changed`);
  if (checks !== null) parts.push(checks);
  if (parts.length === 0) return null;
  return `${checks === "checks failing" ? "\u26A0" : "\u2713"} Done: ${parts.join(", ")}`;
}

// src/config.ts
import { readFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join3 } from "node:path";
var DEFAULTS = {
  level: "plain",
  inline: true,
  flair: "full",
  notify: false
};
function readConfig() {
  try {
    const dir = process.env.CODEVIBEZ_DIR ? dirname(process.env.CODEVIBEZ_DIR) : join3(homedir2(), ".codevibez");
    const value = JSON.parse(readFileSync(join3(dir, "config.json"), "utf8"));
    const config = typeof value === "object" && value !== null ? value : {};
    return {
      level: config.level === "developer" ? "developer" : "plain",
      inline: config.inline !== false,
      flair: config.flair === "minimal" || config.flair === "off" ? config.flair : "full",
      notify: config.notify === true
    };
  } catch {
    return { ...DEFAULTS };
  }
}

// src/io.ts
function readStdin(deadlineMs = 150) {
  return new Promise((resolve) => {
    let buf = "";
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(buf);
    };
    const timer = setTimeout(finish, deadlineMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}
function emit(obj) {
  console.log(JSON.stringify(obj));
}

// src/budget.ts
var BUDGET_MS = 150;
function startBudget(limitMs = BUDGET_MS) {
  const started = Date.now();
  return {
    spent: () => Date.now() - started > limitMs,
    elapsed: () => Date.now() - started
  };
}

// src/hook.ts
async function runHook(body) {
  const budget = startBudget();
  let output;
  try {
    const parsed = JSON.parse(await readStdin());
    const payload = typeof parsed === "object" && parsed !== null ? parsed : {};
    const config = readConfig();
    output = body({
      payload,
      session: String(payload.session_id ?? "unknown"),
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      config,
      flair: effectiveFlair(config.flair),
      budget
    });
  } catch {
  }
  emit(output ?? {});
  process.exit(0);
}

// src/stop.ts
void runHook(({ payload, session, ts, config, flair, budget }) => {
  const text = typeof payload.transcript_path === "string" ? lastAssistantText(payload.transcript_path, budget) : null;
  const event = {
    v: 1,
    ts,
    session,
    agent: "claude-code",
    kind: "agent.done",
    ...text ? { text } : {}
  };
  const dir = defaultEventsDir();
  appendEvent(dir, event);
  const closer = config.inline ? inlineDoneCloser(readSessionEvents(dir, session, budget)) : null;
  const output = {};
  if (closer) output.systemMessage = closer;
  if (flair !== "off") {
    output.terminalSequence = closer === null ? "]2;codevibez" : titleSequence(closer.replace(/^[⚠✓]\s*/, ""));
  }
  return output;
});
