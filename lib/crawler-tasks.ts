import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractTopicCandidates as extractTopics, type TopicCandidate, type TopicRuleOptions } from "./topic-extractor";

export type CrawlerTaskStatus = "idle" | "running" | "waiting_topics" | "succeeded" | "failed" | "stopped";
export type DiscoveryMode = "single" | "two_stage_auto" | "two_stage_manual";
export type { TopicCandidate };

export type CrawlerTaskSnapshot = {
  id: string;
  keyword: string;
  maxNotes: number;
  status: CrawlerTaskStatus;
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logs: string[];
  command: string;
  error: string;
  discoveryMode: DiscoveryMode;
  stage: "idle" | "keyword" | "topic" | "done";
  topicCandidates: TopicCandidate[];
  selectedTopics: string[];
  topicLimit: number;
  activeKeywords: string[];
};

type CrawlerContentItem = {
  title?: string;
  desc?: string;
  liked_count?: string | number;
  last_modify_ts?: number;
  source_keyword?: string;
};

type RunningCrawlerTask = CrawlerTaskSnapshot & {
  process: ChildProcessWithoutNullStreams | null;
  publishWindowDays?: number;
  sortBy?: string;
  topicRules?: TopicRuleOptions;
  retriedWithoutSearchFilters?: boolean;
};

const globalForCrawler = globalThis as typeof globalThis & {
  __kolCrmDouyinCrawlerTask?: RunningCrawlerTask;
};

function crawlerDir(): string {
  return path.resolve(process.cwd(), "..", "MediaCrawler-main");
}

function jsonlDir(): string {
  return path.join(crawlerDir(), "data", "douyin", "jsonl");
}

function makeIdleTask(): RunningCrawlerTask {
  return {
    id: "",
    keyword: "",
    maxNotes: 0,
    status: "idle",
    pid: null,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    logs: [],
    command: "",
    error: "",
    discoveryMode: "single",
    stage: "idle",
    topicCandidates: [],
    selectedTopics: [],
    topicLimit: 3,
    activeKeywords: [],
    process: null
  };
}

function currentTask(): RunningCrawlerTask {
  if (!globalForCrawler.__kolCrmDouyinCrawlerTask) {
    globalForCrawler.__kolCrmDouyinCrawlerTask = makeIdleTask();
  }
  return globalForCrawler.__kolCrmDouyinCrawlerTask;
}

function pushLog(task: RunningCrawlerTask, chunk: Buffer | string) {
  const lines = String(chunk)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  task.logs.push(...lines);
  task.logs = task.logs.slice(-180);
}

function mapPublishWindowToDouyinType(days?: number): number {
  const value = Number(days ?? 0);
  if (value <= 0) return 0;
  if (value <= 1) return 1;
  if (value <= 7) return 7;
  return 180;
}

function mapSortByToDouyinType(sortBy?: string): number {
  if (sortBy === "likes") return 1;
  if (sortBy === "latest") return 2;
  return 0;
}

function buildArgs(keywords: string, maxNotes: number, task?: RunningCrawlerTask): string[] {
  return [
    "run",
    "main.py",
    "--platform",
    "dy",
    "--lt",
    "qrcode",
    "--type",
    "search",
    "--keywords",
    keywords,
    "--publish_time_type",
    String(mapPublishWindowToDouyinType(task?.publishWindowDays)),
    "--search_sort_type",
    String(mapSortByToDouyinType(task?.sortBy)),
    "--crawler_max_notes_count",
    String(maxNotes),
    "--get_comment",
    "false",
    "--get_sub_comment",
    "false",
    "--save_data_option",
    "jsonl"
  ];
}

