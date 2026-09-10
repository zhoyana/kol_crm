import os from "node:os";
import process from "node:process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const workerId = process.env.AGENT_WORKER_ID || `${os.hostname()}-${process.pid}`;
const appBaseUrl = (process.env.APP_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const pollMs = Math.max(1000, Number(process.env.AGENT_WORKER_POLL_MS || 2000));
const leaseMs = Math.max(30000, Number(process.env.AGENT_WORKER_LEASE_MS || 60000));
const heartbeatMs = Math.min(leaseMs / 2, Math.max(5000, Number(process.env.AGENT_WORKER_HEARTBEAT_MS || 15000)));
const homepageBacklogLimit = Math.min(30, Math.max(5, Number(process.env.AGENT_HOMEPAGE_BACKLOG_LIMIT || 15)));
const newCandidateLimit = Math.min(50, Math.max(5, Number(process.env.AGENT_NEW_CANDIDATE_LIMIT || 20)));
const stages = ["crawling", "discovering", "importing", "profiling", "reviewing", "outreach_ready"];
let shuttingDown = false;
let activeAgentDeviceId = "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = () => new Date().toISOString();

class StopRun extends Error {
  constructor(reason, message) { super(message); this.reason = reason; }
}

async function requestJson(path, init) {
  const headers = { ...(init?.headers || {}) };
  if (activeAgentDeviceId) headers["x-kol-agent-id"] = activeAgentDeviceId;
  const response = await fetch(`${appBaseUrl}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${path} 请求失败（${response.status}）`);
  return data;
}

async function claimNextRun() {
  // Worker 在收到取消请求后异常退出时，任务可能永久停在 stopping。
  // 新 Worker 轮询时先收口已过租约的停止中任务，避免页面一直显示“正在停止”。
  const staleStopping = await prisma.agentRun.findFirst({
    where: {
      status: "stopping",
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }]
    },
    select: { id: true }
  });
  if (staleStopping) {
    const now = new Date();
    await prisma.$transaction([
      prisma.agentRun.update({
        where: { id: staleStopping.id },
        data: {
          status: "stopped", stage: "stopped", stopReason: "cancelled",
          message: "Agent 已停止。", finishedAt: now,
          workerId: null, lockedAt: null, leaseExpiresAt: null, lastHeartbeatAt: null,
          version: { increment: 1 }
        }
      }),
      prisma.agentRunStep.updateMany({
        where: { agentRunId: staleStopping.id, status: "running" },
        data: { status: "stopped", finishedAt: now, detail: "Agent 已停止" }
      }),
      prisma.agentRunRound.updateMany({
        where: { agentRunId: staleStopping.id, status: "running" },
        data: { status: "stopped", stopReason: "cancelled", finishedAt: now }
      })
    ]);
  }

  const candidate = await prisma.agentRun.findFirst({
    where: {
      OR: [
        { status: "queued", OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }] },
        { status: "running", leaseExpiresAt: { lt: new Date() }, retryCount: { lt: 2 } }
      ]
    },
    orderBy: [{ createdAt: "asc" }]
  });
  if (!candidate) return null;
  const now = new Date();
  const claimed = await prisma.agentRun.updateMany({
    where: {
      id: candidate.id,
      OR: [
        { status: "queued", workerId: null },
        { status: "running", leaseExpiresAt: { lt: now } }
      ]
    },
    data: {
      status: "running",
      workerId,
      lockedAt: now,
      lastHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      startedAt: candidate.startedAt || now,
      retryCount: candidate.status === "running" ? { increment: 1 } : candidate.retryCount,
      error: null,
      version: { increment: 1 }
    }
  });
  if (claimed.count !== 1) return null;
  return prisma.agentRun.findUnique({ where: { id: candidate.id }, include: { campaignTask: { include: { brandLibrary: true } }, steps: true } });
}

async function heartbeat(runId) {
  const now = new Date();
  await prisma.agentRun.updateMany({
    where: { id: runId, workerId, status: { in: ["running", "paused", "stopping"] } },
    data: { lastHeartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + leaseMs), version: { increment: 1 } }
  });
}

async function controlPoint(runId, startedAt, maxDurationMinutes) {
  while (true) {
    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      select: { pauseRequestedAt: true, cancelRequestedAt: true, status: true, workerId: true }
    });
    if (!run || run.workerId !== workerId) throw new StopRun("lease_lost", "Worker 已失去任务租约。");
    if (run.cancelRequestedAt || run.status === "stopping") throw new StopRun("cancelled", "用户已取消本次 Agent 运行。");
    if (Date.now() - startedAt.getTime() >= maxDurationMinutes * 60000) {
      throw new StopRun("time_limit_reached", "已达到最长运行时间，Agent 已安全停止。");
    }
    if (!run.pauseRequestedAt && run.status !== "paused") return;
    await prisma.agentRun.updateMany({ where: { id: runId, workerId }, data: { status: "paused", message: "Agent 已暂停，等待继续。" } });
    await heartbeat(runId);
    await sleep(2000);
  }
}

async function patchRun(runId, data) {
  return prisma.agentRun.update({
    where: { id: runId },
    data: { ...data, version: { increment: 1 } }
  });
}

