import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureCdpBrowser } from "@/lib/cdp-browser";

export type XhsCrawlerStatus = "idle" | "running" | "succeeded" | "failed" | "stopped";
export type XhsCrawlerSnapshot = {
  id: string;
  keyword: string;
  maxNotes: number;
  status: XhsCrawlerStatus;
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logs: string[];
  command: string;
  error: string;
  collectedWorks: number;
};

export type RedfoxXhsWork = Record<string, unknown> & {
  authorId?: string;
  authorFans?: number | string;
  authorNickname?: string;
  collectedCount?: number | string;
  commentsCount?: number | string;
  createTime?: number | string;
  desc?: string;
  id?: string;
  likedCount?: number | string;
  shareInfoLink?: string;
  sharedCount?: number | string;
  title?: string;
  sourceKeyword?: string;
  fetchedAt?: string;
  crawlTaskId?: string;
};

type Running = XhsCrawlerSnapshot & { controller: AbortController | null; child: ChildProcessWithoutNullStreams | null };
const globals = globalThis as typeof globalThis & { __kolCrmXhsCrawlerTask?: Running };

function cacheDir() {
  return path.resolve(process.cwd(), ".runtime", "xhs-redfox");
}

export function xhsRedfoxCacheFile() {
  return path.join(cacheDir(), "works.json");
}

function idle(): Running {
  return {
    id: "", keyword: "", maxNotes: 0, status: "idle", pid: null,
    startedAt: null, finishedAt: null, exitCode: null, logs: [],
    command: "", error: "", collectedWorks: 0, controller: null, child: null
  };
}

function current() {
  return globals.__kolCrmXhsCrawlerTask ||= idle();
}

function snapshot(task: Running): XhsCrawlerSnapshot {
  const { controller: _controller, child: _child, ...rest } = task;
  return rest;
}

function mediaCrawlerDir() {
  return path.resolve(process.cwd(), "..", "MediaCrawler-main");
}

function mediaCrawlerOutputBase() {
  return path.resolve(process.cwd(), ".runtime", "mediacrawler");
}

async function readMediaCrawlerNoteIds() {
  const dir = path.join(mediaCrawlerOutputBase(), "xhs", "jsonl");
  const names = (await readdir(dir).catch(() => [])).filter((name) => /^search_contents_.*\.jsonl$/i.test(name));
  const ids = new Set<string>();
  for (const name of names) {
    const text = await readFile(path.join(dir, name), "utf8").catch(() => "");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const id = String(row?.note_id || "").trim();
        if (id) ids.add(id);
      } catch { /* ignore incomplete jsonl row */ }
    }
  }
  return ids;
}

async function readNewMediaCrawlerWorks(beforeIds: Set<string>, keyword: string, crawlTaskId: string) {
  const dir = path.join(mediaCrawlerOutputBase(), "xhs", "jsonl");
  const names = (await readdir(dir).catch(() => [])).filter((name) => /^search_contents_.*\.jsonl$/i.test(name));
  const works: RedfoxXhsWork[] = [];
  for (const name of names) {
    const text = await readFile(path.join(dir, name), "utf8").catch(() => "");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const id = String(row?.note_id || "").trim();
        if (!id || beforeIds.has(id) || String(row?.source_keyword || "").trim() !== keyword) continue;
        works.push({
          authorId: row.user_id,
          authorNickname: row.nickname,
          authorFans: row.fans || row.followers || 0,
          id,
          shareInfoLink: row.note_url,
          title: row.title,
          desc: row.desc,
          createTime: row.time,
          likedCount: row.liked_count,
          collectedCount: row.collected_count,
          commentsCount: row.comment_count,
          sharedCount: row.share_count,
          sourceKeyword: keyword,
          fetchedAt: new Date().toISOString(),
          crawlTaskId,
          provider: "mediacrawler"
        });
      } catch { /* ignore incomplete jsonl row */ }
    }
  }
  return works;
}

async function parsePythonLiteral(python: string, payload: string): Promise<any> {
  const code = "import ast,json,sys; json.dump(ast.literal_eval(sys.stdin.read()), sys.stdout, ensure_ascii=False)";
  const child = spawn(python, ["-c", code], { cwd: process.cwd(), windowsHide: true, stdio: "pipe" });
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stdin.end(payload, "utf8");
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (value) => resolve(Number(value ?? 1)));
  });
  if (exitCode !== 0 || !stdout.trim()) return null;
  return JSON.parse(stdout);
}

