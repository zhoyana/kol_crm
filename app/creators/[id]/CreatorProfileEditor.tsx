"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Creator } from "@/lib/creators";

type CreatorProfileEditorProps = {
  creator: Creator;
};

const outreachStatuses = ["未建联", "已建联", "需跟进", "已回复", "报价中", "确定合作", "已拒绝", "已放弃"];
const cooperationStatuses = ["", "待确认", "确定合作", "报价过高", "已拒绝", "暂缓"];

export function CreatorProfileEditor({ creator }: CreatorProfileEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    profileUrl: creator.profileUrl,
    contact: creator.contact === "-" ? "" : creator.contact,
    quote: creator.quote ? String(creator.quote) : "",
    outreachStatus: creator.outreachStatus,
    cooperationStatus: creator.cooperationStatus === "-" ? "" : creator.cooperationStatus,
    notes: creator.notes
  });

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveProfile() {
    setMessage("");

    const response = await fetch(`/api/creators/${encodeURIComponent(creator.id)}/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...form,
        quote: form.quote ? Number(form.quote) : null
      })
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      setMessage(result.error || "保存失败");
      return;
    }

    setMessage("已保存");
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <section className="panel editor-panel">
      <div className="panel-header">
        <div>
          <h2>运营资料</h2>
          <p>维护主页链接、联系方式、报价、状态和备注。</p>
        </div>
        <button disabled={isPending} onClick={saveProfile} type="button">
          {isPending ? "保存中..." : "保存"}
        </button>
      </div>

      <div className="editor-grid">
        <label>
          主页链接
          <input onChange={(event) => updateField("profileUrl", event.target.value)} value={form.profileUrl} />
        </label>
        <label>
          联系方式
          <input onChange={(event) => updateField("contact", event.target.value)} value={form.contact} />
        </label>
        <label>
          当前报价
          <input inputMode="numeric" onChange={(event) => updateField("quote", event.target.value)} value={form.quote} />
        </label>
        <label>
          建联状态
          <select onChange={(event) => updateField("outreachStatus", event.target.value)} value={form.outreachStatus}>
            {outreachStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          合作状态
          <select onChange={(event) => updateField("cooperationStatus", event.target.value)} value={form.cooperationStatus}>
            {cooperationStatuses.map((status) => (
              <option key={status || "empty"} value={status}>
                {status || "未填写"}
              </option>
            ))}
          </select>
        </label>
        <label className="editor-wide">
          备注
          <textarea onChange={(event) => updateField("notes", event.target.value)} value={form.notes} />
        </label>
      </div>

      {message ? <p className="task-message editor-message">{message}</p> : null}
    </section>
  );
}