async function appendLog(runId, message) {
  const current = await prisma.agentRun.findUnique({ where: { id: runId }, select: { logs: true } });
  const logs = Array.isArray(current?.logs) ? current.logs.map(String) : [];
  logs.push(`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${message}`);
  await prisma.agentRun.update({ where: { id: runId }, data: { logs: logs.slice(-80), version: { increment: 1 } } });
}

async function enterStep(runId, stage, message, total = 0) {
  await appendLog(runId, message);
  const now = new Date();
  await prisma.$transaction([
    prisma.agentRun.update({ where: { id: runId }, data: { stage, status: "running", message, completed: 0, total, error: null, version: { increment: 1 } } }),
    prisma.agentRunStep.upsert({
      where: { agentRunId_stage: { agentRunId: runId, stage } },
      create: { agentRunId: runId, stage, status: "running", completed: 0, total, detail: message, startedAt: now },
      update: { status: "running", completed: 0, total, detail: message, startedAt: now, finishedAt: null }
    })
  ]);
}

async function progress(runId, stage, completed, total, detail, results, extra = {}) {
  await prisma.$transaction([
    prisma.agentRun.update({ where: { id: runId }, data: { completed, total, message: detail, ...extra, version: { increment: 1 } } }),
    prisma.agentRunStep.update({
      where: { agentRunId_stage: { agentRunId: runId, stage } },
      data: { completed, total, detail, ...(results ? { results } : {}) }
    })
  ]);
}

async function finishStep(runId, stage, detail, completed, total, results) {
  await appendLog(runId, detail);
  await prisma.$transaction([
    prisma.agentRun.update({ where: { id: runId }, data: { completed, total, message: detail, version: { increment: 1 } } }),
    prisma.agentRunStep.update({
      where: { agentRunId_stage: { agentRunId: runId, stage } },
      data: { status: "success", completed, total, detail, results: results || undefined, finishedAt: new Date() }
    })
  ]);
}

async function loadQueueIds(campaignTaskId, stage) {
  const data = await requestJson(`/api/creators/review?campaignTaskId=${campaignTaskId}&stage=${stage}`);
  if (stage === "reviewing" && Array.isArray(data.creators)) {
    const ids = data.creators
      .filter((creator) => creator.poolStatus === "candidate" && creator.screeningStatus === "portrait_passed")
      .map((creator) => String(creator.externalId || creator.id || ""))
      .filter(Boolean);
    console.log(`[agent-worker] 复筛队列：API=${data.creators.length}，待晋升=${ids.length}`);
    return ids;
  }
  if (stage === "profiling" && Array.isArray(data.creators)) {
    // Manual rechecks are targeted repair requests. Process them before the
    // passive backlog so the requested creators are not displaced by older
    // unrelated pending profiles.
    return [...data.creators]
      // Legacy teaching-mode imports only contain an irreversible creator hash.
      // They cannot be homepage-profiled and must not consume every new run's
      // inventory budget ahead of newly collected, addressable creators.
      .filter((creator) =>
        String(creator.profileUrl || "").includes("/user/") ||
        !String(creator.externalId || "").startsWith("douyin-")
      )
      .sort((left, right) =>
        Number(right.screeningStatus === "manual_recheck") - Number(left.screeningStatus === "manual_recheck")
      )
      .map((creator) => String(creator.externalId || creator.id || ""))
      .filter(Boolean);
  }
  return Array.isArray(data.ids) ? data.ids.map(String).filter(Boolean) : [];
}

function termsFromText(value) {
  return String(value || "").split(/[,，、\n]/).map((item) => item.trim()).filter((item) => item.length >= 2);
}

