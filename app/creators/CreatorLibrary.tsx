"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import type { BrandLibraryItem, CampaignTaskItem } from "@/lib/campaign-tasks";
import { BrandTaskPicker } from "@/app/components/BrandTaskPicker";
import type { Creator } from "@/lib/creators";

type CreatorLibraryProps = {
  creators: Creator[];
  initialBrandLibraries: BrandLibraryItem[];
  initialCampaignTasks: CampaignTaskItem[];
  initialCampaignTaskId: number | null;
  initialPlatform: "全部" | "抖音" | "小红书";
};

const ALL = "全部";

const poolLabel: Record<string, string> = {
  candidate: "达人待选库",
  featured: "达人精选库",
  skipped: "已跳过"
};

const poolTabs = [
  { value: ALL, label: "全部" },
  { value: "candidate", label: "达人待选库" },
  { value: "featured", label: "达人精选库" }
];

const businessPoolStatuses = new Set(["candidate", "featured"]);

function getPoolLabel(status: string): string {
  return poolLabel[status] || status || "未分库";
}

function localDateText(daysAgo = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function CreatorLibrary({ creators, initialBrandLibraries, initialCampaignTasks, initialCampaignTaskId, initialPlatform }: CreatorLibraryProps) {
  const [items, setItems] = useState(creators);
  const [campaignTasks] = useState(initialCampaignTasks);
  const [selectedCampaignTaskId, setSelectedCampaignTaskId] = useState(initialCampaignTaskId ? String(initialCampaignTaskId) : "");
  const [keyword, setKeyword] = useState("");
  const [platform] = useState(initialPlatform);
  const [status, setStatus] = useState(ALL);
  const [poolStatus, setPoolStatus] = useState(ALL);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scripts, setScripts] = useState<Record<string, string>>({});
  const [scriptStatus, setScriptStatus] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [outreachSummary, setOutreachSummary] = useState("");
  const [exportFrom, setExportFrom] = useState(() => localDateText(30));
  const [exportTo, setExportTo] = useState(() => localDateText());
  const [isExporting, setIsExporting] = useState(false);

  const statuses = [ALL, "已建联", "未建联"];
  const selectedCampaignTask = useMemo(
    () => campaignTasks.find((task) => String(task.id) === selectedCampaignTaskId) || null,
    [campaignTasks, selectedCampaignTaskId]
  );
  const businessCreators = useMemo(
    () => items.filter((creator) => businessPoolStatuses.has(creator.poolStatus)),
    [items]
  );
  const poolCounts = useMemo(
    () =>
      businessCreators.filter((creator) => platform === ALL || creator.platform === platform).reduce<Record<string, number>>(
        (acc, creator) => {
          acc[ALL] += 1;
          acc[creator.poolStatus] = (acc[creator.poolStatus] || 0) + 1;
          return acc;
        },
        { [ALL]: 0 }
      ),
    [businessCreators, platform]
  );
  const platformCounts = useMemo(() => ({
    [ALL]: businessCreators.length,
    抖音: businessCreators.filter((creator) => creator.platform === "抖音").length,
    小红书: businessCreators.filter((creator) => creator.platform === "小红书").length
  }), [businessCreators]);
  const platformCreators = useMemo(
    () => businessCreators.filter((creator) => platform === ALL || creator.platform === platform),
    [businessCreators, platform]
  );
  const platformMetrics = useMemo(() => ({
    total: platformCreators.length,
    featured: platformCreators.filter((creator) => creator.poolStatus === "featured").length,
    candidate: platformCreators.filter((creator) => creator.poolStatus === "candidate").length,
    contacted: platformCreators.filter((creator) => creator.outreachStatus === "已建联").length
  }), [platformCreators]);
  const visibleCampaignTasks = useMemo(
    () => campaignTasks.filter((task) => {
      if (platform === ALL) return true;
      const taskPlatform = /小红书|xhs/i.test(String(task.platform || "")) ? "小红书" : "抖音";
      return taskPlatform === platform;
    }),
    [campaignTasks, platform]
  );

  const filteredCreators = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();

    return businessCreators.filter((creator) => {
      const matchesKeyword =
        !normalizedKeyword ||
        creator.name.toLowerCase().includes(normalizedKeyword) ||
        creator.category.toLowerCase().includes(normalizedKeyword) ||
        creator.notes.toLowerCase().includes(normalizedKeyword) ||
        creator.screeningSummary.toLowerCase().includes(normalizedKeyword);
      const matchesPool = poolStatus === ALL || creator.poolStatus === poolStatus;
      const matchesPlatform = platform === ALL || creator.platform === platform;
      const matchesStatus = status === ALL || creator.outreachStatus === status;
      return matchesKeyword && matchesPool && matchesPlatform && matchesStatus;
    });
  }, [businessCreators, keyword, platform, poolStatus, status]);

  const selectableCreators = useMemo(
    () => filteredCreators.filter((creator) => creator.poolStatus !== "skipped" && creator.outreachStatus === "未建联" && creator.profileUrl),
    [filteredCreators]
  );
  const selectedCreators = useMemo(() => items.filter((creator) => selectedIds.includes(creator.id)), [items, selectedIds]);

  function toggleCreator(creator: Creator) {
    setError("");
    setSelectedIds((current) => {
      if (current.includes(creator.id)) return current.filter((id) => id !== creator.id);
      if (current.length >= 5) {
        setError("每批最多选择 5 位达人。");
        return current;
      }
      setScripts((currentScripts) => ({
        ...currentScripts,
        [creator.id]: currentScripts[creator.id] || "您好，关注到您的内容很适合我们的合作方向，想了解一下近期的合作报价和档期，方便进一步沟通吗？"
      }));
      return [...current, creator.id];
    });
  }

  function toggleVisibleCreators() {
    const visibleIds = selectableCreators.slice(0, 5).map((creator) => creator.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : visibleIds);
    if (!allSelected) {
      setScripts((current) => {
        const next = { ...current };
        for (const creator of selectableCreators.slice(0, 5)) {
          next[creator.id] ||= "您好，关注到您的内容很适合我们的合作方向，想了解一下近期的合作报价和档期，方便进一步沟通吗？";
        }
        return next;
      });
    }
  }

  function handleSent(creatorIds: string[]) {
    const sent = new Set(creatorIds);
    setItems((current) => current.map((creator) => (sent.has(creator.id) ? { ...creator, outreachStatus: "已建联" } : creator)));
    setSelectedIds((current) => current.filter((id) => !sent.has(id)));
  }

  async function generateSelectedScripts() {
    if (!selectedCreators.length) return {} as Record<string, string>;
    setIsGenerating(true);
    setOutreachSummary("");
    let generated = 0;
    const generatedScripts = { ...scripts };
    await Promise.all(selectedCreators.map(async (creator) => {
      setScriptStatus((current) => ({ ...current, [creator.id]: "正在生成个性化话术…" }));
      try {
        const response = await fetch("/api/outreach/script", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kol-agent-id": window.localStorage.getItem("kol-crm-local-agent-id") || "" },
          body: JSON.stringify({ creatorId: creator.id, taskKind: "initial", campaignTaskId: Number(selectedCampaignTaskId) || null, provider: "default" })
        });
        const result = await response.json().catch(() => ({})) as { script?: string; error?: string };
        if (!response.ok || !result.script) throw new Error(result.error || "生成失败");
        generatedScripts[creator.id] = result.script;
        setScripts((current) => ({ ...current, [creator.id]: result.script! }));
        setScriptStatus((current) => ({ ...current, [creator.id]: "话术已生成，可以继续编辑。" }));
        generated += 1;
      } catch (error) {
        setScriptStatus((current) => ({ ...current, [creator.id]: error instanceof Error ? error.message : "生成失败，请重试。" }));
      }
    }));
    setIsGenerating(false);
    setOutreachSummary(`已生成 ${generated}/${selectedCreators.length} 人的话术。`);
    return generatedScripts;
  }

  async function sendSelectedScripts(scriptValues: Record<string, string> = scripts) {
    const sendable = selectedCreators.filter((creator) => creator.platform === "抖音" && scriptValues[creator.id]?.trim());
    if (!sendable.length) {
      setOutreachSummary("当前选中达人里没有可自动发送的抖音话术；小红书话术可复制后人工发送。");
      return;
    }
    if (!window.confirm(`确认依次向 ${sendable.length} 位抖音达人发送私信吗？发送成功后将自动标记为已建联。`)) return;
    setIsSending(true);
    let sent = 0;
    const successfulIds: string[] = [];
    for (const creator of sendable) {
      setScriptStatus((current) => ({ ...current, [creator.id]: "正在发送…" }));
      try {
        const response = await fetch("/api/outreach/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creatorId: creator.id,
            profileUrl: creator.profileUrl,
            message: scriptValues[creator.id],
            taskKind: "initial",
            campaignTaskId: Number(selectedCampaignTaskId) || null
          })
        });
        const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
        if (!response.ok || !result.ok) throw new Error(result.error || "发送失败");
        sent += 1;
        successfulIds.push(creator.id);
        setScriptStatus((current) => ({ ...current, [creator.id]: "已发送并标记为已建联。" }));
      } catch (error) {
        setScriptStatus((current) => ({ ...current, [creator.id]: error instanceof Error ? error.message : "发送失败。" }));
      }
    }
    setIsSending(false);
    if (successfulIds.length) handleSent(successfulIds);
    setOutreachSummary(`发送完成：成功 ${sent}/${sendable.length} 人。`);
  }

  async function generateAndSend() {
    const generatedScripts = await generateSelectedScripts();
    if (Object.keys(generatedScripts).length) await sendSelectedScripts(generatedScripts);
  }

  function changeCampaignTask(taskId: string) {
    setSelectedCampaignTaskId(taskId);
    const params = new URLSearchParams();
    if (taskId) params.set("campaignTaskId", taskId);
    if (platform === "抖音") params.set("platform", "douyin");
    if (platform === "小红书") params.set("platform", "xhs");
    window.location.href = `/creators${params.size ? `?${params.toString()}` : ""}`;
  }

  function changePlatform(nextPlatform: "全部" | "抖音" | "小红书") {
    const currentTaskPlatform = selectedCampaignTask
      ? (/小红书|xhs/i.test(String(selectedCampaignTask.platform || "")) ? "小红书" : "抖音")
      : null;
    const params = new URLSearchParams();
    if (nextPlatform === "抖音") params.set("platform", "douyin");
    if (nextPlatform === "小红书") params.set("platform", "xhs");
    if (selectedCampaignTaskId && (nextPlatform === ALL || currentTaskPlatform === nextPlatform)) {
      params.set("campaignTaskId", selectedCampaignTaskId);
    }
    window.location.href = `/creators${params.size ? `?${params.toString()}` : ""}`;
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
      setSelectedIds((current) => current.filter((id) => id !== creator.id));
    } catch {
      setError("删除接口没有响应，请确认本地服务还在运行。");
    } finally {
      setDeletingId(null);
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

  async function exportConnectedCreators() {
    if (!exportFrom || !exportTo || exportFrom > exportTo) {
      setError("请选择有效的建联日期范围。");
      return;
    }
    setError("");
    setIsExporting(true);
    try {
      const exportParams = new URLSearchParams({ from: exportFrom, to: exportTo });
      if (selectedCampaignTaskId) exportParams.set("campaignTaskId", selectedCampaignTaskId);
      const response = await fetch(`/api/creators/export-connected?${exportParams.toString()}`);
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        setError(result.error || "导出失败，请重试。");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `已建联达人-${exportFrom}-${exportTo}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("导出接口没有响应，请确认服务正常运行。");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className={`creator-library-shell ${platform === "小红书" ? "xhs-theme" : platform === "抖音" ? "douyin-theme" : "all-theme"}`}>
      <section className={`platform-overview ${platform === "抖音" ? "douyin-active" : platform === "小红书" ? "xhs-active" : "all-active"}`}>
        <div className="platform-switcher" aria-label="平台视图">
          {([ALL, "抖音", "小红书"] as const).map((item) => (
            <button aria-label={`切换到${item === ALL ? "全部" : item}平台`} className={platform === item ? "active" : ""} data-platform={item} key={item} onClick={() => changePlatform(item)} type="button">
              <span className={`platform-logo ${item === "抖音" ? "douyin" : item === "小红书" ? "xhs" : "all"}`}>{item === ALL ? "全" : item === "抖音" ? "抖" : "红"}</span>
              <span>{item === ALL ? "全部平台" : item}</span>
              <strong>{platformCounts[item]}</strong>
            </button>
          ))}
        </div>
        <section className="metrics workflow-metrics platform-metrics">
          <div><span>当前达人</span><strong>{platformMetrics.total}</strong></div>
          <div><span>精选库</span><strong>{platformMetrics.featured}</strong></div>
          <div><span>待选库</span><strong>{platformMetrics.candidate}</strong></div>
          <div><span>已建联</span><strong>{platformMetrics.contacted}</strong></div>
        </section>
      </section>
      <section className="panel campaign-task-picker workflow-section workflow-primary-section">
        <div>
          <span className="workflow-kicker">01 · 当前视图</span>
          <h2>品类任务视图</h2>
          <p>选择任务后，库类型和建联状态都按这个任务独立显示；同一达人不会影响其他品类任务。</p>
        </div>
        <div className="campaign-task-picker-controls">
          <BrandTaskPicker allowAll brandLibraries={initialBrandLibraries} campaignTasks={visibleCampaignTasks} onTaskChange={changeCampaignTask} selectedTaskId={selectedCampaignTaskId} storageKey="creators-brand-library" />
          <select hidden onChange={(event) => changeCampaignTask(event.target.value)} value={selectedCampaignTaskId}>
            <option value="">全局达人库</option>
            {visibleCampaignTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
          </select>
          <Link className="secondary-link workflow-manage-link" href="/agent">
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
              <strong>{businessCreators.length} 个</strong>
            </div>
            <p>{selectedCampaignTask.targetDescription}</p>
          </div>
        ) : null}
      </section>

      <section className="panel workflow-section workflow-action-section">
        <div className="panel-header">
          <div>
            <span className="workflow-kicker">02 · 库类型</span>
            <h2>库类型</h2>
            <p>画像通过后进入待选库，数据达到门槛后进入精选库；处理中间状态不在达人库展示。</p>
          </div>
          <div className="action-row">
            <div className="connected-export-control">
              <label>建联开始日期<input max={exportTo} onChange={(event) => setExportFrom(event.target.value)} type="date" value={exportFrom} /></label>
              <span>至</span>
              <label>建联结束日期<input min={exportFrom} onChange={(event) => setExportTo(event.target.value)} type="date" value={exportTo} /></label>
              <button className="secondary-button" disabled={isExporting} onClick={exportConnectedCreators} type="button">
                {isExporting ? "导出中…" : "导出已建联达人 CSV"}
              </button>
            </div>
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

      <section className="filter-bar workflow-filter-bar">
        <label>
          搜索
          <input onChange={(event) => setKeyword(event.target.value)} placeholder="达人昵称、类目、备注" value={keyword} />
        </label>
        <label>
          {selectedCampaignTask ? "当前任务建联状态" : "全局建联状态"}
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            {statuses.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </section>

      {error ? <p className="form-error">{error}</p> : null}

      <section className="panel workflow-section workflow-results-section">
        <div className="panel-header">
          <div>
            <span className="workflow-kicker">03 · 达人明细</span>
            <h2>达人列表</h2>
            <p>
              当前显示 {filteredCreators.length} / {businessCreators.length} 个达人。
            </p>
          </div>
          <div className="action-row">
            <button className="secondary-button" disabled={!selectableCreators.length} onClick={toggleVisibleCreators} type="button">
              {selectableCreators.length > 0 && selectableCreators.slice(0, 5).every((creator) => selectedIds.includes(creator.id)) ? "取消选择" : "选择当前前5位"}
            </button>
            <strong>已选 {selectedIds.length}/5</strong>
          </div>
        </div>
        <div className="table-wrap">
          <table className="creator-directory-table">
            <thead>
              <tr>
                <th>选择</th>
                <th>达人</th>
                <th>平台</th>
                <th>任务类别</th>
                <th>库类型</th>
                <th>建联状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredCreators.map((creator) => (
                <Fragment key={creator.id}>
                <tr className={selectedIds.includes(creator.id) ? "is-selected" : undefined}>
                  <td className="creator-select-cell">
                    <input
                      aria-label={`选择 ${creator.name}`}
                      checked={selectedIds.includes(creator.id)}
                      disabled={creator.poolStatus === "skipped" || creator.outreachStatus === "已建联" || !creator.profileUrl}
                      onChange={() => toggleCreator(creator)}
                      type="checkbox"
                    />
                  </td>
                  <td className="creator-identity-cell">
                    {creator.profileUrl ? <a className="creator-link" href={creator.profileUrl} rel="noreferrer" target="_blank">{creator.name}<span aria-hidden>↗</span></a> : <strong>{creator.name}</strong>}
                    <Link className="creator-detail-link" href={`/creators/${creator.id}`}>查看资料</Link>
                  </td>
                  <td><span className={`platform-pill ${creator.platform === "小红书" ? "xhs" : "douyin"}`}>{creator.platform}</span></td>
                  <td className="creator-task-cell">{creator.campaignTaskName || creator.category || "未分类"}</td>
                  <td>
                    <span className={`priority ${creator.poolStatus === "featured" ? "high" : creator.poolStatus === "candidate" ? "medium" : "low"}`}>
                      {getPoolLabel(creator.poolStatus)}
                    </span>
                  </td>
                  <td><span className={`outreach-status-pill ${creator.outreachStatus === "已建联" ? "connected" : "unconnected"}`}>{creator.outreachStatus}</span></td>
                  <td><div className="creator-row-actions">
                    {creator.poolStatus === "featured" ? (
                      <button className="secondary-button" disabled={movingId === creator.id} onClick={() => moveToCandidate(creator)} type="button">
                        {movingId === creator.id ? "移动中..." : "移到待选库"}
                      </button>
                    ) : null}
                    <button className="secondary-button danger-button" disabled={deletingId === creator.id} onClick={() => deleteCreator(creator)} type="button">
                      {deletingId === creator.id ? "删除中..." : "删除"}
                    </button>
                  </div></td>
                </tr>
                {selectedIds.includes(creator.id) ? (
                  <tr className="creator-inline-script-row">
                    <td aria-hidden />
                    <td colSpan={6}>
                      <div className="creator-inline-script">
                        <div className="creator-inline-script-heading">
                          <strong>{creator.name} 的建联话术</strong>
                          <span>{creator.platform === "抖音" ? "支持自动发送" : "小红书暂需复制后人工发送"}</span>
                        </div>
                        <textarea
                          aria-label={`${creator.name} 的建联话术`}
                          onChange={(event) => setScripts((current) => ({ ...current, [creator.id]: event.target.value }))}
                          rows={3}
                          value={scripts[creator.id] || ""}
                        />
                        <small>{scriptStatus[creator.id] || "可直接编辑，或点击下方批量生成 AI 话术。"}</small>
                      </div>
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {selectedCreators.length ? (
        <div className="creator-selection-bar">
          <div>
            <strong>已选择 {selectedCreators.length}/5 人</strong>
            <span>{outreachSummary || "话术已在对应达人行下方展开"}</span>
          </div>
          <div className="creator-selection-actions">
            <button className="secondary-button" disabled={isGenerating || isSending} onClick={() => setSelectedIds([])} type="button">取消选择</button>
            <button disabled={isGenerating || isSending} onClick={generateSelectedScripts} type="button">{isGenerating ? "生成中…" : "批量生成 AI 话术"}</button>
            <button className="go-contact-button" disabled={isGenerating || isSending} onClick={() => sendSelectedScripts()} type="button">{isSending ? "发送中…" : "发送抖音话术"}</button>
            <button className="go-contact-button" disabled={isGenerating || isSending} onClick={generateAndSend} type="button">一键生成并发送</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
