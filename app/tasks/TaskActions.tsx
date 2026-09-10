"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type TaskActionsProps = {
  creatorId: string;
  creatorName: string;
  profileUrl: string;
  script: string;
  taskKind: "initial" | "followup" | "negotiate";
  campaignTaskId?: number | null;
};

type AiScriptResult = {
  script?: string;
  angle?: string;
  reason?: string;
  portrait?: string;
  source?: "ai" | "fallback";
  provider?: "default" | "openai";
  error?: string;
};

export function TaskActions({ creatorId, creatorName, profileUrl, script, taskKind, campaignTaskId }: TaskActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState("");
  const [draftScript, setDraftScript] = useState(script);
  const [aiMeta, setAiMeta] = useState<{ angle: string; reason: string; portrait: string; source: string } | null>(null);

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(draftScript);
      return true;
    } catch {
      return false;
    }
  }

  async function generateScript() {
    setIsGenerating(true);
    setMessage("");

    try {
      const response = await fetch("/api/outreach/script", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          creatorId,
          taskKind,
          campaignTaskId: campaignTaskId || null,
          provider: "default"
        })
      });
      const result = (await response.json().catch(() => ({}))) as AiScriptResult;

      if (!response.ok || !result.script) {
        setMessage(result.error || "AI 话术生成失败");
        return;
      }

      setDraftScript(result.script);
      setAiMeta({
        angle: result.angle || "建联话术",
        reason: result.reason || "",
        portrait: result.portrait || "",
        source: result.source === "ai" ? "AI 接口" : "本地兜底"
      });
      setMessage(result.source === "ai" ? "AI 话术已生成，可以先看一下再发送。" : "已生成兜底话术，可以先手动调整。");
    } catch {
      setMessage("生成话术接口没有响应，请确认本地服务还在运行。");
    } finally {
      setIsGenerating(false);
    }
  }

  async function updateStatus(outreachStatus: string, action: string, content: string) {
    const response = await fetch(`/api/creators/${encodeURIComponent(creatorId)}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        outreachStatus,
        action,
        content,
        campaignTaskId: campaignTaskId || null
      })
    });

    const result = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      setMessage(result.error || "操作失败");
      return false;
    }

    startTransition(() => {
      router.refresh();
    });
    return true;
  }

  async function startOutreach() {
    setMessage("");

    const copied = await copyScript();
    if (!profileUrl) {
      setMessage(copied ? "话术已复制，但这个达人还没有主页/沟通链接。" : "缺少主页链接，且复制话术失败。");
      return;
    }

    window.open(profileUrl, "_blank", "noopener,noreferrer");

    setMessage(copied ? "话术已复制，已打开达人主页。发送后记得点“标记已发送”。" : "已打开达人主页，但话术复制失败，请手动复制。");
  }

  async function markSent() {
    setMessage("");
    const copied = await copyScript();
    const updated = await updateStatus(
      "已建联",
      "mark_sent",
      copied ? `已向 ${creatorName} 发送建联消息，发送话术已复制到剪贴板。\n\n话术：${draftScript}` : `已向 ${creatorName} 发送建联消息。`
    );
    if (updated) setMessage("已标记发送。");
  }

  async function sendAutomatically() {
    setMessage("");
    if (!profileUrl) {
      setMessage("这个达人没有抖音主页链接，无法自动建联。");
      return;
    }
    if (!draftScript.trim()) {
      setMessage("请先生成或填写建联话术。");
      return;
    }

    const confirmed = window.confirm(
      `确认立即向「${creatorName}」发送下面这条私信吗？\n\n${draftScript}\n\n发送后无法自动撤回。`
    );
    if (!confirmed) return;

    setIsSending(true);
    try {
      const response = await fetch("/api/outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-kol-agent-id": window.localStorage.getItem("kol-crm-local-agent-id") || "" },
        body: JSON.stringify({ creatorId, profileUrl, message: draftScript, taskKind, campaignTaskId: campaignTaskId || null })
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || !result.ok) {
        setMessage(result.error || "自动建联失败；没有标记为已发送。");
        return;
      }

      setMessage("私信已发送，并已标记为已建联。");
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setMessage("自动建联接口没有响应；请确认9222浏览器已启动并已登录抖音。");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <>
      <details className="script-draft" open={Boolean(aiMeta)}>
        <summary>查看/编辑话术</summary>
        <textarea onChange={(event) => setDraftScript(event.target.value)} rows={7} value={draftScript} />
        {aiMeta ? (
          <div className="script-meta">
            <p>
              {aiMeta.source}：{aiMeta.angle}
              {aiMeta.reason ? `；${aiMeta.reason}` : ""}
            </p>
            {aiMeta.portrait ? <pre>{aiMeta.portrait}</pre> : null}
          </div>
        ) : null}
      </details>
      <div className="task-actions">
        <button className="secondary-button" disabled={isPending || isGenerating} onClick={generateScript} type="button">
          {isGenerating ? "生成中..." : "AI生成话术"}
        </button>
        <button className="go-contact-button" disabled={isPending} onClick={startOutreach} type="button">
          {isPending ? "处理中..." : "复制话术并去建联"}
        </button>
        <button className="go-contact-button" disabled={isPending || isSending} onClick={sendAutomatically} type="button">
          {isSending ? "自动发送中..." : "确认并自动私信"}
        </button>
        <button className="secondary-button" disabled={isPending} onClick={markSent} type="button">
          标记已发送
        </button>
      </div>
      {message ? <p className="task-message">{message}</p> : null}
    </>
  );
}