async function runAgent(run) {
  activeAgentDeviceId = String(run.agentDeviceId || "");
  const task = run.campaignTask;
  const startedAt = run.startedAt || new Date();
  let startIndex = Math.max(0, stages.indexOf(run.startStage || "crawling"));
  const keywords = Array.isArray(task.seedKeywords) && task.seedKeywords.length ? task.seedKeywords.map(String) : [task.name];
  let currentRound = Math.max(1, Number(run.currentRound || 1));
  let noGrowthRounds = Math.max(0, Number(run.noGrowthRounds || 0));
  let candidates = [];
  let importedIds = Array.isArray(run.importedIds) ? run.importedIds.map(String) : [];
  let currentPortraitPassedIds = [];
  let aiCalls = Number(run.aiCalls || 0);
  let collectedWorks = Number(run.collectedWorks || 0);
  let featuredAdded = Number(run.featuredAdded || 0);
  let forcedKeyword = "";
  let inventoryPreflightPending = startIndex === 0 && currentRound === 1 && featuredAdded === 0;
  let inventoryFirstRound = false;
  const { resolveDiscoveryRuleTemplate } = await import("../lib/discovery-rule-templates.ts");
  const metricTemplate = resolveDiscoveryRuleTemplate(task).metricRules;
  const metricOverride = run.metricRules?.useCustom ? run.metricRules : null;
  const baseMetricRules = metricOverride ? {
    requireAvgLikes: Boolean(metricOverride.requireAvgLikes),
    avgLikesThreshold: Number(metricOverride.avgLikesThreshold),
    requireViralWorks: Boolean(metricOverride.requireViralWorks),
    viralLikesThreshold: Number(metricOverride.viralLikesThreshold),
    minViralWorks: Number(metricOverride.minViralWorks),
    requireSampleWorks: Boolean(metricOverride.requireSampleWorks),
    minSampleWorks: Number(metricOverride.minSampleWorks),
    requireRecentUpdate: Boolean(metricOverride.requireRecentUpdate),
    matchMode: metricOverride.matchMode === "all" ? "all" : "any"
  } : metricTemplate;
  const isXhsTask = /小红书|xhs/i.test(String(task.platform || ""));
  const activeMetricRules = isXhsTask
    ? {
        ...baseMetricRules,
        avgLikesThreshold: Math.min(100, Number(baseMetricRules.avgLikesThreshold || 100)),
        viralLikesThreshold: Math.min(500, Number(baseMetricRules.viralLikesThreshold || 500))
      }
    : baseMetricRules;

  const timer = setInterval(() => void heartbeat(run.id).catch(() => {}), heartbeatMs);
  try {
    while (true) {
    if (inventoryPreflightPending) {
      inventoryPreflightPending = false;
      const pendingPortraitIds = await loadQueueIds(task.id, "profiling");
      const pendingMetricIds = await loadQueueIds(task.id, "reviewing");
      if (pendingPortraitIds.length) {
        startIndex = 3;
        inventoryFirstRound = true;
        await appendLog(run.id, `库存优先：发现待画像 ${pendingPortraitIds.length} 人、画像已通过待筛选 ${pendingMetricIds.length} 人，首轮跳过新采集。`);
      } else if (pendingMetricIds.length) {
        startIndex = 4;
        inventoryFirstRound = true;
        await appendLog(run.id, `库存优先：发现画像已通过待筛选 ${pendingMetricIds.length} 人，首轮直接执行数据门槛。`);
      } else {
        await appendLog(run.id, "库存优先检查完成：当前没有待画像或待筛选达人，开始关键词采集。");
      }
    }
    const roundKeyword = forcedKeyword || keywords[(currentRound - 1) % keywords.length];
    forcedKeyword = "";
    const roundStartedAt = new Date();
    const roundAiCallsAtStart = aiCalls;
    const collectedWorksAtStart = collectedWorks;
    let roundPortraitPassed = 0;
    let roundPortraitProcessed = 0;
    let roundPortraitInsufficient = 0;
    let roundPortraitIncomplete = 0;
    let roundPortraitRejected = 0;
    let crawlTaskId = "";
    candidates = [];
    importedIds = startIndex >= 2 ? importedIds : [];
    currentPortraitPassedIds = [];
    await prisma.agentRunRound.upsert({
      where: { agentRunId_roundNumber: { agentRunId: run.id, roundNumber: currentRound } },
      create: { agentRunId: run.id, roundNumber: currentRound, keyword: roundKeyword, startStage: stages[startIndex] || "crawling", status: "running", startedAt: roundStartedAt },
      update: { keyword: roundKeyword, startStage: stages[startIndex] || "crawling", status: "running", error: null, finishedAt: null }
    });
    await patchRun(run.id, { currentRound, message: `第 ${currentRound} 轮开始，关键词：${roundKeyword}` });
    await appendLog(run.id, `第 ${currentRound} 轮开始，关键词：${roundKeyword}`);
    if (startIndex <= 0) {
      await controlPoint(run.id, startedAt, run.maxDurationMinutes);
      await enterStep(run.id, "crawling", "正在启动关键词采集…", 1);
      const platformKey = /小红书|xhs/i.test(String(task.platform || "")) ? "xhs" : "douyin";
      // maxCollectedWorks is the per-keyword collection limit shown in the UI,
      // not a cumulative run budget. The run-level safety limits remain AI,
      // duration, max rounds, and the target count.
      const remainingCollectionBudget = Math.max(1, Number(run.maxCollectedWorks || 1));
      const startedCrawler = await requestJson(`/api/crawler/${platformKey}/start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: roundKeyword,
          // XHS is deliberately collected in small batches. The run-level
          // budget can still be 100+, but each original keyword only keeps the
          // signed-in browser active for about 25 notes before profiling work
          // creates a natural cooling-off period.
          maxNotes: platformKey === "xhs"
            ? Math.min(25, remainingCollectionBudget)
            : Math.min(300, remainingCollectionBudget),
          discoveryMode: "single",
          restartCdpBeforeSpawn: platformKey !== "xhs",
          topicLimit: 3, publishWindowDays: 180, sortBy: "relevance",
          topicRules: { primaryTerms: task.seedKeywords, supportTerms: task.productSellingPoints, excludeTerms: task.excludeKeywords }
        })
      });
      crawlTaskId = String(startedCrawler?.id || "");
      while (true) {
        await controlPoint(run.id, startedAt, run.maxDurationMinutes);
        const crawler = await requestJson(`/api/crawler/${platformKey}/status`);
        collectedWorks = collectedWorksAtStart + Number(crawler.collectedWorks || 0);
        const detail = Array.isArray(crawler.logs) && crawler.logs.length ? String(crawler.logs.at(-1)) : `采集状态：${crawler.status}`;
        await progress(run.id, "crawling", crawler.status === "succeeded" ? 1 : 0, 1, detail,
          [{ label: "已采集作品", value: collectedWorks, tone: "success" }], { collectedWorks });
        if (crawler.status === "succeeded") break;
        if (["failed", "stopped"].includes(crawler.status)) throw new Error(crawler.error || `采集任务状态：${crawler.status}`);
        await sleep(2000);
      }
      await finishStep(run.id, "crawling", `关键词“${roundKeyword}”采集完成，本轮获得 ${collectedWorks - collectedWorksAtStart} 个作品`, 1, 1,
        [{ label: "本轮采集作品", value: collectedWorks - collectedWorksAtStart, tone: "success" }]);
    }

    if (startIndex <= 1) {
      await controlPoint(run.id, startedAt, run.maxDurationMinutes);
      await enterStep(run.id, "discovering", "正在从采集结果聚合候选达人…", 1);
      const platformKey = /小红书|xhs/i.test(String(task.platform || "")) ? "xhs" : "douyin";
      const discovered = await requestJson(`/api/discover/${platformKey}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: roundKeyword,
          crawlTaskId: platformKey === "xhs" ? crawlTaskId : undefined,
          campaignTaskId: task.id,
          filters: { publishWindowDays: 180, sortBy: "relevance", primaryTerms: [...task.seedKeywords, ...termsFromText(task.targetAudience), ...termsFromText(task.targetDescription)], supportTerms: task.productSellingPoints, excludeTerms: task.excludeKeywords, useAiWorkFilter: true }
        })
      });
      candidates = Array.isArray(discovered.candidates) ? discovered.candidates : [];
      if (candidates.length > newCandidateLimit) {
        const discoveredTotal = candidates.length;
        candidates = candidates.slice(0, newCandidateLimit);
        await appendLog(
          run.id,
          `本轮聚合出 ${discoveredTotal} 位新候选，按优先顺序仅让前 ${candidates.length} 人进入导入与主页画像，其余候选留待后续轮次。`
        );
      }
      if (!candidates.length) {
        const rawCandidateCount = Number(discovered.stats?.rawCandidateCount || 0);
        const hiddenExistingCount = Number(discovered.stats?.hiddenExistingCount || 0);
        const intentFilteredCount = Number(discovered.stats?.intentFilteredCount || 0);
        const emptyDetail = intentFilteredCount > 0
          ? `聚合出 ${rawCandidateCount} 位作者，但 ${intentFilteredCount} 位均未通过达人身份画像门槛；本轮新增候选 0 人。`
          : rawCandidateCount > 0 && hiddenExistingCount >= rawCandidateCount
          ? `聚合出 ${rawCandidateCount} 位达人，但均已存在于达人库；本轮新增候选 0 人。`
          : `达人聚合完成，本轮没有符合条件的新候选。`;
        await finishStep(run.id, "discovering", emptyDetail, 1, 1, [
          { label: "聚合达人", value: rawCandidateCount, tone: "neutral" },
          { label: "画像身份排除", value: intentFilteredCount, tone: intentFilteredCount ? "danger" : "neutral" },
          { label: "历史达人", value: hiddenExistingCount, tone: "neutral" },
          { label: "新增候选", value: 0, tone: "warning" }
        ]);
        for (const skippedStage of ["importing", "profiling", "reviewing", "outreach_ready"]) {
          await prisma.agentRunStep.update({
            where: { agentRunId_stage: { agentRunId: run.id, stage: skippedStage } },
            data: { status: "success", completed: 0, total: 0, detail: "本轮无新增候选，已跳过。", results: [], finishedAt: new Date() }
          });
        }
        noGrowthRounds += 1;
        const roundLimitReached = currentRound >= run.maxRounds;
        const noGrowthReached = noGrowthRounds >= run.maxNoGrowthRounds
          && currentRound >= Math.min(run.maxRounds, keywords.length);
        const collectionLimitReached = false;
        const stopReason = collectionLimitReached ? "collection_budget_reached" : roundLimitReached ? "max_rounds_reached" : noGrowthReached ? "no_growth_limit_reached" : null;
        const decision = stopReason
          ? collectionLimitReached
            ? `已达到采集作品上限 ${run.maxCollectedWorks}，本轮结束。`
            : roundLimitReached
            ? `已完成最大 ${run.maxRounds} 轮，本轮无新增候选。`
            : `连续 ${noGrowthRounds} 轮没有新增精选，已按停止条件结束。`
          : `本轮没有新候选，自动切换下一个关键词继续。`;
        await prisma.agentRunRound.update({
          where: { agentRunId_roundNumber: { agentRunId: run.id, roundNumber: currentRound } },
          data: {
            status: stopReason ? "stopped" : "completed",
            collectedWorks: collectedWorks - collectedWorksAtStart,
            candidatesFound: 0,
            importedCount: 0,
            aiCalls: 0,
            portraitPassed: 0,
            featuredAdded: 0,
            featuredTotal: featuredAdded,
            decision,
            stopReason,
            strategyStatus: "skipped",
            strategyError: "本轮无新增候选，未调用策略模型。",
            finishedAt: new Date()
          }
        });
        await appendLog(run.id, `${emptyDetail}${decision}`);
        if (stopReason) {
          await patchRun(run.id, {
            status: "stopped", stage: "stopped", message: decision, collectedWorks, featuredAdded, noGrowthRounds,
            stopReason, finishedAt: new Date(), workerId: null, leaseExpiresAt: null, lastHeartbeatAt: new Date()
          });
          break;
        }
        currentRound += 1;
        startIndex = 0;
        await prisma.agentRunStep.updateMany({
          where: { agentRunId: run.id },
          data: { status: "waiting", completed: 0, total: 0, detail: `等待第 ${currentRound} 轮`, results: [], startedAt: null, finishedAt: null }
        });
        await patchRun(run.id, { currentRound, noGrowthRounds, collectedWorks, stage: "idle", completed: 0, total: 0, message: decision });
        continue;
      }
      await finishStep(run.id, "discovering", `聚合出 ${candidates.length} 位候选达人`, candidates.length, candidates.length,
        [{ label: "聚合达人", value: candidates.length, tone: "success" }]);
    }

    if (startIndex <= 2) {
      await controlPoint(run.id, startedAt, run.maxDurationMinutes);
      if (!candidates.length) throw new Error("没有可导入候选，请从达人聚合步骤重试。");
      await enterStep(run.id, "importing", "正在建立主页样本与画像队列…", candidates.length);
      const platformKey = /小红书|xhs/i.test(String(task.platform || "")) ? "xhs" : "douyin";
      const imported = await requestJson(`/api/discover/${platformKey}/import`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidates, campaignTaskId: task.id })
      });
      importedIds = candidates.map((candidate) => String(candidate.externalId)).filter(Boolean);
      await patchRun(run.id, { importedIds });
      await finishStep(run.id, "importing", `已建立画像队列 ${importedIds.length} 人`, importedIds.length, importedIds.length, [
        { label: "新加入", value: Number(imported.imported || 0), tone: "success" },
        { label: "已存在更新", value: Number(imported.updated || 0), tone: "neutral" },
        { label: "关联任务", value: Number(imported.campaignTaskLinked || importedIds.length), tone: "success" }
      ]);
    }

    let profileIds = startIndex === 3 ? await loadQueueIds(task.id, "profiling") : importedIds;
    if (startIndex === 3 && profileIds.length > homepageBacklogLimit) {
      const backlogTotal = profileIds.length;
      profileIds = profileIds.slice(0, homepageBacklogLimit);
      await appendLog(
        run.id,
        `历史主页补齐队列共 ${backlogTotal} 人，本轮限量处理 ${profileIds.length} 人，剩余 ${backlogTotal - profileIds.length} 人留待后续运行。`
      );
    }
    if (startIndex <= 3) {
      if (!profileIds.length) throw new Error("当前品类没有等待补齐主页样本或 AI 画像的达人。");
      await enterStep(run.id, "profiling", "正在补齐主页样本并执行 AI 作品画像初筛…", profileIds.length);
      let completed = 0, portraitPassed = 0, insufficient = 0, crawlIncomplete = 0, rejected = 0, failed = 0, totalSamples = 0;
      for (let index = 0; index < profileIds.length;) {
        await controlPoint(run.id, startedAt, run.maxDurationMinutes);
        const remaining = run.maxAiCalls - aiCalls;
        if (remaining <= 0) throw new StopRun("ai_budget_reached", "已达到 AI 调用上限，Agent 已安全停止。");
        const allowFullRetry = remaining >= 2;
        const safeBatchSize = allowFullRetry ? Math.max(1, Math.min(5, Math.floor(remaining / 2))) : 1;
        const batch = profileIds.slice(index, index + safeBatchSize);
        await patchRun(run.id, { message: `正在补齐主页样本：${completed}/${profileIds.length}` });
        const portraitPlatform = /小红书|xhs/i.test(String(task.platform || "")) ? "xhs" : "douyin";
        const profiled = await requestJson(`/api/review/${portraitPlatform}/batch`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "portrait",
            ids: batch,
            campaignTaskId: task.id,
            agentRunId: run.id,
            workLimit: Math.min(12, Math.max(10, Number(process.env.AGENT_HOMEPAGE_WORK_LIMIT || 12))),
            allowFullRetry,
            skipObviousMismatch: true
          })
        });
        const resultRows = Array.isArray(profiled.results) ? profiled.results : [];
        const actualAiCalls = Math.max(0, Number(profiled.aiCalls ?? resultRows.reduce((sum, item) => sum + Number(item.aiCalls || 0), 0)));
        aiCalls += actualAiCalls;
        currentPortraitPassedIds.push(...resultRows
          .filter((item) => item.ok && item.poolStatus === "candidate" && item.screeningStatus === "portrait_passed")
          .map((item) => String(item.externalId))
          .filter(Boolean));
        portraitPassed += resultRows.filter((item) => item.poolStatus === "candidate" && item.screeningStatus === "portrait_passed").length;
        insufficient += resultRows.filter((item) => item.screeningStatus === "portrait_insufficient").length;
        crawlIncomplete += resultRows.filter((item) => String(item.screeningStatus).includes("incomplete") || (item.poolStatus === "pending_review" && item.screeningStatus !== "portrait_insufficient")).length;
        rejected += resultRows.filter((item) => ["rejected", "skipped"].includes(String(item.poolStatus))).length;
        failed += resultRows.filter((item) => item.error).length;
        totalSamples += resultRows.reduce((sum, item) => sum + Number(item.sampleWorkCount || 0), 0);
        completed += batch.length;
        index += batch.length;
        await progress(run.id, "profiling", completed, profileIds.length, `已处理 ${completed}/${profileIds.length} 人`, [
          { label: "主页作品样本", value: totalSamples, tone: "neutral" }, { label: "画像通过", value: portraitPassed, tone: "success" },
          { label: "信息不足待补采", value: insufficient, tone: "warning" }, { label: "采集不完整", value: crawlIncomplete, tone: "danger" },
          { label: "画像排除", value: rejected, tone: "danger" }, { label: "失败", value: failed, tone: "warning" }
        ], { aiCalls });
        if (aiCalls >= run.maxAiCalls && index < profileIds.length) throw new StopRun("ai_budget_reached", "已达到 AI 调用上限，Agent 已安全停止。");
      }
      await finishStep(run.id, "profiling", `主页样本与 AI 画像完成，共处理 ${profileIds.length} 人`, profileIds.length, profileIds.length, [
        { label: "主页作品样本", value: totalSamples, tone: "neutral" }, { label: "本轮新进入待选", value: portraitPassed, tone: "success" },
        { label: "信息不足待补采", value: insufficient, tone: "warning" }, { label: "采集不完整", value: crawlIncomplete, tone: "danger" },
        { label: "画像排除", value: rejected, tone: "danger" }
      ]);
      roundPortraitPassed = portraitPassed;
      roundPortraitProcessed = profileIds.length;
      roundPortraitInsufficient = insufficient;
      roundPortraitIncomplete = crawlIncomplete;
      roundPortraitRejected = rejected;
    }

    const usesHistoricalReviewQueue = startIndex >= 4 || inventoryFirstRound;
    const metricIds = usesHistoricalReviewQueue ? await loadQueueIds(task.id, "reviewing") : currentPortraitPassedIds;
    await enterStep(run.id, "reviewing", "正在读取已记录指标并应用数据门槛…", metricIds.length);
    let completed = 0, succeeded = 0, failed = 0, featured = 0, rejected = 0, pending = 0;
    for (let index = 0; index < metricIds.length; index += 30) {
      await controlPoint(run.id, startedAt, run.maxDurationMinutes);
      const batch = metricIds.slice(index, index + 30);
      const reviewed = await requestJson("/api/review/douyin/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: batch, campaignTaskId: task.id, mode: "metrics", rules: {
          requireAvgLikes500: activeMetricRules.requireAvgLikes, avgLikesThreshold: activeMetricRules.avgLikesThreshold,
          requireViral2000: activeMetricRules.requireViralWorks, viralLikesThreshold: activeMetricRules.viralLikesThreshold,
          minViralWorks: activeMetricRules.minViralWorks, requireWorkCount10: activeMetricRules.requireSampleWorks,
          minSampleWorks: activeMetricRules.minSampleWorks, metricMatchMode: activeMetricRules.matchMode,
          requireRecentViral: false, requireRecentUpdate: activeMetricRules.requireRecentUpdate
        } })
      });
      const resultRows = Array.isArray(reviewed.results) ? reviewed.results : [];
      succeeded += Number(reviewed.succeeded || 0); failed += Number(reviewed.failed || 0);
      featured += resultRows.filter((item) => item.ok && item.poolStatus === "featured" && !item.wasFeatured).length;
      rejected += resultRows.filter((item) => item.skipped || ["skipped", "rejected"].includes(String(item.poolStatus))).length;
      pending += resultRows.filter((item) => item.ok && !["featured", "skipped", "rejected"].includes(String(item.poolStatus))).length;
      completed += batch.length;
      await progress(run.id, "reviewing", completed, metricIds.length, `已完成 ${completed}/${metricIds.length} 人`, [
        { label: usesHistoricalReviewQueue ? "历史待选参与复筛" : "本轮新待选参与复筛", value: metricIds.length, tone: "neutral" },
        { label: "规则已执行", value: succeeded, tone: "success" }, { label: "进入精选", value: featured, tone: "success" },
        { label: "留待选", value: pending, tone: "neutral" }, { label: "画像未通过", value: rejected, tone: "danger" },
        { label: "失败", value: failed, tone: "warning" }
      ], { featuredAdded: featuredAdded + featured });
    }
    await finishStep(run.id, "reviewing", `数据门槛筛选完成，共处理 ${metricIds.length} 人`, metricIds.length, metricIds.length, [
      { label: usesHistoricalReviewQueue ? "历史待选参与复筛" : "本轮新待选参与复筛", value: metricIds.length, tone: "neutral" },
      { label: "规则已执行", value: succeeded, tone: "success" }, { label: "进入精选", value: featured, tone: "success" },
      { label: "留待选", value: pending, tone: "neutral" }, { label: "画像未通过", value: rejected, tone: "danger" }, { label: "失败", value: failed, tone: "warning" }
    ]);

    await controlPoint(run.id, startedAt, run.maxDurationMinutes);
    await enterStep(run.id, "outreach_ready", "正在生成建联队列…", 1);
    await finishStep(run.id, "outreach_ready", "建联队列已生成", 1, 1, [{ label: "待建联达人", value: featured, tone: "success" }]);
    const maintenanceCycle = inventoryFirstRound;
    featuredAdded += featured;
    if (!maintenanceCycle) noGrowthRounds = featured === 0 ? noGrowthRounds + 1 : 0;
    const targetReached = featuredAdded >= run.targetFeaturedCount;
    const roundLimitReached = !maintenanceCycle && currentRound >= run.maxRounds;
    const noGrowthReached = !maintenanceCycle
      && noGrowthRounds >= run.maxNoGrowthRounds
      && currentRound >= Math.min(run.maxRounds, keywords.length);
    const collectionLimitReached = false;
    let stopReason = targetReached ? "target_reached" : collectionLimitReached ? "collection_budget_reached" : roundLimitReached ? "max_rounds_reached" : noGrowthReached ? "no_growth_limit_reached" : null;
    let decision = maintenanceCycle && !targetReached
      ? `库存维护完成，本次不计入业务轮次或连续无增长次数；继续执行第 ${currentRound} 轮关键词采集。`
      : collectionLimitReached
      ? `已达到采集作品上限 ${run.maxCollectedWorks}，本轮结束。`
      : stopReason
      ? targetReached ? `累计新增精选 ${featuredAdded} 人，达到目标。` : roundLimitReached ? `已完成最多 ${run.maxRounds} 轮。` : `连续 ${noGrowthRounds} 轮没有新增精选。`
      : `目标尚缺 ${Math.max(0, run.targetFeaturedCount - featuredAdded)} 人，切换下一个关键词继续。`;
    let strategyData = { strategyStatus: "skipped", strategyError: null };
    let resolvedStrategy = null;
    try {
      const { generateAgentStrategy, resolveAgentStrategyExecution } = await import("../lib/agent-strategy.ts");
      const strategyInput = {
        brandName: task.brandLibrary?.name || "",
        campaignTaskName: task.name,
        productName: task.productName,
        targetAudience: task.targetAudience,
        targetDescription: task.targetDescription,
        excludeKeywords: task.excludeKeywords,
        seedKeywords: keywords,
        targetFeaturedCount: run.targetFeaturedCount,
        maxAiCalls: run.maxAiCalls,
        maxDurationMinutes: run.maxDurationMinutes,
        maxNoGrowthRounds: run.maxNoGrowthRounds,
        maxRounds: run.maxRounds,
        currentRound,
        cumulativeFeatured: featuredAdded,
        cumulativeAiCalls: aiCalls,
        elapsedMinutes: Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 6000) / 10),
        noGrowthRounds,
        keyword: roundKeyword,
        collectedWorks: collectedWorks - collectedWorksAtStart,
        candidatesFound: candidates.length,
        importedCount: importedIds.length,
        portraitProcessed: roundPortraitProcessed,
        roundAiCalls: aiCalls - roundAiCallsAtStart,
        portraitPassed: roundPortraitPassed,
        portraitInsufficient: roundPortraitInsufficient,
        portraitIncomplete: roundPortraitIncomplete,
        portraitRejected: roundPortraitRejected,
        featuredAdded: featured,
        usedKeywords: Array.from({ length: currentRound }, (_, index) => keywords[index % keywords.length]),
        unusedKeywords: keywords.filter((_, index) => index >= currentRound),
        deterministicDecision: decision,
        deterministicStopReason: stopReason
      };
      await appendLog(run.id, `观察完成：正在基于本轮证据选择唯一下一步动作…`);
      const strategy = await generateAgentStrategy(strategyInput);
      resolvedStrategy = resolveAgentStrategyExecution(strategy.decision, strategyInput);
      strategyData = {
        strategyStatus: "completed",
        strategyModel: strategy.model,
        strategyAction: strategy.decision.action,
        strategyConfidence: strategy.decision.confidence,
        strategyReason: strategy.decision.reason,
        strategyBenefit: strategy.decision.expected_benefit,
        strategyRisk: strategy.decision.risk,
        strategyScope: strategy.decision.execution_scope,
        strategyStopCondition: strategy.decision.stop_condition,
        strategyHumanMessage: strategy.decision.human_message,
        strategyInput,
        strategyOutput: strategy.raw,
        strategyError: null
      };
      await appendLog(run.id, `决策：${strategy.decision.action}；${resolvedStrategy.reason}`);
      if (resolvedStrategy.executable) {
        if (resolvedStrategy.mode === "stop") {
          stopReason = stopReason || `agent_${strategy.decision.action}`;
          decision = `Agent 验证后停止：${resolvedStrategy.reason}`;
        } else if (resolvedStrategy.mode === "retry") {
          decision = `Agent 将重试当前关键词：${resolvedStrategy.reason}`;
        } else if (resolvedStrategy.mode === "supplement") {
          decision = `Agent 下一轮先补采信息不足达人：${resolvedStrategy.reason}`;
        } else {
          decision = `Agent 将继续下一个关键词：${resolvedStrategy.reason}`;
        }
        await appendLog(run.id, `执行授权通过：${resolvedStrategy.mode}；将在本轮持久化后执行。`);
      } else {
        stopReason = "human_review_required";
        decision = `Agent 已暂停并请求人工复核：${resolvedStrategy.reason}`;
        await appendLog(run.id, `验证未通过自动执行门槛：${resolvedStrategy.reason}`);
      }
    } catch (strategyError) {
      const strategyMessage = strategyError instanceof Error ? strategyError.message : "策略模型调用失败";
      strategyData = { strategyStatus: "failed", strategyError: strategyMessage };
      await appendLog(run.id, `策略建议生成失败，不影响规则流程：${strategyMessage}`);
    }
    await prisma.agentRunRound.update({
      where: { agentRunId_roundNumber: { agentRunId: run.id, roundNumber: currentRound } },
      data: {
        status: stopReason ? "stopped" : "completed", collectedWorks: collectedWorks - collectedWorksAtStart,
        candidatesFound: candidates.length, importedCount: importedIds.length, aiCalls: aiCalls - roundAiCallsAtStart,
        portraitPassed: roundPortraitPassed, featuredAdded: featured, featuredTotal: featuredAdded,
        decision, stopReason, finishedAt: new Date(), ...strategyData
      }
    });
    await appendLog(run.id, `第 ${currentRound} 轮完成：新增精选 ${featured} 人。${decision}`);
    if (stopReason) {
      await patchRun(run.id, {
        status: "stopped", stage: "stopped", message: decision, featuredAdded, noGrowthRounds,
        stopReason, finishedAt: new Date(), workerId: null, leaseExpiresAt: null, lastHeartbeatAt: new Date()
      });
      break;
    }
    if (!maintenanceCycle) currentRound += 1;
    if (resolvedStrategy?.mode === "retry") forcedKeyword = roundKeyword;
    startIndex = resolvedStrategy?.mode === "supplement" ? 3 : 0;
    inventoryFirstRound = false;
    await prisma.agentRunStep.updateMany({
      where: { agentRunId: run.id },
      data: { status: "waiting", completed: 0, total: 0, detail: `等待第 ${currentRound} 轮`, results: [], startedAt: null, finishedAt: null }
    });
    await patchRun(run.id, { currentRound, noGrowthRounds, featuredAdded, stage: "idle", completed: 0, total: 0 });
    }
  } catch (error) {
    if (error instanceof StopRun) {
      await appendLog(run.id, `停止：${error.message}`);
      await prisma.agentRunRound.updateMany({ where: { agentRunId: run.id, roundNumber: currentRound }, data: { status: "stopped", stopReason: error.reason, decision: error.message, strategyStatus: "skipped", strategyError: "本轮流程提前停止，未生成策略建议。", finishedAt: new Date() } });
      await patchRun(run.id, { status: "stopped", stage: "stopped", message: error.message, stopReason: error.reason, featuredAdded, noGrowthRounds, finishedAt: new Date(), workerId: null, leaseExpiresAt: null });
    } else {
      const message = error instanceof Error ? error.message : "Agent Worker 执行失败";
      await appendLog(run.id, `失败：${message}`);
      await prisma.agentRunRound.updateMany({ where: { agentRunId: run.id, roundNumber: currentRound }, data: { status: "failed", error: message, decision: "本轮执行失败，等待从失败步骤重试。", strategyStatus: "skipped", strategyError: "本轮流程执行失败，未生成策略建议。", finishedAt: new Date() } });
      await patchRun(run.id, { status: "failed", stage: "failed", failedStage: stages.includes((await prisma.agentRun.findUnique({ where: { id: run.id }, select: { stage: true } }))?.stage) ? (await prisma.agentRun.findUnique({ where: { id: run.id }, select: { stage: true } })).stage : run.startStage, error: message, message: "执行失败，可以重新排队重试。", finishedAt: new Date(), workerId: null, leaseExpiresAt: null });
    }
  } finally {
    activeAgentDeviceId = "";
    clearInterval(timer);
  }
}

async function main() {
  console.log(`[agent-worker] ${workerId} 已启动，Web=${appBaseUrl}`);
  if (process.env.AGENT_WORKER_SMOKE === "1") {
    await prisma.agentRun.count();
    console.log("[agent-worker] 数据库连接与 Prisma 模型检查通过。");
    return;
  }
  while (!shuttingDown) {
    try {
      const run = await claimNextRun();
      if (run) await runAgent(run);
      else {
        await sleep(pollMs);
      }
    } catch (error) {
      console.error("[agent-worker] 循环异常：", error);
      await sleep(pollMs);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { shuttingDown = true; });
await main();
await prisma.$disconnect();
