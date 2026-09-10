import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_AGENT_GOAL, normalizeAgentGoal, normalizeAgentMetricRules, type AgentGoal, type AgentMetricRules } from "@/lib/agent-goals";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const workStages = ["crawling", "discovering", "importing", "profiling", "reviewing", "outreach_ready"] as const;
type WorkStage = (typeof workStages)[number];
const isWorkStage = (value: unknown): value is WorkStage =>
  typeof value === "string" && (workStages as readonly string[]).includes(value);
const runStages = new Set(["idle", ...workStages, "completed", "stopped", "failed"]);

type StepMetric = {
  startedAt?: string;
  finishedAt?: string;
  completed?: number;
  total?: number;
  detail?: string;
  results?: Array<{ label: string; value: number; tone?: string }>;
};

type PipelineSnapshot = {
  stage: string;
  failedStage?: string;
  message: string;
  completed: number;
  total: number;
  importedIds: string[];
  error: string;
  updatedAt: string;
  metrics: Record<string, StepMetric>;
  logs: string[];
  goal: AgentGoal;
  metricRules: AgentMetricRules | null;
  usage: {
    collectedWorks: number;
    aiCalls: number;
    currentRound: number;
    noGrowthRounds: number;
    featuredAtStart: number;
    featuredAdded: number;
    startedAt?: string;
    stopReason?: string;
  };
};

function cleanDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanSnapshot(value: any): PipelineSnapshot {
  const stage = runStages.has(String(value?.stage)) ? String(value.stage) : "idle";
  const failedStage = workStages.includes(value?.failedStage) ? String(value.failedStage) : undefined;
  const metrics = value?.metrics && typeof value.metrics === "object" ? value.metrics : {};
  const usage = value?.usage || {};
  return {
    stage,
    failedStage,
    message: String(value?.message || "等待启动完整流程").slice(0, 5000),
    completed: Math.max(0, Number(value?.completed || 0)),
    total: Math.max(0, Number(value?.total || 0)),
    importedIds: Array.isArray(value?.importedIds) ? value.importedIds.map(String).filter(Boolean).slice(0, 5000) : [],
    error: String(value?.error || "").slice(0, 10000),
    updatedAt: cleanDate(value?.updatedAt)?.toISOString() || new Date().toISOString(),
    metrics,
    logs: Array.isArray(value?.logs) ? value.logs.map(String).slice(-80) : [],
    goal: normalizeAgentGoal(value?.goal, DEFAULT_AGENT_GOAL),
    metricRules: normalizeAgentMetricRules(value?.metricRules),
    usage: {
      collectedWorks: Math.max(0, Number(usage.collectedWorks || 0)),
      aiCalls: Math.max(0, Number(usage.aiCalls || 0)),
      currentRound: Math.max(1, Number(usage.currentRound || 1)),
      noGrowthRounds: Math.max(0, Number(usage.noGrowthRounds || 0)),
      featuredAtStart: Math.max(0, Number(usage.featuredAtStart || 0)),
      featuredAdded: Math.max(0, Number(usage.featuredAdded || 0)),
      startedAt: cleanDate(usage.startedAt)?.toISOString(),
      stopReason: usage.stopReason ? String(usage.stopReason).slice(0, 100) : undefined
    }
  };
}

function runStatus(snapshot: PipelineSnapshot): string {
  if (snapshot.stage === "completed") return "completed";
  if (snapshot.stage === "failed") return "failed";
  if (snapshot.stage === "stopped") return "stopped";
  if (snapshot.stage === "idle") return "idle";
  return "running";
}

function stepStatus(snapshot: PipelineSnapshot, stage: string, metric: StepMetric): string {
  if (snapshot.stage === "failed" && snapshot.failedStage === stage) return "failed";
  if (snapshot.stage === stage) return "running";
  if (metric.finishedAt) return "success";
  return "waiting";
}

