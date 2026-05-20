import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { loadConfig, type PmAgentConfig } from "../core/config.js";
import { ensureDir, writeJson, writeTextIfMissing } from "../core/fs.js";
import { createAdapter } from "../model/index.js";

const execFileAsync = promisify(execFile);

export type UnderstandOptions = {
  refresh?: boolean;
  budget?: string;
  llm?: boolean;
  adapter?: string;
  ledger?: string;
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
  hash: string;
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
  packageInfo?: PackageInfo;
  contentSignals?: string[];
  responsibilities?: string[];
  risks?: string[];
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
  blocked?: boolean;
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
  estimatedTokens?: number;
};

type PackageInfo = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type UnderstandCache = {
  fileHashes: Record<string, string>;
  summaryHashes: Record<string, string>;
};

type TokenBudget = {
  mode: UnderstandBudget;
  fileCards: number;
  deepReadFiles: number;
  issues: number;
  summaries: number;
  total: number;
  limit: number;
  trimmedDeepReadFiles: number;
};

type UnderstandStats = {
  gitTrackedFiles: number;
  ignoredByPmAgentignore: number;
  textFiles: number;
  sensitiveCandidates: number;
  fileCardsReused: number;
  fileCardsGenerated: number;
  dependencyEdges: number;
  selectedDeepReadFiles: number;
  fileSummariesReused: number;
  fileSummariesGenerated: number;
};

type UnderstandBudget = "cheap" | "standard" | "deep";