function splitKeywords(value: string): string[] {
  return value
    .split(/[,，、\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function itemMatchesTaskKeywords(task: RunningCrawlerTask, item: CrawlerContentItem): boolean {
  const allowedKeywords = task.activeKeywords.length ? task.activeKeywords : [task.keyword];
  const sourceKeyword = normalizeText(String(item.source_keyword || ""));
  if (!sourceKeyword) return true;
  return allowedKeywords.map(normalizeText).includes(sourceKeyword);
}

function getRecentContentFiles(task: RunningCrawlerTask): string[] {
  const dir = jsonlDir();
  if (!existsSync(dir)) return [];

  const since = task.startedAt ? new Date(task.startedAt).getTime() - 10_000 : 0;
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl") && name.includes("contents"))
    .map((name) => path.join(dir, name))
    .filter((filePath) => statSync(filePath).mtimeMs >= since);
}

function isCurrentTaskItem(task: RunningCrawlerTask, item: CrawlerContentItem): boolean {
  if (!task.startedAt) return true;

  const startedAtMs = new Date(task.startedAt).getTime() - 10_000;
  if (item.last_modify_ts && item.last_modify_ts < startedAtMs) return false;
  if (!itemMatchesTaskKeywords(task, item)) return false;

  return true;
}

function readRecentItems(task: RunningCrawlerTask): CrawlerContentItem[] {
  const items: CrawlerContentItem[] = [];

  for (const filePath of getRecentContentFiles(task)) {
    const content = readFileSync(filePath, "utf8");

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;

      try {
        const item = JSON.parse(line) as CrawlerContentItem;
        if (isCurrentTaskItem(task, item)) items.push(item);
      } catch {
        // Ignore partial rows written by an interrupted crawler.
      }
    }
  }

  return items;
}

function cleanupStoppedTaskRows(task: RunningCrawlerTask): number {
  let removedCount = 0;

  for (const filePath of getRecentContentFiles(task)) {
    const content = readFileSync(filePath, "utf8");
    const keptLines: string[] = [];

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;

      try {
        const item = JSON.parse(line) as CrawlerContentItem;
        if (isCurrentTaskItem(task, item)) {
          removedCount += 1;
          continue;
        }
      } catch {
        removedCount += 1;
        continue;
      }

      keptLines.push(line);
    }

    if (keptLines.length) {
      writeFileSync(filePath, `${keptLines.join("\n")}\n`, "utf8");
    } else {
      unlinkSync(filePath);
    }
  }

  return removedCount;
}

function extractTopicCandidates(task: RunningCrawlerTask): TopicCandidate[] {
  const items = readRecentItems(task);
  pushLog(task, `Topic extraction input works: ${items.length}`);

  return extractTopics({
    keyword: task.keyword,
    items,
    limit: 12,
    minHashtagCount: 4,
    rules: task.topicRules
  });
}

function preferredTopicCandidates(task: RunningCrawlerTask): TopicCandidate[] {
  const preferredTerms = ["警校生", "警校生日常", "警校生活", "警校日常", "警校穿搭", "警校生vlog", "藏蓝青春", "警校训练", "警校宿舍"];
  const broadTerms = ["警校", "警察", "公安", "公安院校", "警察学院", "中国人民公安大学", "江西警察学院", "山东警察学院", "山西警察学院"];
  const offTargetTerms = ["报考", "招生", "培训", "升学", "高考", "志愿", "公安联考", "联考", "考试", "招聘", "执法", "巡逻", "办案", "执勤", "新闻", "报道", "普法"];

  const normalize = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  const preferred = preferredTerms.map(normalize);
  const broad = broadTerms.map(normalize);
  const offTarget = offTargetTerms.map(normalize);

  const scored = task.topicCandidates
    .filter((item) => !offTarget.some((term) => normalize(item.topic).includes(term)))
    .map((item) => {
      const topic = normalize(item.topic);
      const preference = preferred.some((term) => topic.includes(term)) ? 1000 : broad.some((term) => topic === term || topic.includes(term)) ? -500 : 0;
      return { item, score: preference + item.score };
    })
    .sort((a, b) => b.score - a.score || b.item.count - a.item.count)
    .map((entry) => entry.item);

  return scored.length ? scored : task.topicCandidates;
}

function finishWithPartialSuccess(task: RunningCrawlerTask, stage: "keyword" | "topic", code: number | null): boolean {
  const collectedItems = readRecentItems(task);
  if (!collectedItems.length) return false;

  if (stage === "keyword" && task.discoveryMode !== "single") {
    pushLog(task, `Crawler exited with code ${code}, but ${collectedItems.length} works were collected. Continue topic extraction.`);
    task.topicCandidates = extractTopicCandidates(task);

    if (!task.topicCandidates.length) {
      task.status = "succeeded";
      task.stage = "done";
      task.finishedAt = new Date().toISOString();
      task.error = "";
      pushLog(task, "No usable topic was extracted. Using current works as discovery result.");
      return true;
    }

    if (task.discoveryMode === "two_stage_manual") {
      task.status = "waiting_topics";
      task.error = "";
      pushLog(task, "Waiting for topic selection.");
      return true;
    }

    const autoTopics = preferredTopicCandidates(task).slice(0, task.topicLimit).map((item) => item.topic);
    task.selectedTopics = autoTopics;
    spawnCrawler(task, autoTopics.join(","), "topic");
    return true;
  }

  task.status = "succeeded";
  task.stage = "done";
  task.finishedAt = new Date().toISOString();
  task.error = "";
  pushLog(task, `Crawler exited with code ${code}, but ${collectedItems.length} works were collected. Treat as partial success.`);
  return true;
}

function spawnCrawler(task: RunningCrawlerTask, keywords: string, stage: "keyword" | "topic") {
  const dir = crawlerDir();
  const args = buildArgs(keywords, task.maxNotes, task);
  const taskId = task.id;
  const child = spawn("uv", args, {
    cwd: dir,
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8"
    }
  });

  task.process = child;
  task.pid = child.pid ?? null;
  task.stage = stage;
  task.activeKeywords = splitKeywords(keywords);
  task.command = `uv ${args.join(" ")}`;
  task.status = "running";
  pushLog(task, stage === "keyword" ? `Keyword crawl: ${keywords}` : `Topic crawl: ${keywords}`);

  child.stdout.on("data", (chunk) => pushLog(task, chunk));
  child.stderr.on("data", (chunk) => pushLog(task, chunk));

  child.on("error", (error) => {
    if (currentTask().id !== taskId) return;
    task.status = "failed";
    task.error = error.message;
    task.finishedAt = new Date().toISOString();
    task.process = null;
    pushLog(task, `Crawler start failed: ${error.message}`);
  });

  child.on("close", (code) => {
    if (currentTask().id !== taskId) return;

    if (task.status === "stopped") {
      task.exitCode = code;
      task.process = null;
      task.pid = null;
      task.finishedAt = task.finishedAt || new Date().toISOString();
      return;
    }

    task.exitCode = code;
    task.process = null;
    task.pid = null;

    const collectedItems = readRecentItems(task);
    const hasSearchFilters = Boolean(task.publishWindowDays && task.publishWindowDays > 0) || Boolean(task.sortBy && task.sortBy !== "relevance");
    if (code === 0 && stage === "keyword" && !collectedItems.length && hasSearchFilters && !task.retriedWithoutSearchFilters) {
      task.retriedWithoutSearchFilters = true;
      task.publishWindowDays = 0;
      task.sortBy = "relevance";
      pushLog(task, "Keyword crawl returned 0 works with search filters. Retrying once without publish time and sort filters.");
      spawnCrawler(task, keywords, stage);
      return;
    }

    if (code !== 0) {
      if (finishWithPartialSuccess(task, stage, code)) return;

      task.status = "failed";
      task.finishedAt = new Date().toISOString();
      task.error = `Crawler failed, exit code: ${code}`;
      pushLog(task, task.error);
      return;
    }

    if (stage === "keyword" && task.discoveryMode !== "single") {
      task.topicCandidates = extractTopicCandidates(task);

      if (task.topicCandidates.length === 0) {
        pushLog(task, "First round finished, but no usable topic was extracted. Using current works as result.");
        task.status = "succeeded";
        task.stage = "done";
        task.finishedAt = new Date().toISOString();
        return;
      }

      pushLog(
        task,
        `Topic candidates: ${task.topicCandidates.map((item) => `${item.topic}(${item.count}/${Math.round(item.score)}/${item.source})`).join(", ")}`
      );

      if (task.discoveryMode === "two_stage_manual") {
        task.status = "waiting_topics";
        pushLog(task, "Waiting for topic selection.");
        return;
      }

      const autoTopics = preferredTopicCandidates(task).slice(0, task.topicLimit).map((item) => item.topic);
      task.selectedTopics = autoTopics;
      pushLog(task, `Auto selected topics: ${autoTopics.join(", ")}`);
      spawnCrawler(task, autoTopics.join(","), "topic");
      return;
    }

    task.status = "succeeded";
    task.stage = "done";
    task.finishedAt = new Date().toISOString();
    pushLog(task, "Crawler task completed.");
  });
}

