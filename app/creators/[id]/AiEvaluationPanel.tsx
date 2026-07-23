"use client";

import { useState } from "react";
import type { AiEvaluationResult } from "@/lib/ai";

type AiEvaluationPanelProps = {
  creatorId: string;
  profileUrl: string;
};

export function AiEvaluationPanel({ creatorId, profileUrl }: AiEvaluationPanelProps) {
  const [evaluation, setEvaluation] = useState<AiEvaluationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function runEvaluation() {
    setLoading(true);
    setMessage("");

    const response = await fetch(`/api/creators/${encodeURIComponent(creatorId)}/ai-evaluate`, {
      method: "POST"
    });
    const result = (await response.json().catch(() => ({}))) as {
      evaluation?: AiEvaluationResult;
      error?: string;
    };

    setLoading(false);

    if (!response.ok || !result.evaluation) {
      setMessage(result.error || "AI 评估失败");
      return;
    }

    setEvaluation(result.evaluation);
  }

  async function copyScriptAndOpenProfile() {
    if (!evaluation?.outreachScript) return;
    try {
      await navigator.clipboard.writeText(evaluation.outreachScript);
      if (profileUrl) {
        window.open(profileUrl, "_blank", "noopener,noreferrer");
        setMessage("话术已复制，已打开达人主页。发送前再人工确认一下。");
        return;
      }
      setMessage("话术已复制，但这个达人没有主页链接。");
    } catch {
      if (profileUrl) {
        window.open(profileUrl, "_blank", "noopener,noreferrer");
        setMessage("已打开达人主页，但浏览器没有允许自动复制话术，请手动复制。");
        return;
      }
      setMessage("复制失败，且这个达人没有主页链接。");
    }
  }

  return (
    <section className="panel ai-panel">
      <div className="panel-header">
        <div>
          <h2>AI 筛选与话术</h2>
          <p>生成匹配分、风险标签、合作建议和建联话术。发送前仍需人工确认。</p>
        </div>
        <button disabled={loading} onClick={runEvaluation} type="button">
          {loading ? "分析中" : "AI评估"}
        </button>
      </div>

      {message ? <p className="task-message">{message}</p> : null}

      {evaluation ? (
        <div className="ai-result">
          <div className="ai-score">
            <strong>{evaluation.matchScore}</strong>
            <span>匹配分</span>
          </div>
          <div className="ai-summary">
            <dl>
              <div>
                <dt>推荐动作</dt>
                <dd>{evaluation.recommendedAction}</dd>
              </div>
              <div>
                <dt>合作形式</dt>
                <dd>{evaluation.suggestedCooperation}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>{evaluation.source === "ai" ? "AI 接口" : "本地规则兜底"}</dd>
              </div>
            </dl>
            <div className="risk-tags">
              {evaluation.riskTags.length ? evaluation.riskTags.map((tag) => <span key={tag}>{tag}</span>) : <span>暂无明显风险</span>}
            </div>
          </div>
          <p className="notes">{evaluation.reason}</p>
          <p className="task-action">{evaluation.negotiationPoint}</p>
          <pre>{evaluation.outreachScript}</pre>
          <button onClick={copyScriptAndOpenProfile} type="button">
            复制话术并打开达人主页
          </button>
        </div>
      ) : (
        <p className="empty-state">点击 AI评估 后生成筛选建议和话术。</p>
      )}
    </section>
  );
}
