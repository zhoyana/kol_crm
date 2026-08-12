import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const globalForCdp = globalThis as typeof globalThis & {
  __kolCrmCdpBrowserPromise?: Promise<CdpBrowserStatus>;
};

export type CdpBrowserStatus = {
  port: number;
  started: boolean;
  chromePath: string;
  userDataDir: string;
};

function debugPort(): number {
  const value = Number(process.env.CDP_DEBUG_PORT || 9222);
  return Number.isInteger(value) && value > 0 ? value : 9222;
}

function userDataDir(): string {
  return process.env.CDP_USER_DATA_DIR || path.join(os.homedir(), "Desktop", "chrome-cdp");
}

function chromePath(): string {
  const candidates = [
    process.env.CDP_CHROME_PATH,
    process.env.PROGRAMFILES
      ? path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe")
      : "",
    process.env["PROGRAMFILES(X86)"]
      ? path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")
      : "",
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : ""
  ].filter(Boolean) as string[];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("没有找到 Google Chrome，请通过 CDP_CHROME_PATH 配置 chrome.exe 路径。");
  }
  return found;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function closeBrowserViaCdp(port: number): Promise<void> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(3_000)
  });
  if (!response.ok) throw new Error(`CDP version HTTP ${response.status}`);
  const data = await response.json() as { webSocketDebuggerUrl?: string };
  if (!data.webSocketDebuggerUrl) throw new Error("CDP 没有返回 browser WebSocket 地址");

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(data.webSocketDebuggerUrl as string);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("通过 CDP 关闭 Chrome 超时"));
    }, 5_000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    });
    socket.addEventListener("message", () => {
      clearTimeout(timeout);
      socket.close();
      resolve();
    });
    socket.addEventListener("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("通过 CDP 关闭 Chrome 失败"));
    });
  });
}

async function findListeningPid(port: number): Promise<number | null> {
  if (process.platform !== "win32") return null;
  try {
    const output = await execFileText("netstat.exe", ["-ano", "-p", "tcp"]);
    for (const line of output.split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || columns[3] !== "LISTENING") continue;
      if (!columns[1]?.endsWith(`:${port}`)) continue;
      const pid = Number(columns[4]);
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
  } catch {
    return null;
  }
  return null;
}

async function waitForPortState(port: number, available: boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await isCdpBrowserAvailable(port)) === available) return true;
    await wait(300);
  }
  return false;
}

export function isCdpBrowserAvailable(port = debugPort(), timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(available);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function startOrReuseCdpBrowser(): Promise<CdpBrowserStatus> {
  const port = debugPort();
  const browserPath = chromePath();
  const profileDir = userDataDir();
  if (await isCdpBrowserAvailable(port)) {
    return { port, started: false, chromePath: browserPath, userDataDir: profileDir };
  }

  mkdirSync(profileDir, { recursive: true });
  const browser = spawn(
    browserPath,
    [
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check"
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    }
  );
  browser.unref();

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await isCdpBrowserAvailable(port)) {
      return { port, started: true, chromePath: browserPath, userDataDir: profileDir };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`已尝试自动启动 Chrome，但 ${port} 端口在 20 秒内没有就绪。`);
}

export async function ensureCdpBrowser(): Promise<CdpBrowserStatus> {
  if (!globalForCdp.__kolCrmCdpBrowserPromise) {
    globalForCdp.__kolCrmCdpBrowserPromise = startOrReuseCdpBrowser().finally(() => {
      globalForCdp.__kolCrmCdpBrowserPromise = undefined;
    });
  }
  return globalForCdp.__kolCrmCdpBrowserPromise;
}

export async function restartCdpBrowser(): Promise<CdpBrowserStatus> {
  const port = debugPort();
  globalForCdp.__kolCrmCdpBrowserPromise = undefined;

  if (await isCdpBrowserAvailable(port)) {
    try {
      await closeBrowserViaCdp(port);
    } catch (error) {
      console.warn("[cdp-browser] 无法优雅关闭失去响应的 Chrome：", error);
    }

    if (!(await waitForPortState(port, false, 8_000))) {
      const pid = await findListeningPid(port);
      if (!pid) throw new Error(`无法确定占用 ${port} 端口的 Chrome 进程，未执行强制重启。`);
      await execFileText("taskkill.exe", ["/PID", String(pid), "/T", "/F"]);
      if (!(await waitForPortState(port, false, 8_000))) {
        throw new Error(`已终止占用 ${port} 端口的进程，但端口仍未释放。`);
      }
    }
  }

  await wait(1_000);
  return startOrReuseCdpBrowser();
}