async function worksFromSearchResponses(python: string, payloads: string[], keyword: string, crawlTaskId: string) {
  const works = new Map<string, RedfoxXhsWork>();
  for (const payload of payloads) {
    const parsed = await parsePythonLiteral(python, payload).catch(() => null);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    for (const item of items) {
      if (item?.model_type !== "note") continue;
      const card = item?.note_card || {};
      const user = card?.user || {};
      const interact = card?.interact_info || {};
      const id = String(item?.id || "").trim();
      const authorId = String(user?.user_id || "").trim();
      if (!id || !authorId) continue;
      const token = String(item?.xsec_token || "").trim();
      works.set(id, {
        id,
        title: String(card?.display_title || "").trim(),
        desc: "",
        authorId,
        authorNickname: String(user?.nickname || user?.nick_name || "").trim(),
        likedCount: interact?.liked_count || 0,
        collectedCount: interact?.collected_count || 0,
        commentsCount: interact?.comment_count || 0,
        sharedCount: interact?.shared_count || interact?.share_count || 0,
        shareInfoLink: `https://www.xiaohongshu.com/explore/${id}${token ? `?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_search` : ""}`,
        sourceKeyword: keyword,
        fetchedAt: new Date().toISOString(),
        crawlTaskId,
        provider: "mediacrawler-search"
      });
    }
  }
  return Array.from(works.values());
}

async function runMediaCrawlerTask(task: Running) {
  try {
    const cdp = await ensureCdpBrowser();
    log(task, cdp.started
      ? `专用 Chrome 已自动启动：127.0.0.1:${cdp.port}。`
      : `专用 Chrome 已就绪：127.0.0.1:${cdp.port}。`);
  } catch (error) {
    log(task, `专用 Chrome 自动启动未就绪，将使用项目内备用浏览器继续：${error instanceof Error ? error.message : "未知错误"}`);
  }
  const beforeIds = await readMediaCrawlerNoteIds();
  const crawlerDir = mediaCrawlerDir();
  const outputBase = mediaCrawlerOutputBase();
  await mkdir(outputBase, { recursive: true });
  const python = path.join(crawlerDir, ".venv", "Scripts", "python.exe");
  const crawlerEntry = path.join(crawlerDir, "main.py");
  const configuredLimit = Number(process.env.XHS_MEDIACRAWLER_MAX_NOTES_PER_KEYWORD || 100);
  const perKeywordLimit = Number.isFinite(configuredLimit)
    ? Math.max(1, Math.min(120, Math.round(configuredLimit)))
    : 100;
  const limit = Math.max(1, Math.min(perKeywordLimit, task.maxNotes));
  const minDelay = Math.max(3, Math.min(12, Number(process.env.XHS_MEDIACRAWLER_MIN_DELAY_SECONDS || 4)));
  const maxDelay = Math.max(minDelay, Math.min(15, Number(process.env.XHS_MEDIACRAWLER_MAX_DELAY_SECONDS || 7)));
  const runner = path.join(process.cwd(), "scripts", "run-mediacrawler-xhs.py");
  const args = [
    runner, crawlerDir, crawlerEntry, String(minDelay), String(maxDelay),
    "--platform", "xhs", "--lt", "qrcode", "--type", "search",
    "--keywords", task.keyword, "--start", "1", "--get_comment", "no",
    "--get_sub_comment", "no", "--headless", "no", "--save_data_option", "jsonl",
    "--crawler_max_notes_count", String(limit), "--max_concurrency_num", "1",
    "--save_data_path", outputBase, "--enable_ip_proxy", "no"
  ];
  task.command = `MediaCrawler XHS slow (${limit} notes, concurrency 1, ${minDelay}-${maxDelay}s delay, comments off)`;
  log(task, `安全模式：MediaCrawler仅搜索当前关键词“${task.keyword}”，最多 ${limit} 篇，不抓评论；主页样本仍由 RedFox 补齐。`);
  // Keep cwd inside this project. MediaCrawler builds its fallback browser_data
  // path from cwd; using the sibling repository caused EPERM in workspace-only
  // deployments whenever CDP 9222 was unavailable.
  const child = spawn(python, args, { cwd: process.cwd(), windowsHide: true, stdio: "pipe" });
  task.child = child;
  task.pid = child.pid || null;
  let loginRequired = false;
  const searchPayloads: string[] = [];
  let stdoutBuffer = "";
  let stderrBuffer = "";
  const handleLine = (rawLine: string) => {
      const line = rawLine.trim();
      if (!line) return;
      const marker = "Search notes response: ";
      const markerIndex = line.indexOf(marker);
      if (markerIndex >= 0) {
        searchPayloads.push(line.slice(markerIndex + marker.length));
        log(task, `已收到关键词“${task.keyword}”搜索结果页，正在整理作者与互动数据…`);
      } else {
        log(task, line);
      }
      if (line.includes("Login state result: False")) {
        loginRequired = true;
        if (!child.killed) child.kill();
      }
  };
  const onOutput = (kind: "stdout" | "stderr", chunk: Buffer) => {
    const combined = (kind === "stdout" ? stdoutBuffer : stderrBuffer) + chunk.toString("utf8");
    const lines = combined.split(/\r?\n/);
    const tail = lines.pop() || "";
    if (kind === "stdout") stdoutBuffer = tail;
    else stderrBuffer = tail;
    for (const line of lines) handleLine(line);
  };
  child.stdout.on("data", (chunk) => onOutput("stdout", chunk));
  child.stderr.on("data", (chunk) => onOutput("stderr", chunk));
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(Number(code ?? 1)));
  });
  handleLine(stdoutBuffer);
  handleLine(stderrBuffer);
  task.child = null;
  task.pid = null;
  if (task.status === "stopped") return;
  if (loginRequired) throw new Error("专用 Chrome 尚未登录小红书。请先在9222专用 Chrome 打开小红书并完成登录，再重新运行 Agent。");
  const detailedWorks = await readNewMediaCrawlerWorks(beforeIds, task.keyword, task.id);
  const searchWorks = await worksFromSearchResponses(python, searchPayloads, task.keyword, task.id);
  const mergedWorks = new Map<string, RedfoxXhsWork>();
  for (const work of [...searchWorks, ...detailedWorks]) {
    const id = String(work.id || work.shareInfoLink || "").trim();
    if (id) mergedWorks.set(id, work);
  }
  const works = Array.from(mergedWorks.values()).slice(0, limit);
  if (exitCode !== 0 && !works.length) {
    const recentLogs = task.logs.slice(-30).join("\n");
    if (/EPERM: operation not permitted, mkdir[\s\S]*browser_data/i.test(recentLogs)) {
      throw new Error("专用 Chrome 未能通过 9222 连接，MediaCrawler 回退启动浏览器时目录无权限。系统下次会先自动启动专用 Chrome；请在弹出的窗口确认小红书登录状态后重试。");
    }
    throw new Error(`MediaCrawler 小红书关键词采集失败（exit code ${exitCode}）。专用 Chrome 已连接；请查看本步骤日志中的具体异常。`);
  }
  await saveWorks(works);
  task.collectedWorks = works.length;
  task.status = "succeeded";
  task.exitCode = 0;
  log(task, exitCode === 0
    ? `MediaCrawler低频发现完成：本轮新增 ${works.length} 篇作品；后续作者主页由 RedFox 接口补齐。`
    : `部分作品详情解析异常，已保留搜索页中的 ${works.length} 篇作品继续流程；作者主页由 RedFox 接口补齐。`);
}

