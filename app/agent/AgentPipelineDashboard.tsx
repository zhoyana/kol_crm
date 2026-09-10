"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CampaignTaskItem } from "@/lib/campaign-tasks";
import { normalizeAgentGoal, normalizeAgentMetricRules, type AgentGoal, type AgentMetricRules } from "@/lib/agent-goals";
import { resolveDiscoveryRuleTemplate } from "@/lib/discovery-rule-templates";

type WorkStage = "crawling" | "discovering" | "importing" | "profiling" | "reviewing" | "outreach_ready";
type Stage = "idle" | WorkStage | "completed" | "stopped" | "failed";
type StartStage = "crawling" | "discovering" | "profiling" | "reviewing";
type StepStatus = "waiting" | "running" | "paused" | "success" | "stopped" | "skipped" | "failed";

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

type PersistedRun = {
  id: number;
  version: number;
  status: string;
  startStage?: StartStage;
  rounds?: AgentRound[];
  state: Partial<PipelineState>;
};

type OnlineLocalAgent = { id: string; name: string; version: string; lastSeenAt: string };

type AgentRound = {
  id: number;
  roundNumber: number;
  keyword: string;
  status: string;
  collectedWorks: number;
  candidatesFound: number;
  importedCount: number;
  aiCalls: number;
  portraitPassed: number;
  featuredAdded: number;
  featuredTotal: number;
  decision?: string;
  stopReason?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  strategy?: {
    status: string;
    model?: string;
    action?: string;
    confidence?: number;
    reason?: string;
    expectedBenefit?: string;
    risk?: string;
    executionScope?: { keyword?: string | null; max_creators?: number | null; max_ai_calls?: number | null };
    stopCondition?: string;
    humanMessage?: string;
    error?: string;
  };
  feedbacks?: AgentStrategyFeedback[];
};

type AgentStrategyFeedback = {
  id: number;
  verdict: string;
  originalAction?: string;
  finalAction?: string;
  note?: string;
  executionRequested: boolean;
  executionStatus: string;
  executionMessage?: string;
  createdAt?: string;
};

const strategyActionLabels: Record<string, string> = {
  continue_next_keyword: "继续下一个关键词",
  retry_current_keyword: "重试当前关键词",
  supplement_incomplete: "补采信息不足达人",
  optimize_keywords: "优化采集关键词",
  review_rules: "人工检查筛选规则",
  request_human_review: "请求人工复核",
  stop_target_reached: "达到目标，建议停止",
  stop_budget_reached: "达到预算，建议停止",
  stop_low_yield: "产出过低，建议停止"
};

const steps: Array<{ id: WorkStage; title: string; description: string }> = [
  { id: "crawling", title: "关键词作品采集", description: "按任务关键词采集抖音作品" },
  { id: "discovering", title: "聚合与硬排除", description: "聚合达人并排除机构号、大V等明显不符合账号" },
  { id: "importing", title: "建立画像队列", description: "将候选写入主页样本补齐队列" },
  { id: "profiling", title: "主页样本与 AI 画像", description: "统一补齐主页样本，记录指标并按人群模板判断画像" },
  { id: "reviewing", title: "数据门槛筛选", description: "只读取已记录指标，决定进入精选或留在待选" },
  { id: "outreach_ready", title: "生成建联队列", description: "整理通过复筛的达人供建联使用" }
];

function createInitialState(goal: AgentGoal, featuredAtStart = 0, metricRules: AgentMetricRules | null = null): PipelineState {
  return {
  stage: "idle",
  message: "等待启动完整流程",
  completed: 0,
  total: 0,
  importedIds: [],
  error: "",
  updatedAt: "",
  metrics: {},
    logs: [],
    goal,
    metricRules,
    usage: { collectedWorks: 0, aiCalls: 0, currentRound: 1, noGrowthRounds: 0, featuredAtStart, featuredAdded: 0 }
  };
}

