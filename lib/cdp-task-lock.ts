import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const LOCK_STALE_MS = 2 * 60 * 1000;
const LOCK_POLL_MS = 2_000;
const LOCK_WAIT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

type LockOwner = {
  token: string;
  taskType: string;
  taskId: string;
  detail: string;
  pid: number | null;
  acquiredAt: string;
  heartbeatAt: string;
};

export type CdpTaskLease = {
  owner: LockOwner;
  setPid: (pid: number | null) => Promise<void>;
  release: () => Promise<void>;
};

function crawlerRoot(): string {
  return path.resolve(process.cwd(), "..", "MediaCrawler-main");
}

function lockDir(): string {
  return path.join(crawlerRoot(), ".kol-crm-cdp.lock");
}

function ownerFile(): string {
  return path.join(lockDir(), "owner.json");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readOwner(): Promise<LockOwner | null> {
  try {
    return JSON.parse(await readFile(ownerFile(), "utf8")) as LockOwner;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number | null): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isStale(): Promise<boolean> {
  const owner = await readOwner();
  if (owner?.heartbeatAt) {
    const heartbeatExpired = Date.now() - new Date(owner.heartbeatAt).getTime() > LOCK_STALE_MS;
    return heartbeatExpired && !isProcessAlive(owner.pid);
  }
  try {
    return Date.now() - (await stat(lockDir())).mtimeMs > 30_000;
  } catch {
    return false;
  }
}

async function reclaimStaleLock(): Promise<void> {
  if (!(await isStale())) return;
  const staleDir = `${lockDir()}.stale-${Date.now()}-${randomUUID()}`;
  try {
    await rename(lockDir(), staleDir);
  } catch {
    // Another waiter acquired or reclaimed it first.
    return;
  }
  // Best-effort cleanup of the renamed stale dir; failure is non-fatal
  // (it's already moved out of the way and won't block new acquisitions).
  try {
    await rm(staleDir, { recursive: true, force: true });
  } catch {
    // safe-delete shim or permission issue — stale dir left behind, harmless.
  }
}

export async function acquireCdpTaskLock(input: {
  taskType: string;
  taskId: string;
  detail?: string;
  onWait?: (owner: LockOwner | null) => void;
  timeoutMs?: number;
}): Promise<CdpTaskLease> {
  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? LOCK_WAIT_TIMEOUT_MS;
  const token = randomUUID();

  while (true) {
    try {
      await mkdir(lockDir());
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      await reclaimStaleLock();
      const owner = await readOwner();
      input.onWait?.(owner);
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(
          `等待抖音采集资源超时；当前占用任务：${owner?.taskType || "未知"} ${owner?.detail || owner?.taskId || ""}`.trim()
        );
      }
      await wait(LOCK_POLL_MS);
    }
  }

  let owner: LockOwner = {
    token,
    taskType: input.taskType,
    taskId: input.taskId,
    detail: input.detail || "",
    pid: null,
    acquiredAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString()
  };
  let released = false;

  const persist = async () => {
    if (released) return;
    await writeFile(ownerFile(), JSON.stringify(owner, null, 2), "utf8");
  };
  await persist();

  const heartbeat = setInterval(() => {
    owner = { ...owner, heartbeatAt: new Date().toISOString() };
    void persist().catch(() => undefined);
  }, 10_000);
  heartbeat.unref();

  return {
    owner,
    setPid: async (pid) => {
      owner = { ...owner, pid, heartbeatAt: new Date().toISOString() };
      await persist();
    },
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      const current = await readOwner();
      if (current?.token === token) {
        // Best-effort lock dir removal. If rm fails (e.g. safe-delete shim
        // intercepts the unlink), fall back to rename so the dir is moved
        // out of the way for the next acquisition.
        try {
          await rm(lockDir(), { recursive: true, force: true });
        } catch {
          try {
            const staleDir = `${lockDir()}.stale-${Date.now()}-${randomUUID()}`;
            await rename(lockDir(), staleDir);
            await rm(staleDir, { recursive: true, force: true }).catch(() => undefined);
          } catch {
            // Lock dir remains but is stale; reclaimStaleLock() will clean it up.
          }
        }
      }
    }
  };
}
