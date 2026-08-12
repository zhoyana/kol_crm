"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Conversation = {
  id: number;
  status: string;
  lastPreview: string | null;
  lastInboundAt: string | null;
  unreadCount: number;
  creator: { name: string; profileUrl: string | null; outreachStatus: string };
};

type AiSuggestionRecord = {
  id: number;
  intent: string;
  intentLabel: string;
  sentiment: string;
  sentimentLabel: string;
  summary: string;
  suggestedAction: string;
  draft: string;
  draftReason: string | null;
  riskLevel: string;
  source: string;
  adopted: boolean | null;
  createdAt: string;
};

type FeedbackRecord = {
  id: number;
  verdict: string;
  originalDraft: string | null;
  finalContent: string | null;
  action: string | null;
  note: string | null;
  createdAt: string;
};

type ConversationDetail = {
  id: number;
  creator: { id: number; name: string; profileUrl: string | null };
  messages: Array<{ id: number; direction: string; content: string; createdAt: string; sentAt?: string | null }>;
  syncError?: string | null;
  currentStage?: string | null;
  cooperationResult?: string | null;
  aiSuggestions?: AiSuggestionRecord[];
  feedbacks?: FeedbackRecord[];
};

type ReplyAnalysis = {
  intent: string;
  intentLabel: string;
  sentiment: string;
  sentimentLabel: string;
  summary: string;
  suggestedAction: string;
  draft: string;
  draftReason: string;
  riskLevel: string;
  source: "ai" | "fallback";
};

const intentColor: Record<string, string> = {
  interested: "intent-interested",
  declined: "intent-declined",
  price_inquiry: "intent-price",
  needs_followup: "intent-followup",
  other: "intent-other"
};

const sentimentColor: Record<string, string> = {
  positive: "sentiment-positive",
  neutral: "sentiment-neutral",
  negative: "sentiment-negative"
};

const riskColor: Record<string, string> = {
  low: "risk-low",
  medium: "risk-medium",
  high: "risk-high"
};

const riskLabel: Record<string, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险"
};

const verdictLabel: Record<string, string> = {
  adopted: "采纳",
  modified: "已修改",
  rejected: "拒绝",
  manual: "手动发送"
};

const stageLabel: Record<string, string> = {
  initial_sent: "已初次建联",
  negotiating: "谈判中",
  sample_sent: "已寄样",
  contract_signed: "已签约",
  content_review: "内容审核",
  published: "已发布",
  settled: "已结算"
};

function formatTime(value?: string | null): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "";
  }
}