async function runMatrixFlowTask(task: Running) {
  const script = path.join(process.cwd(), "scripts", "xhs-matrixflow-crawl.mjs");
  const outFile = path.join(process.cwd(), ".runtime", "xhs-matrixflow", `works-${task.id}.json`);
  await mkdir(path.dirname(outFile), { recursive: true });
  task.command = `MatrixFlow XHS browser (${task.maxNotes} notes, window ${process.env.MATRIXFLOW_XHS_WINDOW || "auto"})`;
  log(task, `正在通过 MatrixFlow 真实浏览器搜索关键词“${task.keyword}”，最多 ${task.maxNotes} 篇…`);
  const child = spawn(process.execPath, [
    script, "--keyword", task.keyword, "--max-notes", String(task.maxNotes),
    "--out", outFile, "--crawl-task-id", task.id
  ], { cwd: process.cwd(), windowsHide: true, stdio: "pipe" });
  task.child = child;
  task.pid = child.pid || null;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) log(task, trimmed);
    }
  });
  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString("utf8");
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) log(task, trimmed);
    }
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(Number(code ?? 1)));
  });
  task.child = null;
  task.pid = null;
  const trailing = `${stdoutBuffer}\n${stderrBuffer}`.trim();
  if (trailing) log(task, trailing);
  if (task.status === "stopped") return;
  if (exitCode === 2) throw new Error("小红书需要登录：请先在 MatrixFlow 窗口用手机扫码登录小红书，再重新运行。");
  if (exitCode !== 0) throw new Error(`MatrixFlow 小红书采集失败（exit code ${exitCode}），请查看上方日志。`);
  let works: RedfoxXhsWork[] = [];
  try {
    const value = JSON.parse(await readFile(outFile, "utf8"));
    works = Array.isArray(value) ? value : [];
  } catch {
    works = [];
  }
  if (!works.length) {
    throw new Error("MatrixFlow 采集完成但没有取到作品，可能关键词无结果或页面结构变化，请查看上方日志。");
  }
  await saveWorks(works);
  task.collectedWorks = works.length;
  task.status = "succeeded";
  task.exitCode = 0;
  log(task, `MatrixFlow 采集完成：本轮新增 ${works.length} 篇作品，进入作者主页画像与待选/精选流程。`);
}

