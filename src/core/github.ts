export function parseGitHubRepoFullName(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim().replace(/\.git$/, "");
  const match = trimmed.match(/github\.com[:/]([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}
