import http from "node:http";
import path from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { today } from "../core/date.js";
import { expandHome } from "../core/git.js";
import { parseRepositoryLinks } from "../core/markdown.js";
import { openFile } from "../core/open.js";
import { statusCommand } from "./status.js";

export type DashboardOptions = {
  port?: string;
  open?: boolean;
};

export type DashboardTab = "status" | "daily" | "share" | "suggestions" | "tasks" | "repositories" | "files";

type DashboardData = {
  date: string;
  status: string;
  dailyReport: string;
  shareReport: string;
  suggestions: string;
  repositoryContext: string;
  repositoryLinks: string;
  repositories: DashboardRepository[];
  tasks: Record<string, string>;
  files: {
    dailyReports: string[];
    shareReports: string[];
    suggestions: string[];
  };
};

type DashboardRepository = {
  id: string;
  name?: string;
  path?: string;
  localPath?: string;
  github?: string;
  project?: string;
  context?: string;
  understanding?: {
    projectBrief: string;
    areaMap: string;
    capabilityMap?: string;
    issueMap?: string;
    safetyReport: string;
    llmProjectBrief?: string;
    llmAreaMap?: string;
    llmCapabilityMap?: string;
    llmPlanningNotes?: string;
  };
};

const dashboardServers = new Map<string, http.Server>();

export async function dashboardCommand(targetDir: string, options: DashboardOptions = {}): Promise<string> {
  const port = Number(options.port ?? "4783");
  const url = await ensureDashboardServer(targetDir, port);
  if (options.open !== false) {
    await openFile(url);
  }
  return `Dashboard running: ${url}`;
}

export async function openDashboard(targetDir: string, tab: DashboardTab, date = today(), port = 4783): Promise<string> {
  const url = await ensureDashboardServer(targetDir, port);
  const viewUrl = `${url}/?tab=${encodeURIComponent(tab)}&date=${encodeURIComponent(date)}`;
  await openFile(viewUrl);
  return viewUrl;
}