type UnderstandLimits = {
  maxTokensPerCall: number;
  maxTokensForUnderstand: number;
  maxDeepReadFiles: number;
  maxFileBytes: number;
  headLines: number;
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
  { pattern: ".env.example", reason: "env example", action: "redact" as SensitiveAction },
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

const STANDARD_LIMITS: UnderstandLimits = {
  maxTokensPerCall: 12_000,
  maxTokensForUnderstand: 40_000,
  maxDeepReadFiles: 30,
  maxFileBytes: 80_000,
  headLines: 30
};

const BUDGET_LIMITS: Record<UnderstandBudget, UnderstandLimits> = {
  cheap: {
    maxTokensPerCall: 8_000,
    maxTokensForUnderstand: 20_000,
    maxDeepReadFiles: 12,
    maxFileBytes: 50_000,
    headLines: 20
  },
  standard: STANDARD_LIMITS,
  deep: {
    maxTokensPerCall: 16_000,
    maxTokensForUnderstand: 80_000,
    maxDeepReadFiles: 60,
    maxFileBytes: 140_000,
    headLines: 50
  }
};

function parseBudget(value: string | undefined): UnderstandBudget {
  if (!value) return "standard";
  if (value === "cheap" || value === "standard" || value === "deep") return value;
  throw new Error(`Unknown understand budget: ${value}. Expected cheap, standard, or deep.`);
}

export async function understandCommand(targetDir: string, options: UnderstandOptions = {}): Promise<string> {
  const repoDir = path.resolve(targetDir);
  const budgetMode = parseBudget(options.budget);
  const limits = BUDGET_LIMITS[budgetMode];
  const files = await listGitFiles(repoDir);

  await writeTextIfMissing(path.join(repoDir, ".pm-agentignore"), DEFAULT_IGNORE);
  await ensureKnowledgeDirs(repoDir);

  const cache = options.refresh ? emptyCache() : await readCache(repoDir);
  const previousCards = options.refresh ? new Map<string, FileCard>() : await readPreviousFileCards(repoDir);
  const ignorePatterns = await readIgnorePatterns(repoDir);
  const candidateFiles = files.filter((file) => shouldIncludeDespiteIgnore(file) || !matchesAny(file, ignorePatterns));
  const sensitiveDecisions = await resolveSensitiveActions(candidateFiles);

  const cards: FileCard[] = [];
  const safetyFindings: SafetyFinding[] = [];
  const stats: UnderstandStats = {
    gitTrackedFiles: files.length,
    ignoredByPmAgentignore: files.length - candidateFiles.length,
    textFiles: 0,
    sensitiveCandidates: sensitiveDecisions.size,
    fileCardsReused: 0,
    fileCardsGenerated: 0,
    dependencyEdges: 0,
    selectedDeepReadFiles: 0,
    fileSummariesReused: 0,
    fileSummariesGenerated: 0
  };
  const nextCache: UnderstandCache = emptyCache();

  for (const file of candidateFiles) {
    const absolutePath = path.join(repoDir, file);
    const content = await readFile(absolutePath, "utf8").catch(() => "");
    if (!content && isLikelyBinary(file)) continue;
    stats.textFiles += 1;
    const hash = hashText(content);
    nextCache.fileHashes[file] = hash;
    const previousCard = previousCards.get(file);
    if (previousCard?.hash === hash) {
      cards.push(previousCard);
      stats.fileCardsReused += 1;
      continue;
    }
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
    cards.push(createFileCard(file, action === "redact" ? redacted.text : content, hash, action, limits));
    stats.fileCardsGenerated += 1;
  }

  const aliases = await readPathAliases(repoDir);
  const edges = buildDependencyGraph(cards, aliases);
  const reverseIndex = buildReverseIndex(edges);
  stats.dependencyEdges = edges.length;
  const selected = selectDeepReadCandidates(cards, edges);
  const { candidates: deepReadCandidates, budget } = applyTokenBudget(cards, selected, limits, budgetMode);
  stats.selectedDeepReadFiles = deepReadCandidates.length;
  const summaries = await writeFileSummaries(repoDir, cards, deepReadCandidates, reverseIndex, cache, nextCache, stats);
  const project = buildProjectUnderstanding(cards, edges, deepReadCandidates);

  const payload = JSON.stringify({ cards, edges, reverseIndex, deepReadCandidates, project, summaries });
  const payloadAudit = redactSecrets(payload);
  if (Object.keys(payloadAudit.counts).length > 0) {
    safetyFindings.push({
      path: "llm-payload",
      reason: "secret-like value detected before model payload",
      recommendedAction: "redact",
      action: "redact",
      redactions: payloadAudit.counts,
      blocked: false
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
  await writeFile(path.join(repoDir, ".pm-agent/project/capability-map.md"), renderCapabilityMap(project.capabilityMap), "utf8");
  await writeJson(path.join(repoDir, ".pm-agent/project/issue-map.json"), project.issueMap);
  await writeFile(path.join(repoDir, ".pm-agent/project/issue-map.md"), renderIssueMap(project.issueMap), "utf8");
  await writeJson(path.join(repoDir, ".pm-agent/safety/safety-report.json"), safetyFindings);
  await writeFile(path.join(repoDir, ".pm-agent/safety/safety-report.md"), renderSafetyReport(safetyFindings), "utf8");
  await writeJson(path.join(repoDir, ".pm-agent/cache/understand-cache.json"), nextCache);
  await writeJson(path.join(repoDir, ".pm-agent/cache/token-budget.json"), budget);

  let llmOutput: string | undefined;
  if (options.llm) {
    llmOutput = await generateLlmUnderstanding(repoDir, options);
  }

  return renderUnderstandLog(repoDir, stats, budget, safetyFindings.length, llmOutput);
}

async function ensureKnowledgeDirs(repoDir: string): Promise<void> {
  await Promise.all([
    ensureDir(path.join(repoDir, ".pm-agent/catalog")),
    ensureDir(path.join(repoDir, ".pm-agent/graph")),
    ensureDir(path.join(repoDir, ".pm-agent/file-summaries")),
    ensureDir(path.join(repoDir, ".pm-agent/project")),
    ensureDir(path.join(repoDir, ".pm-agent/safety")),
    ensureDir(path.join(repoDir, ".pm-agent/llm")),
    ensureDir(path.join(repoDir, ".pm-agent/cache"))
  ]);
}

async function listGitFiles(repoDir: string): Promise<string[]> {
  let stdout = "";
  try {
    const result = await execFileAsync("git", ["ls-files"], { cwd: repoDir });
    stdout = result.stdout;
  } catch {
    throw new Error(`Cannot understand ${repoDir}: not a Git repository. Clone the project first, then run pm-agent understand again.`);
  }
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

async function readPreviousFileCards(repoDir: string): Promise<Map<string, FileCard>> {
  const file = path.join(repoDir, ".pm-agent/catalog/file-cards.json");
  if (!existsSync(file)) return new Map();
  try {
    const cards = JSON.parse(await readFile(file, "utf8")) as FileCard[];
    return new Map(cards.map((card) => [card.path, card]));
  } catch {
    return new Map();
  }
}

async function readCache(repoDir: string): Promise<UnderstandCache> {
  const file = path.join(repoDir, ".pm-agent/cache/understand-cache.json");
  if (!existsSync(file)) return emptyCache();
  try {
    return JSON.parse(await readFile(file, "utf8")) as UnderstandCache;
  } catch {
    return emptyCache();
  }
}

function emptyCache(): UnderstandCache {
  return { fileHashes: {}, summaryHashes: {} };
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
  console.log("[a] ask one by one");
  console.log("[s] skip all");
  console.log("[o] structure-only all");
  console.log("[r] redact all");

  const rl = readline.createInterface({ input, output });
  const answer = (await rl.question("> ")).trim().toLowerCase();

  if (answer === "a") {
    const decisions = new Map<string, { reason: string; recommendedAction: SensitiveAction; action: SensitiveAction }>();
    for (const finding of findings) {
      const decision = await rl.question(`${finding.path} [Enter=${finding.recommendedAction}, s=skip, o=structure-only, r=redact] > `);
      decisions.set(finding.path, {
        ...finding,
        action: parseSensitiveAction(decision.trim().toLowerCase()) ?? finding.recommendedAction
      });
    }
    rl.close();
    return decisions;
  }

  rl.close();

  const action = answer === "s" ? "skip" : answer === "o" ? "structure-only" : answer === "r" ? "redact" : null;
  return new Map(findings.map((finding) => [finding.path, { ...finding, action: action ?? finding.recommendedAction }]));
}

function parseSensitiveAction(value: string): SensitiveAction | null {
  if (value === "s" || value === "skip") return "skip";
  if (value === "o" || value === "structure-only") return "structure-only";
  if (value === "r" || value === "redact") return "redact";
  return null;
}

function createFileCard(filePath: string, content: string, hash: string, sensitiveAction: SensitiveAction | undefined, limits: UnderstandLimits): FileCard {
  const extension = path.extname(filePath);
  const language = languageFor(filePath);
  const lines = content.split(/\r?\n/);
  const imports = extractImports(content);
  const exports = extractExports(content);
  const symbols = extractSymbols(content);
  const headings = language === "markdown" ? extractMarkdownHeadings(content) : undefined;
  const tests = extractTests(content);
  const packageInfo = filePath === "package.json" ? extractPackageInfo(content) : undefined;
  const contentAnalysis = analyzeContent(filePath, content);
  const packageSignals = packageInfo ? [...Object.keys(packageInfo.scripts ?? {}), ...Object.keys(packageInfo.dependencies ?? {}), ...Object.keys(packageInfo.devDependencies ?? {})] : [];
  const signals = collectSignals(filePath, [...imports, ...exports, ...symbols.map((symbol) => symbol.name), ...(headings ?? []), ...packageSignals, ...contentAnalysis.signals]);
  const contentIncluded = sensitiveAction !== "structure-only";

  return {
    path: filePath,
    hash,
    extension,
    language,
    size: Buffer.byteLength(content, "utf8"),
    lineCount: lines.length,
    headExcerpt: contentIncluded ? lines.slice(0, limits.headLines).join("\n") : undefined,
    imports,
    exports,
    symbols,
    headings,
    tests: tests.length ? tests : undefined,
    packageInfo,
    contentSignals: contentAnalysis.signals,
    responsibilities: contentAnalysis.responsibilities,
    risks: contentAnalysis.risks,
    signals,
    guessedRole: guessRole(filePath),
    sensitive: Boolean(sensitiveAction),
    sensitiveAction,
    contentIncluded
  };
}

function extractPackageInfo(content: string): PackageInfo | undefined {
  try {
    const parsed = JSON.parse(content);
    return {
      scripts: typeof parsed.scripts === "object" ? parsed.scripts : undefined,
      dependencies: typeof parsed.dependencies === "object" ? parsed.dependencies : undefined,
      devDependencies: typeof parsed.devDependencies === "object" ? parsed.devDependencies : undefined
    };
  } catch {
    return undefined;
  }
}

function extractImports(content: string): string[] {
  const imports = new Set<string>();
  for (const match of content.matchAll(/import\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g)) {
    imports.add(match[1]);
  }
  for (const match of content.matchAll(/require\(["']([^"']+)["']\)/g)) {
    imports.add(match[1]);
  }
  for (const match of content.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
    const value = match[1];
    if (value.startsWith("./") || value.startsWith("../") || value.startsWith("/")) imports.add(value);
  }
  for (const match of content.matchAll(/fetch\(["']([^"']+)["']\)/g)) {
    imports.add(match[1]);
  }
  return [...imports];
}

function analyzeContent(filePath: string, content: string): { signals: string[]; responsibilities: string[]; risks: string[] } {
  const signals = new Set<string>();
  const responsibilities = new Set<string>();
  const risks = new Set<string>();
  const lower = content.toLowerCase();

  if (/index\.html$/.test(filePath)) {
    responsibilities.add("Render the home entry page and load the home script.");
    signals.add("home");
    signals.add("entrypoint");
  }
  if (/study\.html$/.test(filePath)) {
    responsibilities.add("Render the study page shell used by subject-specific learning flows.");
    signals.add("study");
    signals.add("entrypoint");
  }
  if (/home\.js$/.test(filePath)) {
    responsibilities.add("Load subject metadata and render the home subject cards.");
    responsibilities.add("Register the service worker for offline use.");
    signals.add("home");
    signals.add("subjects");
  }
  if (/app\.js$/.test(filePath)) {
    responsibilities.add("Manage study page state, modes, filters, progress, quizzes, materials, and review flows.");
    signals.add("study");
    signals.add("quiz");
    signals.add("progress");
    signals.add("materials");
  }
  if (/service-worker\.js$/.test(filePath)) {
    responsibilities.add("Cache application assets for offline use.");
    risks.add("Cache asset list changes can break offline behavior if stale or incomplete.");
    signals.add("offline");
    signals.add("cache");
  }
  if (/manifest\.json$/.test(filePath)) {
    responsibilities.add("Define PWA metadata and install behavior.");
    signals.add("pwa");
  }
  if (/styles\.css$/.test(filePath)) {
    responsibilities.add("Define visual layout, themes, responsive behavior, and component styling.");
    signals.add("theme");
    signals.add("layout");
  }
  if (/data\/index\.json$/.test(filePath)) {
    responsibilities.add("Register available subjects and map each subject id to its data file and display metadata.");
    signals.add("subjects");
    signals.add("catalog");
  }
  if (/data\/.+\.json$/.test(filePath) && !/data\/index\.json$/.test(filePath)) {
    responsibilities.add("Provide subject content such as terms, materials, quizzes, chapters, and explanations.");
    signals.add("content");
    signals.add("subject");
  }
  if (lower.includes("localstorage")) {
    responsibilities.add("Persist user progress in browser localStorage.");
    risks.add("Changing progress key shape can break saved user progress.");
    signals.add("persistence");
  }
  if (lower.includes("wrongquestions")) {
    responsibilities.add("Track wrong answers for review sessions.");
    signals.add("review");
  }
  if (lower.includes("navigator.serviceworker")) {
    responsibilities.add("Connect the page to the browser service worker lifecycle.");
    signals.add("service-worker");
  }
  if (lower.includes("urlsearchparams")) {
    responsibilities.add("Read and synchronize state through URL query parameters.");
    signals.add("routing");
  }
  if (lower.includes("fetch(")) {
    responsibilities.add("Load JSON or asset resources at runtime.");
    signals.add("data-loading");
  }
  if (lower.includes("quiz")) signals.add("quiz");
  if (lower.includes("terms")) signals.add("terms");
  if (lower.includes("materials")) signals.add("materials");
  if (lower.includes("chapter")) signals.add("chapter");

  return {
    signals: [...signals],
    responsibilities: [...responsibilities],
    risks: [...risks]
  };
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
    `${base}.css`,
    `${base}.html`,
    `${base}.json`,
    `${base}.svg`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
    `${base}/index.json`
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
      if (/^(index|study)\.html$|^(app|home|main|server|service-worker)\.js$|^styles\.css$|^manifest\.json$|^data\/index\.json$/.test(card.path)) {
        score += 18;
        reasons.push("static-app-core");
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
      if (card.responsibilities?.length) {
        score += Math.min(card.responsibilities.length * 3, 12);
        reasons.push("content-responsibility");
      }
      if (/src\/(components|pages|controllers|handlers)\//.test(card.path)) {
        score += 8;
        reasons.push("interface");
      }
      if (/^data\/.+\.json$/.test(card.path) && !/^data\/index\.json$/.test(card.path)) {
        score += 2;
        reasons.push("representative-data");
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
      return { path: card.path, score, reasons, estimatedTokens: estimateTokens(card.headExcerpt ?? "") };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function applyTokenBudget(
  cards: FileCard[],
  selected: DeepReadCandidate[],
  limits: UnderstandLimits,
  mode: UnderstandBudget
): { candidates: DeepReadCandidate[]; budget: TokenBudget } {
  const cardTokens = estimateTokens(JSON.stringify(cards.map((card) => ({ ...card, headExcerpt: undefined }))));
  const summariesTokens = Math.round(selected.length * 180);
  const issuesTokens = 0;
  let candidates = selected.slice(0, limits.maxDeepReadFiles);
  let deepReadTokens = estimateDeepReadTokens(cards, candidates, limits);
  let total = cardTokens + deepReadTokens + summariesTokens + issuesTokens;
  let trimmed = 0;

  while (total > limits.maxTokensForUnderstand && candidates.length > 0) {
    candidates = candidates.slice(0, -1);
    trimmed += 1;
    deepReadTokens = estimateDeepReadTokens(cards, candidates, limits);
    total = cardTokens + deepReadTokens + Math.round(candidates.length * 180) + issuesTokens;
  }

  return {
    candidates,
    budget: {
      mode,
      fileCards: cardTokens,
      deepReadFiles: deepReadTokens,
      issues: issuesTokens,
      summaries: Math.round(candidates.length * 180),
      total,
      limit: limits.maxTokensForUnderstand,
      trimmedDeepReadFiles: trimmed
    }
  };
}

function estimateDeepReadTokens(cards: FileCard[], candidates: DeepReadCandidate[], limits: UnderstandLimits): number {
  const byPath = new Map(cards.map((card) => [card.path, card]));
  return candidates.reduce((sum, candidate) => {
    const card = byPath.get(candidate.path);
    if (!card) return sum;
    return sum + Math.min(Math.ceil(Math.min(card.size, limits.maxFileBytes) / 4), limits.maxTokensPerCall);
  }, 0);
}

async function writeFileSummaries(
  repoDir: string,
  cards: FileCard[],
  candidates: DeepReadCandidate[],
  reverseIndex: Record<string, Array<{ importedBy: string; symbols: string[] }>>,
  cache: UnderstandCache,
  nextCache: UnderstandCache,
  stats: UnderstandStats
): Promise<Array<{ path: string; summaryPath: string }>> {
  const byPath = new Map(cards.map((card) => [card.path, card]));
  const summaries: Array<{ path: string; summaryPath: string }> = [];
  for (const candidate of candidates) {
    const card = byPath.get(candidate.path);
    if (!card) continue;
    const summaryPath = path.join(repoDir, ".pm-agent/file-summaries", `${safeFileName(candidate.path)}.md`);
    nextCache.summaryHashes[candidate.path] = card.hash;
    if (cache.summaryHashes[candidate.path] === card.hash && existsSync(summaryPath)) {
      stats.fileSummariesReused += 1;
      summaries.push({ path: candidate.path, summaryPath });
      continue;
    }
    const summary = renderFileSummary(card, candidate, reverseIndex[card.path] ?? []);
    await mkdir(path.dirname(summaryPath), { recursive: true });
    await writeFile(summaryPath, summary, "utf8");
    stats.fileSummariesGenerated += 1;
    summaries.push({ path: candidate.path, summaryPath });
  }
  return summaries;
}

function buildProjectUnderstanding(cards: FileCard[], edges: DependencyEdge[], candidates: DeepReadCandidate[]) {
  const packageCard = cards.find((card) => card.path === "package.json");
  const areas = buildAreas(cards);
  const capabilities = buildCapabilities(cards);
  const planningSignals = inferPlanningSignals(cards, candidates);
  const brief = {
    purpose: inferPurpose(cards),
    techStack: inferTechStack(cards),
    mainFeatures: inferMainFeatures(cards, capabilities.capabilities.slice(0, 10).map((capability) => capability.name)),
    currentPhase: inferCurrentPhase(cards),
    currentStatus: "Project understanding generated from git-tracked files.",
    importantAreas: areas.areas.map((area) => area.name),
    bottlenecks: candidates.filter((candidate) => candidate.reasons.includes("huge-file-penalty")).map((candidate) => candidate.path),
    risks: [
      ...cards.filter((card) => card.sensitive).map((card) => `${card.path}: sensitive handling required`),
      ...new Set(cards.flatMap((card) => card.risks ?? []))
    ],
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
      planningSignals,
      suggestedIssueWorkflow: [
        "Match issue title/body terms against planningSignals and capability names.",
        "Start with files from matching capabilities and important area files.",
        "Check reverse dependencies before splitting implementation tasks.",
        "Create separate tasks for implementation, tests, docs, and review handoff."
      ],
      note: "No specific issue was provided. Run future understand --issue <number> for issue-specific mapping."
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
      purpose: inferAreaPurpose(name),
      fileCount: files.length,
      importantFiles: rankFilesForPlanning(files).slice(0, 12).map((file) => file.path),
      responsibilities: [...new Set(files.flatMap((file) => file.responsibilities ?? []))].slice(0, 10),
      relatedCapabilities: [...new Set(files.flatMap((file) => file.signals))].slice(0, 12),
      relatedIssues: [],
      risks: [
        ...new Set([
          ...files.flatMap((file) => file.risks ?? []),
          ...(files.some((file) => file.sensitive) ? ["contains sensitive-handling files"] : [])
        ])
      ]
    }))
  };
}

function rankFilesForPlanning(files: FileCard[]): FileCard[] {
  return [...files].sort((a, b) => planningFileScore(b) - planningFileScore(a) || a.path.localeCompare(b.path));
}

function planningFileScore(card: FileCard): number {
  let score = 0;
  if (/README\.md$/i.test(card.path)) score += 20;
  if (/package\.json$|tsconfig\.json$|Dockerfile$/.test(card.path)) score += 16;
  if (/^(index|study)\.html$|^(app|home|main|server|service-worker)\.js$|^src\/(main|server|index)\./.test(card.path)) score += 14;
  if (/src\/(lib|services|domain|usecases)\//.test(card.path)) score += 12;
  if (/src\/(components|pages|controllers|handlers)\//.test(card.path)) score += 8;
  score += Math.min((card.responsibilities?.length ?? 0) * 3, 12);
  score += Math.min(card.symbols.length, 8);
  if (card.sensitive) score -= 30;
  if (card.size > 80_000) score -= 10;
  return score;
}

function inferAreaPurpose(area: string): string {
  const purposes: Record<string, string> = {
    overview: "Project documentation, operating notes, and setup instructions.",
    home: "Home screen and subject selection entry flow.",
    study: "Study experience, learning modes, quiz flow, review flow, and per-subject navigation.",
    data: "Subject catalog and learning content consumed by the app.",
    offline: "PWA manifest and service worker behavior for offline use.",
    styling: "Visual system, layout, themes, and responsive presentation.",
    assets: "Static visual assets used by the app.",
    config: "Repository and platform configuration."
  };
  return purposes[area] ?? `${area} area inferred from repository structure.`;
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
        description: describeCapability(name, [...files]),
        areas: [...new Set([...files].map(inferArea))],
        files: [...files].slice(0, 20),
        relatedIssues: [],
        risks: [...new Set([...files].flatMap((file) => cards.find((card) => card.path === file)?.risks ?? []))].slice(0, 8)
      }))
  };
}

function describeCapability(name: string, files: string[]): string {
  const areaNames = [...new Set(files.map(inferArea))].join(", ");
  return `Inferred from repeated signal "${name}" across ${files.length} files${areaNames ? ` in ${areaNames}` : ""}.`;
}

function inferPlanningSignals(cards: FileCard[], candidates: DeepReadCandidate[]): Array<{ signal: string; files: string[]; areas: string[]; candidateFiles: string[] }> {
  const candidatePaths = new Set(candidates.map((candidate) => candidate.path));
  const signals = new Map<string, Set<string>>();
  for (const card of cards) {
    for (const signal of card.signals.slice(0, 12)) {
      if (signal.length < 3 || COMMON_SIGNALS.has(signal)) continue;
      signals.set(signal, (signals.get(signal) ?? new Set()).add(card.path));
    }
  }
  return [...signals.entries()]
    .filter(([, files]) => files.size > 1)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .slice(0, 40)
    .map(([signal, files]) => ({
      signal,
      files: [...files].slice(0, 12),
      areas: [...new Set([...files].map(inferArea))],
      candidateFiles: [...files].filter((file) => candidatePaths.has(file)).slice(0, 8)
    }));
}

function renderFileSummary(card: FileCard, candidate: DeepReadCandidate, importedBy: Array<{ importedBy: string; symbols: string[] }>): string {
  return `# File Summary: ${card.path}

## Role
${card.guessedRole ?? "Role inferred from file path and symbols."}

## Responsibilities
${[
  ...(card.responsibilities ?? []),
  ...card.symbols.slice(0, 10).map((symbol) => `${symbol.kind}: ${symbol.name}`)
].map((item) => `- ${item}`).join("\n") || "- No responsibilities inferred."}

## Dependencies
${card.imports.map((item) => `- ${item}`).join("\n") || "- No imports detected."}

## Imported By
${importedBy.slice(0, 12).map((item) => `- ${item.importedBy}`).join("\n") || "- No tracked reverse dependencies detected."}

## Related Capabilities
${card.signals.slice(0, 12).map((signal) => `- ${signal}`).join("\n") || "- No signals detected."}

## Change Guidance
${renderChangeGuidance(card, importedBy)}

## Selection Reasons
${candidate.reasons.map((reason) => `- ${reason}`).join("\n")}

## Potential Risks
${[
  ...(card.risks ?? []),
  ...(card.sensitive ? ["Sensitive file handling required."] : [])
].map((risk) => `- ${risk}`).join("\n") || "- No obvious risk inferred by the analyzer."}
`;
}

function renderChangeGuidance(card: FileCard, importedBy: Array<{ importedBy: string; symbols: string[] }>): string {
  const guidance = [
    importedBy.length > 0 ? `Check ${Math.min(importedBy.length, 12)} reverse dependenc${importedBy.length === 1 ? "y" : "ies"} before changing exported behavior.` : "",
    card.tests?.length ? "Update or run the related tests named in this file." : "",
    card.risks?.length ? "Treat this file as a risk-bearing change surface." : "",
    card.sensitive ? "Do not include raw values from this file in model prompts or reports." : ""
  ].filter(Boolean);
  return guidance.map((item) => `- ${item}`).join("\n") || "- Review the file role, imports, and related capabilities before planning changes.";
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

function renderAreaMap(areaMap: { areas: Array<{ name: string; purpose: string; fileCount?: number; importantFiles: string[]; responsibilities?: string[]; relatedCapabilities: string[]; risks: string[] }> }): string {
  return `# Area Map

${areaMap.areas
  .map(
    (area) => `## ${area.name}

${area.purpose}

Files: ${area.fileCount ?? area.importantFiles.length}

### Important Files
${area.importantFiles.map((file) => `- ${file}`).join("\n") || "- none"}

### Responsibilities
${(area.responsibilities ?? []).map((responsibility) => `- ${responsibility}`).join("\n") || "- none inferred"}

### Related Capabilities
${area.relatedCapabilities.map((capability) => `- ${capability}`).join("\n") || "- none"}

### Risks
${area.risks.map((risk) => `- ${risk}`).join("\n") || "- none"}`
  )
  .join("\n\n")}
`;
}

function renderCapabilityMap(capabilityMap: { capabilities: Array<{ name: string; description: string; areas: string[]; files: string[]; relatedIssues: unknown[]; risks: string[] }> }): string {
  return `# Capability Map

${capabilityMap.capabilities.length > 0
  ? capabilityMap.capabilities
      .map(
        (capability) => `## ${capability.name}

${capability.description}

### Areas
${capability.areas.map((area) => `- ${area}`).join("\n") || "- none"}

### Files
${capability.files.map((file) => `- ${file}`).join("\n") || "- none"}

### Risks
${capability.risks.map((risk) => `- ${risk}`).join("\n") || "- none"}`
      )
      .join("\n\n")
  : "No repeated capability signals were detected.\n"}
`;
}

function renderIssueMap(issueMap: {
  planningSignals?: Array<{ signal: string; files: string[]; areas: string[]; candidateFiles: string[] }>;
  suggestedIssueWorkflow?: string[];
  note?: string;
}): string {
  const signals = issueMap.planningSignals ?? [];
  return `# Issue Map

${issueMap.note ?? ""}

## Suggested Issue Workflow
${(issueMap.suggestedIssueWorkflow ?? []).map((item) => `- ${item}`).join("\n") || "- Match Issue text against file and capability signals."}

## Planning Signals
${signals.length > 0
  ? signals
      .map(
        (signal) => `### ${signal.signal}

Areas: ${signal.areas.join(", ") || "none"}

Candidate files:
${signal.candidateFiles.map((file) => `- ${file}`).join("\n") || "- none selected for deep read"}

Related files:
${signal.files.map((file) => `- ${file}`).join("\n")}`
      )
      .join("\n\n")
  : "No planning signals were detected.\n"}
`;
}

function renderSafetyReport(findings: SafetyFinding[]): string {
  const skipped = findings.filter((finding) => finding.action === "skip");
  const redacted = findings.filter((finding) => finding.action === "redact");
  const structureOnly = findings.filter((finding) => finding.action === "structure-only");
  const blocked = findings.filter((finding) => finding.blocked);
  const renderGroup = (items: SafetyFinding[]) =>
    items.length
      ? items
          .map(
            (finding) => `- ${finding.path}
  - reason: ${finding.reason}
  - recommended: ${finding.recommendedAction}
  - action: ${finding.action}
  - detected patterns: ${Object.keys(finding.redactions).join(", ") || "none"}`
          )
          .join("\n")
      : "- none";
  return `# Safety Report

## Skipped
${renderGroup(skipped)}

## Redacted
${renderGroup(redacted)}

## Structure Only
${renderGroup(structureOnly)}

## Blocked Payloads
${renderGroup(blocked)}

## Policy

User approval allows scanning.
User approval does not bypass redaction.

ユーザーの許可はスキャン対象に含めるための許可であり、
secretをLLMへそのまま送る許可ではありません。
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
    if (card.path.endsWith(".html")) stack.add("HTML");
    if (card.path.endsWith(".css")) stack.add("CSS");
    if (card.path.endsWith(".js")) stack.add("Vanilla JavaScript");
    if (card.path === "manifest.json" || card.path === "service-worker.js") stack.add("PWA");
    if (card.path.startsWith("data/") && card.path.endsWith(".json")) stack.add("JSON data files");
    if (card.path.endsWith(".ts") || card.path.endsWith(".tsx")) stack.add("TypeScript");
    if (card.path.endsWith(".tsx") || card.imports.some((item) => item.includes("react"))) stack.add("React");
    if (card.path.includes("prisma/")) stack.add("Prisma");
    if (card.path === "Dockerfile") stack.add("Docker");
  }
  return [...stack];
}

function inferMainFeatures(cards: FileCard[], fallback: string[]): string[] {
  const features = new Set<string>();
  const has = (predicate: (card: FileCard) => boolean) => cards.some(predicate);
  if (has((card) => card.path === "index.html" || card.path === "home.js")) features.add("Home subject selection");
  if (has((card) => card.path === "study.html" || card.path === "app.js")) features.add("Subject study page");
  if (has((card) => card.signals.includes("terms"))) features.add("Term cards");
  if (has((card) => card.signals.includes("quiz"))) features.add("Quiz practice");
  if (has((card) => card.signals.includes("materials"))) features.add("Learning materials");
  if (has((card) => card.signals.includes("progress") || card.signals.includes("persistence"))) features.add("Local progress tracking");
  if (has((card) => card.signals.includes("review"))) features.add("Wrong-answer review");
  if (has((card) => card.path === "service-worker.js")) features.add("Offline support");
  if (has((card) => card.path === "data/index.json")) features.add("Subject catalog");
  return [...features, ...fallback.filter((item) => !features.has(item))].slice(0, 12);
}

function inferCurrentPhase(cards: FileCard[]): string {
  if (cards.some((card) => card.path === ".nojekyll") && cards.some((card) => card.path === "service-worker.js")) {
    return "deployed static PWA";
  }
  if (cards.some((card) => card.path === "README.md")) return "documented project";
  return "unknown";
}

function inferUsefulCommands(packageCard?: FileCard): string[] {
  return Object.keys(packageCard?.packageInfo?.scripts ?? {}).map((name) => `npm run ${name}`);
}

function inferArea(filePath: string): string {
  const parts = filePath.split("/");
  if (filePath === "README.md") return "overview";
  if (filePath === "index.html" || filePath === "home.js") return "home";
  if (filePath === "study.html" || filePath === "app.js") return "study";
  if (filePath === "service-worker.js" || filePath === "manifest.json") return "offline";
  if (filePath === "styles.css") return "styling";
  if (filePath === ".gitignore" || filePath === ".nojekyll") return "config";
  if (parts[0] === "src" && parts[1]) return parts[1];
  if (parts[0] === "app") return "app";
  if (parts[0] === "docs") return "docs";
  if (parts[0] === "prisma") return "data";
  return parts[0] || "root";
}

function guessRole(filePath: string): string {
  if (/README\.md$/i.test(filePath)) return "project overview";
  if (filePath === "index.html") return "home page entrypoint";
  if (filePath === "study.html") return "study page shell";
  if (filePath === "home.js") return "home page controller";
  if (filePath === "app.js") return "study app controller";
  if (filePath === "service-worker.js") return "offline cache service worker";
  if (filePath === "manifest.json") return "PWA manifest";
  if (filePath === "styles.css") return "application stylesheet";
  if (filePath === "data/index.json") return "subject catalog";
  if (/^data\/.+\.json$/.test(filePath)) return "subject content data";
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

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function isLikelyBinary(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|mp4|mov|mp3|wav)$/i.test(filePath);
}

function matchesAny(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(filePath, pattern));
}

function shouldIncludeDespiteIgnore(filePath: string): boolean {
  return path.posix.basename(filePath) === ".env.example";
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

async function generateLlmUnderstanding(repoDir: string, options: UnderstandOptions): Promise<string> {
  const ledgerDir = resolveUnderstandLedgerDir(repoDir, options.ledger);
  const config = await loadConfig(ledgerDir);
  const adapterName = options.adapter ?? config.model?.defaultAdapter ?? "background-agent";
  if (adapterName === "mock") {
    throw new Error("understand --llm requires a non-mock adapter. Try --adapter background-agent.");
  }

  const outputPath = path.join(repoDir, ".pm-agent/llm/understand-llm.json");
  const schemaPath = path.join(repoDir, ".pm-agent/llm/understand-llm.schema.json");
  const promptPath = path.join(repoDir, ".pm-agent/llm/understand-input.md");
  const prompt = buildLlmUnderstandPrompt(repoDir, outputPath);
  const safePrompt = redactSecrets(prompt);
  if (Object.keys(safePrompt.counts).length > 0) {
    throw new Error("LLM understand prompt blocked: possible secret detected after redaction.");
  }

  await writeJson(schemaPath, understandLlmSchema());
  await writeFile(promptPath, prompt, "utf8");

  const adapterConfig = configForUnderstandOutput(config, adapterName);
  const adapter = createAdapter(adapterConfig, adapterName);
  await adapter.generate({
    date: "understand",
    ledgerDir: repoDir,
    contextPackPath: path.join(repoDir, ".pm-agent/catalog/file-cards.json"),
    schemaPath,
    outputPath,
    prompt,
    timeoutMs: 600_000
  });

  const parsed = JSON.parse(await readFile(outputPath, "utf8")) as Record<string, unknown>;
  await writeFile(path.join(repoDir, ".pm-agent/llm/project-brief.md"), renderLlmSection("LLM Project Brief", parsed.projectBrief), "utf8");
  await writeFile(path.join(repoDir, ".pm-agent/llm/area-map.md"), renderLlmSection("LLM Area Map", parsed.areaMap), "utf8");
  await writeFile(path.join(repoDir, ".pm-agent/llm/capability-map.md"), renderLlmSection("LLM Capability Map", parsed.capabilityMap), "utf8");
  await writeFile(path.join(repoDir, ".pm-agent/llm/planning-notes.md"), renderLlmSection("LLM Planning Notes", parsed.planningNotes), "utf8");
  return outputPath;
}

function resolveUnderstandLedgerDir(repoDir: string, configured: string | undefined): string {
  const candidates = [
    configured ? path.resolve(process.cwd(), configured) : "",
    process.env.PM_AGENT_LEDGER_DIR ? path.resolve(process.env.PM_AGENT_LEDGER_DIR) : "",
    path.join(path.dirname(repoDir), "progress-ledger"),
    repoDir
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(path.join(candidate, "pm-agent.config.json"))) ?? repoDir;
}

function configForUnderstandOutput(config: PmAgentConfig, adapterName: string): PmAgentConfig {
  const adapter = config.model?.adapters?.[adapterName];
  if (!adapter || adapter.type !== "agent") return config;
  return {
    ...config,
    model: {
      ...config.model,
      adapters: {
        ...config.model?.adapters,
        [adapterName]: {
          ...adapter,
          allowedOutputs: [".pm-agent/llm/understand-llm.json"]
        }
      }
    }
  };
}

function buildLlmUnderstandPrompt(repoDir: string, outputPath: string): string {
  return `You are helping build a project understanding knowledge base for a PM agent.

Read only these generated, safety-filtered pm-agent files:
- .pm-agent/catalog/file-cards.json
- .pm-agent/graph/dependency-graph.json
- .pm-agent/graph/reverse-dependency-index.json
- .pm-agent/file-summaries/*.md
- .pm-agent/project/project-brief.md
- .pm-agent/project/area-map.md
- .pm-agent/project/capability-map.md
- .pm-agent/project/issue-map.md
- .pm-agent/safety/safety-report.md

Do not inspect ignored files, .env files, credentials, raw secret files, or arbitrary repository files.
Use the safety report. User approval does not bypass redaction.

Your task:
1. Produce a deeper project brief that explains purpose, architecture, main flows, and planning rules.
2. Produce an area map that explains responsibilities, important files, likely change surfaces, and risks.
3. Produce a capability map useful for mapping future Issues to files and areas.
4. Produce planning notes for task splitting and PM usage.

Write JSON only to:
${outputPath}

Required JSON shape:
{
  "projectBrief": {
    "purpose": "string",
    "architecture": ["string"],
    "mainFlows": ["string"],
    "currentRisks": ["string"],
    "planningRules": ["string"]
  },
  "areaMap": [
    {
      "area": "string",
      "responsibility": "string",
      "importantFiles": ["string"],
      "changeRisks": ["string"]
    }
  ],
  "capabilityMap": [
    {
      "capability": "string",
      "description": "string",
      "areas": ["string"],
      "files": ["string"],
      "issueKeywords": ["string"]
    }
  ],
  "planningNotes": ["string"]
}

Repository root: ${repoDir}
`;
}

function understandLlmSchema(): object {
  return {
    type: "object",
    required: ["projectBrief", "areaMap", "capabilityMap", "planningNotes"],
    additionalProperties: false
  };
}

function renderLlmSection(title: string, value: unknown): string {
  return `# ${title}

\`\`\`json
${JSON.stringify(value, null, 2)}
\`\`\`
`;
}

function renderUnderstandLog(repoDir: string, stats: UnderstandStats, budget: TokenBudget, safetyFindings: number, llmOutput?: string): string {
  const budgetAdvice = budget.trimmedDeepReadFiles > 0
    ? `\nToken budget exceeded initial selection. Trimmed deep-read files: ${budget.trimmedDeepReadFiles}. Use --budget deep for broader reading.`
    : "";
  return `Analyzing repository...

✓ git tracked files: ${stats.gitTrackedFiles}
✓ ignored by .pm-agentignore: ${stats.ignoredByPmAgentignore}
✓ text files: ${stats.textFiles}
✓ sensitive candidates: ${stats.sensitiveCandidates}
✓ safety policy applied
✓ file cards generated: ${stats.fileCardsGenerated}
✓ file cards reused: ${stats.fileCardsReused}
✓ dependency edges: ${stats.dependencyEdges}
✓ selected deep-read files: ${stats.selectedDeepReadFiles}
✓ file summaries generated: ${stats.fileSummariesGenerated}
✓ file summaries reused: ${stats.fileSummariesReused}
✓ project brief generated
✓ area map generated
✓ capability map generated
✓ issue map generated
✓ safety report generated

Token Budget:
- Mode: ${budget.mode}
- File cards: ${budget.fileCards.toLocaleString()}
- Deep read files: ${budget.deepReadFiles.toLocaleString()}
- Issues: ${budget.issues.toLocaleString()}
- Summaries: ${budget.summaries.toLocaleString()}
Total: ${budget.total.toLocaleString()} / ${budget.limit.toLocaleString()}${budgetAdvice}

Outputs:
${path.join(repoDir, ".pm-agent/catalog/file-cards.json")}
${path.join(repoDir, ".pm-agent/graph/dependency-graph.json")}
${path.join(repoDir, ".pm-agent/graph/reverse-dependency-index.json")}
${path.join(repoDir, ".pm-agent/project/project-brief.md")}
${path.join(repoDir, ".pm-agent/project/area-map.md")}
${path.join(repoDir, ".pm-agent/project/capability-map.md")}
${path.join(repoDir, ".pm-agent/project/capability-map.json")}
${path.join(repoDir, ".pm-agent/project/issue-map.md")}
${path.join(repoDir, ".pm-agent/project/issue-map.json")}
${path.join(repoDir, ".pm-agent/safety/safety-report.md")}
${llmOutput ? `${llmOutput}\n${path.join(repoDir, ".pm-agent/llm/project-brief.md")}\n${path.join(repoDir, ".pm-agent/llm/area-map.md")}\n${path.join(repoDir, ".pm-agent/llm/capability-map.md")}\n${path.join(repoDir, ".pm-agent/llm/planning-notes.md")}` : ""}

Safety findings: ${safetyFindings}`;
}
