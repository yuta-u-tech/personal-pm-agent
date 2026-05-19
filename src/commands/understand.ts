import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { ensureDir, writeJson, writeTextIfMissing } from "../core/fs.js";

const execFileAsync = promisify(execFile);

export type UnderstandOptions = {
  refresh?: boolean;
};

type SensitiveAction = "skip" | "structure-only" | "redact";

type SymbolInfo = {
  kind: string;
  name: string;
};

type TestInfo = {
  kind: string;
  name: string;
};

type FileCard = {
  path: string;
  extension: string;
  language: string;
  size: number;
  lineCount: number;
  headExcerpt?: string;
  imports: string[];
  exports: string[];
  symbols: SymbolInfo[];
  headings?: string[];
  tests?: TestInfo[];
  signals: string[];
  guessedRole?: string;
  sensitive?: boolean;
  sensitiveAction?: SensitiveAction;
  contentIncluded: boolean;
};

type SafetyFinding = {
  path: string;
  reason: string;
  recommendedAction: SensitiveAction;
  action: SensitiveAction;
  redactions: Record<string, number>;
};

type DependencyEdge = {
  from: string;
  to: string;
  type: "imports";
  symbols: string[];
};

type DeepReadCandidate = {
  path: string;
  score: number;
  reasons: string[];
};

const DEFAULT_IGNORE = `# secrets
.env
.env.*
*.pem
*.key
*.p12
*.pfx
id_rsa
id_ed25519
credentials.json
service-account*.json
firebase-adminsdk*.json
secrets/
secret/
.secrets/
certs/
keys/
.aws/
.gcp/
.azure/
.ssh/
.kube/

# dependencies / build
node_modules/
dist/
build/
coverage/
.next/
.nuxt/
vendor/

# generated / large
*.lock
*.min.js
*.map
*.sqlite
*.db
*.dump
*.zip
*.tar
*.gz
`;

const DANGEROUS_PATTERNS = [
  { pattern: ".env", reason: "environment file", action: "skip" as SensitiveAction },
  { pattern: ".env.*", reason: "environment file", action: "skip" as SensitiveAction },
  { pattern: "*.pem", reason: "private key or certificate", action: "skip" as SensitiveAction },
  { pattern: "*.key", reason: "private key", action: "skip" as SensitiveAction },
  { pattern: "*.p12", reason: "certificate bundle", action: "skip" as SensitiveAction },
  { pattern: "*.pfx", reason: "certificate bundle", action: "skip" as SensitiveAction },
  { pattern: "id_rsa", reason: "ssh private key", action: "skip" as SensitiveAction },
  { pattern: "id_ed25519", reason: "ssh private key", action: "skip" as SensitiveAction },
  { pattern: "credentials.json", reason: "credentials file", action: "skip" as SensitiveAction },
  { pattern: "service-account*.json", reason: "service account file", action: "skip" as SensitiveAction },
  { pattern: "firebase-adminsdk*.json", reason: "firebase service account file", action: "skip" as SensitiveAction },
  { pattern: "secrets/", reason: "secrets directory", action: "skip" as SensitiveAction },
  { pattern: "secret/", reason: "secret directory", action: "skip" as SensitiveAction },
  { pattern: ".secrets/", reason: "secrets directory", action: "skip" as SensitiveAction },
  { pattern: "certs/", reason: "certificates directory", action: "skip" as SensitiveAction },
  { pattern: "keys/", reason: "keys directory", action: "skip" as SensitiveAction },
  { pattern: ".aws/", reason: "cloud credentials directory", action: "skip" as SensitiveAction },
  { pattern: ".gcp/", reason: "cloud credentials directory", action: "skip" as SensitiveAction },
  { pattern: ".azure/", reason: "cloud credentials directory", action: "skip" as SensitiveAction },
  { pattern: ".ssh/", reason: "ssh directory", action: "skip" as SensitiveAction },
  { pattern: ".kube/", reason: "kubernetes credentials directory", action: "skip" as SensitiveAction },
  { pattern: "src/config/env.ts", reason: "possible secret handling file", action: "structure-only" as SensitiveAction },
  { pattern: "config/env.ts", reason: "possible secret handling file", action: "structure-only" as SensitiveAction }
];

