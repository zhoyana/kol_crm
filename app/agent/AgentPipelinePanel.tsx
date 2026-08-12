"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CampaignTaskItem } from "@/lib/campaign-tasks";

type Stage = "idle" | "crawling" | "discovering" | "screening" | "importing" | "reviewing" | "outreach_ready" | "completed" | "failed";

type PipelineState = {
  stage: Stage;
  failedStage?: Stage;
  message: string;
  completed: number;
  total: number;
  importedIds: string[];
  error: string;
  updatedAt: string;
};

const initialState: PipelineState = {
  stage: "idle",
  message: "等待启动",
  completed: 0,
  total: 0,
  importedIds: [],
  error: "",
  updatedAt: ""
};

const stageLabels: Record<Stage, string> = {
  idle: "等待启动",
  crawling: "采集作品",
  discovering: "聚合达人",
  screening: "AI候选初筛",
  importing: "加入复筛池",
  reviewing: "主页分批复筛",
  outreach_ready: "生成建联队列",
  completed: "已完成",
  failed: "执行失败"
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function termsFromText(value: string): string[] {
  return value.split(/[,，、\n]/).map((item) => item.trim()).filter((item) => item.length >= 2);
}

export function AgentPipelinePanel({ task }: { task: CampaignTaskItem }) {
  const storageKey = `kol-crm-agent-pipeline:${task.id}`;
  const pauseRef = useRef(false);
  const stageRef = useRef<Stage>("idle");
  const candidatesRef = useRef<any[]>([]);
  const [state, setState] = useState<PipelineState>(initialState);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null") as PipelineState | null;
      if (!saved) return;
      if (["crawling", "discovering", "screening", "importing", "reviewing"].includes(saved.stage)) {
        stageRef.current = "failed";
        setState({ ...saved, stage: "failed", failedStage: saved.stage, error: "上次执行被中断，可以重试。" });
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

  function update(patch: Partial<PipelineState>) {
    if (patch.stage) stageRef.current = patch.stage;
    setState((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));
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
    update({ stage: "crawling", message: "正在启动关键词采集…", completed: 0, total: 1, error: "" });
    const keyword = task.seedKeywords.join(",");
    await requestJson("/api/crawler/douyin/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword,
        campaignTaskId: task.id,
        maxNotes: 50,
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

    while (true) {
      await waitWhilePaused();
      const crawler = await requestJson("/api/crawler/douyin/status");
      const logs = Array.isArray(crawler.logs) ? crawler.logs : [];
      update({ message: logs.at(-1) || `采集状态：${crawler.status}` });
      if (crawler.status === "succeeded") break;
      if (crawler.status === "failed" || crawler.status === "stopped") {
        throw new Error(crawler.error || `采集任务${crawler.status}`);
      }
      await wait(2_000);
    }
    update({ completed: 1, message: "采集完成，开始聚合达人。" });
  }

  async function discoverAndScreen() {
    await waitWhilePaused();
    update({ stage: "discovering", message: "正在从采集结果聚合候选达人…", completed: 0, total: 1 });
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
    if (!candidatesRef.current.length) throw new Error("达人聚合完成，但没有可进入AI初筛的新候选。");

    update({
      stage: "screening",
      message: `正在AI初筛 ${candidatesRef.current.length} 位候选…`,
      completed: 0,
      total: candidatesRef.current.length
    });
    const screened = await requestJson("/api/ai/candidate-screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, campaignTaskId: task.id, candidates: candidatesRef.current })
    });
    const decisionMap = new Map((screened.decisions || []).map((item: any) => [String(item.id), item]));
    candidatesRef.current = candidatesRef.current
      .filter((candidate) => (decisionMap.get(candidate.externalId) as any)?.decision !== "drop")
      .map((candidate) => {
        const decision: any = decisionMap.get(candidate.externalId);
        if (!decision) return candidate;
        return {
          ...candidate,
          screeningStatus: decision.decision === "keep" ? "candidate_strong" : "candidate_observe",
          screeningSummary: `${candidate.screeningSummary || ""}；AI${decision.decision}：${decision.reason || "未说明"}`
        };
      });
    update({
      completed: candidatesRef.current.length,
      total: candidatesRef.current.length,
      message: `AI初筛完成，保留 ${candidatesRef.current.length} 人。`
    });
  }

  async function importCandidates() {
    await waitWhilePaused();
    update({ stage: "importing", message: "正在加入待复筛池…", completed: 0, total: candidatesRef.current.length });
    if (!candidatesRef.current.length) throw new Error("没有可导入候选，请从达人聚合步骤重试。");
    await requestJson("/api/discover/douyin/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: candidatesRef.current, campaignTaskId: task.id })
    });
    const importedIds = candidatesRef.current.map((candidate) => String(candidate.externalId)).filter(Boolean);
    update({
      importedIds,
      completed: importedIds.length,
      total: importedIds.length,
      message: `已加入复筛池 ${importedIds.length} 人。`
    });
  }

  async function reviewCandidates(ids: string[]) {
    if (!ids.length) throw new Error("没有待复筛达人ID，请重新执行达人发现。");
    update({ stage: "reviewing", message: "正在分批进行主页复筛…", completed: 0, total: ids.length });
    let completed = 0;
    for (let index = 0; index < ids.length; index += 30) {
      await waitWhilePaused();
      const batch = ids.slice(index, index + 30);
      await requestJson("/api/review/douyin/batch", {
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
      completed += batch.length;
      update({ completed, message: `主页复筛进度：${completed}/${ids.length}` });
    }
    update({ stage: "outreach_ready", message: "主页复筛完成，正在生成建联任务入口。", completed: ids.length });
    await wait(500);
    update({ stage: "completed", message: "全链路完成，精选达人已进入建联队列。" });
  }

  async function execute(fromStage: Stage = "crawling") {
    setRunning(true);
    setPaused(false);
    pauseRef.current = false;
    try {
      if (fromStage === "crawling") await crawl();
      if (["crawling", "discovering", "screening", "importing"].includes(fromStage)) {
        await discoverAndScreen();
        await importCandidates();
      }
      const ids = state.importedIds.length && fromStage === "reviewing"
        ? state.importedIds
        : candidatesRef.current.map((candidate) => String(candidate.externalId)).filter(Boolean);
      await reviewCandidates(ids);
    } catch (error) {
      const currentStage = stageRef.current === "failed" ? fromStage : stageRef.current;
      update({
        stage: "failed",
        failedStage: currentStage,
        error: error instanceof Error ? error.message : "Agent执行失败",
        message: "执行失败，可以从失败步骤重试。"
      });
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
    let failedStage = state.failedStage || "crawling";
    if (["discovering", "screening", "importing"].includes(failedStage) && !candidatesRef.current.length) {
      failedStage = "discovering";
    }
    void execute(failedStage);
  }

  const progress = state.total ? Math.min(100, Math.round((state.completed / state.total) * 100)) : 0;

  return (
    <section className="panel agent-pipeline-panel">
      <div className="panel-header">
        <div>
          <h2>一键执行 Agent</h2>
          <p>自动完成采集、AI初筛、导入、分批主页复筛，并生成建联队列。</p>
        </div>
        <strong>{stageLabels[state.stage]}</strong>
      </div>
      <div className="agent-pipeline-progress">
        <div style={{ width: `${progress}%` }} />
      </div>
      <p>{state.message}</p>
      {state.total ? <span>当前步骤进度：{state.completed}/{state.total}（{progress}%）</span> : null}
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <div className="task-actions">
        <button disabled={running || state.stage === "completed"} onClick={() => void execute("crawling")} type="button">
          {running ? "Agent执行中…" : "启动完整流程"}
        </button>
        {running && !paused ? <button className="secondary-button" onClick={pause} type="button">暂停</button> : null}
        {running && paused ? <button className="secondary-button" onClick={resume} type="button">继续</button> : null}
        {state.stage === "failed" ? <button className="secondary-button" disabled={running} onClick={retry} type="button">从失败步骤重试</button> : null}
        {state.stage === "completed" ? (
          <Link className="button-link" href={`/tasks?campaignTaskId=${task.id}`}>查看建联队列</Link>
        ) : null}
      </div>
    </section>
  );
}
