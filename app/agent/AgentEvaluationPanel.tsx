"use client";

import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { AGENT_ACTION_PROTOCOL, AGENT_LOOP } from "@/lib/agent-action-protocol";

type Metrics = {
  sampleSize: number; labeledSize: number; doubleLabeledSize: number;
  accuracy: number | null; precision: number | null; recall: number | null;
  humanAgreement: number | null; outreachPassRate: number | null;
  outreachDirectPassRate: number | null; aiCalls: number; totalCost: number;
  costPerCreator: number | null;
};
type EvaluationCase = {
  id: number; caseKey: string; humanADecision: string | null;
  humanBDecision: string | null; adjudicatedDecision: string | null;
  outreachReview: string | null;
};

function percent(value: number | null) { return value === null ? "—" : `${(value * 100).toFixed(1)}%`; }

export function AgentEvaluationPanel({ campaignTaskId }: { campaignTaskId: number | null }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [cases, setCases] = useState<EvaluationCase[]>([]);
  const [sampleSize, setSampleSize] = useState(60);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!campaignTaskId) { setMetrics(null); setCases([]); return; }
    const response = await fetch(`/api/agent/evaluation?campaignTaskId=${campaignTaskId}`, { cache: "no-store" });
    const data = await response.json();
    if (response.ok) { setMetrics(data.metrics); setCases(data.cases || []); }
  }, [campaignTaskId]);

  useEffect(() => { void load(); }, [load]);

  async function createDataset() {
    if (!campaignTaskId) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/agent/evaluation", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignTaskId, sampleSize, datasetVersion: "v1" })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "建立评测集失败");
      setMessage(`已冻结 ${data.total} 条真实样本，本次新增 ${data.created} 条。`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "建立评测集失败"); }
    finally { setBusy(false); }
  }

  async function importLabels() {
    if (!campaignTaskId || !file) return;
    setBusy(true); setMessage("");
    try {
      const form = new FormData();
      form.append("campaignTaskId", String(campaignTaskId)); form.append("file", file);
      const response = await fetch("/api/agent/evaluation/import", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "导入失败");
      setMessage(`已导入 ${data.updated} 条标注${data.errors?.length ? `；${data.errors.length} 条需检查：${data.errors[0]}` : "。"}`);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "导入失败"); }
    finally { setBusy(false); }
  }

  const costReady = Boolean(metrics?.aiCalls);
  return (
    <section className="panel agent-panel agent-evaluation-panel">
      <div className="panel-header">
        <div><span className="agent-section-kicker">03 · 真实评测与治理</span><h2>可评测业务 Agent</h2><p>从当前任务冻结真实样本，盲标后回传，系统自动计算业务指标。</p></div>
        <span className="agent-task-count">真实集 v1 · {metrics?.sampleSize || 0} 条</span>
      </div>

      <div className="agent-eval-metrics">
        <article><span>筛选准确率</span><strong>{percent(metrics?.accuracy ?? null)}</strong><small>{metrics?.labeledSize || 0} 条已有人工金标</small></article>
        <article><span>筛选精确率</span><strong>{percent(metrics?.precision ?? null)}</strong><small>Agent 判通过中人工认可</small></article>
        <article><span>人工一致率</span><strong>{percent(metrics?.humanAgreement ?? null)}</strong><small>{metrics?.doubleLabeledSize || 0} 条完成双人盲标</small></article>
        <article><span>AI 调用成本</span><strong>{costReady ? `¥${metrics!.totalCost.toFixed(2)}` : "待接入"}</strong><small>{costReady ? `${metrics!.aiCalls} 次 · ¥${(metrics!.costPerCreator || 0).toFixed(3)}/人` : "需记录每次模型 Token 与费用"}</small></article>
        <article><span>话术通过率</span><strong>{percent(metrics?.outreachPassRate ?? null)}</strong><small>直接或修改后通过</small></article>
      </div>

      <div className="agent-eval-workflow">
        <label>样本数（建议 50–100 条）<input type="number" min={1} max={100} value={sampleSize} onChange={(event) => setSampleSize(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} /></label>
        <button type="button" className="primary-button" disabled={!campaignTaskId || busy} onClick={createDataset}>{busy ? "处理中…" : "1. 冻结真实评测集"}</button>
        <a className={`secondary-button${cases.length ? "" : " disabled"}`} href={cases.length && campaignTaskId ? `/api/agent/evaluation/export?campaignTaskId=${campaignTaskId}` : undefined}>2. 导出盲标 Excel</a>
        <label>3. 选择已标注 Excel<input type="file" accept=".xlsx" onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] || null)} /></label>
        <button type="button" className="primary-button" disabled={!campaignTaskId || !file || busy} onClick={importLabels}>4. 导入并计算指标</button>
      </div>
      {message ? <p className="agent-eval-message">{message}</p> : null}
      {!campaignTaskId ? <p className="agent-eval-message">请先在上方选择一个推广任务。</p> : null}

      <div className="agent-loop-strip" aria-label="Agent 完整闭环">
        {AGENT_LOOP.map((step, index) => <div key={step}><b>{index + 1}</b><span>{step}</span><small>{["读取队列、预算与证据", "选择唯一动作并写明理由", "按权限与上限执行", "复算结果并记录偏差"][index]}</small></div>)}
      </div>

      <details className="agent-protocol-details">
        <summary><span><strong>有限动作协议</strong><small>7 个动作；话术只生成草稿，发送权始终留给人工</small></span><b>查看边界</b></summary>
        <div className="agent-protocol-table"><div className="head"><span>动作</span><span>执行前置条件</span><span>副作用</span><span>验证</span></div>{AGENT_ACTION_PROTOCOL.map((action) => <div key={action.id}><strong>{action.label}</strong><span>{action.guard}</span><span>{action.effect}</span><span>{action.verify}</span></div>)}</div>
      </details>

      {cases.length ? <details className="agent-protocol-details"><summary><span><strong>真实标注进度</strong><small>{metrics?.labeledSize || 0}/{cases.length} 条已标注</small></span><b>查看样本</b></summary><div className="agent-eval-samples">{cases.slice(0, 12).map((item) => <div key={item.id}><code>{item.caseKey}</code><span>A：{item.humanADecision || "未标"} · B：{item.humanBDecision || "未标"}</span><b className={item.humanADecision ? "pass" : "miss"}>{item.adjudicatedDecision ? "已裁决" : item.humanADecision ? "已回传" : "待标注"}</b></div>)}</div><p className="agent-eval-note">页面不展示 Agent 原结论，避免影响人工盲标；指标使用全部冻结样本。</p></details> : null}
    </section>
  );
}
