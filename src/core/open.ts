import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function openFile(filePath: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("open", [filePath]);
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", filePath]);
    return;
  }

  await execFileAsync("xdg-open", [filePath]);
}