const stageLabels: Record<Stage, string> = {
  idle: "等待启动",
  crawling: "采集中",
  discovering: "正在聚合达人",
  importing: "正在建立画像队列",
  profiling: "主页补采与 AI 画像中",
  reviewing: "数据门槛筛选中",
  outreach_ready: "正在生成建联队列",
  completed: "全部完成",
  stopped: "已按条件停止",
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

function normalizeSavedState(saved: Partial<PipelineState>, fallbackGoal: AgentGoal): PipelineState {
  const initialState = createInitialState(fallbackGoal);
  return {
    ...initialState,
    ...saved,
    importedIds: Array.isArray(saved.importedIds) ? saved.importedIds : [],
    metrics: saved.metrics || {},
    logs: Array.isArray(saved.logs) ? saved.logs.slice(-80) : [],
    goal: normalizeAgentGoal(saved.goal, fallbackGoal),
    metricRules: normalizeAgentMetricRules(saved.metricRules),
    usage: { ...initialState.usage, ...(saved.usage || {}) }
  };
}

class AgentStopError extends Error {
  constructor(public reason: string, message: string) { super(message); }
}

export function AgentPipelineDashboard({ task, featuredAtStart = 0, onTaskUpdated }: {
  task: CampaignTaskItem;
  featuredAtStart?: number;
  onTaskUpdated?: (task: CampaignTaskItem) => void;
}) {
  const initialState = createInitialState(task.agentGoalDefaults, featuredAtStart);
  const metricTemplate = resolveDiscoveryRuleTemplate(task).metricRules;
  const isXhsTask = /小红书|xhs/i.test(String(task.platform || ""));
  const defaultMetricDraft: AgentMetricRules = {
    useCustom: false,
    requireAvgLikes: metricTemplate.requireAvgLikes,
    avgLikesThreshold: isXhsTask
      ? Math.min(100, metricTemplate.avgLikesThreshold)
      : metricTemplate.avgLikesThreshold,
    requireViralWorks: metricTemplate.requireViralWorks,
    viralLikesThreshold: isXhsTask
      ? Math.min(500, metricTemplate.viralLikesThreshold)
      : metricTemplate.viralLikesThreshold,
    minViralWorks: metricTemplate.minViralWorks,
    requireSampleWorks: metricTemplate.requireSampleWorks,
    minSampleWorks: metricTemplate.minSampleWorks,
    requireRecentUpdate: metricTemplate.requireRecentUpdate,
    matchMode: metricTemplate.matchMode
  };
  const storageKey = `kol-crm-agent-pipeline:${task.id}`;
  const pauseRef = useRef(false);
  const stageRef = useRef<Stage>("idle");
  const candidatesRef = useRef<any[]>([]);
  const crawlTaskIdRef = useRef("");
  const stateRef = useRef<PipelineState>(initialState);
  const runIdRef = useRef<number | null>(null);
  const runVersionRef = useRef(0);
  const persistTimerRef = useRef<number | null>(null);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pollTimerRef = useRef<number | null>(null);
  const persistenceConflictRef = useRef(false);
  const [state, setStateValue] = useState<PipelineState>(initialState);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [persistenceError, setPersistenceError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [startStage, setStartStage] = useState<StartStage>("crawling");
  const [runStartStage, setRunStartStage] = useState<StartStage | null>(null);
  const [queueCounts, setQueueCounts] = useState({ profiling: 0, reviewing: 0 });
  const [goalDraft, setGoalDraft] = useState<AgentGoal>(task.agentGoalDefaults);
  const [metricDraft, setMetricDraft] = useState<AgentMetricRules>(defaultMetricDraft);
  const goalDefaultsKey = JSON.stringify(task.agentGoalDefaults);
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalMessage, setGoalMessage] = useState("");
  const [rounds, setRounds] = useState<AgentRound[]>([]);
  const [strategyDrafts, setStrategyDrafts] = useState<Record<number, { action: string; note: string }>>({});
  const [strategySavingId, setStrategySavingId] = useState<number | null>(null);
  const [agentMode, setAgentMode] = useState<"direct" | "queue">("direct");
  const [onlineAgents, setOnlineAgents] = useState<OnlineLocalAgent[]>([]);
  const [agentDeviceId, setAgentDeviceId] = useState("");

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/local-agents", { cache: "no-store" });
        const data = await response.json() as { mode?: "direct" | "queue"; agents?: OnlineLocalAgent[] };
        if (cancelled) return;
        const agents = data.agents || [];
        setAgentMode(data.mode === "queue" ? "queue" : "direct");
        setOnlineAgents(agents);
        setAgentDeviceId((current) => agents.some((agent) => agent.id === current) ? current : (agents[0]?.id || ""));
      } catch { /* main health polling will surface server failures */ }
    };
    void refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (agentDeviceId) window.localStorage.setItem("kol-crm-local-agent-id", agentDeviceId);
  }, [agentDeviceId]);

  function strategyDraft(round: AgentRound) {
    return strategyDrafts[round.id] || { action: round.strategy?.action || "request_human_review", note: "" };
  }

  function updateStrategyDraft(round: AgentRound, patch: Partial<{ action: string; note: string }>) {
    setStrategyDrafts((current) => ({ ...current, [round.id]: { ...strategyDraft(round), ...patch } }));
  }

  async function submitStrategyFeedback(round: AgentRound, verdict: "accepted" | "rejected" | "modified", execute = false) {
    const draft = strategyDraft(round);
    setStrategySavingId(round.id);
    try {
      const response = await fetch("/api/agent/strategy-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: round.id, verdict, finalAction: draft.action, note: draft.note, execute })
      });
      const data = await response.json().catch(() => ({})) as { feedback?: AgentStrategyFeedback; error?: string };
      if (!response.ok || !data.feedback) throw new Error(data.error || "保存策略反馈失败");
      setRounds((items) => items.map((item) => item.id === round.id
        ? { ...item, feedbacks: [...(item.feedbacks || []), data.feedback as AgentStrategyFeedback] }
        : item));
      if (execute) setStrategyDrafts((current) => ({ ...current, [round.id]: { ...draft, note: "" } }));
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : "保存策略反馈失败");
    } finally {
      setStrategySavingId(null);
    }
  }

  function setState(next: PipelineState | ((current: PipelineState) => PipelineState)) {
    setStateValue((current) => {
      const value = typeof next === "function" ? next(current) : next;
      stateRef.current = value;
      return value;
    });
  }

  async function createRun(snapshot: PipelineState, enqueue = false): Promise<PersistedRun> {
    const response = await fetch("/api/agent/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ campaignTaskId: task.id, state: snapshot, enqueue, startStage, agentDeviceId: agentDeviceId || undefined })
    });
    const data = (await response.json().catch(() => ({}))) as { run?: PersistedRun; error?: string };
    if (!response.ok || !data.run) throw new Error(data.error || "创建 Agent 运行记录失败");
    runIdRef.current = data.run.id;
    runVersionRef.current = data.run.version;
    return data.run;
  }

  async function persistSnapshot(snapshot: PipelineState): Promise<void> {
    const runId = runIdRef.current;
    if (!runId) return;
    const response = await fetch("/api/agent/runs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, version: runVersionRef.current, state: snapshot })
    });
    const data = (await response.json().catch(() => ({}))) as { run?: PersistedRun; error?: string };
    if (!response.ok || !data.run) {
      if (response.status === 409 && data.run) {
        persistenceConflictRef.current = true;
      }
      throw new Error(data.error || "Agent 运行状态保存失败");
    }
    runVersionRef.current = data.run.version;
    setPersistenceError("");
  }

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      setHydrated(false);
      setPersistenceError("");
      persistenceConflictRef.current = false;
      try {
        const response = await fetch(`/api/agent/runs?campaignTaskId=${task.id}`, { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as { run?: PersistedRun | null; error?: string };
        if (!response.ok) throw new Error(data.error || "读取 Agent 运行状态失败");

        const run = data.run || null;
        let saved: PipelineState;
        if (run) {
          runIdRef.current = run.id;
          runVersionRef.current = run.version;
          setRunStartStage(run.startStage || "crawling");
          setRounds(run.rounds || []);
          saved = normalizeSavedState(run.state, task.agentGoalDefaults);
          setMetricDraft(saved.metricRules || defaultMetricDraft);
          setRunning(["queued", "running", "paused", "stopping"].includes(run.status));
          setPaused(run.status === "paused");
        } else {
          const local = JSON.parse(window.localStorage.getItem(storageKey) || "null") as Partial<PipelineState> | null;
          saved = normalizeSavedState(local || initialState, task.agentGoalDefaults);
        }
        if (cancelled) return;
        stageRef.current = saved.stage;
        stateRef.current = saved;
        setStateValue(saved);
      } catch (error) {
        if (cancelled) return;
        setPersistenceError(error instanceof Error ? error.message : "读取 Agent 运行状态失败");
        stageRef.current = "idle";
        stateRef.current = initialState;
        setStateValue(initialState);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [storageKey, task.id]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state, storageKey]);

  useEffect(() => {
    if (!hydrated || !running) return;
    let cancelled = false;
    let lastSignature = "";
    async function pollRun() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`/api/agent/runs?campaignTaskId=${task.id}`, { cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as { run?: PersistedRun | null; error?: string };
        if (!response.ok) throw new Error(data.error || "读取 Agent 运行状态失败");
        if (!data.run || cancelled) return;
        const run = data.run;
        const signature = `${run.status}|${run.version}|${(run.rounds || []).length}|${run.startStage || ""}`;
        if (signature === lastSignature) return;
        lastSignature = signature;
        runIdRef.current = run.id;
        runVersionRef.current = run.version;
        setRunStartStage(run.startStage || "crawling");
        setRounds(run.rounds || []);
        const saved = normalizeSavedState(run.state, task.agentGoalDefaults);
        stageRef.current = saved.stage;
        stateRef.current = saved;
        setStateValue(saved);
        setRunning(["queued", "running", "paused", "stopping"].includes(run.status));
        setPaused(run.status === "paused");
        setPersistenceError("");
      } catch (error) {
        if (!cancelled) setPersistenceError(error instanceof Error ? error.message : "读取 Agent 运行状态失败");
      }
    }
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    const timer = window.setInterval(() => void pollRun(), 2000);
    pollTimerRef.current = timer;
    void pollRun();
    return () => { cancelled = true; window.clearInterval(timer); pollTimerRef.current = null; };
  }, [hydrated, running, goalDefaultsKey, task.id]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    let cancelled = false;
    async function loadCounts() {
      const stages: Array<"profiling" | "reviewing"> = ["profiling", "reviewing"];
      const results = await Promise.all(stages.map(async (stage) => {
        const response = await fetch(`/api/creators/review?campaignTaskId=${task.id}&stage=${stage}`);
        const data = await response.json().catch(() => ({}));
        return [stage, response.ok ? Number(data.total || 0) : 0] as const;
      }));
      if (!cancelled) setQueueCounts(Object.fromEntries(results) as { profiling: number; reviewing: number });
    }
    void loadCounts();
    return () => {
      cancelled = true;
    };
  }, [task.id, state.updatedAt]);

  function update(patch: Partial<PipelineState>) {
    if (patch.stage) stageRef.current = patch.stage;
    setState((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));
  }

  function updateUsage(patch: Partial<PipelineState["usage"]>) {
    setState((current) => ({
      ...current,
      usage: { ...current.usage, ...patch },
      updatedAt: new Date().toISOString()
    }));
  }

  function ensureWithinTime() {
    const { startedAt } = stateRef.current.usage;
    if (!startedAt) return;
    const elapsed = Date.now() - new Date(startedAt).getTime();
    if (elapsed >= stateRef.current.goal.maxDurationMinutes * 60_000) {
      throw new AgentStopError("time_limit_reached", "已达到最长运行时间，Agent 已安全停止。 ");
    }
  }

  async function saveGoalDefaults() {
    setGoalSaving(true);
    setGoalMessage("");
    try {
      const goal = normalizeAgentGoal(goalDraft, task.agentGoalDefaults);
      const response = await fetch("/api/campaign-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, agentGoalDefaults: goal })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.task) throw new Error(data.error || "保存默认目标失败");
      setGoalDraft(data.task.agentGoalDefaults);
      onTaskUpdated?.(data.task);
      setGoalMessage("已保存为这个任务的默认目标。");
    } catch (error) {
      setGoalMessage(error instanceof Error ? error.message : "保存默认目标失败");
    } finally {
      setGoalSaving(false);
    }
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

  async function loadQueueIds(stage: "profiling" | "reviewing"): Promise<string[]> {
    const data = await requestJson(`/api/creators/review?campaignTaskId=${task.id}&stage=${stage}`);
    return Array.isArray(data.ids) ? data.ids.map(String).filter(Boolean) : [];
  }

  async function crawl() {
    ensureWithinTime();
    enterStep("crawling", "正在启动关键词采集…", 1);
    const keyword = task.seedKeywords.join(",");
    const platformKey = /小红书|xhs/i.test(task.platform) ? "xhs" : "douyin";
    const startedCrawler = await requestJson(`/api/crawler/${platformKey}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword,
        campaignTaskId: task.id,
        maxNotes: platformKey === "xhs"
          ? Math.min(25, stateRef.current.goal.maxCollectedWorks)
          : Math.min(300, stateRef.current.goal.maxCollectedWorks),
        restartCdpBeforeSpawn: platformKey !== "xhs",
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
    crawlTaskIdRef.current = String(startedCrawler?.id || "");

    let collectedWorks = 0;
    while (true) {
      await waitWhilePaused();
      const crawler = await requestJson(`/api/crawler/${platformKey}/status`);
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
        usage: { ...current.usage, collectedWorks },
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

  async function discoverCandidates() {
    ensureWithinTime();
    await waitWhilePaused();
    enterStep("discovering", "正在从采集结果聚合候选达人…", 1);
    const keyword = task.seedKeywords.join(",");
    const platformKey = /小红书|xhs/i.test(task.platform) ? "xhs" : "douyin";
    const discovered = await requestJson(`/api/discover/${platformKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword,
        crawlTaskId: platformKey === "xhs" ? crawlTaskIdRef.current : undefined,
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
    if (!candidatesRef.current.length) throw new Error("达人聚合完成，但没有可进入作品画像阶段的新候选。");
    finishStep("discovering", `聚合出 ${candidatesRef.current.length} 位候选达人`, candidatesRef.current.length, candidatesRef.current.length);
    updateStep("discovering", {
      results: [{ label: "聚合达人", value: candidatesRef.current.length, tone: "success" }]
    });
  }

  async function importCandidates() {
    ensureWithinTime();
    await waitWhilePaused();
    enterStep("importing", "正在加入待画像…", candidatesRef.current.length);
    if (!candidatesRef.current.length) throw new Error("没有可导入候选，请从达人聚合步骤重试。");
    const platformKey = /小红书|xhs/i.test(task.platform) ? "xhs" : "douyin";
    const imported = await requestJson(`/api/discover/${platformKey}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: candidatesRef.current, campaignTaskId: task.id })
    });
    const importedIds = candidatesRef.current.map((candidate) => String(candidate.externalId)).filter(Boolean);
    update({ importedIds });
    finishStep("importing", `已建立画像队列 ${importedIds.length} 人`, importedIds.length, importedIds.length);
    updateStep("importing", {
      results: [
        { label: "新加入", value: Number(imported.imported || 0), tone: "success" },
        { label: "已存在更新", value: Number(imported.updated || 0), tone: "neutral" },
        { label: "关联任务", value: Number(imported.campaignTaskLinked || importedIds.length), tone: "success" }
      ]
    });
  }

  async function profileCandidates(ids: string[]) {
    if (!ids.length) throw new Error("没有需要补齐主页样本的达人 ID。");
    enterStep("profiling", "正在补齐主页样本并执行 AI 作品画像初筛…", ids.length);
    let completed = 0;
    let portraitPassed = 0;
    let insufficient = 0;
    let crawlIncomplete = 0;
    let rejected = 0;
    let failed = 0;
    let totalSamples = 0;
    const isXhsTask = /小红书|xhs/i.test(task.platform);
    const batchSize = isXhsTask ? 5 : 30;

    for (let index = 0; index < ids.length; index += batchSize) {
      await waitWhilePaused();
      ensureWithinTime();
      const remainingAiCalls = stateRef.current.goal.maxAiCalls - stateRef.current.usage.aiCalls;
      if (remainingAiCalls <= 0) throw new AgentStopError("ai_budget_reached", "已达到 AI 调用上限，Agent 已安全停止。 ");
      const batch = ids.slice(index, index + Math.min(batchSize, remainingAiCalls));
      const batchNumber = Math.floor(index / batchSize) + 1;
      const batchTotal = Math.ceil(ids.length / batchSize);
      update({ completed, message: `正在补齐第 ${batchNumber}/${batchTotal} 批主页样本，本批 ${batch.length} 人` });
      const batchStartedAt = Date.now();
      const heartbeat = window.setInterval(() => {
        const elapsedSeconds = Math.max(1, Math.floor((Date.now() - batchStartedAt) / 1000));
        const elapsedText = elapsedSeconds < 60
          ? `${elapsedSeconds} 秒`
          : `${Math.floor(elapsedSeconds / 60)} 分 ${elapsedSeconds % 60} 秒`;
        update({
          completed,
          message: `第 ${batchNumber}/${batchTotal} 批仍在运行：${isXhsTask ? "MatrixFlow" : "MediaCrawler"} 正在采集 ${batch.length} 位达人主页，已等待 ${elapsedText}`
        });
        updateStep("profiling", {
          completed,
          total: ids.length,
          detail: `本批正在采集/等待${isXhsTask ? "小红书" : "抖音"}响应，已运行 ${elapsedText}`
        });
      }, 10_000);
      let profiled: any;
      try {
        updateUsage({ aiCalls: stateRef.current.usage.aiCalls + batch.length });
        const portraitPlatform = /小红书|xhs/i.test(task.platform) ? "xhs" : "douyin";
        profiled = await requestJson(`/api/review/${portraitPlatform}/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "portrait",
            ids: batch,
            campaignTaskId: task.id,
            workLimit: 12,
            allowFullRetry: true,
            skipObviousMismatch: true
          })
        });
      } finally {
        window.clearInterval(heartbeat);
      }
      const rows = Array.isArray(profiled.results) ? profiled.results : [];
      portraitPassed += rows.filter((item: any) => item.poolStatus === "candidate" && item.screeningStatus === "portrait_passed").length;
      insufficient += rows.filter((item: any) => item.screeningStatus === "portrait_insufficient").length;
      crawlIncomplete += rows.filter((item: any) =>
        String(item.screeningStatus).includes("incomplete") ||
        (item.poolStatus === "pending_review" && item.screeningStatus !== "portrait_insufficient")
      ).length;
      rejected += rows.filter((item: any) => ["rejected", "skipped"].includes(String(item.poolStatus))).length;
      failed += rows.filter((item: any) => item.error).length;
      totalSamples += rows.reduce((sum: number, item: any) => sum + Number(item.sampleWorkCount || 0), 0);
      completed += batch.length;
      update({ completed, message: `作品画像进度：${completed}/${ids.length}` });
      updateStep("profiling", {
        completed,
        total: ids.length,
        detail: `已处理 ${completed}/${ids.length} 人`,
        results: [
          { label: "主页作品样本", value: totalSamples, tone: "neutral" },
          { label: "画像通过", value: portraitPassed, tone: "success" },
          { label: "AI 信息不足", value: insufficient, tone: "warning" },
          { label: "采集不完整", value: crawlIncomplete, tone: "danger" },
          { label: "画像排除", value: rejected, tone: "danger" },
          { label: "失败", value: failed, tone: "warning" }
        ]
      });
      if (batch.length < Math.min(batchSize, ids.length - index)) {
        throw new AgentStopError("ai_budget_reached", "已达到 AI 调用上限，Agent 已安全停止。 ");
      }
    }

    finishStep("profiling", `主页样本与 AI 画像完成，共处理 ${ids.length} 人`, ids.length, ids.length);
    updateStep("profiling", {
      results: [
        { label: "主页作品样本", value: totalSamples, tone: "neutral" },
        { label: "进入待选", value: portraitPassed, tone: "success" },
        { label: "AI 信息不足", value: insufficient, tone: "warning" },
        { label: "采集不完整", value: crawlIncomplete, tone: "danger" },
        { label: "画像排除", value: rejected, tone: "danger" }
      ]
    });
  }

  async function reviewCandidates(ids: string[]) {
    enterStep("reviewing", "正在读取已记录指标并应用数据门槛…", ids.length);
    if (!ids.length) {
      finishStep("reviewing", "当前没有画像通过的待选达人，数据门槛无需执行", 0, 0);
      updateStep("reviewing", {
        results: [
          { label: "进入精选", value: 0, tone: "success" },
          { label: "留待选", value: 0, tone: "neutral" }
        ]
      });
      enterStep("outreach_ready", "正在生成建联队列…", 1);
      finishStep("outreach_ready", "建联队列已生成，当前新增 0 人", 1, 1);
      updateStep("outreach_ready", {
        results: [{ label: "待建联达人", value: 0, tone: "success" }]
      });
      update({ stage: "completed", message: "全链路完成；当前没有新增精选达人。" });
      return;
    }
    let completed = 0;
    let reviewSucceeded = 0;
    let reviewFailed = 0;
    let featured = 0;
    let rejected = 0;
    let pending = 0;
    const activeMetricRules = stateRef.current.metricRules || defaultMetricDraft;
    const reviewBatchSize = 30;
    for (let index = 0; index < ids.length; index += reviewBatchSize) {
      await waitWhilePaused();
      ensureWithinTime();
      const batch = ids.slice(index, index + reviewBatchSize);
      const batchNumber = Math.floor(index / reviewBatchSize) + 1;
      const batchTotal = Math.ceil(ids.length / reviewBatchSize);
      update({ completed, message: `正在处理第 ${batchNumber}/${batchTotal} 批数据门槛，本批 ${batch.length} 人` });
      updateStep("reviewing", {
        completed,
        total: ids.length,
        detail: `第 ${batchNumber}/${batchTotal} 批正在读取指标`
      });
      const reviewed = await requestJson("/api/review/douyin/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: batch,
          campaignTaskId: task.id,
          mode: "metrics",
          rules: {
            requireAvgLikes500: activeMetricRules.requireAvgLikes,
            avgLikesThreshold: activeMetricRules.avgLikesThreshold,
            requireViral2000: activeMetricRules.requireViralWorks,
            viralLikesThreshold: activeMetricRules.viralLikesThreshold,
            minViralWorks: activeMetricRules.minViralWorks,
            requireWorkCount10: activeMetricRules.requireSampleWorks,
            minSampleWorks: activeMetricRules.minSampleWorks,
            metricMatchMode: activeMetricRules.matchMode,
            requireRecentViral: false,
            requireRecentUpdate: activeMetricRules.requireRecentUpdate
          }
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
      updateUsage({ featuredAdded: featured });
      update({ completed, message: `数据门槛进度：${completed}/${ids.length}` });
      updateStep("reviewing", {
        completed,
        total: ids.length,
        detail: `已完成 ${completed}/${ids.length} 人`,
        results: [
          { label: "规则已执行", value: reviewSucceeded, tone: "success" },
          { label: "进入精选", value: featured, tone: "success" },
          { label: "留待选", value: pending, tone: "neutral" },
          { label: "画像未通过", value: rejected, tone: "danger" },
          { label: "失败", value: reviewFailed, tone: "warning" }
        ]
      });
    }
    finishStep("reviewing", `数据门槛筛选完成，共处理 ${ids.length} 人`, ids.length, ids.length);
    updateStep("reviewing", {
      results: [
        { label: "规则已执行", value: reviewSucceeded, tone: "success" },
        { label: "进入精选", value: featured, tone: "success" },
        { label: "留待选", value: pending, tone: "neutral" },
        { label: "画像未通过", value: rejected, tone: "danger" },
        { label: "失败", value: reviewFailed, tone: "warning" }
      ]
    });

    enterStep("outreach_ready", "正在生成建联队列…", 1);
    await wait(500);
    finishStep("outreach_ready", "建联队列已生成", 1, 1);
    updateStep("outreach_ready", {
      results: [{ label: "待建联达人", value: featured, tone: "success" }]
    });
    if (featured >= stateRef.current.goal.targetFeaturedCount) {
      throw new AgentStopError("target_reached", `本轮已新增 ${featured} 位精选达人并生成建联队列，达到目标。`);
    }
    update({
      stage: "completed",
      message: `单轮流程完成，本轮新增 ${featured} 位精选达人。`,
      usage: {
        ...stateRef.current.usage,
        featuredAdded: featured,
        noGrowthRounds: featured === 0 ? 1 : 0,
        stopReason: "single_round_completed"
      }
    });
  }

  async function execute(fromStage: Stage = "crawling", freshRun = false) {
    setRunning(true);
    setPaused(false);
    pauseRef.current = false;
    if (freshRun || fromStage === "crawling") {
      const startedAt = new Date().toISOString();
      const nextState = createInitialState(normalizeAgentGoal(goalDraft, task.agentGoalDefaults), featuredAtStart, normalizeAgentMetricRules(metricDraft));
      nextState.updatedAt = startedAt;
      nextState.usage.startedAt = startedAt;
      stageRef.current = "idle";
      candidatesRef.current = [];
      crawlTaskIdRef.current = "";
      stateRef.current = nextState;
      runIdRef.current = null;
      runVersionRef.current = 0;
      persistenceConflictRef.current = false;
      setState(nextState);
      try {
        await createRun(nextState);
      } catch (error) {
        const message = error instanceof Error ? error.message : "创建 Agent 运行记录失败";
        setPersistenceError(message);
        setRunning(false);
        return;
      }
    }
    try {
      if (fromStage === "crawling") await crawl();
      if (["crawling", "discovering", "importing"].includes(fromStage)) {
        await discoverCandidates();
        await importCandidates();
      }
      const savedIds = stateRef.current.importedIds;
      let profileIds = candidatesRef.current.map((candidate) => String(candidate.externalId)).filter(Boolean);
      if (!profileIds.length) profileIds = savedIds;
      if (fromStage === "profiling") profileIds = await loadQueueIds("profiling");

      if (fromStage !== "reviewing" && fromStage !== "outreach_ready") {
        if (!profileIds.length) throw new Error("当前任务没有等待补齐主页样本或 AI 画像的达人。");
        await profileCandidates(profileIds);
      }

      const metricIds = await loadQueueIds("reviewing");
      await reviewCandidates(metricIds);
    } catch (error) {
      if (error instanceof AgentStopError) {
        const stoppedAt = new Date().toISOString();
        stageRef.current = "stopped";
        setState((current) => ({
          ...current,
          stage: "stopped",
          message: error.message.trim(),
          error: "",
          updatedAt: stoppedAt,
          usage: { ...current.usage, stopReason: error.reason },
          logs: [...current.logs, `[${timeText(stoppedAt)}] 停止：${error.message.trim()}`].slice(-80)
        }));
        return;
      }
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

  async function startRemoteRun() {
    setPersistenceError("");
    const startedAt = new Date().toISOString();
    const snapshot = createInitialState(normalizeAgentGoal(goalDraft, task.agentGoalDefaults), featuredAtStart, normalizeAgentMetricRules(metricDraft));
    snapshot.updatedAt = startedAt;
    snapshot.usage.startedAt = startedAt;
    try {
      const run = await createRun(snapshot, true);
      setRunStartStage(run.startStage || startStage);
      setRounds(run.rounds || []);
      setState(normalizeSavedState(run.state, task.agentGoalDefaults));
      setRunning(true);
      setPaused(false);
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : "后台任务创建失败");
    }
  }

  async function controlRun(action: "pause" | "resume" | "cancel" | "retry") {
    const runId = runIdRef.current;
    if (!runId) return;
    try {
      const response = await fetch("/api/agent/runs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, action })
      });
      const data = (await response.json().catch(() => ({}))) as { run?: PersistedRun; error?: string };
      if (!response.ok || !data.run) throw new Error(data.error || "更新后台任务失败");
      const saved = normalizeSavedState(data.run.state, task.agentGoalDefaults);
      setRounds(data.run.rounds || []);
      setState(saved);
      setRunning(["queued", "running", "paused", "stopping"].includes(data.run.status));
      setPaused(data.run.status === "paused");
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : "更新后台任务失败");
    }
  }

  const pause = () => void controlRun("pause");
  const resume = () => void controlRun("resume");
  const retry = () => void controlRun("retry");

  const stoppedStage = state.stage === "stopped"
    ? steps.find((step) => state.metrics[step.id]?.startedAt && !state.metrics[step.id]?.finishedAt)?.id
    : undefined;
  const selectedStartIndex = runStartStage ? Math.max(0, steps.findIndex((step) => step.id === runStartStage)) : 0;
  const applicableSteps = steps.slice(selectedStartIndex);
  const completedSteps = applicableSteps.filter((step) => Boolean(state.metrics[step.id]?.finishedAt)
    && !(state.stage === "failed" && state.failedStage === step.id)).length;
  const stepProgress = state.total ? Math.min(100, Math.round((state.completed / state.total) * 100)) : 0;
  const partialStage = state.stage === "stopped" ? stoppedStage : steps.some((step) => step.id === state.stage)
    ? state.stage as WorkStage
    : undefined;
  const partialProgress = partialStage
    && applicableSteps.some((step) => step.id === partialStage)
    && !state.metrics[partialStage]?.finishedAt
    ? stepProgress / 100
    : 0;
  const overallProgress = Math.round(((completedSteps + partialProgress) / applicableSteps.length) * 100);

  const stepStatuses = useMemo(() => {
    return Object.fromEntries(steps.map((step, index) => {
      let status: StepStatus = "waiting";
      if (runStartStage && index < selectedStartIndex) status = "skipped";
      if (state.metrics[step.id]?.finishedAt) status = "success";
      if (state.stage === step.id) status = paused ? "paused" : "running";
      if (state.stage === "failed" && state.failedStage === step.id) status = "failed";
      if (state.stage === "stopped" && stoppedStage === step.id) status = "stopped";
      return [step.id, status];
    })) as Record<WorkStage, StepStatus>;
  }, [paused, runStartStage, selectedStartIndex, state.failedStage, state.metrics, state.stage, stoppedStage]);

  return (
    <section className="panel agent-pipeline-panel">
      <div className="panel-header">
        <div>
          <span className="agent-section-kicker">02 · 一键执行</span>
          <h2>一键执行 Agent</h2>
          <p>选择起点后启动，Agent 会按顺序完成筛选并持续显示进度。</p>
        </div>
        <span className={`agent-pipeline-badge ${state.stage}`}>{stageLabels[state.stage]}</span>
      </div>

      <div className="agent-overall">
        <div className="agent-overall-heading">
          <strong>整条流程</strong>
          <span>{completedSteps}/{applicableSteps.length} 个本次步骤 · {overallProgress}%</span>
        </div>
        <div className="agent-pipeline-progress" aria-label={`整条流程完成 ${overallProgress}%`}>
          <div style={{ width: `${overallProgress}%` }} />
        </div>
      </div>

      <details className="agent-goal-editor" open={state.stage === "idle"}>
        <summary>
          <span><strong>本轮目标与停止条件</strong><small>未修改时使用当前任务的默认值</small></span>
          <b><span aria-hidden="true">⚙</span> 编辑目标</b>
        </summary>
        <div className="agent-goal-grid">
          {([
            ["targetFeaturedCount", "新增精选目标", "人"],
            ["maxCollectedWorks", "单个关键词采集", "条/词"],
            ["maxAiCalls", "最多 AI 画像", "人次"],
            ["maxDurationMinutes", "最长运行", "分钟"],
            ["maxNoGrowthRounds", "无新增停止", "轮"],
            ["maxRounds", "最多运行", "轮"]
          ] as Array<[keyof AgentGoal, string, string]>).map(([key, label, unit]) => (
            <label key={key}>
              <span>{label}</span>
              <div><input disabled={running} min="1" type="number" value={goalDraft[key]} onChange={(event) => setGoalDraft((goal) => ({ ...goal, [key]: Number(event.target.value) }))} /><em>{unit}</em></div>
            </label>
          ))}
        </div>
        <div className="agent-metric-editor">
          <div className="agent-metric-heading">
            <label>
              <input
                checked={metricDraft.useCustom}
                disabled={running}
                onChange={(event) => setMetricDraft((current) => ({ ...current, useCustom: event.target.checked }))}
                type="checkbox"
              />
              <span><strong>自定义本轮数据门槛</strong><small>不勾选时使用当前品类默认值</small></span>
            </label>
            <select disabled={running || !metricDraft.useCustom} onChange={(event) => setMetricDraft((current) => ({ ...current, matchMode: event.target.value === "all" ? "all" : "any" }))} value={metricDraft.matchMode}>
              <option value="any">点赞与爆款满足任一项</option>
              <option value="all">点赞与爆款全部满足</option>
            </select>
          </div>
          <div className="agent-metric-grid">
            <label>
              <span><input checked={metricDraft.requireAvgLikes} disabled={running || !metricDraft.useCustom} onChange={(event) => setMetricDraft((current) => ({ ...current, requireAvgLikes: event.target.checked }))} type="checkbox" /> 平均点赞</span>
              <input disabled={running || !metricDraft.useCustom || !metricDraft.requireAvgLikes} min="0" onChange={(event) => setMetricDraft((current) => ({ ...current, avgLikesThreshold: Number(event.target.value) }))} type="number" value={metricDraft.avgLikesThreshold} />
            </label>
            <label>
              <span><input checked={metricDraft.requireViralWorks} disabled={running || !metricDraft.useCustom} onChange={(event) => setMetricDraft((current) => ({ ...current, requireViralWorks: event.target.checked }))} type="checkbox" /> 爆款作品</span>
              <div><input disabled={running || !metricDraft.useCustom || !metricDraft.requireViralWorks} min="1" onChange={(event) => setMetricDraft((current) => ({ ...current, minViralWorks: Number(event.target.value) }))} type="number" value={metricDraft.minViralWorks} /><em>条，点赞 ≥</em><input disabled={running || !metricDraft.useCustom || !metricDraft.requireViralWorks} min="0" onChange={(event) => setMetricDraft((current) => ({ ...current, viralLikesThreshold: Number(event.target.value) }))} type="number" value={metricDraft.viralLikesThreshold} /></div>
            </label>
            <label>
              <span><input checked={metricDraft.requireSampleWorks} disabled={running || !metricDraft.useCustom} onChange={(event) => setMetricDraft((current) => ({ ...current, requireSampleWorks: event.target.checked }))} type="checkbox" /> 主页样本数</span>
              <input disabled={running || !metricDraft.useCustom || !metricDraft.requireSampleWorks} min="1" onChange={(event) => setMetricDraft((current) => ({ ...current, minSampleWorks: Number(event.target.value) }))} type="number" value={metricDraft.minSampleWorks} />
            </label>
            <label className="agent-metric-check-only">
              <span><input checked={metricDraft.requireRecentUpdate} disabled={running || !metricDraft.useCustom} onChange={(event) => setMetricDraft((current) => ({ ...current, requireRecentUpdate: event.target.checked }))} type="checkbox" /> 近1个月有更新</span>
              <small>关闭时不限制更新时间</small>
            </label>
          </div>
        </div>
        <div className="task-actions agent-goal-actions">
          <button className="secondary-button" disabled={running} onClick={() => setGoalDraft(task.agentGoalDefaults)} type="button">恢复任务默认值</button>
          <button className="secondary-button" disabled={running || goalSaving} onClick={() => void saveGoalDefaults()} type="button">{goalSaving ? "保存中…" : "保存为任务默认值"}</button>
          <span>{goalMessage || "直接修改只影响下一次运行；保存后才会成为该任务默认值。"}</span>
        </div>
        <p className="agent-goal-note">每轮使用一个采集关键词；未达到目标时自动切换下一个关键词，直到命中任一停止条件。</p>
      </details>

      <div className="agent-budget-grid">
        <div><span>本次进入精选</span><strong>{state.usage.featuredAdded}/{state.goal.targetFeaturedCount}</strong></div>
        <div><span>采集作品总数</span><strong>{state.usage.collectedWorks}</strong><small>{task.seedKeywords.length} 个关键词 · 每词最多 {state.goal.maxCollectedWorks} 条</small></div>
        <div><span>实际 AI 调用</span><strong>{state.usage.aiCalls}/{state.goal.maxAiCalls}</strong></div>
        <div><span>运行时长</span><strong>{state.usage.startedAt ? durationText(state.usage.startedAt, state.stage === "completed" || state.stage === "stopped" || state.stage === "failed" ? state.updatedAt : undefined, now) : "0 秒"} / {state.goal.maxDurationMinutes} 分</strong></div>
        <div><span>运行轮次</span><strong>{state.usage.currentRound}/{state.goal.maxRounds}</strong></div>
      </div>

      <div className="task-actions agent-primary-actions">
        {agentMode === "queue" ? (
          <label className="agent-start-stage">
            <span>在这台电脑采集</span>
            <select disabled={running} onChange={(event) => setAgentDeviceId(event.target.value)} value={agentDeviceId}>
              {onlineAgents.length ? onlineAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}（在线）</option>) : <option value="">未检测到采集助手</option>}
            </select>
          </label>
        ) : null}
        <label className="agent-start-stage">
          <span>从哪一步开始</span>
          <select disabled={running} onChange={(event) => setStartStage(event.target.value as StartStage)} value={startStage}>
            <option value="crawling">1. 完整流程（先消化待画像，不足再采集）</option>
            <option value="discovering">2. 从已有采集结果聚合开始</option>
            <option value="profiling">3. 从样本与 AI 画像开始（{queueCounts.profiling} 人）</option>
            <option value="reviewing">4. 从待选库数据门槛开始（{queueCounts.reviewing} 人）</option>
          </select>
        </label>
        <button disabled={running || !hydrated || Boolean(persistenceError) || (agentMode === "queue" && !agentDeviceId)} onClick={() => void startRemoteRun()} type="button">
          {!hydrated ? "正在恢复运行状态…" : running ? "后台 Agent 执行中…" : startStage === "crawling" ? "启动后台完整流程" : "从所选步骤后台启动"}
        </button>
        {running && !paused ? <button className="secondary-button" onClick={pause} type="button">暂停</button> : null}
        {running && paused ? <button className="secondary-button" onClick={resume} type="button">继续</button> : null}
        {running ? <button className="secondary-button" onClick={() => void controlRun("cancel")} type="button">取消运行</button> : null}
        {state.stage === "failed" ? <button className="secondary-button" disabled={running} onClick={retry} type="button">从失败步骤重试</button> : null}
        {state.stage === "stopped" && ["ai_budget_reached", "time_limit_reached"].includes(state.usage.stopReason || "") ? (
          <button className="secondary-button" disabled={running} onClick={retry} type="button">从停止步骤重新运行</button>
        ) : null}
      {state.stage === "completed" || state.stage === "stopped" ? (
          <Link className="button-link" href={`/tasks?campaignTaskId=${task.id}`}>查看建联队列</Link>
        ) : null}
      </div>

      <div className="agent-step-grid">
        {steps.map((step, index) => {
          const status = stepStatuses[step.id];
          const metric = state.metrics[step.id];
          return (
            <article className={`agent-step-card ${status}`} key={step.id}>
              <div className="agent-step-top">
                <span className="agent-step-number">
                  {status === "success" ? "✓" : status === "failed" ? "!" : status === "stopped" ? "■" : status === "skipped" ? "—" : index + 1}
                </span>
                <span className={`agent-step-status ${status}`}>
                  {status === "waiting" ? "等待" : status === "running" ? "进行中" : status === "paused" ? "已暂停" : status === "success" ? "完成" : status === "stopped" ? "已停止" : status === "skipped" ? "本次跳过" : "失败"}
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
      {persistenceError ? <p className="form-error">运行状态数据库异常：{persistenceError}</p> : null}

      {state.logs.length ? (
        <details className="agent-log-panel" open={running || state.stage === "failed"}>
          <summary>实时执行日志（最近 {state.logs.length} 条）</summary>
          <pre>{state.logs.join("\n")}</pre>
        </details>
      ) : null}

    </section>
  );
}
