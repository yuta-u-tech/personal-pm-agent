import http from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { today } from "../core/date.js";
import { openFile } from "../core/open.js";
import { statusCommand } from "./status.js";

export type DashboardOptions = {
  port?: string;
  open?: boolean;
};

type DashboardData = {
  date: string;
  status: string;
  dailyReport: string;
  shareReport: string;
  suggestions: string;
  tasks: Record<string, string>;
  files: {
    dailyReports: string[];
    shareReports: string[];
    suggestions: string[];
  };
};

export async function dashboardCommand(targetDir: string, options: DashboardOptions = {}): Promise<string> {
  const port = Number(options.port ?? "4783");
  const server = http.createServer(async (request, response) => {
    try {
      await handleRequest(targetDir, request, response);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const url = `http://127.0.0.1:${port}`;
  if (options.open !== false) {
    await openFile(url);
  }
  return `Dashboard running: ${url}`;
}

async function handleRequest(targetDir: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderDashboardHtml());
    return;
  }

  if (url.pathname === "/api/dashboard") {
    const date = url.searchParams.get("date") ?? today();
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(await readDashboardData(targetDir, date)));
    return;
  }

  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

async function readDashboardData(targetDir: string, date: string): Promise<DashboardData> {
  return {
    date,
    status: await statusCommand(targetDir, date),
    dailyReport: await readText(path.join(targetDir, "reports/daily", `${date}.md`)),
    shareReport: await readText(path.join(targetDir, "reports/share", `${date}.md`)),
    suggestions: await readText(path.join(targetDir, "suggestions", `${date}.md`)),
    tasks: {
      active: await readText(path.join(targetDir, "tasks/active.md")),
      waiting: await readText(path.join(targetDir, "tasks/waiting.md")),
      delegated: await readText(path.join(targetDir, "tasks/delegated.md")),
      backlog: await readText(path.join(targetDir, "tasks/backlog.md")),
      done: await readText(path.join(targetDir, "tasks/done.md"))
    },
    files: {
      dailyReports: await listMarkdownNames(path.join(targetDir, "reports/daily")),
      shareReports: await listMarkdownNames(path.join(targetDir, "reports/share")),
      suggestions: await listMarkdownNames(path.join(targetDir, "suggestions"))
    }
  };
}

async function readText(filePath: string): Promise<string> {
  if (!existsSync(filePath)) return "";
  return readFile(filePath, "utf8");
}

async function listMarkdownNames(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Personal PM Agent</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --line: #d9dde5;
      --text: #1d2430;
      --muted: #657184;
      --accent: #146c5f;
      --accent-weak: #e3f2ee;
      --warn: #9a4d00;
      --shadow: 0 1px 2px rgba(20, 27, 38, 0.08);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }

    .app {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
    }

    aside {
      border-right: 1px solid var(--line);
      background: #fbfcfd;
      padding: 20px 16px;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: auto;
    }

    main {
      padding: 24px;
      min-width: 0;
    }

    h1 {
      margin: 0 0 4px;
      font-size: 22px;
      line-height: 1.2;
    }

    .sub {
      margin: 0 0 20px;
      color: var(--muted);
      font-size: 13px;
    }

    .controls {
      display: grid;
      gap: 10px;
      margin-bottom: 18px;
    }

    input, button {
      font: inherit;
    }

    input {
      width: 100%;
      height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 0 10px;
      background: #fff;
      color: var(--text);
    }

    button {
      height: 34px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      cursor: pointer;
    }

    button:hover { border-color: var(--accent); }
    button.active {
      border-color: var(--accent);
      background: var(--accent-weak);
      color: var(--accent);
      font-weight: 650;
    }

    .tabs {
      display: grid;
      gap: 8px;
    }

    .meta {
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }

    .toolbar h2 {
      margin: 0;
      font-size: 20px;
      line-height: 1.25;
    }

    .content {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      min-height: calc(100vh - 88px);
      padding: 22px;
      overflow: auto;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }

    .block {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: #fff;
      min-width: 0;
    }

    .block h3 {
      margin: 0 0 10px;
      font-size: 15px;
    }

    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .empty {
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 18px;
      background: #fbfcfd;
    }

    .file-list {
      display: grid;
      gap: 6px;
      margin-top: 8px;
    }

    .file-list span {
      color: var(--muted);
      font-size: 12px;
    }

    @media (max-width: 820px) {
      .app { grid-template-columns: 1fr; }
      aside {
        height: auto;
        position: static;
        border-right: 0;
        border-bottom: 1px solid var(--line);
      }
      main { padding: 16px; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside>
      <h1>Personal PM Agent</h1>
      <p class="sub">Progress Ledger Dashboard</p>
      <div class="controls">
        <input id="date" type="date">
        <button id="refresh" type="button">Refresh</button>
      </div>
      <div class="tabs">
        <button class="tab active" type="button" data-tab="status">Status</button>
        <button class="tab" type="button" data-tab="daily">Daily Report</button>
        <button class="tab" type="button" data-tab="share">Share</button>
        <button class="tab" type="button" data-tab="suggestions">Suggestions</button>
        <button class="tab" type="button" data-tab="tasks">Tasks</button>
        <button class="tab" type="button" data-tab="files">Files</button>
      </div>
      <div class="meta" id="meta">Loading...</div>
    </aside>
    <main>
      <div class="toolbar">
        <h2 id="title">Status</h2>
      </div>
      <section class="content" id="content"></section>
    </main>
  </div>
  <script>
    const state = { tab: "status", data: null };
    const titles = {
      status: "Status",
      daily: "Daily Report",
      share: "Share",
      suggestions: "Suggestions",
      tasks: "Tasks",
      files: "Files"
    };

    const dateInput = document.getElementById("date");
    const content = document.getElementById("content");
    const title = document.getElementById("title");
    const meta = document.getElementById("meta");

    dateInput.value = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

    document.getElementById("refresh").addEventListener("click", load);
    document.querySelectorAll(".tab").forEach((button) => {
      button.addEventListener("click", () => {
        state.tab = button.dataset.tab;
        document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
        render();
      });
    });

    async function load() {
      const response = await fetch("/api/dashboard?date=" + encodeURIComponent(dateInput.value));
      state.data = await response.json();
      render();
    }

    function render() {
      if (!state.data) return;
      title.textContent = titles[state.tab];
      meta.textContent = "Date: " + state.data.date;

      if (state.tab === "status") {
        content.innerHTML = markdownBlock(state.data.status);
      } else if (state.tab === "daily") {
        content.innerHTML = markdownBlock(state.data.dailyReport, "No daily report. Run /report.");
      } else if (state.tab === "share") {
        content.innerHTML = markdownBlock(state.data.shareReport, "No share report. Run /share.");
      } else if (state.tab === "suggestions") {
        content.innerHTML = markdownBlock(state.data.suggestions, "No suggestions. Run /suggest.");
      } else if (state.tab === "tasks") {
        content.innerHTML = '<div class="grid">' + Object.entries(state.data.tasks)
          .map(([name, text]) => '<div class="block"><h3>' + escapeHtml(name) + '</h3>' + markdownBlock(text, "No tasks.") + '</div>')
          .join("") + '</div>';
      } else if (state.tab === "files") {
        content.innerHTML = filesBlock(state.data.files);
      }
    }

    function markdownBlock(text, emptyText = "No content.") {
      if (!text || !text.trim()) return '<div class="empty">' + escapeHtml(emptyText) + '</div>';
      return '<pre>' + escapeHtml(text) + '</pre>';
    }

    function filesBlock(files) {
      return '<div class="grid">' + Object.entries(files)
        .map(([name, items]) => '<div class="block"><h3>' + escapeHtml(name) + '</h3><div class="file-list">' +
          (items.length ? items.map((item) => '<span>' + escapeHtml(item) + '</span>').join("") : '<span>No files.</span>') +
          '</div></div>')
        .join("") + '</div>';
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    load();
  </script>
</body>
</html>`;
}