async function runMatrixFlowTaskSafely(task: Running) {
  try {
    await runMatrixFlowTask(task);
  } catch (error) {
    if (task.status !== "stopped") {
      task.status = "failed";
      task.exitCode = 1;
      task.error = error instanceof Error ? error.message : "MatrixFlow 小红书采集失败";
      log(task, task.error);
    }
  } finally {
    task.finishedAt = new Date().toISOString();
    task.child = null;
  }
}
async function runMediaCrawlerTaskSafely(task: Running) {
  try {
    await runMediaCrawlerTask(task);
  } catch (error) {
    if (task.status !== "stopped") {
      task.status = "failed";
      task.exitCode = 1;
      task.error = error instanceof Error ? error.message : "MediaCrawler 小红书采集失败";
      log(task, task.error);
    }
  } finally {
    task.finishedAt = new Date().toISOString();
    task.child = null;
  }
}

function log(task: Running, message: string) {
  task.logs.push(message);
  task.logs = task.logs.slice(-180);
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function readCachedWorks(): Promise<RedfoxXhsWork[]> {
  try {
    const value = JSON.parse(await readFile(xhsRedfoxCacheFile(), "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function saveWorks(works: RedfoxXhsWork[]) {
  await mkdir(cacheDir(), { recursive: true });
  const existing = await readCachedWorks();
  const merged = new Map<string, RedfoxXhsWork>();
  for (const work of [...existing, ...works]) {
    const id = String(work.id || work.shareInfoLink || "").trim();
    if (id) merged.set(id, work);
  }
  const file = xhsRedfoxCacheFile();
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(Array.from(merged.values()), null, 2), "utf8");
  await rename(temp, file);
}

async function runRedfoxTask(task: Running, controller: AbortController) {
  try {
    const apiKey = String(process.env.REDFOX_API_KEY || "").trim();
    if (!apiKey) throw new Error("未配置 REDFOX_API_KEY。请重启 Web 服务以读取已设置的用户环境变量。");

    const end = new Date();
    const dateRanges = [30, 90, 180].map((days) => ({
      days,
      startDate: dateOnly(new Date(end.getTime() - days * 86400_000)),
      endDate: dateOnly(end)
    }));
    log(task, `正在通过红狐 API 搜索“小红书”关键词：${task.keyword}`);
    const collected = new Map<string, RedfoxXhsWork>();
    const sortModes = [
      { value: "_0", label: "综合" },
      { value: "_2", label: "最新" },
      { value: "_4", label: "最热" }
    ];
    let lastError = "小红书 API 请求失败";

    for (const range of dateRanges) {
      if (collected.size >= task.maxNotes) break;
      const beforeRange = collected.size;
      log(task, `正在使用原关键词查询近 ${range.days} 天内容…`);

    for (const sortMode of sortModes) {
      if (collected.size >= task.maxNotes) break;
      let payload: any = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const response = await fetch("https://redfox.hk/story/api/xhs/crawl/work", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
            "User-Agent": "QoderWork/1.0"
          },
          body: JSON.stringify({
            keyword: task.keyword,
            startDate: range.startDate,
            endDate: range.endDate,
            source: "KOL CRM 小红书采集",
            sortType: sortMode.value
          }),
          signal: controller.signal
        });
        payload = await response.json().catch(() => null);
        if (response.ok && payload?.code === 2000) break;
        const detail = payload?.message || payload?.msg || `HTTP ${response.status}`;
        lastError = `小红书 API 请求失败：${detail}`;
        const retryable = [429, 500, 502, 503, 504].includes(response.status);
        if (!retryable || attempt === 3) {
          payload = null;
          log(task, `${sortMode.label}排序采集失败，继续尝试其他排序。`);
          break;
        }
        const delaySeconds = attempt * 5;
        log(task, `${sortMode.label}排序接口暂时不可用（${detail}），${delaySeconds} 秒后自动重试 ${attempt + 1}/3…`);
        await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
      }
      if (!payload) continue;
      const raw = payload?.data?.works || payload?.data?.list || payload?.data?.articles || [];
      for (const work of Array.isArray(raw) ? raw : []) {
        const id = String(work?.id || work?.shareInfoLink || "").trim();
        if (!id || collected.has(id)) continue;
        collected.set(id, {
          ...work,
          sourceKeyword: task.keyword,
          fetchedAt: new Date().toISOString(),
          crawlTaskId: task.id
        });
        if (collected.size >= task.maxNotes) break;
      }
      log(task, `${sortMode.label}排序完成，去重后累计 ${collected.size}/${task.maxNotes} 篇。`);
    }

      const added = collected.size - beforeRange;
      log(task, `原关键词近 ${range.days} 天查询完成，本阶段新增 ${added} 篇，累计 ${collected.size}/${task.maxNotes} 篇。`);
    }

    let works = Array.from(collected.values());
    if (!works.length) {
      works = (await readCachedWorks()).filter((work) => {
        if (String(work.sourceKeyword || "") !== task.keyword) return false;
        const fetchedAt = new Date(String(work.fetchedAt || "")).getTime();
        return Number.isFinite(fetchedAt) && fetchedAt >= Date.now() - 24 * 60 * 60 * 1000;
      }).slice(0, task.maxNotes).map((work) => ({
        ...work,
        crawlTaskId: task.id,
        fetchedAt: new Date().toISOString()
      }));
      if (works.length) {
        log(task, `红狐接口连续失败，已使用同关键词 24 小时内缓存的 ${works.length} 篇笔记继续流程。`);
      } else {
        log(task, `${lastError}；所有排序均失败且没有可用缓存，本关键词记为 0 篇并自动切换下一个关键词。`);
      }
    }
    await saveWorks(works);
    task.collectedWorks = works.length;
    task.status = "succeeded";
    task.exitCode = 0;
    log(task, `API 采集完成，获得 ${works.length} 篇笔记，已保存作者 ID 和互动指标。`);
  } catch (error) {
    if (controller.signal.aborted) {
      task.status = "stopped";
      task.error = "";
      log(task, "采集任务已停止。");
    } else {
      task.status = "failed";
      task.exitCode = 1;
      task.error = error instanceof Error ? error.message : "小红书 API 采集失败";
      log(task, task.error);
    }
  } finally {
    task.finishedAt = new Date().toISOString();
    task.controller = null;
  }
}

