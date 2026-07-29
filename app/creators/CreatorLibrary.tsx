"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CampaignTaskItem } from "@/lib/campaign-tasks";
import type { Creator } from "@/lib/creators";

type CreatorLibraryProps = {
  creators: Creator[];
  initialCampaignTasks: CampaignTaskItem[];
  initialCampaignTaskId: number | null;
};

const ALL = "全部";

const gradeLabel: Record<string, string> = {
  S: "S级",
  A: "A级",
  B: "B级",
  C: "C级",
  D: "D级"
};

const priorityLabel: Record<string, string> = {
  high: "优先",
  medium: "观察",
  low: "暂缓"
};

const poolLabel: Record<string, string> = {
  pending_review: "待复筛池",
  candidate: "达人待选库",
  featured: "达人精选库",
  skipped: "已跳过"
};

const poolTabs = [
  { value: ALL, label: "全部" },
  { value: "candidate", label: "达人待选库" },
  { value: "featured", label: "达人精选库" },
  { value: "pending_review", label: "待复筛池" },
  { value: "skipped", label: "已跳过" }
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function getPoolLabel(status: string): string {
  return poolLabel[status] || status || "未分库";
}

function getGradeLabel(grade: string): string {
  return gradeLabel[grade] || grade || "-";
}

function getPriorityLabel(priority: string): string {
  return priorityLabel[priority] || priority || "-";
}

function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function todayText(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CreatorLibrary({ creators, initialCampaignTasks, initialCampaignTaskId }: CreatorLibraryProps) {
  const [items, setItems] = useState(creators);
  const [campaignTasks] = useState(initialCampaignTasks);
  const [selectedCampaignTaskId, setSelectedCampaignTaskId] = useState(initialCampaignTaskId ? String(initialCampaignTaskId) : "");
  const [keyword, setKeyword] = useState("");
  const [platform, setPlatform] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [grade, setGrade] = useState(ALL);
  const [priority, setPriority] = useState(ALL);
  const [poolStatus, setPoolStatus] = useState(ALL);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [isBatchReviewing, setIsBatchReviewing] = useState(false);
  const [error, setError] = useState("");

  const platforms = useMemo(() => [ALL, ...Array.from(new Set(items.map((creator) => creator.platform).filter(Boolean)))], [items]);
  const statuses = useMemo(() => [ALL, ...Array.from(new Set(items.map((creator) => creator.outreachStatus).filter(Boolean)))], [items]);
  const selectedCampaignTask = useMemo(
    () => campaignTasks.find((task) => String(task.id) === selectedCampaignTaskId) || null,
    [campaignTasks, selectedCampaignTaskId]
  );
  const poolCounts = useMemo(
    () =>
      items.reduce<Record<string, number>>(
        (acc, creator) => {
          acc[ALL] += 1;
          acc[creator.poolStatus] = (acc[creator.poolStatus] || 0) + 1;
          return acc;
        },
        { [ALL]: 0 }
      ),
    [items]
  );

  const filteredCreators = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    return items.filter((creator) => {
      const matchesKeyword =
        !normalizedKeyword ||
        creator.name.toLowerCase().includes(normalizedKeyword) ||
        creator.category.toLowerCase().includes(normalizedKeyword) ||
        creator.notes.toLowerCase().includes(normalizedKeyword) ||
        creator.screeningSummary.toLowerCase().includes(normalizedKeyword);
      const matchesPool = poolStatus === ALL || creator.poolStatus === poolStatus;
      const matchesPlatform = platform === ALL || creator.platform === platform;
      const matchesStatus = status === ALL || creator.outreachStatus === status;
      const matchesGrade = grade === ALL || creator.grade === grade;
      const matchesPriority = priority === ALL || creator.priority === priority;

      return matchesKeyword && matchesPool && matchesPlatform && matchesStatus && matchesGrade && matchesPriority;
    });
  }, [grade, items, keyword, platform, poolStatus, priority, status]);

  function changeCampaignTask(taskId: string) {
    setSelectedCampaignTaskId(taskId);
    const suffix = taskId ? `?campaignTaskId=${encodeURIComponent(taskId)}` : "";
    window.location.href = `/creators${suffix}`;
  }

  async function deleteCreator(creator: Creator) {
    const message = selectedCampaignTask
      ? `确定把「${creator.name}」从当前品类任务里移除吗？不会删除其他品类里的记录。`
      : `确定删除「${creator.name}」吗？会从达人库和数据库中移除。`;
    const confirmed = window.confirm(message);
    if (!confirmed) return;

    setDeletingId(creator.id);
    setError("");

    try {
      const response = await fetch(`/api/creators/${encodeURIComponent(creator.id)}/delete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "Manual delete: not a fit for current creator screening target.",
          campaignTaskId: selectedCampaignTaskId || null
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || "删除达人失败。");
        return;
      }

      setItems((current) => current.filter((item) => item.id !== creator.id));
    } catch {
      setError("删除接口没有响应，请确认本地服务还在运行。");
    } finally {
      setDeletingId(null);
    }
  }

  async function sendToReview(creator: Creator) {
    setReviewingId(creator.id);
    setError("");

    try {
      const response = await fetch(`/api/creators/${encodeURIComponent(creator.id)}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "Manual send to review: rules or human judgment changed.",
          campaignTaskId: selectedCampaignTaskId || null
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || "加入复筛失败。");
        return;
      }

      setItems((current) =>
        current.map((item) =>
          item.id === creator.id
            ? {
                ...item,
                poolStatus: "pending_review",
                screeningStatus: "manual_recheck",
                screeningSummary: data.creator?.screeningSummary || item.screeningSummary
              }
            : item
        )
      );
    } catch {
      setError("加入复筛接口没有响应，请确认本地服务还在运行。");
    } finally {
      setReviewingId(null);
    }
  }

  async function moveToCandidate(creator: Creator) {
    const confirmed = window.confirm(`确定把「${creator.name}」从精选库移到待选库吗？`);
    if (!confirmed) return;

    setMovingId(creator.id);
    setError("");

    try {
      const response = await fetch(`/api/creators/${encodeURIComponent(creator.id)}/pool`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poolStatus: "candidate",
          screeningStatus: "manual_downgraded",
          reason: "Manual audit: move from featured to candidate for continued observation.",
          campaignTaskId: selectedCampaignTaskId || null
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || "移到待选库失败。");
        return;
      }

      setItems((current) =>
        current.map((item) =>
          item.id === creator.id
            ? {
                ...item,
                poolStatus: "candidate",
                screeningStatus: "manual_downgraded",
                screeningSummary: data.creator?.screeningSummary || item.screeningSummary
              }
            : item
        )
      );
    } catch {
      setError("移到待选库接口没有响应，请确认本地服务还在运行。");
    } finally {
      setMovingId(null);
    }
  }

  async function sendFilteredCandidatesToReview() {
    const targets = filteredCreators.filter((creator) => creator.poolStatus === "candidate" || creator.poolStatus === "skipped");
    if (!targets.length) {
      setError("当前筛选结果里没有可加入复筛的待选库或已跳过达人。");
      return;
    }

    const confirmed = window.confirm(`确定把当前筛选出的 ${targets.length} 个待选/已跳过达人加入复筛吗？`);
    if (!confirmed) return;

    setIsBatchReviewing(true);
    setError("");

    try {
      const response = await fetch("/api/creators/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: targets.map((creator) => creator.id),
          reason: "Batch send to review: rules or human judgment changed.",
          campaignTaskId: selectedCampaignTaskId || null
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || "批量加入复筛失败。");
        return;
      }

      const updatedIds = new Set<string>(data.ids || targets.map((creator) => creator.id));
      setItems((current) =>
        current.map((item) =>
          updatedIds.has(item.id)
            ? {
                ...item,
                poolStatus: "pending_review",
                screeningStatus: "manual_recheck"
              }
            : item
        )
      );
    } catch {
      setError("批量加入复筛接口没有响应，请确认本地服务还在运行。");
    } finally {
      setIsBatchReviewing(false);
    }
  }

  function exportFeaturedCreators() {
    const featuredCreators = items.filter((creator) => creator.poolStatus === "featured");
    if (!featuredCreators.length) {
      setError("当前没有精选库达人可以导出。");
      return;
    }

    setError("");
    const headers = [
      "达人昵称",
      "平台",
      "主页链接",
      "类目",
      "粉丝",
      "稳定播放",
      "平均播放",
      "报价",
      "当前CPM",
      "建议报价",
      "评级",
      "优先级",
      "建联状态",
      "筛选状态",
      "筛选说明",
      "备注"
    ];
    const rows = featuredCreators.map((creator) => [
      creator.name,
      creator.platform,
      creator.profileUrl,
      creator.category,
      creator.fans,
      creator.stablePlay,
      creator.avgPlay,
      creator.quote ?? "",
      creator.currentCpm ?? "",
      creator.suggestedPrice,
      getGradeLabel(creator.grade),
      getPriorityLabel(creator.priority),
      creator.outreachStatus,
      creator.screeningStatus,
      creator.screeningSummary,
      creator.notes
    ]);
    const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `达人精选库-${todayText()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <section className="panel campaign-task-picker">
        <div>
          <h2>品类任务视图</h2>
          <p>选择任务后，库类型会优先显示这个任务下的状态；不选任务则查看全局达人库。</p>
        </div>
        <div className="campaign-task-picker-controls">
          <select onChange={(event) => changeCampaignTask(event.target.value)} value={selectedCampaignTaskId}>
            <option value="">全局达人库</option>
            {campaignTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
          </select>
          <Link className="secondary-link" href="/agent">
            管理品类任务
          </Link>
        </div>
        {selectedCampaignTask ? (
          <div className="campaign-task-summary">
            <div>
              <span>推广产品</span>
              <strong>{selectedCampaignTask.productName}</strong>
            </div>
            <div>
              <span>目标人群</span>
              <strong>{selectedCampaignTask.targetAudience}</strong>
            </div>
            <div>
              <span>当前达人</span>
              <strong>{items.length} 个</strong>
            </div>
            <p>{selectedCampaignTask.targetDescription}</p>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>库类型</h2>
            <p>用待选库、精选库、待复筛池和已跳过区分不同阶段。明显不符合目标的达人可以直接删除。</p>
          </div>
          <div className="action-row">
            <button className="secondary-button" disabled={isBatchReviewing} onClick={sendFilteredCandidatesToReview} type="button">
              {isBatchReviewing ? "加入中..." : "一键去复筛"}
            </button>
            <button className="secondary-button" onClick={exportFeaturedCreators} type="button">
              导出精选库
            </button>
          </div>
        </div>
        <div className="topic-list">
          {poolTabs.map((tab) => (
            <button
              className={poolStatus === tab.value ? "selected" : "secondary-button"}
              key={tab.value}
              onClick={() => setPoolStatus(tab.value)}
              type="button"
            >
              {tab.label}
              <strong>{poolCounts[tab.value] || 0}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="filter-bar">
        <label>
          搜索
          <input onChange={(event) => setKeyword(event.target.value)} placeholder="达人昵称、类目、备注" value={keyword} />
        </label>
        <label>
          平台
          <select onChange={(event) => setPlatform(event.target.value)} value={platform}>
            {platforms.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          状态
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            {statuses.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          评级
          <select onChange={(event) => setGrade(event.target.value)} value={grade}>
            {[ALL, "S", "A", "B", "C", "D"].map((item) => (
              <option key={item}>{item === ALL ? item : getGradeLabel(item)}</option>
            ))}
          </select>
        </label>
        <label>
          优先级
          <select onChange={(event) => setPriority(event.target.value)} value={priority}>
            <option value={ALL}>全部</option>
            <option value="high">优先</option>
            <option value="medium">观察</option>
            <option value="low">暂缓</option>
          </select>
        </label>
      </section>

      {error ? <p className="form-error">{error}</p> : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>达人列表</h2>
            <p>
              当前显示 {filteredCreators.length} / {items.length} 个达人。
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>达人</th>
                <th>库类型</th>
                <th>平台</th>
                <th>建联状态</th>
                <th>粉丝</th>
                <th>稳定播放</th>
                <th>报价</th>
                <th>CPM</th>
                <th>建议报价</th>
                <th>评级</th>
                <th>优先级</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredCreators.map((creator) => (
                <tr key={creator.id}>
                  <td>
                    <Link className="creator-link" href={`/creators/${creator.id}`}>
                      {creator.name}
                    </Link>
                    <span>{creator.category}</span>
                  </td>
                  <td>
                    <span className={`priority ${creator.poolStatus === "featured" ? "high" : creator.poolStatus === "candidate" ? "medium" : "low"}`}>
                      {getPoolLabel(creator.poolStatus)}
                    </span>
                  </td>
                  <td>{creator.platform}</td>
                  <td>{creator.outreachStatus}</td>
                  <td>{formatNumber(creator.fans)}</td>
                  <td>{formatNumber(creator.stablePlay)}</td>
                  <td>{creator.quote ? `¥${formatNumber(creator.quote)}` : "-"}</td>
                  <td className={creator.currentCpm && creator.currentCpm > 20 ? "danger" : ""}>{creator.currentCpm ?? "-"}</td>
                  <td>¥{formatNumber(creator.suggestedPrice)}</td>
                  <td>
                    <span className={`grade grade-${creator.grade.toLowerCase()}`}>{getGradeLabel(creator.grade)}</span>
                  </td>
                  <td>
                    <span className={`priority ${creator.priority}`}>{getPriorityLabel(creator.priority)}</span>
                  </td>
                  <td>
                    {creator.poolStatus === "candidate" || creator.poolStatus === "skipped" ? (
                      <button className="secondary-button" disabled={reviewingId === creator.id} onClick={() => sendToReview(creator)} type="button">
                        {reviewingId === creator.id ? "加入中..." : "去复筛"}
                      </button>
                    ) : null}
                    {creator.poolStatus === "featured" ? (
                      <button className="secondary-button" disabled={movingId === creator.id} onClick={() => moveToCandidate(creator)} type="button">
                        {movingId === creator.id ? "移动中..." : "移到待选库"}
                      </button>
                    ) : null}
                    <button className="secondary-button danger-button" disabled={deletingId === creator.id} onClick={() => deleteCreator(creator)} type="button">
                      {deletingId === creator.id ? "删除中..." : "删除"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
