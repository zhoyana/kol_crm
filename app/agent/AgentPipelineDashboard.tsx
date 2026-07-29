"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CampaignTaskItem } from "@/lib/campaign-tasks";

type WorkStage = "crawling" | "discovering" | "screening" | "importing" | "reviewing" | "outreach_ready";
type Stage = "idle" | WorkStage | "completed" | "failed";
type StepStatus = "waiting" | "running" | "paused" | "success" | "failed";

type StepMetric = {
  startedAt?: string;
  finishedAt?: string;
  completed?: number;
  total?: number;
  detail?: string;
  results?: Array<{ label: string; value: number; tone?: "success" | "warning" | "danger" | "neutral" }>;
};

type PipelineState = {
  stage: Stage;
  failedStage?: WorkStage;
  message: string;
  completed: number;
  total: number;
  importedIds: string[];
  error: string;
  updatedAt: string;
  metrics: Partial<Record<WorkStage, StepMetric>>;
  logs: string[];
};

const steps: Array<{ id: WorkStage; title: string; description: string }> = [
  { id: "crawling", title: "启动并等待采集", description: "按任务关键词采集抖音作品" },
  { id: "discovering", title: "聚合候选达人", description: "从作品数据合并达人账号" },
  { id: "screening", title: "AI 候选初筛", description: "按品类规则淘汰明显不匹配账号" },
  { id: "importing", title: "自动加入复筛", description: "将保留账号写入待复筛池" },
  { id: "reviewing", title: "分批主页复筛", description: "每批最多 30 人检查主页与近期作品" },
  { id: "outreach_ready", title: "生成建联队列", description: "整理通过复筛的达人供建联使用" }
];

const initialState: PipelineState = {
  stage: "idle",
  message: "等待启动完整流程",
  completed: 0,
  total: 0,
  importedIds: [],
  error: "",
  updatedAt: "",
  metrics: {},
  logs: []
};

const stageLabels: Record<Stage, string> = {
  idle: "等待启动",
  crawling: "采集中",
  discovering: "正在聚合达人",
  screening: "AI 初筛中",
  importing: "正在加入复筛",
  reviewing: "主页复筛中",
  outreach_ready: "正在生成建联队列",
  completed: "全部完成",
  failed: "执行失败"
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function termsFromText(value: string): string[] {
  return value.split(/[,，、\n]/).map((item) => item.trim()).filter((item) => item.length >= 2);
}

function timeText(value?: string): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}

