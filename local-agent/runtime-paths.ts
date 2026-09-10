import { existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function projectRoot(): string {
  return path.resolve(process.env.KOL_CRM_ROOT || sourceRoot);
}

export function mediaCrawlerRoot(): string {
  if (process.env.MEDIACRAWLER_ROOT) return path.resolve(process.env.MEDIACRAWLER_ROOT);
  const bundled = path.join(projectRoot(), "MediaCrawler-main");
  if (existsSync(path.join(bundled, "main.py"))) return bundled;
  return path.resolve(projectRoot(), "..", "MediaCrawler-main");
}

export function agentDataRoot(): string {
  const configured = process.env.KOL_AGENT_DATA_ROOT;
  const root = configured
    ? path.resolve(configured)
    : process.env.KOL_AGENT_PORTABLE === "1"
      ? path.join(process.env.LOCALAPPDATA || os.homedir(), "KOLCRM", "Agent")
      : path.join(projectRoot(), ".runtime");
  mkdirSync(root, { recursive: true });
  return root;
}

export function mediaCrawlerOutputRoot(): string {
  const root = process.env.MEDIACRAWLER_OUTPUT_ROOT
    ? path.resolve(process.env.MEDIACRAWLER_OUTPUT_ROOT)
    : path.join(agentDataRoot(), "mediacrawler-data");
  mkdirSync(root, { recursive: true });
  return root;
}

export function crawlerPythonCommand(): string {
  if (process.env.CRAWLER_PYTHON_COMMAND) return path.resolve(process.env.CRAWLER_PYTHON_COMMAND);
  const bundled = path.join(projectRoot(), "runtime", "python", "python.exe");
  if (existsSync(bundled)) return bundled;
  return path.join(mediaCrawlerRoot(), ".venv", "Scripts", "python.exe");
}

export function crawlerRuntimePath(): string {
  return process.env.CRAWLER_PATH || process.env.PATH || process.env.Path || "";
}
