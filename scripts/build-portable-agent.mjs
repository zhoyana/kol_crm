import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageName = process.env.PORTABLE_AGENT_PACKAGE_NAME || "达人采集助手-portable";
const outputRoot = path.join(projectRoot, "dist", packageName);
const archive = path.join(projectRoot, "dist", `${packageName}.zip`);
const appRoot = path.join(outputRoot, "app");
const centralConfigFile = path.join(outputRoot, "central-agent.conf");
const crawlerSource = path.resolve(process.env.MEDIACRAWLER_ROOT || path.join(projectRoot, "..", "MediaCrawler-main"));
const venvPython = path.join(crawlerSource, ".venv", "Scripts", "python.exe");
const nodeSource = process.execPath;
const cscCandidates = [
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
  "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"
];

function fail(message) {
  throw new Error(`[agent-package] ${message}`);
}

function ensureFile(file, label) {
  if (!existsSync(file) || !statSync(file).isFile()) fail(`${label}不存在：${file}`);
}

function safeReset(target) {
  const resolved = path.resolve(target);
  const expectedParent = path.resolve(projectRoot, "dist");
  if (path.dirname(resolved) !== expectedParent) fail(`拒绝清理非 dist 目标：${resolved}`);
  try {
    rmSync(resolved, { recursive: true, force: true });
  } catch (error) {
    // Windows may keep an otherwise empty build directory locked when an old
    // launcher process used it as its working directory. Reusing an empty
    // directory is safe; never reuse it when files are still present.
    if (!existsSync(resolved) || readdirSync(resolved).length > 0) throw error;
  }
  mkdirSync(resolved, { recursive: true });
}

function copy(source, target, filter) {
  cpSync(source, target, { recursive: true, force: true, filter });
}

function crawlerFilter(source) {
  const relative = path.relative(crawlerSource, source);
  const segments = relative.split(path.sep).filter(Boolean);
  const excluded = new Set([
    ".git", ".github", ".venv", ".idea", ".vscode", ".runtime", "__pycache__", ".pytest_cache",
    "data", "browser_data", "logs", "test", "tests", "docs", "webui"
  ]);
  return !segments.some((segment) => excluded.has(segment) || segment.startsWith(".kol-crm-cdp.lock"));
}

function pythonFilter(source) {
  const name = path.basename(source).toLowerCase();
  return name !== "__pycache__" && !name.endsWith(".pyc") && name !== ".git";
}

