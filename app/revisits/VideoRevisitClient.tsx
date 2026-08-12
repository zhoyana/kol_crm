"use client";

import { useCallback, useEffect, useState } from "react";

type Task = { id: number; name: string; productName: string; category: string | null };
type Visit = { id: number; likeCount: number; commentCount: number; revisitedAt: string };
type Target = {
  id: number; videoUrl: string; title: string | null; creatorName: string | null;
  publishedAt: string | null; category: string | null; visits: Visit[];
};

function fmtDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";
}

function delta(current: number, previous?: number) {
  if (previous === undefined) return "首次";
  const value = current - previous;
  return value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString();
}

export function VideoRevisitClient({ tasks }: { tasks: Task[] }) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [videoUrl, setVideoUrl] = useState("");
  const [taskId, setTaskId] = useState(tasks[0]?.id ? String(tasks[0].id) : "");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/video-revisits", { cache: "no-store" });
    const data = await response.json();
    if (response.ok) setTargets(data.targets || []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("正在排队并抓取视频数据，请保持专用 Chrome 开启…");
    try {
      const response = await fetch("/api/video-revisits", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, campaignTaskId: taskId || null, category })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "数据回访失败");
      setVideoUrl("");
      setMessage("抓取完成，已保存到库表。再次提交同一链接会新增一条回访记录。");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "数据回访失败");
    } finally { setLoading(false); }
  }

  return (
    <section className="content revisit-page">
      <header className="topbar"><div><h1>视频数据回访</h1><p>粘贴抖音视频链接，抓取点赞、评论和发布时间，并按品类保存每次回访记录。</p></div></header>
      <form className="panel revisit-form" onSubmit={submit}>
        <div className="section-kicker">01 · 新建回访</div><h2>抓取一条视频</h2>
        <div className="revisit-fields">
          <label className="revisit-url"><span>抖音视频链接</span><input required value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.douyin.com/video/... 或 v.douyin.com 短链接" /></label>
          <label><span>所属任务 / 品类</span><select value={taskId} onChange={(e) => setTaskId(e.target.value)}><option value="">不关联任务</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.name}（{task.category || task.productName}）</option>)}</select></label>
          <label><span>品类覆盖（可选）</span><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="默认使用所选任务品类" /></label>
          <button className="primary-button" disabled={loading}>{loading ? "抓取中…" : "抓取并保存"}</button>
        </div>
        {message && <p className={message.includes("完成") ? "form-message success" : "form-message"}>{message}</p>}
      </form>
      <div className="panel revisit-list">
        <div className="section-kicker">02 · 库表</div><h2>回访记录</h2>
        {!targets.length ? <div className="empty-state">还没有回访记录。粘贴第一条视频链接开始测试。</div> : <div className="table-wrap"><table><thead><tr><th>视频</th><th>品类</th><th>发布时间</th><th>回访时间</th><th>点赞</th><th>评论</th><th>变化</th></tr></thead><tbody>
          {targets.flatMap((target) => target.visits.map((visit, index) => { const previous = target.visits[index + 1]; return <tr key={visit.id}>
            <td><a href={target.videoUrl} target="_blank" rel="noreferrer">{target.title || "查看视频"}</a><small>{target.creatorName || "未知作者"}</small></td>
            <td>{target.category || "未分类"}</td><td>{fmtDate(target.publishedAt)}</td><td>{fmtDate(visit.revisitedAt)}</td>
            <td>{visit.likeCount.toLocaleString()}</td><td>{visit.commentCount.toLocaleString()}</td><td><small>赞 {delta(visit.likeCount, previous?.likeCount)} · 评 {delta(visit.commentCount, previous?.commentCount)}</small></td>
          </tr>; }))}
        </tbody></table></div>}
      </div>
    </section>
  );
}