export async function startXhsCrawlerTask(input: { keyword: string; maxNotes?: number; restartCdpBeforeSpawn?: boolean }): Promise<XhsCrawlerSnapshot> {
  const running = current();
  if (running.status === "running") throw new Error("小红书采集任务正在运行，请等待完成或先停止。");
  const keyword = String(input.keyword || "").trim();
  if (!keyword) throw new Error("请输入小红书采集关键词。");

  const controller = new AbortController();
  const provider = String(process.env.XHS_DISCOVERY_PROVIDER || "matrixflow").trim().toLowerCase();
  const useMediaCrawler = provider === "mediacrawler";
  const useMatrixFlow = provider === "matrixflow";
  const task = Object.assign(running, idle(), {
    id: `xhs-${useMatrixFlow ? "matrixflow" : useMediaCrawler ? "mediacrawler" : "redfox"}-${Date.now()}`,
    keyword,
    maxNotes: Math.max(1, Math.min(300, Number(input.maxNotes || 60))),
    status: "running" as XhsCrawlerStatus,
    startedAt: new Date().toISOString(),
    command: useMatrixFlow ? "MatrixFlow XHS browser" : useMediaCrawler ? "MediaCrawler XHS safe" : "Redfox XHS API",
    controller
  });
  if (useMatrixFlow) void runMatrixFlowTaskSafely(task);
  else if (useMediaCrawler) void runMediaCrawlerTaskSafely(task);
  else void runRedfoxTask(task, controller);
  return snapshot(task);
}

export function getXhsCrawlerTask(): XhsCrawlerSnapshot {
  return snapshot(current());
}

export async function stopXhsCrawlerTask(): Promise<XhsCrawlerSnapshot> {
  const task = current();
  task.controller?.abort();
  if (task.child && !task.child.killed) task.child.kill();
  if (task.status === "running") {
    task.status = "stopped";
    task.finishedAt = new Date().toISOString();
  }
  return snapshot(task);
}
