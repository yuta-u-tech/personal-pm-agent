import test from "node:test";
import assert from "node:assert/strict";
import { parseGitHubRepoFullName } from "./github.js";

test("parseGitHubRepoFullName parses HTTPS remotes", () => {
  assert.equal(parseGitHubRepoFullName("https://github.com/youbo0129ueno-star/personal-pm-agent.git"), "youbo0129ueno-star/personal-pm-agent");
});

test("parseGitHubRepoFullName parses SSH remotes", () => {
  assert.equal(parseGitHubRepoFullName("git@github.com:youbo0129ueno-star/progress-ledger.git"), "youbo0129ueno-star/progress-ledger");
});

test("parseGitHubRepoFullName returns null for non-GitHub remotes", () => {
  assert.equal(parseGitHubRepoFullName("https://example.com/owner/repo.git"), null);
});