const SECRET_RULES: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: "openai_api_key", pattern: /sk-[A-Za-z0-9_-]{20,}/g, replacement: "[REDACTED_OPENAI_API_KEY]" },
  { name: "github_token", pattern: /ghp_[A-Za-z0-9_]{20,}/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
  { name: "github_token", pattern: /github_pat_[A-Za-z0-9_]{20,}/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
  { name: "slack_token", pattern: /xox[baprs]-[A-Za-z0-9-]+/g, replacement: "[REDACTED_SLACK_TOKEN]" },
  { name: "aws_access_key", pattern: /AKIA[0-9A-Z]{16}/g, replacement: "[REDACTED_AWS_ACCESS_KEY]" },
  { name: "private_key", pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |OPENSSH )?PRIVATE KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" },
  { name: "database_url", pattern: /\b(postgres|mysql|mongodb\+srv):\/\/[^\s"'`]+/g, replacement: "[REDACTED_DATABASE_URL]" },
  { name: "secret_env", pattern: /^([A-Z0-9_]*SECRET)=.*$/gm, replacement: "$1=[REDACTED_SECRET]" },
  { name: "token_env", pattern: /^([A-Z0-9_]*TOKEN)=.*$/gm, replacement: "$1=[REDACTED_TOKEN]" },
  { name: "password_env", pattern: /^([A-Z0-9_]*PASSWORD)=.*$/gm, replacement: "$1=[REDACTED_PASSWORD]" }
];

const COMMON_SIGNALS = new Set([
  "src",
  "app",
  "lib",
  "utils",
  "util",
  "index",
  "test",
  "spec",
  "types",
  "type",
  "page",
  "route",
  "component",
  "components",
  "file",
  "files",
  "main",
  "core",
  "common"
]);

export async function understandCommand(targetDir: string, options: UnderstandOptions = {}): Promise<string> {
  const repoDir = path.resolve(targetDir);
  const catalogPath = path.join(repoDir, ".pm-agent/catalog/file-cards.json");
  if (!options.refresh && existsSync(catalogPath)) {
    return `Project understanding already exists: ${path.join(repoDir, ".pm-agent")}\nRun with --refresh to rebuild it.`;
  }

  await writeTextIfMissing(path.join(repoDir, ".pm-agentignore"), DEFAULT_IGNORE);
  await ensureKnowledgeDirs(repoDir);

  const files = await listGitFiles(repoDir);
  const ignorePatterns = await readIgnorePatterns(repoDir);
  const candidateFiles = files.filter((file) => !matchesAny(file, ignorePatterns));
  const sensitiveDecisions = await resolveSensitiveActions(candidateFiles);

  const cards: FileCard[] = [];
  const safetyFindings: SafetyFinding[] = [];

  for (const file of candidateFiles) {
    const absolutePath = path.join(repoDir, file);
    const content = await readFile(absolutePath, "utf8").catch(() => "");
    const sensitive = sensitiveDecisions.get(file);
    const redacted = redactSecrets(content);
    if (sensitive || Object.keys(redacted.counts).length > 0) {
      safetyFindings.push({
        path: file,
        reason: sensitive?.reason ?? "secret-like value detected",
        recommendedAction: sensitive?.recommendedAction ?? "redact",
        action: sensitive?.action ?? "redact",
        redactions: redacted.counts
      });
    }
    const action = sensitive?.action;
    if (action === "skip") continue;
    cards.push(createFileCard(file, action === "redact" ? redacted.text : content, action));
  }

  const aliases = await readPathAliases(repoDir);
  const edges = buildDependencyGraph(cards, aliases);
  const reverseIndex = buildReverseIndex(edges);
  const deepReadCandidates = selectDeepReadCandidates(cards, edges).slice(0, 30);
  const summaries = await writeFileSummaries(repoDir, cards, deepReadCandidates);
  const project = buildProjectUnderstanding(cards, edges, deepReadCandidates);

  const payload = JSON.stringify({ cards, edges, reverseIndex, deepReadCandidates, project, summaries });
  const payloadAudit = redactSecrets(payload);
  if (Object.keys(payloadAudit.counts).length > 0) {
    safetyFindings.push({
      path: "llm-payload",
      reason: "secret-like value detected before model payload",
      recommendedAction: "redact",
      action: "redact",
      redactions: payloadAudit.counts
    });
  }

  await writeJson(path.join(repoDir, ".pm-agent/catalog/file-cards.json"), cards);
  await writeJson(path.join(repoDir, ".pm-agent/graph/dependency-graph.json"), { edges });
  await writeJson(path.join(repoDir, ".pm-agent/graph/reverse-dependency-index.json"), reverseIndex);
  await writeJson(path.join(repoDir, ".pm-agent/project/project-brief.json"), project.brief);
  await writeFile(path.join(repoDir, ".pm-agent/project/project-brief.md"), renderProjectBrief(project.brief), "utf8");
  await writeJson(path.join(repoDir, ".pm-agent/project/area-map.json"), project.areaMap);
  await writeFile(path.join(repoDir, ".pm-agent/project/area-map.md"), renderAreaMap(project.areaMap), "utf8");
  await writeJson(path.join(repoDir, ".pm-agent/project/capability-map.json"), project.capabilityMap);
  await writeJson(path.join(repoDir, ".pm-agent/project/issue-map.json"), project.issueMap);
  await writeJson(path.join(repoDir, ".pm-agent/safety/safety-report.json"), safetyFindings);
  await writeFile(path.join(repoDir, ".pm-agent/safety/safety-report.md"), renderSafetyReport(safetyFindings), "utf8");

  return `Project understanding generated: ${path.join(repoDir, ".pm-agent")}
- Files scanned: ${files.length}
- Files after ignore filters: ${candidateFiles.length}
- File cards: ${cards.length}
- Dependency edges: ${edges.length}
- Deep-read summaries: ${deepReadCandidates.length}
- Safety findings: ${safetyFindings.length}`;
}

async function ensureKnowledgeDirs(repoDir: string): Promise<void> {
  await Promise.all([
    ensureDir(path.join(repoDir, ".pm-agent/catalog")),
    ensureDir(path.join(repoDir, ".pm-agent/graph")),
    ensureDir(path.join(repoDir, ".pm-agent/file-summaries")),
    ensureDir(path.join(repoDir, ".pm-agent/project")),
    ensureDir(path.join(repoDir, ".pm-agent/safety"))
  ]);
}

async function listGitFiles(repoDir: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files"], { cwd: repoDir });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readIgnorePatterns(repoDir: string): Promise<string[]> {
  const file = path.join(repoDir, ".pm-agentignore");
  const text = existsSync(file) ? await readFile(file, "utf8") : DEFAULT_IGNORE;
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function resolveSensitiveActions(files: string[]): Promise<Map<string, { reason: string; recommendedAction: SensitiveAction; action: SensitiveAction }>> {
  const findings = files
    .map((file) => {
      const rule = DANGEROUS_PATTERNS.find((candidate) => matchesPattern(file, candidate.pattern));
      return rule ? { path: file, reason: rule.reason, recommendedAction: rule.action, action: rule.action } : null;
    })
    .filter((finding): finding is { path: string; reason: string; recommendedAction: SensitiveAction; action: SensitiveAction } => Boolean(finding));

  if (findings.length === 0) return new Map();
  if (!input.isTTY || !output.isTTY) return new Map(findings.map((finding) => [finding.path, finding]));

  console.log("\nPotential sensitive files detected\n");
  findings.forEach((finding, index) => {
    console.log(`${index + 1}. ${finding.path}`);
    console.log(`   reason: ${finding.reason}`);
    console.log(`   recommended: ${finding.recommendedAction}`);
  });
  console.log("\nHow should pm-agent handle these files?");
  console.log("[Enter] use recommended actions");
  console.log("[s] skip all");
  console.log("[r] redact all");

  const rl = readline.createInterface({ input, output });
  const answer = (await rl.question("> ")).trim().toLowerCase();
  rl.close();

  const action = answer === "s" ? "skip" : answer === "r" ? "redact" : null;
  return new Map(
    findings.map((finding) => [
      finding.path,
      {
        ...finding,
        action: action ?? finding.recommendedAction
      }
    ])
  );
}

function createFileCard(filePath: string, content: string, sensitiveAction?: SensitiveAction): FileCard {
  const extension = path.extname(filePath);
  const language = languageFor(filePath);
  const lines = content.split(/\r?\n/);
  const imports = extractImports(content);
  const exports = extractExports(content);
  const symbols = extractSymbols(content);
  const headings = language === "markdown" ? extractMarkdownHeadings(content) : undefined;
  const tests = extractTests(content);
  const signals = collectSignals(filePath, [...imports, ...exports, ...symbols.map((symbol) => symbol.name), ...(headings ?? [])]);
  const contentIncluded = sensitiveAction !== "structure-only";

  return {
    path: filePath,
    extension,
    language,
    size: Buffer.byteLength(content, "utf8"),
    lineCount: lines.length,
    headExcerpt: contentIncluded ? lines.slice(0, 30).join("\n") : undefined,
    imports,
    exports,
    symbols,
    headings,
    tests: tests.length ? tests : undefined,
    signals,
    guessedRole: guessRole(filePath),
    sensitive: Boolean(sensitiveAction),
    sensitiveAction,
    contentIncluded
  };
}

function extractImports(content: string): string[] {
  const imports = new Set<string>();
  for (const match of content.matchAll(/import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g)) {
    imports.add(match[1]);
  }
  for (const match of content.matchAll(/require\(["']([^"']+)["']\)/g)) {
    imports.add(match[1]);
  }
  return [...imports];
}

function extractExports(content: string): string[] {
  const exports = new Set<string>();
  for (const match of content.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z0-9_]+)/g)) {
    exports.add(match[1]);
  }
  for (const match of content.matchAll(/export\s*\{([^}]+)\}/g)) {
    match[1].split(",").map((item) => item.trim().split(/\s+as\s+/)[0]?.trim()).filter(Boolean).forEach((item) => exports.add(item));
  }
  return [...exports];
}

