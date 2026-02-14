import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "work-timer",
  version: "1.0.0",
});

// In-memory store for active timers
const timers = {};

// --- Helpers ---

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

const labelSchema = z.string().max(30).regex(/^[a-z0-9_-]+$/, "Label must be lowercase alphanumeric with hyphens/underscores only").optional();

function resolveLabel(label) {
  return label || "default";
}

function runningCount() {
  return Object.keys(timers).length;
}

// --- Tools ---

server.tool("start_timer", "Start a work timer. Optionally give it a label.", { label: labelSchema.describe("Optional label for the timer (defaults to 'default')") }, async ({ label }) => {
  const name = resolveLabel(label);

  if (timers[name]) {
    return {
      content: [{ type: "text", text: `Timer "${name}" is already running (started at ${timers[name].startTime.toLocaleTimeString()}).` }],
    };
  }

  timers[name] = { startTime: new Date() };

  let text = `Timer "${name}" started at ${timers[name].startTime.toLocaleTimeString()}.`;
  if (runningCount() >= 3) {
    const names = Object.keys(timers).map(n => `"${n}"`).join(", ");
    text += `\n\nHeads up: you now have ${runningCount()} timers running (${names}). Did you forget to stop one?`;
  }

  return { content: [{ type: "text", text }] };
});

server.tool("current_timer", "Check the elapsed time on a running timer without stopping it.", { label: labelSchema.describe("Label of the timer to check (defaults to 'default')") }, async ({ label }) => {
  const name = resolveLabel(label);
  const timer = timers[name];

  if (!timer) {
    return {
      content: [{ type: "text", text: `No timer named "${name}" is running.` }],
    };
  }

  const elapsed = formatElapsed(Date.now() - timer.startTime);

  return {
    content: [{
      type: "text",
      text: `Timer "${name}" is running.\nStarted:  ${timer.startTime.toLocaleTimeString()}\nElapsed:  ${elapsed}`,
    }],
  };
});

server.tool("stop_timer", "Stop a running work timer and see the elapsed time.", { label: labelSchema.describe("Label of the timer to stop (defaults to 'default')") }, async ({ label }) => {
  const name = resolveLabel(label);
  const timer = timers[name];

  if (!timer) {
    return {
      content: [{ type: "text", text: `No timer named "${name}" is running.` }],
    };
  }

  const endTime = new Date();
  const elapsed = formatElapsed(endTime - timer.startTime);
  delete timers[name];

  return {
    content: [{
      type: "text",
      text: `Timer "${name}" stopped.\nStarted:  ${timer.startTime.toLocaleTimeString()}\nStopped:  ${endTime.toLocaleTimeString()}\nElapsed:  ${elapsed}`,
    }],
  };
});

server.tool("list_timers", "List all currently running timers with their elapsed time.", {}, async () => {
  const names = Object.keys(timers);

  if (names.length === 0) {
    return {
      content: [{ type: "text", text: "No timers are running." }],
    };
  }

  const now = Date.now();
  const lines = names.map(name => {
    const elapsed = formatElapsed(now - timers[name].startTime);
    return `- "${name}"  started ${timers[name].startTime.toLocaleTimeString()}  (${elapsed})`;
  });

  return {
    content: [{ type: "text", text: `Running timers (${names.length}):\n${lines.join("\n")}` }],
  };
});

server.tool("stop_all_timers", "Stop all running timers and get a summary.", {}, async () => {
  const names = Object.keys(timers);

  if (names.length === 0) {
    return {
      content: [{ type: "text", text: "No timers are running." }],
    };
  }

  const endTime = new Date();
  const lines = names.map(name => {
    const elapsed = formatElapsed(endTime - timers[name].startTime);
    const started = timers[name].startTime.toLocaleTimeString();
    delete timers[name];
    return `- "${name}"  ${started} → ${endTime.toLocaleTimeString()}  (${elapsed})`;
  });

  return {
    content: [{ type: "text", text: `Stopped ${lines.length} timer(s):\n${lines.join("\n")}` }],
  };
});

server.tool("rename_timer", "Rename a running timer without stopping it.", {
  from: labelSchema.describe("Current label of the timer"),
  to: z.string().max(30).regex(/^[a-z0-9_-]+$/, "Label must be lowercase alphanumeric with hyphens/underscores only").describe("New label for the timer"),
}, async ({ from, to }) => {
  const oldName = resolveLabel(from);

  if (!timers[oldName]) {
    return {
      content: [{ type: "text", text: `No timer named "${oldName}" is running.` }],
    };
  }

  if (timers[to]) {
    return {
      content: [{ type: "text", text: `A timer named "${to}" is already running. Stop it first or choose a different name.` }],
    };
  }

  timers[to] = timers[oldName];
  delete timers[oldName];

  return {
    content: [{ type: "text", text: `Timer renamed from "${oldName}" to "${to}".` }],
  };
});

server.tool("switch_timer", "Stop the current timer and immediately start a new one.", {
  stop: labelSchema.describe("Label of the timer to stop (defaults to 'default')"),
  start: z.string().max(30).regex(/^[a-z0-9_-]+$/, "Label must be lowercase alphanumeric with hyphens/underscores only").describe("Label for the new timer to start"),
}, async ({ stop, start }) => {
  const stopName = resolveLabel(stop);
  const now = new Date();
  let summary = "";

  if (timers[stopName]) {
    const elapsed = formatElapsed(now - timers[stopName].startTime);
    summary = `Stopped "${stopName}" (${elapsed}).\n`;
    delete timers[stopName];
  } else {
    summary = `No timer named "${stopName}" was running.\n`;
  }

  if (timers[start]) {
    summary += `Timer "${start}" is already running (started at ${timers[start].startTime.toLocaleTimeString()}).`;
  } else {
    timers[start] = { startTime: now };
    summary += `Started "${start}" at ${now.toLocaleTimeString()}.`;
  }

  return { content: [{ type: "text", text: summary }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
