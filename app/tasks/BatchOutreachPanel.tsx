"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type BatchCandidate = {
  creatorId: string;
  creatorName: string;
  profileUrl: string;
  taskKind: "initial" | "followup" | "negotiate";
  defaultScript: string;
};

type Props = {
  candidates: BatchCandidate[];
  campaignTaskId?: number | null;
};

type ItemState = {
  script: string;
  status: "ready" | "generating" | "generated" | "sending" | "sent" | "failed";
  message: string;
};

const MAX_BATCH_SIZE = 5;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function BatchOutreachPanel({ candidates, campaignTaskId }: Props) {
  const router = useRouter();
  const storageKey = `kol-crm-outreach-queue:${campaignTaskId || "all"}`;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const itemsRef = useRef<Record<string, ItemState>>({});
  const pauseRequestedRef = useRef(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [summary, setSummary] = useState("");

  useEffect(() => {
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
  }, [candidates, storageKey]);

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

  async function waitWhilePaused() {
    while (pauseRequestedRef.current) {
      await wait(500);
    }
  }

  async function interruptibleWait(seconds: number) {
    for (let elapsed = 0; elapsed < seconds; elapsed += 1) {
      await waitWhilePaused();
      await wait(1000);
    }
  }

  function pauseQueue() {
    pauseRequestedRef.current = true;
    setIsPaused(true);
    setSummary("队列已暂停；当前正在执行的单条任务会完成，后续任务暂不启动。");
  }

  function resumeQueue() {
    pauseRequestedRef.current = false;
    setIsPaused(false);
    setSummary("队列已继续。");
  }

  async function generateAll() {
    if (!selectedCandidates.length) {
      setSummary("请先选择要建联的达人。");
      return false;
    }
    setIsGenerating(true);
    setSummary("");
    let succeeded = 0;

    for (const candidate of selectedCandidates) {
      await waitWhilePaused();
      updateItem(candidate.creatorId, { status: "generating", message: "正在生成个性化话术…" });
      try {
        const response = await fetch("/api/outreach/script", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
          continue;
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

    setIsGenerating(false);
    setSummary(`已完成话术生成：${succeeded}/${selectedCandidates.length} 人。发送前请逐条检查。`);
    return true;
  }

  async function recordSent(candidate: BatchCandidate, script: string): Promise<boolean> {
    const response = await fetch(`/api/creators/${encodeURIComponent(candidate.creatorId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outreachStatus: "已建联",
        action: "batch_auto_send_douyin_message",
        content: `批量自动建联已向 ${candidate.creatorName} 发送私信。\n\n话术：${script}`
      })
    });
    return response.ok;
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
      await waitWhilePaused();
      const candidate = prepared[index];
      const script = (itemsRef.current[candidate.creatorId]?.script || candidate.defaultScript).trim();
      updateItem(candidate.creatorId, { status: "sending", message: `正在发送（${index + 1}/${prepared.length}）…` });

      try {
        const response = await fetch("/api/outreach/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileUrl: candidate.profileUrl, message: script })
        });
        const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!response.ok || !result.ok) {
          failed += 1;
          updateItem(candidate.creatorId, {
            status: "failed",
            message: result.error || "发送失败，未标记为已建联。"
          });
        } else {
          const recorded = await recordSent(candidate, script);
          if (!recorded) {
            failed += 1;
            updateItem(candidate.creatorId, {
              status: "failed",
              message: "私信已发送，但CRM状态记录失败，请人工确认。"
            });
          } else {
            sent += 1;
            updateItem(candidate.creatorId, { status: "sent", message: "已发送并记录。" });
          }
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
    router.refresh();
  }

  async function runOneClick() {
    const generated = await generateAll();
    if (!generated) return;
    await sendCandidates();
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

  return (
    <section className="panel batch-outreach-panel">
      <div className="panel-header">
        <div>
          <h2>批量个性化建联</h2>
          <p>每批最多5人。先由AI逐人生成话术并检查，再确认顺序发送。</p>
        </div>
        <strong>{selectedIds.length}/{MAX_BATCH_SIZE}</strong>
      </div>

      <div className="batch-outreach-list">
        {candidates.length ? candidates.slice(0, 30).map((candidate) => {
          const state = items[candidate.creatorId];
          return (
            <article className="batch-outreach-item" key={candidate.creatorId}>
              <label>
                <input
                  checked={selectedIds.includes(candidate.creatorId)}
                  disabled={isGenerating || isSending}
                  onChange={() => toggle(candidate)}
                  type="checkbox"
                />
                <strong>{candidate.creatorName}</strong>
              </label>
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
            </article>
          );
        }) : <p className="empty-state">当前没有未建联的精选达人。</p>}
      </div>

      <div className="task-actions">
        <button className="go-contact-button" disabled={!selectedIds.length || isGenerating || isSending} onClick={runOneClick} type="button">
          一键生成并进入发送队列
        </button>
        <button disabled={!selectedIds.length || isGenerating || isSending} onClick={generateAll} type="button">
          {isGenerating ? "正在逐人生成…" : "批量生成个性化话术"}
        </button>
        <button className="go-contact-button" disabled={!selectedIds.length || isGenerating || isSending} onClick={() => sendCandidates()} type="button">
          {isSending ? "批量发送中…" : "检查后确认批量发送"}
        </button>
        {isSending && !isPaused ? (
          <button className="secondary-button" onClick={pauseQueue} type="button">暂停队列</button>
        ) : null}
        {isSending && isPaused ? (
          <button className="secondary-button" onClick={resumeQueue} type="button">继续队列</button>
        ) : null}
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
