"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type OnlineAgent = { id: string; name: string; version: string; lastSeenAt: string };
type BatchJob = {
  id: string;
  fileName: string;
  outputName: string;
  status: "running" | "completed" | "failed";
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  failureSamples: string[];
  message: string;
  error: string;
  downloadable: boolean;
};

const LAST_BATCH_JOB_KEY = "kol-crm:last-video-revisit-batch-job";

export function VideoRevisitClient() {
  const [file, setFile] = useState<File | null>(null);
  const [agentMode, setAgentMode] = useState<"direct" | "queue">("direct");
  const [agents, setAgents] = useState<OnlineAgent[]>([]);
  const [agentDeviceId, setAgentDeviceId] = useState("");
  const [job, setJob] = useState<BatchJob | null>(null);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const jobId = window.localStorage.getItem(LAST_BATCH_JOB_KEY);
    if (!jobId) return;
    let cancelled = false;
    void fetch(`/api/video-revisits/batch?id=${encodeURIComponent(jobId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { job?: BatchJob };
        if (!cancelled && response.ok && data.job) setJob(data.job);
        else if (!cancelled) window.localStorage.removeItem(LAST_BATCH_JOB_KEY);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshAgents() {
      try {
        const response = await fetch("/api/local-agents", { cache: "no-store" });
        const data = await response.json() as { mode?: "direct" | "queue"; agents?: OnlineAgent[] };
        if (cancelled) return;
        const online = data.agents || [];
        setAgentMode(data.mode === "queue" ? "queue" : "direct");
        setAgents(online);
        setAgentDeviceId((current) => online.some((agent) => agent.id === current) ? current : (online[0]?.id || ""));
      } catch { /* upload will show the actionable error */ }
    }
    void refreshAgents();
    const timer = window.setInterval(refreshAgents, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/video-revisits/batch?id=${encodeURIComponent(job.id)}`, { cache: "no-store" });
        const data = await response.json() as { job?: BatchJob; error?: string };
        if (!response.ok || !data.job) throw new Error(data.error || "无法读取处理进度");
        setJob(data.job);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "无法读取处理进度");
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  const progress = useMemo(() => job?.total ? Math.min(100, Math.round(job.completed / job.total * 100)) : 0, [job]);
  const running = job?.status === "running";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return setMessage("请选择业务提供的 .xlsx 文件。");
    if (agentMode === "queue" && !agentDeviceId) return setMessage("没有在线的达人采集助手，请先在本机启动 EXE。");
    setMessage("");
    const form = new FormData();
    form.set("file", file);
    if (agentDeviceId) form.set("agentDeviceId", agentDeviceId);
    try {
      const response = await fetch("/api/video-revisits/batch", { method: "POST", body: form });
      const data = await response.json() as { job?: BatchJob; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error || "Excel 批量回访启动失败");
      setJob(data.job);
      window.localStorage.setItem(LAST_BATCH_JOB_KEY, data.job.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Excel 批量回访启动失败");
    }
  }

  function reset() {
    setFile(null);
    setJob(null);
    window.localStorage.removeItem(LAST_BATCH_JOB_KEY);
    setMessage("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <section className="content revisit-page batch-revisit-page">
      <header className="topbar">
        <div>
          <h1>视频数据批量回访</h1>
          <p>上传业务提供的 Excel，系统抓取抖音和小红书作品的发布时间、回访时间、点赞、评论、转发和收藏，再将结果追加到原文件右侧供下载。</p>
        </div>
      </header>

      <form className="panel batch-revisit-upload" onSubmit={submit}>
        <div className="section-kicker">01 · 上传文件</div>
        <div className="batch-revisit-heading">
          <div><h2>导入业务 Excel</h2><p>自动识别“发布链接”列；“博主账号名称”等原有列、行顺序和内容保持不变。</p></div>
          <span className="batch-file-rule">支持 .xlsx · 最大 20MB</span>
        </div>
        <label className="batch-file-picker">
          <input ref={inputRef} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={running} onChange={(event) => setFile(event.target.files?.[0] || null)} type="file" />
          <strong>{file?.name || "选择 Excel 文件"}</strong>
          <span>{file ? `${(file.size / 1024).toFixed(1)} KB` : "表头需包含：发布链接"}</span>
        </label>
        {agentMode === "queue" ? (
          <label className="batch-agent-select">
            <span>使用这台电脑采集</span>
            <select disabled={running} onChange={(event) => setAgentDeviceId(event.target.value)} value={agentDeviceId}>
              {agents.length ? agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}（在线）</option>) : <option value="">未检测到采集助手</option>}
            </select>
          </label>
        ) : null}
        <div className="batch-revisit-actions">
          <button disabled={running || !file || (agentMode === "queue" && !agentDeviceId)} type="submit">{running ? "正在批量回访…" : "开始批量抓取"}</button>
          {job && !running ? <button className="secondary-button" onClick={reset} type="button">处理另一份文件</button> : null}
        </div>
        {message ? <p className="form-error">{message}</p> : null}
      </form>

      {job ? (
        <section className={`panel batch-revisit-progress ${job.status}`}>
          <div className="section-kicker">02 · 本次处理</div>
          <div className="batch-progress-title"><div><h2>{job.fileName}</h2><p>{job.error || job.message}</p></div><strong>{progress}%</strong></div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <div className="batch-progress-stats">
            <div><span>总数</span><strong>{job.total}</strong></div>
            <div><span>已处理</span><strong>{job.completed}</strong></div>
            <div className="success"><span>成功</span><strong>{job.succeeded}</strong></div>
            <div className="failed"><span>失败</span><strong>{job.failed}</strong></div>
          </div>
          {job.failureSamples?.length ? (
            <div className="batch-failure-samples">
              <strong>失败原因（前 {job.failureSamples.length} 条）</strong>
              <ul>{job.failureSamples.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            </div>
          ) : null}
          {job.downloadable ? <a className="button-link batch-download" href={`/api/video-revisits/batch?id=${encodeURIComponent(job.id)}&download=1`}>下载 {job.outputName}</a> : null}
          <small className="batch-expiry-note">结果仅用于本次下载，不进入网页回访库；生成后请在两小时内下载。</small>
        </section>
      ) : null}
    </section>
  );
}