export function getDouyinCrawlerTask(): CrawlerTaskSnapshot {
  const { process: _process, ...snapshot } = currentTask();
  return snapshot;
}

export function startDouyinCrawlerTask(input: {
  keyword: string;
  maxNotes: number;
  discoveryMode?: DiscoveryMode;
  topicLimit?: number;
  publishWindowDays?: number;
  sortBy?: string;
  topicRules?: TopicRuleOptions;
}): CrawlerTaskSnapshot {
  const keyword = input.keyword.trim();
  const maxNotes = Math.min(Math.max(Number(input.maxNotes) || 20, 10), 300);
  const discoveryMode = input.discoveryMode || "single";
  const topicLimit = Math.min(Math.max(Number(input.topicLimit) || 3, 1), 8);
  const task = currentTask();

  if (!keyword) throw new Error("请输入关键词。");
  if (task.status === "running" && task.process) throw new Error("已有采集任务正在运行，请等它结束后再启动。");

  const dir = crawlerDir();
  if (!existsSync(path.join(dir, "main.py"))) throw new Error(`没有找到 MediaCrawler 项目：${dir}`);

  const startedTask: RunningCrawlerTask = {
    ...makeIdleTask(),
    id: `${Date.now()}`,
    keyword,
    maxNotes,
    status: "running",
    startedAt: new Date().toISOString(),
    discoveryMode,
    topicLimit,
    publishWindowDays: input.publishWindowDays,
    sortBy: input.sortBy,
    topicRules: input.topicRules,
    logs: [
      discoveryMode === "two_stage_manual"
        ? `启动二段式发现：关键词=${keyword}，第一轮完成后生成话题候选池`
        : discoveryMode === "two_stage_auto"
          ? `启动自动二段式发现：关键词=${keyword}，每轮数量=${maxNotes}`
          : `启动单轮抖音采集：关键词=${keyword}，数量=${maxNotes}`
    ]
  };

  globalForCrawler.__kolCrmDouyinCrawlerTask = startedTask;
  spawnCrawler(startedTask, keyword, "keyword");

  return getDouyinCrawlerTask();
}