async function ensureDashboardServer(targetDir: string, port: number): Promise<string> {
  const url = `http://127.0.0.1:${port}`;
  const key = `${targetDir}:${port}`;
  if (dashboardServers.has(key)) return url;

  const server = http.createServer(async (request, response) => {
    try {
      await handleRequest(targetDir, request, response);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve();
        return;
      }
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => resolve());
  });

  if (server.listening) {
    dashboardServers.set(key, server);
  }
  return url;
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
  const repositoryContext = await readText(path.join(targetDir, "context/repositories.md"));
  const repositoryLinks = await readText(path.join(targetDir, "links/repositories.md"));
  return {
    date,
    status: await statusCommand(targetDir, date),
    dailyReport: await readText(path.join(targetDir, "reports/daily", `${date}.md`)),
    shareReport: await readText(path.join(targetDir, "reports/share", `${date}.md`)),
    suggestions: await readText(path.join(targetDir, "suggestions", `${date}.md`)),
    repositoryContext,
    repositoryLinks,
    repositories: await buildDashboardRepositories(targetDir, repositoryLinks, repositoryContext),
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

async function buildDashboardRepositories(targetDir: string, repositoryLinks: string, repositoryContext: string): Promise<DashboardRepository[]> {
  const contextById = extractRepositoryContextSections(repositoryContext);
  return Promise.all(
    parseRepositoryLinks(repositoryLinks).map(async (repo) => {
      const localPath = resolveRepositoryLocalPath(targetDir, repo);
      const remotePath = path.join(targetDir, ".pm-agent", "remote-repositories", repo.id);
      return {
        id: repo.id,
        name: repo.name,
        path: repo.path,
        localPath,
        github: repo.github,
        project: repo.project,
        context: contextById.get(repo.id) ?? contextById.get(repo.name ?? "") ?? "",
        understanding: localPath
          ? await readRepositoryUnderstanding(localPath)
          : existsSync(remotePath)
            ? await readRemoteRepositoryUnderstanding(remotePath)
            : undefined
      };
    })
  );
}

function resolveRepositoryLocalPath(targetDir: string, repo: Record<string, string>): string | undefined {
  const candidates = [
    repo.path ? expandHome(repo.path) : "",
    path.join(path.dirname(targetDir), repo.id),
    path.join(homedir(), repo.id),
    path.join(homedir(), "work", repo.id),
    path.join(homedir(), "Desktop", repo.id)
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(path.join(candidate, ".git"))) ?? candidates.find((candidate) => existsSync(path.join(candidate, ".pm-agent")));
}

async function readRepositoryUnderstanding(repoDir: string): Promise<DashboardRepository["understanding"]> {
  return {
    projectBrief: await readText(path.join(repoDir, ".pm-agent/project/project-brief.md")),
    areaMap: await readText(path.join(repoDir, ".pm-agent/project/area-map.md")),
    capabilityMap: await readText(path.join(repoDir, ".pm-agent/project/capability-map.md")),
    issueMap: await readText(path.join(repoDir, ".pm-agent/project/issue-map.md")),
    safetyReport: await readText(path.join(repoDir, ".pm-agent/safety/safety-report.md")),
    llmProjectBrief: await readText(path.join(repoDir, ".pm-agent/llm/project-brief.md")),
    llmAreaMap: await readText(path.join(repoDir, ".pm-agent/llm/area-map.md")),
    llmCapabilityMap: await readText(path.join(repoDir, ".pm-agent/llm/capability-map.md")),
    llmPlanningNotes: await readText(path.join(repoDir, ".pm-agent/llm/planning-notes.md"))
  };
}

async function readRemoteRepositoryUnderstanding(repoDir: string): Promise<DashboardRepository["understanding"]> {
  return {
    projectBrief: await readText(path.join(repoDir, "project/project-brief.md")),
    areaMap: await readText(path.join(repoDir, "project/area-map.md")),
    capabilityMap: await readText(path.join(repoDir, "project/capability-map.md")),
    issueMap: await readText(path.join(repoDir, "project/issue-map.md")),
    safetyReport: await readText(path.join(repoDir, "safety/safety-report.md")),
    llmProjectBrief: await readText(path.join(repoDir, "llm/project-brief.md")),
    llmAreaMap: await readText(path.join(repoDir, "llm/area-map.md")),
    llmCapabilityMap: await readText(path.join(repoDir, "llm/capability-map.md")),
    llmPlanningNotes: await readText(path.join(repoDir, "llm/planning-notes.md"))
  };
}

function extractRepositoryContextSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = markdown.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{2,3})\s+(.+)\s*$/);
    if (!match) continue;

    const level = match[1].length;
    const title = match[2].trim();
    const body: string[] = [];
    for (const line of lines.slice(index + 1)) {
      const nextHeading = line.match(/^(#{2,6})\s+/);
      if (nextHeading && nextHeading[1].length <= level) break;
      body.push(line);
    }
    sections.set(title, [`${"#".repeat(level)} ${title}`, ...body].join("\n").trim());
  }

  return sections;
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

    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .copy-status {
      color: var(--muted);
      font-size: 12px;
      min-width: 48px;
      text-align: right;
    }

    .content {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
      min-height: calc(100vh - 88px);
      padding: 22px;
      overflow-x: hidden;
      overflow-y: auto;
      min-width: 0;
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
      max-width: 100%;
      overflow: hidden;
    }

    .block h3 {
      margin: 0 0 10px;
      font-size: 15px;
    }

    .block-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }

    .block-head h3 {
      margin: 0;
    }

    .copy-button {
      width: max-content;
      min-width: 64px;
      padding: 0 10px;
      font-size: 12px;
    }

    pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
      max-width: 100%;
      font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }

    .markdown {
      font-size: 14px;
      line-height: 1.65;
      color: var(--text);
      overflow-wrap: anywhere;
    }

    .markdown h1,
    .markdown h2,
    .markdown h3,
    .markdown h4 {
      margin: 16px 0 8px;
      line-height: 1.3;
    }

    .markdown h1 {
      font-size: 18px;
    }

    .markdown h2 {
      font-size: 16px;
      border-top: 1px solid var(--line);
      padding-top: 12px;
    }

    .markdown h3 {
      font-size: 14px;
    }

    .markdown p {
      margin: 8px 0;
    }

    .markdown ul,
    .markdown ol {
      margin: 8px 0 8px 20px;
      padding: 0;
    }

    .markdown li {
      margin: 4px 0;
    }

    .markdown code {
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      background: #f4f6f8;
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 1px 4px;
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

    .repo-layout {
      display: grid;
      grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
      width: 100%;
      max-width: 100%;
      min-width: 0;
    }

    .repo-list {
      display: grid;
      gap: 8px;
      min-width: 0;
    }

    .repo-detail {
      display: grid;
      gap: 16px;
      min-width: 0;
    }

    .repo-link {
      display: block;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
      color: var(--text);
      text-decoration: none;
      background: #fff;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
    }

    .repo-link:hover {
      border-color: var(--accent);
    }

    .repo-link.active {
      border-color: var(--accent);
      background: var(--accent-weak);
    }

    .repo-link strong {
      display: block;
      font-size: 14px;
      line-height: 1.3;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .repo-link span {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .repo-meta {
      display: grid;
      gap: 8px;
      margin-bottom: 14px;
      color: var(--muted);
      font-size: 13px;
    }

    .repo-meta div {
      overflow-wrap: anywhere;
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
      .repo-layout { grid-template-columns: 1fr; }
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
        <button class="tab" type="button" data-tab="repositories">Repositories</button>
        <button class="tab" type="button" data-tab="files">Files</button>
      </div>
      <div class="meta" id="meta">Loading...</div>
    </aside>
    <main>
      <div class="toolbar">
        <h2 id="title">Status</h2>
        <div class="toolbar-actions">
          <button class="copy-button" id="copy-view" type="button">Copy View</button>
          <span class="copy-status" id="copy-status"></span>
        </div>
      </div>
      <section class="content" id="content"></section>
    </main>
  </div>
  <script>
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get("tab") || "status";
    const state = { tab: initialTab, repo: params.get("repo") || "", data: null };
    const titles = {
      status: "Status",
      daily: "Daily Report",
      share: "Share",
      suggestions: "Suggestions",
      tasks: "Tasks",
      repositories: "Repositories",
      files: "Files"
    };

    const dateInput = document.getElementById("date");
    const content = document.getElementById("content");
    const title = document.getElementById("title");
    const meta = document.getElementById("meta");
    const copyStatus = document.getElementById("copy-status");

    dateInput.value = params.get("date") || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

    document.getElementById("refresh").addEventListener("click", load);
    document.getElementById("copy-view").addEventListener("click", () => copyText(currentViewText()));
    document.querySelectorAll(".tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === state.tab);
    });
    document.querySelectorAll(".tab").forEach((button) => {
      button.addEventListener("click", () => {
        state.tab = button.dataset.tab;
        document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
        updateUrl();
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
          .map(([name, text]) => '<div class="block"><div class="block-head"><h3>' + escapeHtml(name) + '</h3><button class="copy-button" type="button" data-copy-task="' + escapeHtml(name) + '">Copy</button></div>' + markdownBlock(text, "No tasks.") + '</div>')
          .join("") + '</div>';
        content.querySelectorAll("[data-copy-task]").forEach((button) => {
          button.addEventListener("click", () => copyText(state.data.tasks[button.dataset.copyTask] || ""));
        });
      } else if (state.tab === "repositories") {
        content.innerHTML = repositoriesBlock();
      } else if (state.tab === "files") {
        content.innerHTML = filesBlock(state.data.files);
      }
    }

    function markdownBlock(text, emptyText = "No content.") {
      if (!text || !text.trim()) return '<div class="empty">' + escapeHtml(emptyText) + '</div>';
      return '<div class="markdown">' + renderMarkdown(text) + '</div>';
    }

    function renderMarkdown(text) {
      const lines = text.split(/\\r?\\n/);
      const html = [];
      let listType = null;
      let paragraph = [];
      let inFence = false;
      let fence = [];

      function flushParagraph() {
        if (paragraph.length) {
          html.push('<p>' + inlineMarkdown(paragraph.join(' ')) + '</p>');
          paragraph = [];
        }
      }
      function closeList() {
        if (listType) {
          html.push('</' + listType + '>');
          listType = null;
        }
      }

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (line.startsWith(String.fromCharCode(96, 96, 96))) {
          if (inFence) {
            html.push('<pre>' + escapeHtml(fence.join('\\n')) + '</pre>');
            fence = [];
            inFence = false;
          } else {
            flushParagraph();
            closeList();
            inFence = true;
          }
          continue;
        }
        if (inFence) {
          fence.push(line);
          continue;
        }
        if (!line.trim()) {
          flushParagraph();
          closeList();
          continue;
        }
        const heading = line.match(/^(#{1,4})\\s+(.+)$/);
        if (heading) {
          flushParagraph();
          closeList();
          const level = heading[1].length;
          html.push('<h' + level + '>' + inlineMarkdown(heading[2]) + '</h' + level + '>');
          continue;
        }
        const bullet = line.match(/^-\\s+(.+)$/);
        if (bullet) {
          flushParagraph();
          if (listType !== 'ul') {
            closeList();
            html.push('<ul>');
            listType = 'ul';
          }
          html.push('<li>' + inlineMarkdown(bullet[1]) + '</li>');
          continue;
        }
        const numbered = line.match(/^\\d+\\.\\s+(.+)$/);
        if (numbered) {
          flushParagraph();
          if (listType !== 'ol') {
            closeList();
            html.push('<ol>');
            listType = 'ol';
          }
          html.push('<li>' + inlineMarkdown(numbered[1]) + '</li>');
          continue;
        }
        closeList();
        paragraph.push(line.trim());
      }
      flushParagraph();
      closeList();
      if (inFence && fence.length) html.push('<pre>' + escapeHtml(fence.join('\\n')) + '</pre>');
      return html.join('');
    }

    function inlineMarkdown(text) {
      return escapeHtml(text);
    }

    function filesBlock(files) {
      return '<div class="grid">' + Object.entries(files)
        .map(([name, items]) => '<div class="block"><div class="block-head"><h3>' + escapeHtml(name) + '</h3><button class="copy-button" type="button" data-copy-files="' + escapeHtml(name) + '">Copy</button></div><div class="file-list">' +
          (items.length ? items.map((item) => '<span>' + escapeHtml(item) + '</span>').join("") : '<span>No files.</span>') +
          '</div></div>')
        .join("") + '</div>';
    }

    function repositoriesBlock() {
      const repos = state.data.repositories || [];
      if (!repos.length) return markdownBlock(state.data.repositoryLinks, "No repositories. Run setup --select-repos or edit links/repositories.md.");
      const selected = repos.find((repo) => repo.id === state.repo) || repos[0];
      state.repo = selected.id;
      const list = repos.map((repo) => {
        const href = "?tab=repositories&repo=" + encodeURIComponent(repo.id) + "&date=" + encodeURIComponent(dateInput.value);
        return '<a class="repo-link' + (repo.id === selected.id ? ' active' : '') + '" href="' + href + '" data-repo-id="' + escapeHtml(repo.id) + '">' +
          '<strong>' + escapeHtml(repo.name || repo.id) + '</strong>' +
          '<span>' + escapeHtml(repo.github || repo.path || repo.project || repo.id) + '</span>' +
          '</a>';
      }).join("");
      return '<div class="repo-layout">' +
        '<div class="block"><div class="block-head"><h3>Repositories</h3><button class="copy-button" type="button" data-copy-repository="links">Copy</button></div><div class="repo-list">' + list + '</div></div>' +
        '<div class="repo-detail">' +
        '<div class="block"><div class="block-head"><h3>' + escapeHtml(selected.name || selected.id) + '</h3><button class="copy-button" type="button" data-copy-repository="selected">Copy</button></div>' +
        repoMetaBlock(selected) +
        markdownBlock(selected.context || repositoryRecordText(selected), "No repository context. Run setup --select-repos or edit context/repositories.md.") +
        '</div>' +
        understandingBlock(selected) +
        '</div>' +
        '</div>';
    }

    function repoMetaBlock(repo) {
      return '<div class="repo-meta">' +
        '<div><strong>ID:</strong> ' + escapeHtml(repo.id || "") + '</div>' +
        (repo.github ? '<div><strong>GitHub:</strong> ' + escapeHtml(repo.github) + '</div>' : '') +
        (repo.path ? '<div><strong>Local:</strong> ' + escapeHtml(repo.path) + '</div>' : '') +
        (repo.localPath && repo.localPath !== repo.path ? '<div><strong>Resolved:</strong> ' + escapeHtml(repo.localPath) + '</div>' : '') +
        (repo.project ? '<div><strong>Project:</strong> ' + escapeHtml(repo.project) + '</div>' : '') +
        '</div>';
    }

    function understandingBlock(repo) {
      const understanding = repo.understanding || {};
      const hasUnderstanding = Boolean((understanding.projectBrief || "").trim() || (understanding.areaMap || "").trim() || (understanding.capabilityMap || "").trim() || (understanding.issueMap || "").trim() || (understanding.safetyReport || "").trim() || (understanding.llmProjectBrief || "").trim() || (understanding.llmPlanningNotes || "").trim());
      if (!hasUnderstanding) {
        return '<div class="empty">No understand output yet. Run pm-agent understand for this repository, then refresh the dashboard.</div>';
      }
      return '<div class="grid">' +
        '<div class="block"><div class="block-head"><h3>LLM Project Brief</h3><button class="copy-button" type="button" data-copy-understand="llmProjectBrief">Copy</button></div>' + markdownBlock(understanding.llmProjectBrief, "No LLM project brief. Run understand with --llm.") + '</div>' +
        '<div class="block"><div class="block-head"><h3>LLM Planning Notes</h3><button class="copy-button" type="button" data-copy-understand="llmPlanningNotes">Copy</button></div>' + markdownBlock(understanding.llmPlanningNotes, "No LLM planning notes. Run understand with --llm.") + '</div>' +
        '<div class="block"><div class="block-head"><h3>LLM Area Map</h3><button class="copy-button" type="button" data-copy-understand="llmAreaMap">Copy</button></div>' + markdownBlock(understanding.llmAreaMap, "No LLM area map. Run understand with --llm.") + '</div>' +
        '<div class="block"><div class="block-head"><h3>LLM Capability Map</h3><button class="copy-button" type="button" data-copy-understand="llmCapabilityMap">Copy</button></div>' + markdownBlock(understanding.llmCapabilityMap, "No LLM capability map. Run understand with --llm.") + '</div>' +
        '<div class="block"><div class="block-head"><h3>Project Brief</h3><button class="copy-button" type="button" data-copy-understand="projectBrief">Copy</button></div>' + markdownBlock(understanding.projectBrief, "No project brief.") + '</div>' +
        '<div class="block"><div class="block-head"><h3>Area Map</h3><button class="copy-button" type="button" data-copy-understand="areaMap">Copy</button></div>' + markdownBlock(understanding.areaMap, "No area map.") + '</div>' +
        '<div class="block"><div class="block-head"><h3>Capability Map</h3><button class="copy-button" type="button" data-copy-understand="capabilityMap">Copy</button></div>' + markdownBlock(understanding.capabilityMap, "No capability map.") + '</div>' +
        '<div class="block"><div class="block-head"><h3>Issue Map</h3><button class="copy-button" type="button" data-copy-understand="issueMap">Copy</button></div>' + markdownBlock(understanding.issueMap, "No issue map.") + '</div>' +
        '<div class="block"><div class="block-head"><h3>Safety Report</h3><button class="copy-button" type="button" data-copy-understand="safetyReport">Copy</button></div>' + markdownBlock(understanding.safetyReport, "No safety report.") + '</div>' +
        '</div>';
    }

    function repositoryRecordText(repo) {
      return [
        "# " + (repo.name || repo.id),
        "",
        "- id: " + (repo.id || ""),
        repo.github ? "- github: " + repo.github : "",
        repo.path ? "- path: " + repo.path : "",
        repo.project ? "- project: " + repo.project : ""
      ].filter(Boolean).join("\\n");
    }

    content.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      const fileGroup = target.dataset.copyFiles;
      if (fileGroup) {
        copyText((state.data.files[fileGroup] || []).join("\\n"));
      }
      const repositoryGroup = target.dataset.copyRepository;
      if (repositoryGroup === "context") {
        copyText(state.data.repositoryContext || "");
      } else if (repositoryGroup === "links") {
        copyText(state.data.repositoryLinks || "");
      } else if (repositoryGroup === "selected") {
        copyText(selectedRepositoryText());
      }
      const understandGroup = target.dataset.copyUnderstand;
      if (understandGroup) {
        const selected = selectedRepository();
        copyText(selected?.understanding?.[understandGroup] || "");
      }
    });

    content.addEventListener("click", (event) => {
      const link = event.target instanceof Element ? event.target.closest("[data-repo-id]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      event.preventDefault();
      state.repo = link.dataset.repoId || "";
      updateUrl();
      render();
    });

    function currentViewText() {
      if (!state.data) return "";
      if (state.tab === "status") return state.data.status || "";
      if (state.tab === "daily") return state.data.dailyReport || "";
      if (state.tab === "share") return state.data.shareReport || "";
      if (state.tab === "suggestions") return state.data.suggestions || "";
      if (state.tab === "tasks") {
        return Object.entries(state.data.tasks)
          .map(([name, text]) => "# " + name + "\\n\\n" + (text || ""))
          .join("\\n\\n");
      }
      if (state.tab === "files") {
        return Object.entries(state.data.files)
          .map(([name, items]) => "# " + name + "\\n" + items.join("\\n"))
          .join("\\n\\n");
      }
      if (state.tab === "repositories") {
        return selectedRepositoryText();
      }
      return "";
    }

    function selectedRepositoryText() {
      const selected = selectedRepository();
      if (!selected) return "# Repository Links\\n\\n" + (state.data?.repositoryLinks || "");
      const understanding = selected.understanding || {};
      return repositoryRecordText(selected) +
        "\\n\\n" + (selected.context || "") +
        "\\n\\n# Project Brief\\n\\n" + (understanding.projectBrief || "") +
        "\\n\\n# Area Map\\n\\n" + (understanding.areaMap || "") +
        "\\n\\n# Safety Report\\n\\n" + (understanding.safetyReport || "");
    }

    function selectedRepository() {
      const repos = state.data?.repositories || [];
      return repos.find((repo) => repo.id === state.repo) || repos[0];
    }

    function updateUrl() {
      const next = new URLSearchParams(window.location.search);
      next.set("tab", state.tab);
      next.set("date", dateInput.value);
      if (state.tab === "repositories" && state.repo) next.set("repo", state.repo);
      else next.delete("repo");
      window.history.replaceState(null, "", "?" + next.toString());
    }

    async function copyText(text) {
      if (!text || !text.trim()) {
        setCopyStatus("Empty");
        return;
      }
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          fallbackCopy(text);
        }
        setCopyStatus("Copied");
      } catch {
        fallbackCopy(text);
        setCopyStatus("Copied");
      }
    }

    function fallbackCopy(text) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    function setCopyStatus(message) {
      copyStatus.textContent = message;
      window.clearTimeout(setCopyStatus.timer);
      setCopyStatus.timer = window.setTimeout(() => {
        copyStatus.textContent = "";
      }, 1400);
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