function stepData(snapshot: PipelineSnapshot, stage: string) {
  const metric = snapshot.metrics[stage] || {};
  return {
    stage,
    status: stepStatus(snapshot, stage, metric),
    completed: Math.max(0, Number(metric.completed || 0)),
    total: Math.max(0, Number(metric.total || 0)),
    detail: metric.detail ? String(metric.detail).slice(0, 10000) : null,
    results: Array.isArray(metric.results) ? metric.results : undefined,
    startedAt: cleanDate(metric.startedAt),
    finishedAt: cleanDate(metric.finishedAt)
  };
}

function serializeRun(run: any) {
  const metrics = Object.fromEntries(
    (run.steps || []).map((step: any) => [
      step.stage,
      {
        startedAt: step.startedAt?.toISOString?.(),
        finishedAt: step.finishedAt?.toISOString?.(),
        completed: step.completed,
        total: step.total,
        detail: step.detail || undefined,
        results: Array.isArray(step.results) ? step.results : undefined
      }
    ])
  );
  return {
    id: run.id,
    runKey: run.runKey,
    campaignTaskId: run.campaignTaskId,
    status: run.status,
    startStage: run.startStage,
    agentDeviceId: run.agentDeviceId || undefined,
    worker: {
      workerId: run.workerId || undefined,
      lastHeartbeatAt: run.lastHeartbeatAt?.toISOString?.(),
      leaseExpiresAt: run.leaseExpiresAt?.toISOString?.(),
      pauseRequested: Boolean(run.pauseRequestedAt),
      cancelRequested: Boolean(run.cancelRequestedAt)
    },
    version: run.version,
    rounds: (run.rounds || []).map((round: any) => ({
      id: round.id,
      roundNumber: round.roundNumber,
      keyword: round.keyword,
      status: round.status,
      startStage: round.startStage,
      collectedWorks: round.collectedWorks,
      candidatesFound: round.candidatesFound,
      importedCount: round.importedCount,
      aiCalls: round.aiCalls,
      portraitPassed: round.portraitPassed,
      featuredAdded: round.featuredAdded,
      featuredTotal: round.featuredTotal,
      decision: round.decision || undefined,
      stopReason: round.stopReason || undefined,
      error: round.error || undefined,
      strategy: round.strategyStatus ? {
        status: round.strategyStatus,
        model: round.strategyModel || undefined,
        action: round.strategyAction || undefined,
        confidence: round.strategyConfidence ?? undefined,
        reason: round.strategyReason || undefined,
        expectedBenefit: round.strategyBenefit || undefined,
        risk: round.strategyRisk || undefined,
        executionScope: round.strategyScope || undefined,
        stopCondition: round.strategyStopCondition || undefined,
        humanMessage: round.strategyHumanMessage || undefined,
        error: round.strategyError || undefined
      } : undefined,
      feedbacks: (round.feedbacks || []).map((feedback: any) => ({
        id: feedback.id,
        verdict: feedback.verdict,
        originalAction: feedback.originalAction || undefined,
        finalAction: feedback.finalAction || undefined,
        note: feedback.note || undefined,
        executionRequested: feedback.executionRequested,
        executionStatus: feedback.executionStatus,
        executionMessage: feedback.executionMessage || undefined,
        createdAt: feedback.createdAt?.toISOString?.()
      })),
      startedAt: round.startedAt?.toISOString?.(),
      finishedAt: round.finishedAt?.toISOString?.()
    })),
    state: {
      stage: run.stage,
      failedStage: run.failedStage || undefined,
      message: run.message,
      completed: run.completed,
      total: run.total,
      importedIds: Array.isArray(run.importedIds) ? run.importedIds : [],
      error: run.error || "",
      updatedAt: run.updatedAt?.toISOString?.() || "",
      metrics,
      logs: Array.isArray(run.logs) ? run.logs : []
      ,goal: normalizeAgentGoal({
        targetFeaturedCount: run.targetFeaturedCount,
        maxCollectedWorks: run.maxCollectedWorks,
        maxAiCalls: run.maxAiCalls,
        maxDurationMinutes: run.maxDurationMinutes,
        maxNoGrowthRounds: run.maxNoGrowthRounds,
        maxRounds: run.maxRounds
      }),
      metricRules: normalizeAgentMetricRules(run.metricRules),
      usage: {
        collectedWorks: run.collectedWorks,
        aiCalls: run.aiCalls,
        currentRound: run.currentRound,
        noGrowthRounds: run.noGrowthRounds,
        featuredAtStart: run.featuredAtStart,
        featuredAdded: run.featuredAdded,
        startedAt: run.startedAt?.toISOString?.(),
        stopReason: run.stopReason || undefined
      }
    }
  };
}