export function continueDouyinCrawlerWithTopics(topics: string[]): CrawlerTaskSnapshot {
  const task = currentTask();
  const selectedTopics = topics.map((topic) => topic.trim()).filter(Boolean);

  if (task.status !== "waiting_topics") throw new Error("当前没有等待选择的话题采集任务。");
  if (selectedTopics.length === 0) throw new Error("请至少选择一个话题。");
  if (task.process) throw new Error("采集任务正在运行中。");

  task.selectedTopics = selectedTopics;
  spawnCrawler(task, selectedTopics.join(","), "topic");

  return getDouyinCrawlerTask();
}

export function stopDouyinCrawlerTask(): CrawlerTaskSnapshot {
  const task = currentTask();

  if (task.status !== "running" || !task.process) {
    if (task.status === "waiting_topics") {
      const removedCount = cleanupStoppedTaskRows(task);
      task.status = "stopped";
      task.stage = "done";
      task.finishedAt = new Date().toISOString();
      pushLog(task, `采集任务已停止，已清理本次未完成数据 ${removedCount} 行。`);
      return getDouyinCrawlerTask();
    }

    throw new Error("当前没有正在运行的采集任务。");
  }

  task.status = "stopped";
  task.stage = "done";
  task.finishedAt = new Date().toISOString();
  task.error = "";
  const removedCount = cleanupStoppedTaskRows(task);
  pushLog(task, `正在停止采集任务，已清理本次未完成数据 ${removedCount} 行。`);

  try {
    task.process.kill("SIGTERM");
  } catch (error) {
    pushLog(task, `停止失败：${error instanceof Error ? error.message : "未知错误"}`);
  }

  return getDouyinCrawlerTask();
}