function readConfiguredCentralAgent() {
  const candidates = [
    centralConfigFile,
    path.join(projectRoot, ".runtime", "package-config-backup", "central-agent.conf")
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const content = readFileSync(candidate, "utf8");
    const url = content.match(/^CENTRAL_APP_URL=(.+)$/m)?.[1]?.trim() || "";
    const token = content.match(/^CENTRAL_AGENT_TOKEN=(.+)$/m)?.[1]?.trim() || "";
    if (!/^https?:\/\//i.test(url) || url.includes("kol.example.com")) continue;
    if (!token || token.startsWith("replace-with-")) continue;
    return content;
  }
  return null;
}

const preservedCentralConfig = readConfiguredCentralAgent();

ensureFile(nodeSource, "Node运行时");
ensureFile(venvPython, "MediaCrawler Python虚拟环境");
ensureFile(path.join(crawlerSource, "main.py"), "MediaCrawler入口");
const csc = cscCandidates.find(existsSync);
if (!csc) fail("未找到Windows .NET Framework C#编译器。");

console.log(`[agent-package] 输出目录：${outputRoot}`);
safeReset(outputRoot);
rmSync(archive, { force: true });
mkdirSync(appRoot, { recursive: true });

console.log("[agent-package] 复制Agent代码...");
copy(path.join(projectRoot, "local-agent"), path.join(appRoot, "local-agent"), pythonFilter);
mkdirSync(path.join(appRoot, "lib"), { recursive: true });
for (const file of ["cdp-browser.ts", "cdp-task-lock.ts", "topic-extractor.ts"]) {
  cpSync(path.join(projectRoot, "lib", file), path.join(appRoot, "lib", file));
}
mkdirSync(path.join(appRoot, "scripts"), { recursive: true });
cpSync(path.join(projectRoot, "scripts", "run-mediacrawler.py"), path.join(appRoot, "scripts", "run-mediacrawler.py"));
cpSync(path.join(projectRoot, "scripts", "send-douyin-message.py"), path.join(appRoot, "scripts", "send-douyin-message.py"));
writeFileSync(path.join(appRoot, "package.json"), JSON.stringify({ name: "kol-crm-local-agent", private: true, type: "module" }, null, 2));

console.log("[agent-package] 复制MediaCrawler源代码...");
copy(crawlerSource, path.join(appRoot, "MediaCrawler-main"), crawlerFilter);

console.log("[agent-package] 复制Node运行时...");
const nodeTarget = path.join(appRoot, "runtime", "node");
mkdirSync(nodeTarget, { recursive: true });
cpSync(nodeSource, path.join(nodeTarget, "node.exe"));

console.log("[agent-package] 复制Python运行时和依赖（此步骤耗时较长）...");
const pythonInfo = JSON.parse(execFileSync(venvPython, ["-c", "import json,sys; print(json.dumps({'base':sys.base_prefix}))"], { encoding: "utf8" }));
const pythonBase = realpathSync(path.resolve(pythonInfo.base));
const pythonTarget = path.join(appRoot, "runtime", "python");
copy(pythonBase, pythonTarget, pythonFilter);
// Some employee PCs do not have the Microsoft Visual C++ runtime installed.
// greenlet (required by Playwright) imports MSVCP140.dll, so deploy it next to
// python.exe for app-local loading instead of relying on the target machine.
const appLocalRuntimeDlls = ["msvcp140.dll"];
for (const dll of appLocalRuntimeDlls) {
  const source = path.join(process.env.WINDIR || "C:\\Windows", "System32", dll);
  ensureFile(source, `Windows runtime ${dll}`);
  cpSync(source, path.join(pythonTarget, dll));
}
const siteSource = path.join(crawlerSource, ".venv", "Lib", "site-packages");
const siteTarget = path.join(pythonTarget, "Lib", "site-packages");
mkdirSync(siteTarget, { recursive: true });
copy(siteSource, siteTarget, pythonFilter);
for (const file of readdirSync(siteTarget).filter((name) => name.endsWith(".pth"))) {
  const fullPath = path.join(siteTarget, file);
  const content = readFileSync(fullPath, "utf8");
  if (/virtualenv|_virtualenv|C:\\Users\\/i.test(content)) rmSync(fullPath, { force: true });
}

console.log("[agent-package] 编译Windows启动器...");
const launcherSource = path.join(projectRoot, "packaging", "PortableAgentLauncher.cs");
const launcherTarget = path.join(outputRoot, "达人采集助手.exe");
execFileSync(csc, [
  "/nologo", "/target:winexe", "/optimize+", `/out:${launcherTarget}`,
  "/reference:System.dll", "/reference:System.Drawing.dll", "/reference:System.Windows.Forms.dll",
  launcherSource
], { stdio: "inherit" });

const readme = [
  "达人采集助手（便携版）", "", "使用方法：",
  "1. 保持整个文件夹完整，不要单独复制EXE。",
  "2. 电脑需安装Google Chrome，但无需安装Node.js或Python。",
  "3. 双击“达人采集助手.exe”，看到系统托盘提示后即可使用网页。",
  "4. 首次采集会打开专用Chrome窗口，请在该窗口登录抖音。",
  "5. 退出时右键系统托盘图标，选择“退出”。", "",
  "数据和日志目录：%LOCALAPPDATA%\\KOLCRM\\Agent",
  "Chrome登录目录：%LOCALAPPDATA%\\KOLCRM\\ChromeProfile"
].join("\r\n");
writeFileSync(path.join(outputRoot, "使用说明.txt"), readme, "utf8");
writeFileSync(centralConfigFile, preservedCentralConfig || [
  "# 由 IT 填写后再分发给员工；等号后不要加引号。",
  "CENTRAL_APP_URL=https://kol.example.com",
  "CENTRAL_AGENT_TOKEN=replace-with-the-same-token-as-server",
  "# 可选：留空时显示电脑名称",
  "CENTRAL_AGENT_NAME="
].join("\r\n"), "utf8");

const size = readdirSync(outputRoot, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .reduce((total, entry) => {
    const fullPath = path.join(entry.parentPath || entry.path, entry.name);
    return total + statSync(fullPath).size;
  }, 0);
writeFileSync(path.join(outputRoot, "version.json"), JSON.stringify({ version: "0.3.0", builtAt: new Date().toISOString(), bytes: size }, null, 2));
console.log(`[agent-package] 完成：${launcherTarget}`);
console.log(`[agent-package] 解压体积约 ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log("[agent-package] 正在生成分发 ZIP...");
// PowerShell Compress-Archive can report file-lock errors as non-terminating
// errors while still exiting with code 0, leaving a corrupt or partial ZIP.
// Windows bsdtar returns a real non-zero exit code and also handles the
// bundled Python tree more reliably.
execFileSync("tar.exe", [
  "-a", "-c", "-f", archive,
  "-C", path.dirname(outputRoot), path.basename(outputRoot)
], { stdio: "inherit" });
console.log(`[agent-package] ZIP：${archive}`);