export function InboxMonitorPanel({ conversations }: { conversations: Conversation[] }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);

  const [analysis, setAnalysis] = useState<ReplyAnalysis | null>(null);
  const [suggestionId, setSuggestionId] = useState<number | null>(null);
  const [originalDraft, setOriginalDraft] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState("");

  const [showHistory, setShowHistory] = useState(false);

  const pending = conversations.filter((item) => item.unreadCount > 0 || item.status === "needs_reply");

  async function syncNow() {
    setSyncing(true); setMessage("");
    try {
      const response = await fetch("/api/outreach/inbox/sync", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.error || "回复同步失败。"); return; }
      setMessage(data.message || "回复同步完成。");
      router.refresh();
    } catch { setMessage("回复同步接口没有响应，请确认网站和专用 Chrome 正在运行。"); }
    finally { setSyncing(false); }
  }

  function resetConversationState() {
    setAnalysis(null);
    setSuggestionId(null);
    setOriginalDraft("");
    setAnalyzeError("");
    setDraft("");
    setSendResult("");
    setShowHistory(false);
  }

  async function openConversation(id: number) {
    setOpeningId(id); setMessage("");
    try {
      const response = await fetch(`/api/outreach/inbox/${id}`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(data.error || "读取会话详情失败。"); return; }
      resetConversationState();
      setDetail(data.conversation);
      router.refresh();
    } catch { setMessage("会话详情接口没有响应，请确认专用 Chrome 正在运行。"); }
    finally { setOpeningId(null); }
  }

  function closeConversation() {
    setDetail(null);
    resetConversationState();
  }

  async function runAnalysis() {
    if (!detail) return;
    setAnalyzing(true); setAnalyzeError("");
    try {
      const response = await fetch(`/api/outreach/inbox/${detail.id}/reply-draft`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setAnalyzeError(data.error || "AI 分析失败。"); return; }
      setAnalysis(data.analysis);
      setSuggestionId(data.suggestionId ?? null);
      setOriginalDraft(data.analysis.draft || "");
      setDraft(data.analysis.draft || "");
    } catch { setAnalyzeError("AI 分析接口没有响应，请确认服务正常。"); }
    finally { setAnalyzing(false); }
  }

  async function sendReply() {
    if (!detail || !draft.trim()) return;
    if (draft.length > 500) { setSendResult("回复内容不能超过 500 字。"); return; }
    setSending(true); setSendResult("");

    // Determine whether the operator modified the AI draft.
    const trimmedDraft = draft.trim();
    const verdict = suggestionId && originalDraft && trimmedDraft !== originalDraft.trim()
      ? "modified" as const
      : suggestionId ? "adopted" as const : "manual" as const;

    try {
      const response = await fetch("/api/outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorId: String(detail.creator.id),
          profileUrl: detail.creator.profileUrl || "",
          message: trimmedDraft,
          taskKind: "followup",
          suggestionId: suggestionId ?? undefined,
          originalDraft: originalDraft || undefined,
          verdict
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setSendResult(data.error || "发送失败。"); return; }
      setSendResult(data.message || "回复已发送。");
      setDraft("");
      setAnalysis(null);
      setSuggestionId(null);
      setTimeout(() => { closeConversation(); router.refresh(); }, 1500);
    } catch { setSendResult("发送接口没有响应，请确认专用 Chrome 正在运行。"); }
    finally { setSending(false); }
  }

  return <section className="panel inbox-monitor-panel">
    <div className="panel-header">
      <div><h2>回复监控</h2><p>同步已建联达人的可见会话；点击会话卡片打开聊天窗口，可 AI 分析回复意图、生成回复草稿并人工确认发送。</p></div>
      <button className="secondary-button" disabled={syncing} onClick={syncNow} type="button">{syncing ? "同步中…" : "同步会话"}</button>
    </div>
    <div className="inbox-monitor-summary"><strong>{pending.length}</strong><span>待处理回复</span><strong>{conversations.length}</strong><span>已识别会话</span></div>
    {message ? <p className="task-message">{message}</p> : null}
    <div className="inbox-monitor-list">
      {conversations.length ? conversations.slice(0, 8).map((item) => <button className={`inbox-monitor-item ${item.unreadCount ? "unread" : ""}`} disabled={openingId !== null} key={item.id} onClick={() => openConversation(item.id)} type="button">
        <div><strong>{item.creator.name}</strong><span>{item.unreadCount ? `未读 ${item.unreadCount}` : "等待回复"}</span></div>
        <p>{item.lastPreview || "暂未读取到消息内容"}</p>
        <small>{openingId === item.id ? "正在读取会话详情…" : item.lastInboundAt ? new Date(item.lastInboundAt).toLocaleString("zh-CN", { hour12: false }) : "点击查看会话"}</small>
      </button>) : <p className="empty-state">暂无已同步会话。点击"同步会话"后，系统会从当前登录的抖音账号读取已建联达人的可见私信。</p>}
    </div>

    {detail ? <div className="inbox-dialog-backdrop" onMouseDown={closeConversation} role="presentation">
      <section aria-label={`${detail.creator.name} 的私信详情`} className="inbox-dialog inbox-chat-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="inbox-chat-header">
          <div className="inbox-chat-header-info">
            <h3>{detail.creator.name}</h3>
            <p>
              {detail.currentStage ? <span className="inbox-stage-tag">{stageLabel[detail.currentStage] || detail.currentStage}</span> : null}
              点击「AI 分析」识别达人意图并生成回复草稿，确认后发送。
            </p>
          </div>
          <button className="secondary-button" onClick={closeConversation} type="button">关闭</button>
        </div>

        <div className="inbox-message-list inbox-chat-messages">
          {detail.syncError ? (
            <p className="inbox-sync-warning">⚠️ 抖音消息同步失败：{detail.syncError}</p>
          ) : null}
          {detail.messages.length ? detail.messages.map((item) => (
            <div className={`inbox-bubble ${item.direction === "outbound" ? "outbound" : "inbound"}`} key={item.id}>
              <p>{item.content}</p>
              <small>{formatTime(item.sentAt || item.createdAt)}</small>
            </div>
          )) : <p className="empty-state">该会话已打开，但暂未读取到可识别的消息气泡。</p>}
        </div>

        <div className="inbox-chat-actions">
          <button className="inbox-ai-button" disabled={analyzing} onClick={runAnalysis} type="button">
            {analyzing ? "AI 分析中…" : analysis ? "重新分析" : "AI 分析回复"}
          </button>
          {detail.aiSuggestions && detail.aiSuggestions.length > 0 ? (
            <button className="inbox-history-toggle" onClick={() => setShowHistory(!showHistory)} type="button">
              {showHistory ? "隐藏历史" : `AI 建议 ${detail.aiSuggestions.length}`}
            </button>
          ) : null}
          {analyzeError ? <span className="inbox-chat-error">{analyzeError}</span> : null}
        </div>

        {showHistory && detail.aiSuggestions && detail.aiSuggestions.length > 0 ? (
          <div className="inbox-history-list">
            {detail.aiSuggestions.map((s) => (
              <div className="inbox-history-item" key={s.id}>
                <div className="inbox-history-tags">
                  <span className={`inbox-tag ${intentColor[s.intent] || "intent-other"}`}>{s.intentLabel}</span>
                  <span className={`inbox-tag ${riskColor[s.riskLevel] || "risk-low"}`}>{riskLabel[s.riskLevel] || s.riskLevel}</span>
                  {s.adopted ? <span className="inbox-tag tag-adopted">已采纳</span> : null}
                  <small className="inbox-history-time">{formatTime(s.createdAt)}</small>
                </div>
                <p className="inbox-history-draft">{s.draft}</p>
              </div>
            ))}
            {detail.feedbacks && detail.feedbacks.length > 0 ? (
              <div className="inbox-feedback-history">
                <h4>发送记录</h4>
                {detail.feedbacks.map((f) => (
                  <div className="inbox-feedback-item" key={f.id}>
                    <span className={`inbox-tag verdict-${f.verdict}`}>{verdictLabel[f.verdict] || f.verdict}</span>
                    <small>{formatTime(f.createdAt)}</small>
                    {f.finalContent ? <p>{f.finalContent}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {analysis ? (
          <div className="inbox-analysis-card">
            <div className="inbox-analysis-tags">
              <span className={`inbox-tag ${intentColor[analysis.intent] || "intent-other"}`}>{analysis.intentLabel}</span>
              <span className={`inbox-tag ${sentimentColor[analysis.sentiment] || "sentiment-neutral"}`}>{analysis.sentimentLabel}</span>
              <span className={`inbox-tag ${riskColor[analysis.riskLevel] || "risk-low"}`}>{riskLabel[analysis.riskLevel] || analysis.riskLevel}</span>
              {analysis.source === "fallback" ? <span className="inbox-tag tag-fallback">兜底</span> : <span className="inbox-tag tag-ai">AI</span>}
            </div>
            <p className="inbox-analysis-summary">{analysis.summary}</p>
            <p className="inbox-analysis-action">建议动作：{analysis.suggestedAction}</p>
          </div>
        ) : null}

        <div className="inbox-draft-area">
          <label className="inbox-draft-label" htmlFor="inbox-draft-input">回复草稿</label>
          <textarea
            className="inbox-draft-input"
            id="inbox-draft-input"
            maxLength={500}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={analysis ? "AI 已生成草稿，可直接编辑后发送" : "输入回复内容，或点击「AI 分析回复」自动生成草稿"}
            rows={3}
            value={draft}
          />
          <div className="inbox-draft-footer">
            <small className="inbox-char-count">{draft.length}/500</small>
            <div className="inbox-draft-buttons">
              {analysis ? <span className="inbox-draft-reason" title={analysis.draftReason}>{analysis.draftReason}</span> : null}
              <button
                className="inbox-send-button"
                disabled={sending || !draft.trim()}
                onClick={sendReply}
                type="button"
              >
                {sending ? "发送中…" : "确认发送回复"}
              </button>
            </div>
          </div>
          {sendResult ? <p className={`inbox-send-result ${sendResult.includes("失败") || sendResult.includes("不能") ? "error" : "success"}`}>{sendResult}</p> : null}
        </div>
      </section>
    </div> : null}
  </section>;
}