export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL 未配置。" }, { status: 503 });
  }
  const campaignTaskId = Number(request.nextUrl.searchParams.get("campaignTaskId") || 0);
  if (!Number.isInteger(campaignTaskId) || campaignTaskId <= 0) {
    return NextResponse.json({ error: "无效的品类任务。" }, { status: 400 });
  }
  // prisma singleton from import
  try {
    const run = await prisma.agentRun.findFirst({
      where: { campaignTaskId },
      include: { steps: true, rounds: { orderBy: { roundNumber: "asc" }, include: { feedbacks: { orderBy: { createdAt: "asc" } } } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
    });
    return NextResponse.json({ run: run ? serializeRun(run) : null });
  } finally {
    // prisma singleton — do not disconnect
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL 未配置。" }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as { campaignTaskId?: number; state?: unknown; enqueue?: boolean; startStage?: string; agentDeviceId?: string } | null;
  const campaignTaskId = Number(body?.campaignTaskId || 0);
  if (!Number.isInteger(campaignTaskId) || campaignTaskId <= 0) {
    return NextResponse.json({ error: "无效的品类任务。" }, { status: 400 });
  }
  const snapshot = cleanSnapshot(body?.state);
  const enqueue = body?.enqueue === true;
  const agentDeviceId = String(body?.agentDeviceId || "").trim() || null;
  const startStage = ["crawling", "discovering", "profiling", "reviewing"].includes(String(body?.startStage))
    ? String(body?.startStage)
    : "crawling";
  // prisma singleton from import
  try {
    if (enqueue) {
      if (process.env.LOCAL_AGENT_MODE === "queue") {
        if (!agentDeviceId) return NextResponse.json({ error: "请先启动并选择本机达人采集助手。" }, { status: 400 });
        const online = await prisma.localAgentDevice.findFirst({ where: { id: agentDeviceId, lastSeenAt: { gte: new Date(Date.now() - 45_000) } } });
        if (!online) return NextResponse.json({ error: "所选达人采集助手已离线，请重新启动 EXE。" }, { status: 409 });
      }
      const active = await prisma.agentRun.findFirst({
        where: { campaignTaskId, status: { in: ["queued", "running", "paused", "stopping"] } },
        include: { steps: true, rounds: { orderBy: { roundNumber: "asc" }, include: { feedbacks: { orderBy: { createdAt: "asc" } } } } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
      });
      if (active) {
        return NextResponse.json({ error: "这个品类任务已有后台 Agent 在运行。", run: serializeRun(active) }, { status: 409 });
      }
    }
    const run = await prisma.$transaction(async (tx: any) => {
      await tx.agentRun.updateMany({
        where: { campaignTaskId, status: { in: enqueue ? ["idle"] : ["idle", "queued", "running", "paused", "stopping"] } },
        data: { status: "superseded", finishedAt: new Date(), version: { increment: 1 } }
      });
      return tx.agentRun.create({
        data: {
          campaignTaskId,
          status: enqueue ? "queued" : runStatus(snapshot),
          stage: enqueue ? "idle" : snapshot.stage,
          startStage,
          agentDeviceId,
          failedStage: snapshot.failedStage || null,
          message: enqueue ? "任务已进入后台队列，等待 Worker 领取。" : snapshot.message,
          completed: snapshot.completed,
          total: snapshot.total,
          importedIds: snapshot.importedIds,
          error: snapshot.error || null,
          logs: snapshot.logs,
          targetFeaturedCount: snapshot.goal.targetFeaturedCount,
          maxCollectedWorks: snapshot.goal.maxCollectedWorks,
          maxAiCalls: snapshot.goal.maxAiCalls,
          maxDurationMinutes: snapshot.goal.maxDurationMinutes,
          maxNoGrowthRounds: snapshot.goal.maxNoGrowthRounds,
          maxRounds: snapshot.goal.maxRounds,
          metricRules: snapshot.metricRules || undefined,
          collectedWorks: snapshot.usage.collectedWorks,
          aiCalls: snapshot.usage.aiCalls,
          currentRound: snapshot.usage.currentRound,
          noGrowthRounds: snapshot.usage.noGrowthRounds,
          featuredAtStart: snapshot.usage.featuredAtStart,
          featuredAdded: snapshot.usage.featuredAdded,
          stopReason: snapshot.usage.stopReason || null,
          startedAt: enqueue ? null : cleanDate(snapshot.usage.startedAt) || (snapshot.stage === "idle" ? null : new Date()),
          finishedAt: ["completed", "stopped", "failed"].includes(snapshot.stage) ? new Date() : null,
          steps: { create: workStages.map((stage) => stepData(snapshot, stage)) }
        },
        include: { steps: true, rounds: { orderBy: { roundNumber: "asc" }, include: { feedbacks: { orderBy: { createdAt: "asc" } } } } }
      });
    });
    return NextResponse.json({ run: serializeRun(run) }, { status: 201 });
  } finally {
    // prisma singleton — do not disconnect
  }
}

export async function PATCH(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL 未配置。" }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as { runId?: number; version?: number; state?: unknown; action?: string } | null;
  const runId = Number(body?.runId || 0);
  const action = String(body?.action || "");
  if (Number.isInteger(runId) && runId > 0 && ["pause", "resume", "cancel", "retry"].includes(action)) {
    // prisma singleton from import
    try {
      const current = await prisma.agentRun.findUnique({ where: { id: runId }, include: { steps: true, rounds: { orderBy: { roundNumber: "asc" }, include: { feedbacks: { orderBy: { createdAt: "asc" } } } } } });
      if (!current) return NextResponse.json({ error: "运行记录不存在。" }, { status: 404 });
      const now = new Date();
      let data: any;
      if (action === "pause") data = { pauseRequestedAt: now, message: "已请求暂停；当前批次结束后暂停。" };
      if (action === "resume") data = { pauseRequestedAt: null, status: current.status === "paused" ? "running" : current.status, message: "已请求继续执行。" };
      if (action === "cancel") {
        const alreadyFinished = ["completed", "stopped", "failed", "superseded"].includes(current.status)
          || ["completed", "stopped", "failed"].includes(current.stage);
        data = alreadyFinished
          ? {
              status: current.stage === "stopped" ? "stopped" : current.status,
              message: current.message,
              stopReason: current.stopReason,
              finishedAt: current.finishedAt || now
            }
          : {
              cancelRequestedAt: now,
              status: current.status === "queued" ? "stopped" : "stopping",
              message: current.status === "queued" ? "后台任务已取消。" : "已请求取消；当前批次结束后停止。",
              stopReason: current.status === "queued" ? "cancelled" : current.stopReason,
              finishedAt: current.status === "queued" ? now : current.finishedAt
            };
      }
      if (action === "retry") {
        const unfinishedStage = current.steps.find((step: any) =>
          isWorkStage(step.stage) && ["running", "failed", "stopped"].includes(step.status)
        )?.stage;
        const retryStage = isWorkStage(current.failedStage)
          ? current.failedStage
          : isWorkStage(unfinishedStage)
            ? unfinishedStage
            : current.startStage;
        data = {
          status: "queued",
          stage: "idle",
          startStage: retryStage,
          failedStage: null,
          completed: 0,
          total: 0,
          error: null,
          message: `任务已从失败步骤“${retryStage}”重新进入后台队列。`,
          workerId: null,
          lockedAt: null,
          leaseExpiresAt: null,
          lastHeartbeatAt: null,
          pauseRequestedAt: null,
          cancelRequestedAt: null,
          nextRetryAt: null,
          stopReason: null,
          startedAt: null,
          finishedAt: null,
          ...(retryStage === "crawling" ? { collectedWorks: 0 } : {})
        };
        await prisma.agentRunStep.updateMany({
          where: { agentRunId: runId, stage: retryStage },
          data: { status: "waiting", completed: 0, total: 0, detail: "等待从失败步骤重试", results: [], startedAt: null, finishedAt: null }
        });
      }
      const updated = await prisma.agentRun.update({ where: { id: runId }, data: { ...data, version: { increment: 1 } }, include: { steps: true, rounds: { orderBy: { roundNumber: "asc" }, include: { feedbacks: { orderBy: { createdAt: "asc" } } } } } });
      return NextResponse.json({ run: serializeRun(updated) });
    } finally {
      // prisma singleton — do not disconnect
    }
  }
  const version = Number(body?.version || 0);
  if (!Number.isInteger(runId) || runId <= 0 || !Number.isInteger(version) || version <= 0) {
    return NextResponse.json({ error: "无效的运行记录。" }, { status: 400 });
  }
  const snapshot = cleanSnapshot(body?.state);
  // prisma singleton from import
  try {
    const run = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.agentRun.updateMany({
        where: { id: runId, version },
        data: {
          status: runStatus(snapshot),
          stage: snapshot.stage,
          failedStage: snapshot.failedStage || null,
          message: snapshot.message,
          completed: snapshot.completed,
          total: snapshot.total,
          importedIds: snapshot.importedIds,
          error: snapshot.error || null,
          logs: snapshot.logs,
          targetFeaturedCount: snapshot.goal.targetFeaturedCount,
          maxCollectedWorks: snapshot.goal.maxCollectedWorks,
          maxAiCalls: snapshot.goal.maxAiCalls,
          maxDurationMinutes: snapshot.goal.maxDurationMinutes,
          maxNoGrowthRounds: snapshot.goal.maxNoGrowthRounds,
          maxRounds: snapshot.goal.maxRounds,
          metricRules: snapshot.metricRules || undefined,
          collectedWorks: snapshot.usage.collectedWorks,
          aiCalls: snapshot.usage.aiCalls,
          currentRound: snapshot.usage.currentRound,
          noGrowthRounds: snapshot.usage.noGrowthRounds,
          featuredAtStart: snapshot.usage.featuredAtStart,
          featuredAdded: snapshot.usage.featuredAdded,
          stopReason: snapshot.usage.stopReason || null,
          startedAt: cleanDate(snapshot.usage.startedAt),
          finishedAt: ["completed", "stopped", "failed"].includes(snapshot.stage) ? new Date() : null,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) return null;
      for (const stage of workStages) {
        const data = stepData(snapshot, stage);
        await tx.agentRunStep.upsert({
          where: { agentRunId_stage: { agentRunId: runId, stage } },
          create: { agentRunId: runId, ...data },
          update: data
        });
      }
      return tx.agentRun.findUnique({ where: { id: runId }, include: { steps: true, rounds: { orderBy: { roundNumber: "asc" }, include: { feedbacks: { orderBy: { createdAt: "asc" } } } } } });
    });
    if (!run) {
      const current = await prisma.agentRun.findUnique({ where: { id: runId }, include: { steps: true, rounds: { orderBy: { roundNumber: "asc" }, include: { feedbacks: { orderBy: { createdAt: "asc" } } } } } });
      return NextResponse.json(
        { error: "运行状态已在其他页面更新，请刷新后继续。", run: current ? serializeRun(current) : null },
        { status: 409 }
      );
    }
    return NextResponse.json({ run: serializeRun(run) });
  } finally {
    // prisma singleton — do not disconnect
  }
}
