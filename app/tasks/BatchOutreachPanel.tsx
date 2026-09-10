"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

export type BatchCandidate = {
  creatorId: string;
  creatorName: string;
  platform: string;
  profileUrl: string;
  taskKind: "initial" | "followup" | "negotiate";
  defaultScript: string;
  queueEnteredAt: string;
};

type Props = {
  candidates: BatchCandidate[];
  campaignTaskId?: number | null;
  managedSelection?: boolean;
  onSent?: (creatorIds: string[]) => void;
};

type ItemState = {
  script: string;
  status: "ready" | "generating" | "generated" | "sending" | "sent" | "failed";
  message: string;
};

const MAX_BATCH_SIZE = 5;
const AI_GENERATION_CONCURRENCY = 3;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function BatchOutreachPanel({ candidates, campaignTaskId, managedSelection = false, onSent }: Props) {
  const router = useRouter();
  const storageKey = `kol-crm-outreach-queue:${campaignTaskId || "all"}`;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const itemsRef = useRef<Record<string, ItemState>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [summary, setSummary] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (managedSelection) {
      const selected = candidates.slice(0, MAX_BATCH_SIZE);
      setSelectedIds(selected.map((candidate) => candidate.creatorId));
      setItems((current) => {
        const next = { ...current };
        for (const candidate of selected) {
          next[candidate.creatorId] ||= { script: candidate.defaultScript, status: "ready", message: "" };
        }
        itemsRef.current = next;
        return next;
      });
      return;
    }
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "{}") as {
        selectedIds?: string[];
        items?: Record<string, ItemState>;
      };
      const availableIds = new Set(candidates.map((candidate) => candidate.creatorId));
      const restoredItems = Object.fromEntries(
        Object.entries(saved.items || {}).map(([id, item]) => [
          id,
          item.status === "sending" || item.status === "generating"
            ? { ...item, status: "failed", message: "上次执行中断，可点击重试失败项。" }
            : item
        ])
      ) as Record<string, ItemState>;
      itemsRef.current = restoredItems;
      setItems(restoredItems);
      setSelectedIds((saved.selectedIds || []).filter((id) => availableIds.has(id)).slice(0, MAX_BATCH_SIZE));
    } catch {
      // Ignore broken local queue snapshots.
    }
  }, [candidates, managedSelection, storageKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify({ selectedIds, items }));
  }, [items, selectedIds, storageKey]);

  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selectedIds.includes(candidate.creatorId)),
    [candidates, selectedIds]
  );

  function toggle(candidate: BatchCandidate) {
    setSummary("");
    setSelectedIds((current) => {
      if (current.includes(candidate.creatorId)) return current.filter((id) => id !== candidate.creatorId);
      if (current.length >= MAX_BATCH_SIZE) {
        setSummary(`每批最多选择 ${MAX_BATCH_SIZE} 人。`);
        return current;
      }
      return [...current, candidate.creatorId];
    });
    setItems((current) => {
      const next = {
        ...current,
        [candidate.creatorId]: current[candidate.creatorId] || {
          script: candidate.defaultScript,
          status: "ready" as const,
          message: ""
        }
      };
      itemsRef.current = next;
      return next;
    });
  }

  function toggleSelectAll() {
    setSummary("");
    const available = candidates.slice(0, MAX_BATCH_SIZE);
    const availableIds = available.map((candidate) => candidate.creatorId);
    const allSelected = availableIds.length > 0 && availableIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(availableIds);
    setItems((current) => {
      const next = { ...current };
      for (const candidate of available) {
        next[candidate.creatorId] ||= { script: candidate.defaultScript, status: "ready", message: "" };
      }
      itemsRef.current = next;
      return next;
    });
    if (candidates.length > MAX_BATCH_SIZE) setSummary(`每批最多 ${MAX_BATCH_SIZE} 人，已选择列表前 ${MAX_BATCH_SIZE} 位。`);
  }

  function updateItem(creatorId: string, patch: Partial<ItemState>) {
    setItems((current) => {
      const next = {
        ...current,
        [creatorId]: {
          script: current[creatorId]?.script || "",
          status: current[creatorId]?.status || "ready",
          message: current[creatorId]?.message || "",
          ...patch
        }
      };
      itemsRef.current = next;
      return next;
    });
  }

  async function interruptibleWait(seconds: number) {
    await wait(seconds * 1000);
  }

  async function generateAll() {
    if (!selectedCandidates.length) {
      setSummary("请先选择要建联的达人。");
      return false;
    }
    setIsGenerating(true);
    setSummary("");
    let succeeded = 0;
    let nextIndex = 0;

    async function generateOne(candidate: BatchCandidate) {
      updateItem(candidate.creatorId, { status: "generating", message: "正在生成个性化话术…" });
      try {
        const response = await fetch("/api/outreach/script", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kol-agent-id": window.localStorage.getItem("kol-crm-local-agent-id") || "" },
          body: JSON.stringify({
            creatorId: candidate.creatorId,
            taskKind: candidate.taskKind,
            campaignTaskId: campaignTaskId || null,
            provider: "default"
          })
        });
        const result = (await response.json().catch(() => ({}))) as { script?: string; error?: string };
        if (!response.ok || !result.script) {
          updateItem(candidate.creatorId, {
            script: itemsRef.current[candidate.creatorId]?.script || candidate.defaultScript,
            status: "failed",
            message: result.error || "AI话术生成失败，可使用默认话术或重新生成。"
          });
          return;
        }
        updateItem(candidate.creatorId, {
          script: result.script,
          status: "generated",
          message: "个性化话术已生成，请检查。"
        });
        succeeded += 1;
      } catch {
        updateItem(candidate.creatorId, {
          script: itemsRef.current[candidate.creatorId]?.script || candidate.defaultScript,
          status: "failed",
          message: "AI接口没有响应，可使用默认话术或重新生成。"
        });
      }
    }

    async function runWorker() {
      while (nextIndex < selectedCandidates.length) {
        const candidate = selectedCandidates[nextIndex];
        nextIndex += 1;
        await generateOne(candidate);
      }
    }

    const workerCount = Math.min(AI_GENERATION_CONCURRENCY, selectedCandidates.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    setIsGenerating(false);
    setSummary(`已完成话术生成：${succeeded}/${selectedCandidates.length} 人。发送前请逐条检查。`);
    return true;
  }

  async function sendCandidates(queue: BatchCandidate[] = selectedCandidates) {
    const prepared = queue.filter((candidate) => (itemsRef.current[candidate.creatorId]?.script || candidate.defaultScript).trim());
    if (!prepared.length) {
      setSummary("没有可发送的话术，请先生成并检查。");
      return;
    }

    const preview = prepared
      .map((candidate, index) => `${index + 1}. ${candidate.creatorName}\n${itemsRef.current[candidate.creatorId]?.script || candidate.defaultScript}`)
      .join("\n\n");
    const confirmed = window.confirm(
      `确认顺序发送 ${prepared.length} 条抖音私信吗？\n\n${preview}\n\n发送后无法自动撤回；过程中可关闭页面停止后续发送。`
    );
    if (!confirmed) return;

    setIsSending(true);
    setSummary("批量发送已开始，请保持本页面和9222抖音浏览器开启。");
    let sent = 0;
    let failed = 0;

    for (let index = 0; index < prepared.length; index += 1) {
      const candidate = prepared[index];
      const script = (itemsRef.current[candidate.creatorId]?.script || candidate.defaultScript).trim();
      updateItem(candidate.creatorId, { status: "sending", message: `正在发送（${index + 1}/${prepared.length}）…` });

      try {
        const response = await fetch("/api/outreach/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creatorId: candidate.creatorId,
            profileUrl: candidate.profileUrl,
            message: script,
            taskKind: candidate.taskKind,
            campaignTaskId: campaignTaskId || null
          })
        });
        const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!response.ok || !result.ok) {
          failed += 1;
          updateItem(candidate.creatorId, {
            status: "failed",
            message: result.error || "发送失败，未标记为已建联。"
          });
        } else {
          sent += 1;
          updateItem(candidate.creatorId, { status: "sent", message: "已发送并标记为已建联。" });
        }
      } catch {
        failed += 1;
        updateItem(candidate.creatorId, {
          status: "failed",
          message: "自动建联接口没有响应，未标记为已建联。"
        });
      }

      if (index < prepared.length - 1) {
        const delaySeconds = 15 + Math.floor(Math.random() * 11);
        setSummary(`已发送 ${sent} 条、失败 ${failed} 条；等待 ${delaySeconds} 秒后继续下一位。`);
        await interruptibleWait(delaySeconds);
      }
    }

    setIsSending(false);
    setSummary(`批量发送完成：成功 ${sent} 条，失败 ${failed} 条。`);
    const sentIds = prepared.filter((candidate) => itemsRef.current[candidate.creatorId]?.status === "sent").map((candidate) => candidate.creatorId);
    if (sentIds.length) onSent?.(sentIds);
    router.refresh();
  }

  async function retryFailed() {
    const failedCandidates = candidates
      .filter((candidate) => itemsRef.current[candidate.creatorId]?.status === "failed")
      .slice(0, MAX_BATCH_SIZE);
    if (!failedCandidates.length) {
      setSummary("当前没有失败项需要重试。");
      return;
    }
    setSelectedIds(failedCandidates.map((candidate) => candidate.creatorId));
    await sendCandidates(failedCandidates);
  }

  async function generateAndSend() {
    const generated = await generateAll();
    if (generated) await sendCandidates();
  }

  async function markCreatorSent(candidate: BatchCandidate) {
    setUpdatingId(candidate.creatorId);
    setSummary("");
    try {
      const response = await fetch(`/api/creators/${candidate.creatorId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outreachStatus: "已建联",
          action: "mark_sent",
          content: `已将 ${candidate.creatorName} 标记为已发送。`,
          campaignTaskId: campaignTaskId || null
        })
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setSummary(result.error || "状态更新失败，请重试。");
        return;
      }
      setSummary(`${candidate.creatorName} 已标记发送。`);
      router.refresh();
    } catch {
      setSummary("状态接口没有响应，请重试。");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <section className={`panel batch-outreach-panel workflow-section workflow-action-section${managedSelection ? " creator-outreach-dock" : ""}`}>
      <div className="panel-header">
        <div>
          <span className="workflow-kicker">建联执行</span>
          <h2>已选达人话术</h2>
          <p>每批最多5人。先由AI逐人生成话术并检查，再确认顺序发送。</p>
        </div>
        {!managedSelection ? <div className="batch-selection-tools">
          <button className="secondary-button" disabled={isGenerating || isSending || !candidates.length} onClick={toggleSelectAll} type="button">
            {candidates.slice(0, MAX_BATCH_SIZE).every((candidate) => selectedIds.includes(candidate.creatorId)) ? "取消全选" : "一键全选"}
          </button>
          <strong>{selectedIds.length}/{MAX_BATCH_SIZE}</strong>
        </div> : <strong>已选 {selectedIds.length}/{MAX_BATCH_SIZE} 人</strong>}
      </div>

      <div className="batch-outreach-list">
        {candidates.length ? candidates.slice(0, 30).map((candidate) => {
          const state = items[candidate.creatorId];
          const enteredAt = new Date(candidate.queueEnteredAt).getTime();
          const isNew = Number.isFinite(enteredAt) && enteredAt >= Date.now() - 24 * 60 * 60 * 1000;
          return (
            <article className="batch-outreach-item" key={candidate.creatorId}>
              {isNew ? <span className="batch-new-badge">NEW</span> : null}
              <div className="batch-card-head">
                <a href={candidate.profileUrl} rel="noreferrer" target="_blank">
                  <strong>{candidate.creatorName}</strong>
                  <span>打开{candidate.platform === "小红书" ? "小红书" : "抖音"}主页 ↗</span>
                </a>
                <span className={`batch-platform-badge ${candidate.platform === "小红书" ? "xhs" : "douyin"}`}>
                  {candidate.platform || "抖音"}
                </span>
                {!managedSelection ? <label aria-label={`选择 ${candidate.creatorName}`}>
                <input
                  checked={selectedIds.includes(candidate.creatorId)}
                  disabled={isGenerating || isSending}
                  onChange={() => toggle(candidate)}
                  type="checkbox"
                />
                </label> : null}
              </div>
              {selectedIds.includes(candidate.creatorId) ? (
                <>
                  <textarea
                    disabled={isSending}
                    onChange={(event) => updateItem(candidate.creatorId, { script: event.target.value })}
                    rows={4}
                    value={state?.script || candidate.defaultScript}
                  />
                  <span className={`batch-status ${state?.status || "ready"}`}>{state?.message || "等待生成个性化话术"}</span>
                </>
              ) : null}
              <div className="batch-card-actions">
                <button
                  disabled={Boolean(updatingId) || isGenerating || isSending}
                  onClick={() => markCreatorSent(candidate)}
                  type="button"
                >
                  {updatingId === candidate.creatorId ? "处理中…" : "标记已发送"}
                </button>
              </div>
            </article>
          );
        }) : <p className="empty-state">当前没有未建联的精选达人。</p>}
      </div>

      <div className="task-actions">
        <button disabled={!selectedIds.length || isGenerating || isSending} onClick={generateAll} type="button">
          {isGenerating ? "正在逐人生成…" : "批量生成个性化 AI 话术"}
        </button>
        <button className="go-contact-button" disabled={!selectedIds.length || isGenerating || isSending} onClick={() => sendCandidates()} type="button">
          {isSending ? "批量发送中…" : "检查后确认批量发送"}
        </button>
        <button className="go-contact-button" disabled={!selectedIds.length || isGenerating || isSending} onClick={generateAndSend} type="button">
          {isGenerating || isSending ? "处理中…" : "一键生成并发送"}
        </button>
        <button
          className="secondary-button"
          disabled={isGenerating || isSending || !Object.values(items).some((item) => item.status === "failed")}
          onClick={retryFailed}
          type="button"
        >
          重试失败项
        </button>
      </div>
      {summary ? <p className="task-message">{summary}</p> : null}
    </section>
  );
}