function extractSymbols(content: string): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  for (const match of content.matchAll(/\b(type|interface|enum|function|class)\s+([A-Za-z0-9_]+)/g)) {
    symbols.push({ kind: match[1], name: match[2] });
  }
  for (const match of content.matchAll(/\b(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(?/g)) {
    symbols.push({ kind: "const", name: match[1] });
  }
  return uniqueSymbols(symbols).slice(0, 80);
}

function extractTests(content: string): TestInfo[] {
  return [...content.matchAll(/\b(describe|it|test)\(["'`]([^"'`]+)["'`]/g)].map((match) => ({
    kind: match[1],
    name: match[2]
  }));
}

function extractMarkdownHeadings(content: string): string[] {
  return [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim()).slice(0, 80);
}

async function readPathAliases(repoDir: string): Promise<Record<string, string>> {
  const aliases: Record<string, string> = { "@/*": "src/*" };
  const configPath = ["tsconfig.json", "jsconfig.json"].map((name) => path.join(repoDir, name)).find((file) => existsSync(file));
  if (!configPath) return aliases;
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8"));
    const paths = parsed.compilerOptions?.paths ?? {};
    for (const [alias, targets] of Object.entries(paths)) {
      if (Array.isArray(targets) && typeof targets[0] === "string") aliases[alias] = targets[0];
    }
  } catch {
    return aliases;
  }
  return aliases;
}

function buildDependencyGraph(cards: FileCard[], aliases: Record<string, string>): DependencyEdge[] {
  const known = new Set(cards.map((card) => card.path));
  const edges: DependencyEdge[] = [];
  for (const card of cards) {
    for (const importPath of card.imports) {
      const resolved = resolveImport(card.path, importPath, known, aliases);
      if (!resolved) continue;
      edges.push({ from: card.path, to: resolved, type: "imports", symbols: [] });
    }
  }
  return edges;
}

function resolveImport(from: string, imported: string, known: Set<string>, aliases: Record<string, string>): string | null {
  if (imported.startsWith(".")) {
    return resolveKnownPath(path.posix.normalize(path.posix.join(path.posix.dirname(from), imported)), known);
  }

  for (const [alias, target] of Object.entries(aliases)) {
    const aliasPrefix = alias.replace(/\*$/, "");
    const targetPrefix = target.replace(/\*$/, "");
    if (imported.startsWith(aliasPrefix)) {
      return resolveKnownPath(path.posix.normalize(targetPrefix + imported.slice(aliasPrefix.length)), known);
    }
  }
  return null;
}

function resolveKnownPath(base: string, known: Set<string>): string | null {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`
  ];
  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

function buildReverseIndex(edges: DependencyEdge[]): Record<string, Array<{ importedBy: string; symbols: string[] }>> {
  const index: Record<string, Array<{ importedBy: string; symbols: string[] }>> = {};
  for (const edge of edges) {
    index[edge.to] ??= [];
    index[edge.to].push({ importedBy: edge.from, symbols: edge.symbols });
  }
  return index;
}

function selectDeepReadCandidates(cards: FileCard[], edges: DependencyEdge[]): DeepReadCandidate[] {
  const importedCount = new Map<string, number>();
  for (const edge of edges) importedCount.set(edge.to, (importedCount.get(edge.to) ?? 0) + 1);

  return cards
    .map((card) => {
      const reasons: string[] = [];
      let score = importedCount.get(card.path) ?? 0;
      if (/README\.md$/i.test(card.path)) {
        score += 20;
        reasons.push("overview");
      }
      if (/package\.json$|tsconfig\.json$|Dockerfile$/.test(card.path)) {
        score += 15;
        reasons.push("runtime");
      }
      if (/src\/(main|server|index)\.|src\/app\/.*(page|route)\./.test(card.path)) {
        score += 12;
        reasons.push("entrypoint");
      }
      if (/src\/(lib|services|domain|usecases)\//.test(card.path)) {
        score += 10;
        reasons.push("core");
      }
      if (/src\/(components|pages|controllers|handlers)\//.test(card.path)) {
        score += 8;
        reasons.push("interface");
      }
      if (/prisma\/schema\.prisma|migrations|models/.test(card.path)) {
        score += 8;
        reasons.push("data");
      }
      if (/\.test\.|\.spec\./.test(card.path)) {
        score += 4;
        reasons.push("test");
      }
      if (card.size > 80_000) {
        score -= 20;
        reasons.push("huge-file-penalty");
      }
      if (card.sensitive) {
        score -= 50;
        reasons.push("sensitive-penalty");
      }
      return { path: card.path, score, reasons };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

async function writeFileSummaries(repoDir: string, cards: FileCard[], candidates: DeepReadCandidate[]): Promise<Array<{ path: string; summaryPath: string }>> {
  const byPath = new Map(cards.map((card) => [card.path, card]));
  const summaries: Array<{ path: string; summaryPath: string }> = [];
  for (const candidate of candidates) {
    const card = byPath.get(candidate.path);
    if (!card) continue;
    const summary = renderFileSummary(card, candidate);
    const summaryPath = path.join(repoDir, ".pm-agent/file-summaries", `${safeFileName(candidate.path)}.md`);
    await mkdir(path.dirname(summaryPath), { recursive: true });
    await writeFile(summaryPath, summary, "utf8");
    summaries.push({ path: candidate.path, summaryPath });
  }
  return summaries;
}

function buildProjectUnderstanding(cards: FileCard[], edges: DependencyEdge[], candidates: DeepReadCandidate[]) {
  const packageCard = cards.find((card) => card.path === "package.json");
  const areas = buildAreas(cards);
  const capabilities = buildCapabilities(cards);
  const brief = {
    purpose: inferPurpose(cards),
    techStack: inferTechStack(cards),
    mainFeatures: capabilities.capabilities.slice(0, 10).map((capability) => capability.name),
    currentPhase: "unknown",
    currentStatus: "Project understanding generated from git-tracked files.",
    importantAreas: areas.areas.map((area) => area.name),
    bottlenecks: candidates.filter((candidate) => candidate.reasons.includes("huge-file-penalty")).map((candidate) => candidate.path),
    risks: cards.filter((card) => card.sensitive).map((card) => `${card.path}: sensitive handling required`),
    planningRules: [
      "Use issue text to match signals before selecting files.",
      "Prefer deep-read candidates over broad repository reads.",
      "Never send raw secret-like content to an LLM payload."
    ],
    usefulCommands: inferUsefulCommands(packageCard)
  };

  return {
    brief,
    areaMap: areas,
    capabilityMap: capabilities,
    issueMap: {
      issues: [],
      note: "Issue-specific mapping is reserved for pm-agent understand --issue."
    },
    dependencySummary: {
      files: cards.length,
      edges: edges.length
    }
  };
}

function buildAreas(cards: FileCard[]) {
  const groups = new Map<string, FileCard[]>();
  for (const card of cards) {
    const area = inferArea(card.path);
    groups.set(area, [...(groups.get(area) ?? []), card]);
  }
  return {
    areas: [...groups.entries()].map(([name, files]) => ({
      name,
      purpose: `${name} area inferred from repository structure.`,
      importantFiles: files.slice(0, 12).map((file) => file.path),
      relatedCapabilities: [...new Set(files.flatMap((file) => file.signals))].slice(0, 12),
      relatedIssues: [],
      risks: files.some((file) => file.sensitive) ? ["contains sensitive-handling files"] : []
    }))
  };
}

function buildCapabilities(cards: FileCard[]) {
  const capabilityMap = new Map<string, Set<string>>();
  for (const card of cards) {
    for (const signal of card.signals.slice(0, 8)) {
      if (signal.length < 3) continue;
      capabilityMap.set(signal, (capabilityMap.get(signal) ?? new Set()).add(card.path));
    }
  }
  return {
    capabilities: [...capabilityMap.entries()]
      .filter(([, files]) => files.size > 1)
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .slice(0, 30)
      .map(([name, files]) => ({
        name,
        description: `Capability inferred from repeated signal: ${name}`,
        areas: [...new Set([...files].map(inferArea))],
        files: [...files].slice(0, 20),
        relatedIssues: [],
        risks: []
      }))
  };
}

function renderFileSummary(card: FileCard, candidate: DeepReadCandidate): string {
  return `# File Summary: ${card.path}

## Role
${card.guessedRole ?? "Role inferred from file path and symbols."}

## Responsibilities
${card.symbols.slice(0, 10).map((symbol) => `- ${symbol.kind}: ${symbol.name}`).join("\n") || "- No top-level symbols detected."}

## Dependencies
${card.imports.map((item) => `- ${item}`).join("\n") || "- No imports detected."}

## Related Capabilities
${card.signals.slice(0, 12).map((signal) => `- ${signal}`).join("\n") || "- No signals detected."}

## Selection Reasons
${candidate.reasons.map((reason) => `- ${reason}`).join("\n")}

## Potential Risks
${card.sensitive ? "- Sensitive file handling required." : "- No obvious risk inferred by the MVP analyzer."}
`;
}

function renderProjectBrief(brief: Record<string, unknown>): string {
  const list = (value: unknown) => (Array.isArray(value) && value.length ? value.map((item) => `- ${item}`).join("\n") : "- none");
  return `# Project Brief

## Purpose
${brief.purpose}

## Tech Stack
${list(brief.techStack)}

## Main Features
${list(brief.mainFeatures)}

## Current Phase
${brief.currentPhase}

## Current Status
${brief.currentStatus}

## Important Areas
${list(brief.importantAreas)}

## Bottlenecks
${list(brief.bottlenecks)}

## Risks
${list(brief.risks)}

## Planning Rules
${list(brief.planningRules)}

## Useful Commands
${list(brief.usefulCommands)}
`;
}

function renderAreaMap(areaMap: { areas: Array<{ name: string; purpose: string; importantFiles: string[]; relatedCapabilities: string[]; risks: string[] }> }): string {
  return `# Area Map

${areaMap.areas
  .map(
    (area) => `## ${area.name}

${area.purpose}

### Important Files
${area.importantFiles.map((file) => `- ${file}`).join("\n") || "- none"}

### Related Capabilities
${area.relatedCapabilities.map((capability) => `- ${capability}`).join("\n") || "- none"}

### Risks
${area.risks.map((risk) => `- ${risk}`).join("\n") || "- none"}`
  )
  .join("\n\n")}
`;
}

function renderSafetyReport(findings: SafetyFinding[]): string {
  return `# Safety Report

${findings.length ? findings.map((finding) => `## ${finding.path}

- reason: ${finding.reason}
- recommended: ${finding.recommendedAction}
- action: ${finding.action}
- redactions: ${JSON.stringify(finding.redactions)}`).join("\n\n") : "No sensitive files or secret-like values detected."}
`;
}

function inferPurpose(cards: FileCard[]): string {
  const readme = cards.find((card) => /README\.md$/i.test(card.path));
  if (!readme?.headExcerpt) return "Purpose could not be inferred from README.";
  return readme.headExcerpt
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .slice(0, 3)
    .join(" ")
    .slice(0, 500);
}

function inferTechStack(cards: FileCard[]): string[] {
  const stack = new Set<string>();
  for (const card of cards) {
    if (card.path === "package.json") stack.add("Node.js");
    if (card.path.endsWith(".ts") || card.path.endsWith(".tsx")) stack.add("TypeScript");
    if (card.path.endsWith(".tsx") || card.imports.some((item) => item.includes("react"))) stack.add("React");
    if (card.path.includes("prisma/")) stack.add("Prisma");
    if (card.path === "Dockerfile") stack.add("Docker");
  }
  return [...stack];
}

function inferUsefulCommands(packageCard?: FileCard): string[] {
  if (!packageCard?.headExcerpt) return [];
  try {
    const parsed = JSON.parse(packageCard.headExcerpt);
    return Object.keys(parsed.scripts ?? {}).map((name) => `npm run ${name}`);
  } catch {
    return [];
  }
}

function inferArea(filePath: string): string {
  const parts = filePath.split("/");
  if (parts[0] === "src" && parts[1]) return parts[1];
  if (parts[0] === "app") return "app";
  if (parts[0] === "docs") return "docs";
  if (parts[0] === "prisma") return "data";
  return parts[0] || "root";
}

function guessRole(filePath: string): string {
  if (/README\.md$/i.test(filePath)) return "project overview";
  if (filePath === "package.json") return "package manifest";
  if (/src\/components\//.test(filePath)) return "UI component";
  if (/src\/app\/.*page\.tsx$/.test(filePath)) return "page route";
  if (/src\/app\/.*route\.ts$/.test(filePath)) return "API route handler";
  if (/src\/lib\//.test(filePath)) return "shared logic";
  if (/src\/services\//.test(filePath)) return "service layer";
  if (/\.(test|spec)\.[tj]sx?$/.test(filePath)) return "test file";
  if (filePath === "prisma/schema.prisma") return "database schema";
  return "source file";
}

function languageFor(filePath: string): string {
  if (filePath.endsWith(".tsx")) return "tsx";
  if (filePath.endsWith(".ts")) return "typescript";
  if (filePath.endsWith(".jsx")) return "jsx";
  if (filePath.endsWith(".js")) return "javascript";
  if (filePath.endsWith(".md")) return "markdown";
  if (filePath.endsWith(".json")) return "json";
  if (filePath.endsWith(".prisma")) return "prisma";
  return path.extname(filePath).replace(".", "") || "unknown";
}

function collectSignals(filePath: string, values: string[]): string[] {
  const raw = [filePath, ...values].flatMap(splitSignalText);
  return [...new Set(raw.map((value) => value.toLowerCase()).filter((value) => value.length >= 3 && !COMMON_SIGNALS.has(value)))].slice(0, 40);
}

function splitSignalText(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function redactSecrets(text: string): { text: string; counts: Record<string, number> } {
  let redacted = text;
  const counts: Record<string, number> = {};
  for (const rule of SECRET_RULES) {
    let count = 0;
    redacted = redacted.replace(rule.pattern, (...args: string[]) => {
      count += 1;
      const match = args[0];
      if (rule.replacement.includes("$1")) return match.replace(rule.pattern, rule.replacement);
      return rule.replacement;
    });
    if (count > 0) counts[rule.name] = (counts[rule.name] ?? 0) + count;
  }
  return { text: redacted, counts };
}

function matchesAny(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(filePath, pattern));
}

function matchesPattern(filePath: string, pattern: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  const normalizedPattern = pattern.replaceAll("\\", "/");
  if (normalizedPattern.endsWith("/")) {
    const dir = normalizedPattern.slice(0, -1);
    return normalized === dir || normalized.startsWith(`${dir}/`) || normalized.includes(`/${dir}/`);
  }
  if (!normalizedPattern.includes("*")) {
    return normalized === normalizedPattern || normalized.endsWith(`/${normalizedPattern}`);
  }
  const regex = new RegExp(`^${escapeRegex(normalizedPattern).replaceAll("\\*", ".*")}$`);
  return regex.test(normalized) || regex.test(path.posix.basename(normalized));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueSymbols(symbols: SymbolInfo[]): SymbolInfo[] {
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    const key = `${symbol.kind}:${symbol.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeFileName(filePath: string): string {
  return filePath.replace(/[^A-Za-z0-9_.-]+/g, "__");
}
