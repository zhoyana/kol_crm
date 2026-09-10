import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type UvRuntimeConfig = {
  cacheDir: string;
  noCache: boolean;
};

let cachedConfig: UvRuntimeConfig | null = null;

/**
 * Use an app-owned cache instead of uv's global cache or the legacy shared
 * .runtime/uv-cache directory. The latter can inherit incompatible Windows
 * sandbox ACLs. Probe once per process and fall back safely if it is unusable.
 */
export function getUvRuntimeConfig(): UvRuntimeConfig {
  if (cachedConfig) return cachedConfig;

  const cacheDir = process.env.UV_CACHE_DIR?.trim()
    || path.resolve(process.cwd(), ".runtime", "mediacrawler-uv-cache-v2");
  const probe = path.join(cacheDir, `.write-probe-${process.pid}-${randomUUID()}`);

  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(probe, "ok", "utf8");
    if (readFileSync(probe, "utf8") !== "ok") throw new Error("cache probe mismatch");
    unlinkSync(probe);
    cachedConfig = { cacheDir, noCache: false };
  } catch {
    try {
      unlinkSync(probe);
    } catch {
      // The probe may not have been created.
    }
    cachedConfig = { cacheDir, noCache: true };
  }

  return cachedConfig;
}

export function uvRunArgs(script: string, args: string[]): string[] {
  const { noCache } = getUvRuntimeConfig();
  return ["run", ...(noCache ? ["--no-cache"] : []), script, ...args];
}

export function uvRuntimeEnv(): Record<string, string> {
  const { cacheDir, noCache } = getUvRuntimeConfig();
  return noCache
    ? { UV_NO_CACHE: "1" }
    : { UV_CACHE_DIR: cacheDir, UV_NO_CACHE: "0" };
}
