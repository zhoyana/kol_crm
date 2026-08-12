import { NextRequest, NextResponse } from "next/server";
import { AGENT_STRATEGY_ACTIONS } from "@/lib/agent-strategy";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const workStages = ["crawling", "discovering", "importing", "profiling", "reviewing", "outreach_ready"];
const verdicts = new Set(["accepted", "rejected", "modified"]);
const executableActions = new Set([
  "continue_next_keyword",
  "retry_current_keyword",
  "supplement_incomplete",
  "stop_target_reached",
  "stop_budget_reached",
  "stop_low_yield"
]);
const stopActions = new Set(["stop_target_reached", "stop_budget_reached", "stop_low_yield"]);

function serializeFeedback(row: any) {
  return {
    id: row.id,
    verdict: row.verdict,
    originalAction: row.originalAction || undefined,
    finalAction: row.finalAction || undefined,
    note: row.note || undefined,
    executionRequested: row.executionRequested,
    executionStatus: row.executionStatus,
    executionMessage: row.executionMessage || undefined,
    createdAt: row.createdAt?.toISOString?.()
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    roundId?: number;
    verdict?: string;
    finalAction?: string;
    note?: string;
    execute?: boolean;
  } | null;
  const roundId = Number(body?.roundId || 0);
  const verdict = String(body?.verdict || "");
  const finalAction = String(body?.finalAction || "");
  const execute = body?.execute === true;
  if (!Number.isInteger(roundId) || roundId <= 0 || !verdicts.has(verdict)) {
    return NextResponse.json({ error: "无效的策略反馈。" }, { status: 400 });
  }
  if (finalAction && !AGENT_STRATEGY_ACTIONS.includes(finalAction as any)) {
    return NextResponse.json({ error: "修改后的动作不在允许列表。" }, { status: 400 });
  }

  // prisma singleton from import
  try {
    const round = await prisma.agentRunRound.findUnique({
      where: { id: roundId },
      include: { agentRun: { include: { campaignTask: true } } }
    });
    if (!round) return NextResponse.json({ error: "运行轮次不存在。" }, { status: 404 });
    const selectedAction = finalAction || round.strategyAction || "";
    let executionStatus = execute ? "checking" : "not_requested";
    let executionMessage = execute ? "正在检查执行条件。" : "反馈已记录，未请求执行。";
    const feedback = await prisma.agentStrategyFeedback.create({
      data: {
        agentRunRoundId: roundId,
        verdict,
        originalAction: round.strategyAction || null,
        finalAction: selectedAction || null,
        note: String(body?.note || "").trim().slice(0, 5000) || null,
        executionRequested: execute,
        executionStatus,
        executionMessage
      }
    });

    let createdRunId: number | null = null;
    if (execute) {
      if (!selectedAction || !executableActions.has(selectedAction)) {
        executionStatus = "manual_only";
        executionMessage = "该动作涉及关键词或规则调整，只记录反馈，不允许自动执行。";
      } else if (stopActions.has(selectedAction)) {
        const active = await prisma.agentRun.findFirst({
          where: { campaignTaskId: round.agentRun.campaignTaskId, status: { in: ["queued", "running", "paused", "stopping"] } },
          orderBy: { updatedAt: "desc" }
        });
        if (active) {
          await prisma.agentRun.update({
            where: { id: active.id },
            data: {
              status: active.status === "queued" ? "stopped" : "stopping",
              cancelRequestedAt: new Date(),
              stopReason: "human_confirmed_strategy",
              message: "人工确认策略建议：停止运行。",
              finishedAt: active.status === "queued" ? new Date() : active.finishedAt,
              version: { increment: 1 }
            }
          });
          executionMessage = `已向运行 #${active.id} 发送停止请求。`;
        } else {
          executionMessage = "当前没有后台运行，停止建议已确认，无需额外操作。";
        }
        executionStatus = "executed";
      } else {
        const source = round.agentRun;
        const active = await prisma.agentRun.findFirst({
          where: { campaignTaskId: source.campaignTaskId, status: { in: ["queued", "running", "paused", "stopping"] } }
        });
        const remainingAi = source.maxAiCalls - source.aiCalls;
        const elapsedMinutes = source.startedAt ? Math.floor((Date.now() - source.startedAt.getTime()) / 60000) : 0;
        const remainingMinutes = source.maxDurationMinutes - elapsedMinutes;
        const nextRound = selectedAction === "continue_next_keyword" ? round.roundNumber + 1 : round.roundNumber;
        if (active) {
          executionStatus = "blocked";
          executionMessage = `品类任务已有运行 #${active.id} 正在执行，未重复启动。`;
        } else if (remainingAi <= 0 || remainingMinutes <= 0) {
          executionStatus = "blocked";
          executionMessage = "AI或时间预算已经用完，未启动新运行。";
        } else if (selectedAction === "continue_next_keyword" && nextRound > source.maxRounds) {
          executionStatus = "blocked";
          executionMessage = "已达到最大轮次，未继续下一个关键词。";
        } else {
          const startStage = selectedAction === "supplement_incomplete" ? "profiling" : "crawling";
          const created = await prisma.agentRun.create({
            data: {
              campaignTaskId: source.campaignTaskId,
              status: "queued",
              stage: "idle",
              startStage,
              message: `人工确认策略建议，任务已进入后台队列：${selectedAction}`,
              completed: 0,
              total: 0,
              importedIds: [],
              logs: [`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] 人工确认策略建议：${selectedAction}`],
              targetFeaturedCount: source.targetFeaturedCount,
              maxCollectedWorks: source.maxCollectedWorks,
              maxAiCalls: source.maxAiCalls,
              maxDurationMinutes: Math.max(1, remainingMinutes),
              maxNoGrowthRounds: source.maxNoGrowthRounds,
              maxRounds: source.maxRounds,
              collectedWorks: source.collectedWorks,
              aiCalls: source.aiCalls,
              currentRound: nextRound,
              noGrowthRounds: source.noGrowthRounds,
              featuredAtStart: source.featuredAtStart,
              featuredAdded: source.featuredAdded,
              steps: {
                create: workStages.map((stage) => ({ stage, status: "waiting", completed: 0, total: 0 }))
              }
            }
          });
          createdRunId = created.id;
          executionStatus = "executed";
          executionMessage = `已创建后台运行 #${created.id}，从${startStage === "profiling" ? "历史待补采队列" : "关键词采集"}开始。`;
        }
      }
    }

    const updated = await prisma.agentStrategyFeedback.update({
      where: { id: feedback.id },
      data: { executionStatus, executionMessage }
    });
    return NextResponse.json({ feedback: serializeFeedback(updated), createdRunId });
  } finally {
    // prisma singleton — do not disconnect
  }
}