function durationText(startedAt?: string, finishedAt?: string, now = Date.now()): string {
  if (!startedAt) return "";
  const end = finishedAt ? new Date(finishedAt).getTime() : now;
  const seconds = Math.max(0, Math.round((end - new Date(startedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function normalizeSavedState(saved: Partial<PipelineState>): PipelineState {
  return {
    ...initialState,
    ...saved,
    importedIds: Array.isArray(saved.importedIds) ? saved.importedIds : [],
    metrics: saved.metrics || {},
    logs: Array.isArray(saved.logs) ? saved.logs.slice(-80) : []
  };
}

export function AgentPipelineDashboard({ task }: { task: CampaignTaskItem }) {
  const storageKey = `kol-crm-agent-pipeline:${task.id}`;
  const pauseRef = useRef(false);
  const stageRef = useRef<Stage>("idle");
  const candidatesRef = useRef<any[]>([]);
  const stateRef = useRef<PipelineState>(initialState);
  const [state, setStateValue] = useState<PipelineState>(initialState);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(Date.now());

  function setState(next: PipelineState | ((current: PipelineState) => PipelineState)) {
    setStateValue((current) => {
      const value = typeof next === "function" ? next(current) : next;
      stateRef.current = value;
      return value;
    });
  }

  useEffect(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(storageKey) || "null") as Partial<PipelineState> | null;
      if (!raw) return;
      const saved = normalizeSavedState(raw);
      if (steps.some((step) => step.id === saved.stage)) {
        const interruptedStage = saved.stage as WorkStage;
        stageRef.current = "failed";
        setState({
          ...saved,
          stage: "failed",
          failedStage: interruptedStage,
          error: "上次执行被页面刷新或服务重启中断，可以从失败步骤重试。",
          message: "流程已中断，等待重试。",
          metrics: {
            ...saved.metrics,
            [interruptedStage]: { ...saved.metrics[interruptedStage], detail: "执行中断" }
          }
        });
      } else {
        stageRef.current = saved.stage;
        setState(saved);
      }
    } catch {
      setState(initialState);
    }
  }, [storageKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state, storageKey]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  function update(patch: Partial<PipelineState>) {
    if (patch.stage) stageRef.current = patch.stage;
    setState((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));
  }

  function updateStep(stage: WorkStage, patch: Partial<StepMetric>) {
    setState((current) => ({
      ...current,
      metrics: { ...current.metrics, [stage]: { ...current.metrics[stage], ...patch } },
      updatedAt: new Date().toISOString()
    }));
  }

  function enterStep(stage: WorkStage, message: string, total = 0) {
    const startedAt = new Date().toISOString();
    stageRef.current = stage;
    setState((current) => ({
      ...current,
      stage,
      message,
      completed: 0,
      total,
      error: "",
      updatedAt: startedAt,
      metrics: {
        ...current.metrics,
        [stage]: { startedAt, completed: 0, total, detail: message }
      },
      logs: [...current.logs, `[${timeText(startedAt)}] ${message}`].slice(-80)
    }));
  }

  function finishStep(stage: WorkStage, detail: string, completed?: number, total?: number) {
    const finishedAt = new Date().toISOString();
    setState((current) => ({
      ...current,
      completed: completed ?? current.completed,
      total: total ?? current.total,
      message: detail,
      updatedAt: finishedAt,
      metrics: {
        ...current.metrics,
        [stage]: {
          ...current.metrics[stage],
          finishedAt,
          completed: completed ?? current.metrics[stage]?.completed,
          total: total ?? current.metrics[stage]?.total,
          detail
        }
      },
      logs: [...current.logs, `[${timeText(finishedAt)}] ${detail}`].slice(-80)
    }));
  }

  async function waitWhilePaused() {
    while (pauseRef.current) await wait(500);
  }

  async function requestJson(url: string, init?: RequestInit): Promise<any> {
    const response = await fetch(url, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${url} 执行失败`);
    return data;
  }

  async function crawl() {
    enterStep("crawling", "正在启动关键词采集…", 1);
    const keyword = task.seedKeywords.join(",");
    await requestJson("/api/crawler/douyin/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword,
        campaignTaskId: task.id,
        maxNotes: 100,
        discoveryMode: "single",
        topicLimit: 3,
        publishWindowDays: 180,
        sortBy: "relevance",
        topicRules: {
          primaryTerms: task.seedKeywords,
          supportTerms: task.productSellingPoints,
          excludeTerms: task.excludeKeywords
        }
      })
    });

    let collectedWorks = 0;
    while (true) {
      await waitWhilePaused();
      const crawler = await requestJson("/api/crawler/douyin/status");
      const crawlerLogs = Array.isArray(crawler.logs) ? crawler.logs.map(String) : [];
      const latestLog = crawlerLogs.at(-1) || `采集状态：${crawler.status}`;
      collectedWorks = Number(crawler.collectedWorks || 0);
      setState((current) => ({
        ...current,
        message: latestLog,
        logs: crawlerLogs.slice(-80),
        metrics: {
          ...current.metrics,
          crawling: {
            ...current.metrics.crawling,
            detail: latestLog,
            results: [{ label: "已采集作品", value: collectedWorks, tone: "success" }]
          }
        },
        updatedAt: new Date().toISOString()
      }));
      if (crawler.status === "succeeded") break;
      if (crawler.status === "failed" || crawler.status === "stopped") {
        throw new Error(crawler.error || `采集任务状态：${crawler.status}`);
      }
      await wait(2_000);
    }
    finishStep("crawling", `采集完成，共获得 ${collectedWorks} 个作品`, 1, 1);
    updateStep("crawling", {
      results: [{ label: "采集作品", value: collectedWorks, tone: "success" }]
    });
  }

  async function discoverAndScreen() {
    await waitWhilePaused();
    enterStep("discovering", "正在从采集结果聚合候选达人…", 1);
    const keyword = task.seedKeywords.join(",");
    const discovered = await requestJson("/api/discover/douyin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword,
        campaignTaskId: task.id,
        filters: {
          publishWindowDays: 180,
          sortBy: "relevance",
          primaryTerms: [...task.seedKeywords, ...termsFromText(task.targetAudience), ...termsFromText(task.targetDescription)],
          supportTerms: task.productSellingPoints,
          excludeTerms: task.excludeKeywords,
          useAiWorkFilter: true
        }
      })
    });
    candidatesRef.current = Array.isArray(discovered.candidates) ? discovered.candidates : [];
    if (!candidatesRef.current.length) throw new Error("达人聚合完成，但没有可进入 AI 初筛的新候选。");
    finishStep("discovering", `聚合出 ${candidatesRef.current.length} 位候选达人`, candidatesRef.current.length, candidatesRef.current.length);
    updateStep("discovering", {
      results: [{ label: "聚合达人", value: candidatesRef.current.length, tone: "success" }]
    });

    enterStep("screening", `正在 AI 初筛 ${candidatesRef.current.length} 位候选…`, candidatesRef.current.length);
    const beforeCount = candidatesRef.current.length;
    const screened = await requestJson("/api/ai/candidate-screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, campaignTaskId: task.id, candidates: candidatesRef.current })
    });
    const decisionMap = new Map((screened.decisions || []).map((item: any) => [String(item.id), item]));
    const decisions = Array.isArray(screened.decisions) ? screened.decisions : [];
    const keepCount = decisions.filter((item: any) => item.decision === "keep").length;
    const maybeCount = decisions.filter((item: any) => item.decision === "maybe").length;
    const dropCount = decisions.filter((item: any) => item.decision === "drop").length;
    candidatesRef.current = candidatesRef.current
      .filter((candidate) => (decisionMap.get(candidate.externalId) as any)?.decision !== "drop")
      .map((candidate) => {
        const decision: any = decisionMap.get(candidate.externalId);
        if (!decision) return candidate;
        return {
          ...candidate,
          screeningStatus: decision.decision === "keep" ? "candidate_strong" : "candidate_observe",
          screeningSummary: `${candidate.screeningSummary || ""}；AI ${decision.decision}：${decision.reason || "未说明"}`
        };
      });
    finishStep(
      "screening",
      `AI 初筛完成：保留 ${candidatesRef.current.length} 人，淘汰 ${beforeCount - candidatesRef.current.length} 人`,
      beforeCount,
      beforeCount
    );
    updateStep("screening", {
      results: [
        { label: "强保留", value: keepCount, tone: "success" },
        { label: "待观察", value: maybeCount, tone: "warning" },
        { label: "淘汰", value: dropCount, tone: "danger" }
      ]
    });
  }

  async function importCandidates() {
    await waitWhilePaused();
    enterStep("importing", "正在加入待复筛池…", candidatesRef.current.length);
    if (!candidatesRef.current.length) throw new Error("没有可导入候选，请从达人聚合步骤重试。");
    const imported = await requestJson("/api/discover/douyin/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: candidatesRef.current, campaignTaskId: task.id })
    });
    const importedIds = candidatesRef.current.map((candidate) => String(candidate.externalId)).filter(Boolean);
    update({ importedIds });
    finishStep("importing", `已加入复筛池 ${importedIds.length} 人`, importedIds.length, importedIds.length);
    updateStep("importing", {
      results: [
        { label: "新加入", value: Number(imported.imported || 0), tone: "success" },
        { label: "已存在更新", value: Number(imported.updated || 0), tone: "neutral" },
        { label: "关联任务", value: Number(imported.campaignTaskLinked || importedIds.length), tone: "success" }
      ]
    });
  }

  async function reviewCandidates(ids: string[]) {
    if (!ids.length) throw new Error("没有待复筛达人 ID，请重新执行达人发现。");
    enterStep("reviewing", "正在分批进行主页复筛…", ids.length);
    let completed = 0;
    let reviewSucceeded = 0;
    let reviewFailed = 0;
    let featured = 0;
    let rejected = 0;
    let pending = 0;
    const reviewBatchSize = 30;
    for (let index = 0; index < ids.length; index += reviewBatchSize) {
      await waitWhilePaused();
      const batch = ids.slice(index, index + reviewBatchSize);
      const batchNumber = Math.floor(index / reviewBatchSize) + 1;
      const batchTotal = Math.ceil(ids.length / reviewBatchSize);
      update({ completed, message: `正在处理第 ${batchNumber}/${batchTotal} 批，本批 ${batch.length} 人` });
      updateStep("reviewing", {
        completed,
        total: ids.length,
        detail: `第 ${batchNumber}/${batchTotal} 批正在复筛`
      });
      const reviewed = await requestJson("/api/review/douyin/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: batch,
          campaignTaskId: task.id,
          workLimit: 6,
          allowFullRetry: true,
          skipObviousMismatch: true
        })
      });
      const batchResults = Array.isArray(reviewed.results) ? reviewed.results : [];
      reviewSucceeded += Number(reviewed.succeeded || 0);
      reviewFailed += Number(reviewed.failed || 0);
      featured += batchResults.filter((item: any) => item.ok && item.poolStatus === "featured").length;
      rejected += batchResults.filter((item: any) =>
        item.skipped || ["skipped", "rejected"].includes(String(item.poolStatus))
      ).length;
      pending += batchResults.filter((item: any) =>
        item.ok && !["featured", "skipped", "rejected"].includes(String(item.poolStatus))
      ).length;
      completed += batch.length;
      update({ completed, message: `主页复筛进度：${completed}/${ids.length}` });
      updateStep("reviewing", {
        completed,
        total: ids.length,
        detail: `已完成 ${completed}/${ids.length} 人`,
        results: [
          { label: "复筛成功", value: reviewSucceeded, tone: "success" },
          { label: "进入精选", value: featured, tone: "success" },
          { label: "留待选", value: pending, tone: "neutral" },
          { label: "直接排除", value: rejected, tone: "danger" },
          { label: "失败", value: reviewFailed, tone: "warning" }
        ]
      });
    }
    finishStep("reviewing", `主页复筛完成，共处理 ${ids.length} 人`, ids.length, ids.length);
    updateStep("reviewing", {
      results: [
        { label: "复筛成功", value: reviewSucceeded, tone: "success" },
        { label: "进入精选", value: featured, tone: "success" },
        { label: "留待选", value: pending, tone: "neutral" },
        { label: "直接排除", value: rejected, tone: "danger" },
        { label: "失败", value: reviewFailed, tone: "warning" }
      ]
    });

    enterStep("outreach_ready", "正在生成建联队列…", 1);
    await wait(500);
    finishStep("outreach_ready", "建联队列已生成", 1, 1);
    updateStep("outreach_ready", {
      results: [{ label: "待建联达人", value: featured, tone: "success" }]
    });
    update({ stage: "completed", message: "全链路完成，精选达人已进入建联队列。" });
  }

  async function execute(fromStage: Stage = "crawling") {
    setRunning(true);
    setPaused(false);
    pauseRef.current = false;
    if (fromStage === "crawling") setState({ ...initialState, updatedAt: new Date().toISOString() });
    try {
      if (fromStage === "crawling") await crawl();
      if (["crawling", "discovering", "screening", "importing"].includes(fromStage)) {
        await discoverAndScreen();
        await importCandidates();
      }
      const savedIds = stateRef.current.importedIds;
      const ids = savedIds.length && fromStage === "reviewing"
        ? savedIds
        : candidatesRef.current.map((candidate) => String(candidate.externalId)).filter(Boolean);
      await reviewCandidates(ids);
    } catch (error) {
      const currentStage = (stageRef.current === "failed" ? fromStage : stageRef.current) as WorkStage;
      const errorMessage = error instanceof Error ? error.message : "Agent 执行失败";
      const failedAt = new Date().toISOString();
      stageRef.current = "failed";
      setState((current) => ({
        ...current,
        stage: "failed",
        failedStage: currentStage,
        error: errorMessage,
        message: "执行失败，可以从失败步骤重试。",
        updatedAt: failedAt,
        metrics: {
          ...current.metrics,
          [currentStage]: { ...current.metrics[currentStage], finishedAt: failedAt, detail: errorMessage }
        },
        logs: [...current.logs, `[${timeText(failedAt)}] 失败：${errorMessage}`].slice(-80)
      }));
    } finally {
      setRunning(false);
      setPaused(false);
      pauseRef.current = false;
    }
  }

  function pause() {
    pauseRef.current = true;
    setPaused(true);
    update({ message: "已请求暂停；当前网络请求或当前复筛批次完成后暂停。" });
  }

  function resume() {
    pauseRef.current = false;
    setPaused(false);
    update({ message: "继续执行队列。" });
  }

  function retry() {
    let failedStage: Stage = state.failedStage || "crawling";
    if (["discovering", "screening", "importing"].includes(failedStage) && !candidatesRef.current.length) {
      failedStage = "discovering";
    }
    void execute(failedStage);
  }

  function reset() {
    if (running) return;
    stageRef.current = "idle";
    candidatesRef.current = [];
    setState(initialState);
  }

  const activeStage = state.stage === "failed" ? state.failedStage : state.stage;
  const activeIndex = steps.findIndex((step) => step.id === activeStage);
  const completedSteps = state.stage === "completed"
    ? steps.length
    : steps.filter((step) => Boolean(state.metrics[step.id]?.finishedAt)
      && !(state.stage === "failed" && state.failedStage === step.id)).length;
  const overallProgress = Math.round((completedSteps / steps.length) * 100);
  const stepProgress = state.total ? Math.min(100, Math.round((state.completed / state.total) * 100)) : 0;

  const stepStatuses = useMemo(() => {
    return Object.fromEntries(steps.map((step, index) => {
      let status: StepStatus = "waiting";
      if (state.metrics[step.id]?.finishedAt) status = "success";
      if (state.stage === step.id) status = paused ? "paused" : "running";
      if (state.stage === "failed" && state.failedStage === step.id) status = "failed";
      if (state.stage === "completed") status = "success";
      if (status === "waiting" && activeIndex >= 0 && index < activeIndex) status = "success";
      return [step.id, status];
    })) as Record<WorkStage, StepStatus>;
  }, [activeIndex, paused, state.failedStage, state.metrics, state.stage]);

  return (
    <section className="panel agent-pipeline-panel">
      <div className="panel-header">
        <div>
          <h2>一键执行 Agent</h2>
          <p>完整展示采集、AI 初筛、导入、主页复筛和建联队列的执行位置。</p>
        </div>
        <span className={`agent-pipeline-badge ${state.stage}`}>{stageLabels[state.stage]}</span>
      </div>

      <div className="agent-overall">
        <div className="agent-overall-heading">
          <strong>整条流程</strong>
          <span>{completedSteps}/{steps.length} 步 · {overallProgress}%</span>
        </div>
        <div className="agent-pipeline-progress" aria-label={`整条流程完成 ${overallProgress}%`}>
          <div style={{ width: `${overallProgress}%` }} />
        </div>
      </div>

      <div className="agent-step-grid">
        {steps.map((step, index) => {
          const status = stepStatuses[step.id];
          const metric = state.metrics[step.id];
          return (
            <article className={`agent-step-card ${status}`} key={step.id}>
              <div className="agent-step-top">
                <span className="agent-step-number">
                  {status === "success" ? "✓" : status === "failed" ? "!" : index + 1}
                </span>
                <span className={`agent-step-status ${status}`}>
                  {status === "waiting" ? "等待" : status === "running" ? "进行中" : status === "paused" ? "已暂停" : status === "success" ? "完成" : "失败"}
                </span>
              </div>
              <strong>{step.title}</strong>
              <p>{metric?.detail || step.description}</p>
              {metric?.results?.length ? (
                <div className="agent-step-results">
                  {metric.results.map((result) => (
                    <span className={result.tone || "neutral"} key={result.label}>
                      <small>{result.label}</small>
                      <b>{result.value}</b>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="agent-step-meta">
                {metric?.total ? <span>{metric.completed || 0}/{metric.total}</span> : <span>尚未开始</span>}
                {metric?.startedAt ? <span>耗时 {durationText(metric.startedAt, metric.finishedAt, now)}</span> : null}
              </div>
            </article>
          );
        })}
      </div>

      {(running || state.stage === "failed" || state.stage === "completed") ? (
        <div className="agent-current-step">
          <div>
            <strong>当前动态</strong>
            <p>{state.message}</p>
          </div>
          {state.total ? <strong>{state.completed}/{state.total}（{stepProgress}%）</strong> : null}
          <div className="agent-pipeline-progress compact">
            <div style={{ width: `${stepProgress}%` }} />
          </div>
        </div>
      ) : null}

      {state.error ? <p className="form-error">{state.error}</p> : null}

      {state.logs.length ? (
        <details className="agent-log-panel" open={running || state.stage === "failed"}>
          <summary>实时执行日志（最近 {state.logs.length} 条）</summary>
          <pre>{state.logs.join("\n")}</pre>
        </details>
      ) : null}

      <div className="task-actions">
        <button disabled={running || state.stage === "completed"} onClick={() => void execute("crawling")} type="button">
          {running ? "Agent 执行中…" : "启动完整流程"}
        </button>
        {running && !paused ? <button className="secondary-button" onClick={pause} type="button">暂停</button> : null}
        {running && paused ? <button className="secondary-button" onClick={resume} type="button">继续</button> : null}
        {state.stage === "failed" ? <button className="secondary-button" disabled={running} onClick={retry} type="button">从失败步骤重试</button> : null}
        {!running && state.stage !== "idle" ? <button className="secondary-button" onClick={reset} type="button">清空本次进度</button> : null}
        {state.stage === "completed" ? (
          <Link className="button-link" href={`/tasks?campaignTaskId=${task.id}`}>查看建联队列</Link>
        ) : null}
      </div>
    </section>
  );
}
