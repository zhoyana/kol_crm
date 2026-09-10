import { spawn } from "node:child_process";
import net from "node:net";

const children = new Set();

function start(label, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    windowsHide: false,
    shell: false
  });
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    const exitCode = typeof code === "number" ? code : 1;
    console.error(`[dev-local] ${label} 已退出：code=${code ?? "null"}, signal=${signal || "none"}`);
    shutdown(exitCode);
  });
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try { child.kill("SIGTERM"); } catch { /* Process may already be gone. */ }
  }
  setTimeout(() => process.exit(code), 500).unref();
}

const node = process.execPath;

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(600);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function jsonEndpointMatches(url, predicate) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_500), cache: "no-store" });
    const payload = await response.json();
    return predicate(payload, response);
  } catch {
    return false;
  }
}

const agentRunning = await jsonEndpointMatches(
  "http://127.0.0.1:17321/health",
  (payload) => payload?.ok === true && Array.isArray(payload.capabilities)
);
const crmRunning = await jsonEndpointMatches(
  "http://127.0.0.1:3000/api/campaign-tasks",
  (payload, response) => response.ok && Array.isArray(payload?.tasks)
);

if (!agentRunning && await portIsOpen(17321)) {
  console.error("[dev-local] 17321端口已被其他程序占用，无法启动本地Agent。");
  process.exit(1);
}
if (!crmRunning && await portIsOpen(3000)) {
  console.error("[dev-local] 3000端口已被其他程序占用，且该程序不是当前KOL CRM。");
  process.exit(1);
}

if (agentRunning) console.log("[dev-local] 本地Agent已运行，直接复用17321端口。");
else start("local-agent", node, ["--env-file=.env", "--experimental-strip-types", "local-agent/server.mjs"]);

if (crmRunning) console.log("[dev-local] KOL CRM已运行，直接复用3000端口。");
else start("next", node, ["node_modules/next/dist/bin/next", "dev", "-p", "3000"]);

if (agentRunning && crmRunning) {
  console.log("[dev-local] 两项服务均已就绪，无需重复启动。");
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
