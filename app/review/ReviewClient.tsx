"use client";

import { useMemo, useState } from "react";
import type { BrandLibraryItem, CampaignTaskItem } from "@/lib/campaign-tasks";
import { BrandTaskPicker } from "@/app/components/BrandTaskPicker";
import { resolveDiscoveryRuleTemplate } from "@/lib/discovery-rule-templates";
import type { ReviewCreator } from "@/lib/review";
import type { HomepageReviewRules } from "@/lib/douyin-homepage";

type ReviewResult = {
  id?: number;
  ok?: boolean;
  skipped?: boolean;
  message?: string;
  poolStatus?: string;
  screeningStatus?: string;
  screeningSummary?: string;
  error?: string;
  avgLikes?: number;
  maxLikes?: number;
  recentWorkCount?: number;
  viralWorkCount?: number;
  sampleWorkCount?: number;
};

type BatchReviewResponse = {
  ok?: boolean;
  total?: number;
  succeeded?: number;
  skipped?: number;
  failed?: number;
  results?: ReviewResult[];
  error?: string;
};

type ReviewRunOptions = {
  keepRunningState?: boolean;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function statusLabel(status?: string): string {
  if (status === "homepage_sample_pending") return "等待补齐主页样本";
  if (status === "portrait_passed") return "AI画像通过：待选库";
  if (status === "portrait_insufficient") return "AI画像：信息不足";
  if (status === "portrait_data_incomplete") return "主页样本不完整";
  if (status === "portrait_rejected") return "AI画像排除";
  if (status === "featured_stable") return "精选库：稳定优质";
  if (status === "featured_trending") return "精选库：近期流量好";
  if (status === "candidate_potential") return "待选库：潜力观察";
  if (status === "candidate_observe") return "待选库：普通观察";
  if (status === "inactive_or_failed") return "跳过";
  return status || "等待处理";
}

function resultTone(result?: ReviewResult): string {
  if (!result) return "";
  if (result.error || result.skipped) return "error";
  if (result.poolStatus === "featured") return "success";
  return "";
}

function creatorPriority(creator: ReviewCreator): number {
  const summary = creator.screeningSummary || "";
  const isStrong = summary.includes("强候选") || summary.includes("AI保留") || summary.includes("candidate_strong");
  const hasRecentHint = summary.includes("近1个月有更新") || creator.recentWorkCount > 0;
  return (
    (isStrong ? 1_000_000_000 : 0) +
    (hasRecentHint ? 100_000_000 : 0) +
    creator.maxLikes * 10 +
    creator.avgLikes +
    creator.viralWorkCount * 50_000
  );
}

function isPriorityCreator(creator: ReviewCreator): boolean {
  const summary = creator.screeningSummary || "";
  return summary.includes("强候选") || summary.includes("AI保留") || summary.includes("candidate_strong");
}

function buildBatchQueue(creators: ReviewCreator[], onlyPriorityBatch: boolean): ReviewCreator[] {
  const sorted = creators
    .filter((creator) => creator.poolStatus === "candidate" && creator.screeningStatus === "portrait_passed")
    .sort((a, b) => creatorPriority(b) - creatorPriority(a));
  if (!onlyPriorityBatch) return sorted.slice(0, 30);

  const priorityCreators = sorted.filter(isPriorityCreator);
  return (priorityCreators.length ? priorityCreators : sorted).slice(0, 30);
}

type ReviewClientProps = {
  initialCreators: ReviewCreator[];
  initialBrandLibraries: BrandLibraryItem[];
  initialCampaignTasks: CampaignTaskItem[];
  initialCampaignTaskId: number | null;
};

export function ReviewClient({ initialCreators, initialBrandLibraries, initialCampaignTasks, initialCampaignTaskId }: ReviewClientProps) {
  const initialCampaignTask = initialCampaignTasks.find((task) => task.id === initialCampaignTaskId);
  const initialMetricRules = resolveDiscoveryRuleTemplate(initialCampaignTask).metricRules;
  const [creators, setCreators] = useState([...initialCreators].sort((a, b) => creatorPriority(b) - creatorPriority(a)));
  const [campaignTasks] = useState(initialCampaignTasks);
  const [selectedCampaignTaskId, setSelectedCampaignTaskId] = useState(initialCampaignTaskId ? String(initialCampaignTaskId) : "");
  const [runningId, setRunningId] = useState<number | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [results, setResults] = useState<Record<number, ReviewResult>>({});
  const [onlyPriorityBatch, setOnlyPriorityBatch] = useState(false);
  const [rules, setRules] = useState<HomepageReviewRules>({
    requireAvgLikes500: initialMetricRules.requireAvgLikes,
    requireViral2000: initialMetricRules.requireViralWorks,
    requireWorkCount10: initialMetricRules.requireSampleWorks,
    requireRecentViral: false,
    requireRecentUpdate: initialMetricRules.requireRecentUpdate,
    avgLikesThreshold: initialMetricRules.avgLikesThreshold,
    viralLikesThreshold: initialMetricRules.viralLikesThreshold,
    minViralWorks: initialMetricRules.minViralWorks,
    minSampleWorks: initialMetricRules.minSampleWorks,
    metricMatchMode: initialMetricRules.matchMode
  });

  const selectedRuleLabels = useMemo(() => {
    const labels = [];
    if (rules.requireAvgLikes500) labels.push(`平均点赞 > ${rules.avgLikesThreshold || 500}`);
    if (rules.requireViral2000) labels.push(`至少 ${rules.minViralWorks || 1} 条点赞 > ${rules.viralLikesThreshold || 2000}`);
    if (rules.requireWorkCount10) labels.push(`主页样本数 ≥ ${rules.minSampleWorks || 10}`);
    if (rules.requireRecentViral) labels.push("爆款在近 1 个月内");
    if (rules.requireRecentUpdate) labels.push("近 1 个月有更新");
    const separator = rules.metricMatchMode === "any" ? " 或 " : " + ";
    return labels.length ? labels.join(separator) : "不设置数据门槛，画像通过的达人都进入精选库";
  }, [rules]);

  const selectedCampaignTask = useMemo(
    () => campaignTasks.find((task) => String(task.id) === selectedCampaignTaskId) || null,
    [campaignTasks, selectedCampaignTaskId]
  );

  function changeCampaignTask(taskId: string) {
    setSelectedCampaignTaskId(taskId);
    const suffix = taskId ? `?campaignTaskId=${encodeURIComponent(taskId)}` : "";
    window.location.href = `/review${suffix}`;
  }

  function toggleRule(key: keyof HomepageReviewRules) {
    setRules((current) => ({ ...current, [key]: !current[key] }));
  }

  function setNumberRule(key: keyof HomepageReviewRules, value: number) {
    setRules((current) => ({ ...current, [key]: Math.max(0, value) }));
  }

  async function reviewCreator(creator: ReviewCreator, options: ReviewRunOptions = {}) {
    if (!options.keepRunningState) setRunningId(creator.id);
    setResults((current) => ({
      ...current,
      [creator.id]: { message: "正在读取已记录指标并应用数据门槛…" }
    }));

    try {
      const response = await fetch("/api/review/douyin/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: [creator.externalId || String(creator.id)],
          campaignTaskId: selectedCampaignTaskId || null,
          rules
        })
      });
      const batchData = (await response.json()) as BatchReviewResponse;
      const data = batchData.results?.[0] || { error: batchData.error };

      if (!response.ok) {
        setResults((current) => ({
          ...current,
          [creator.id]: { error: data.error || "数据门槛筛选失败" }
        }));
        return false;
      }

      setResults((current) => ({
        ...current,
        [creator.id]: data
      }));
      setCreators((current) => current.filter((item) => item.id !== creator.id));
      return true;
    } catch {
      setResults((current) => ({
        ...current,
        [creator.id]: { error: "数据门槛接口没有响应，请确认本地服务正常。" }
      }));
      return false;
    } finally {
      if (!options.keepRunningState) setRunningId(null);
    }
  }

  async function reviewAll() {
    setIsBatchRunning(true);
    setRunningId(null);

    try {
      const batch = buildBatchQueue(creators, onlyPriorityBatch);
      setResults((current) => {
        const next = { ...current };
        for (const creator of batch) {
            next[creator.id] = { message: "已进入数据门槛队列，不会重新打开 Crawler。" };
        }
        return next;
      });

      const response = await fetch("/api/review/douyin/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: batch.map((creator) => creator.externalId || String(creator.id)),
          campaignTaskId: selectedCampaignTaskId || null,
          rules
        })
      });
      const data = (await response.json()) as BatchReviewResponse;

      if (!response.ok) {
        setResults((current) => {
          const next = { ...current };
          for (const creator of batch) {
            next[creator.id] = { error: data.error || "批量数据门槛筛选失败" };
          }
          return next;
        });
        return;
      }

      const resultRows = data.results || [];
      setResults((current) => {
        const next = { ...current };
        for (const item of resultRows) {
          if (item.id) next[item.id] = item;
        }
        return next;
      });
      const removableIds = new Set(resultRows.filter((item) => !item.error && item.id).map((item) => item.id));
      setCreators((current) => current.filter((creator) => !removableIds.has(creator.id)));
    } finally {
      setRunningId(null);
      setIsBatchRunning(false);
    }
  }

  async function profileCreators(targets: ReviewCreator[]) {
    if (!targets.length) return;
    setIsBatchRunning(true);
    setRunningId(null);
    setResults((current) => {
      const next = { ...current };
      for (const creator of targets) next[creator.id] = { message: "正在补齐主页样本并执行 AI 作品画像…" };
      return next;
    });

    try {
      const response = await fetch("/api/review/douyin/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "portrait",
          ids: targets.map((creator) => creator.externalId || String(creator.id)),
          campaignTaskId: selectedCampaignTaskId || null,
          workLimit: 10,
          allowFullRetry: true,
          skipObviousMismatch: true
        })
      });
      const data = (await response.json()) as BatchReviewResponse;
      if (!response.ok) {
        setResults((current) => {
          const next = { ...current };
          for (const creator of targets) next[creator.id] = { error: data.error || "主页样本与 AI 画像失败" };
          return next;
        });
        return;
      }

      const rows = data.results || [];
      const rowMap = new Map(rows.filter((row) => row.id).map((row) => [row.id as number, row]));
      setResults((current) => {
        const next = { ...current };
        for (const row of rows) if (row.id) next[row.id] = row;
        return next;
      });
      setCreators((current) => current
        .map((creator) => {
          const row = rowMap.get(creator.id);
          if (!row) return creator;
          return {
            ...creator,
            poolStatus: row.poolStatus || creator.poolStatus,
            screeningStatus: row.screeningStatus || creator.screeningStatus,
            screeningSummary: row.screeningSummary || row.message || creator.screeningSummary,
            avgLikes: row.avgLikes ?? creator.avgLikes,
            maxLikes: row.maxLikes ?? creator.maxLikes,
            recentWorkCount: row.recentWorkCount ?? creator.recentWorkCount,
            viralWorkCount: row.viralWorkCount ?? creator.viralWorkCount,
            sampleWorkCount: row.sampleWorkCount ?? creator.sampleWorkCount
          };
        })
        .filter((creator) => !["rejected", "skipped"].includes(creator.poolStatus)));
    } finally {
      setIsBatchRunning(false);
    }
  }

  const isBusy = runningId !== null || isBatchRunning;
  const portraitQueue = creators.filter((creator) => creator.poolStatus === "pending_review");
  const metricQueue = creators.filter((creator) => creator.poolStatus === "candidate" && creator.screeningStatus === "portrait_passed");
  const priorityCount = metricQueue.filter(isPriorityCreator).length;
  const batchCount = buildBatchQueue(creators, onlyPriorityBatch).length;
  const batchModeText = onlyPriorityBatch && priorityCount === 0 && creators.length ? "暂无强候选，将按数据表现排序" : "只读取已记录的主页指标，不重新采集";

  return (
    <div className="discover-stack review-layout">
      <section className="panel review-note workflow-guide">
        <span className="review-guide-icon">i</span>
        <div>
          <h2>分层筛选说明</h2>
          <p>样本与画像队列负责补齐主页作品并调用品类 AI；画像通过后进入待选库。数据门槛阶段只读快照，不再启动 Crawler 或调用 AI。</p>
        </div>
      </section>

      <section className="panel campaign-task-picker workflow-section workflow-primary-section">
        <div>
          <span className="workflow-kicker">01 · 当前品类</span>
          <h2>品类任务</h2>
          <p>数据门槛结果会写回当前品类任务；作品画像仍由该品类的 AI 模板负责。</p>
        </div>
        <div className="campaign-task-picker-controls">
          <BrandTaskPicker allowAll brandLibraries={initialBrandLibraries} campaignTasks={campaignTasks} onTaskChange={changeCampaignTask} selectedTaskId={selectedCampaignTaskId} storageKey="review-brand-library" />
          <select hidden onChange={(event) => changeCampaignTask(event.target.value)} value={selectedCampaignTaskId}>
            <option value="">全局样本与数据队列</option>
            {campaignTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
          </select>
          <a className="secondary-link" href="/agent">
            管理品类任务
          </a>
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
              <span>排除方向</span>
              <strong>{selectedCampaignTask.excludeKeywords.join("，") || "-"}</strong>
            </div>
            <p>{selectedCampaignTask.targetDescription}</p>
          </div>
        ) : null}
      </section>

      <section className="panel workflow-section workflow-action-section">
        <div className="panel-header">
          <div>
            <span className="workflow-kicker">02 · 精选门槛</span>
            <h2>精选库规则</h2>
            <p>当前规则：{selectedRuleLabels}</p>
          </div>
          <div className="task-actions">
            <button disabled={!portraitQueue.length || isBusy} onClick={() => void profileCreators(portraitQueue.slice(0, 30))} type="button">
              {isBatchRunning ? "处理中..." : `补齐样本并画像前${Math.min(30, portraitQueue.length)}个`}
            </button>
            <button disabled={!batchCount || isBusy} onClick={reviewAll} type="button">
              {isBatchRunning ? "处理中..." : `对前${batchCount}个应用数据门槛`}
            </button>
          </div>
        </div>

        <div className="review-rule-console">
          <div className="review-rule-toolbar">
            <div>
              <strong>数据门槛</strong>
              <span className="review-switch active" aria-hidden="true"><i /></span>
              <span>已开启</span>
            </div>
            <span>指标已经在 AI 画像阶段记录，本阶段不再抓取作品。</span>
          </div>

          <div className="topic-list review-metric-grid">
          <label className={`review-metric-card ${rules.requireAvgLikes500 ? "selected" : ""}`}>
            <input checked={Boolean(rules.requireAvgLikes500)} onChange={() => toggleRule("requireAvgLikes500")} type="checkbox" />
            <span>平均点赞</span>
            <input min={0} onChange={(event) => setNumberRule("avgLikesThreshold", Number(event.target.value))} type="number" value={rules.avgLikesThreshold || 500} />
          </label>
          <label className={`review-metric-card wide ${rules.requireViral2000 ? "selected" : ""}`}>
            <input checked={Boolean(rules.requireViral2000)} onChange={() => toggleRule("requireViral2000")} type="checkbox" />
            <span>爆款作品</span>
            <input min={1} onChange={(event) => setNumberRule("minViralWorks", Number(event.target.value))} type="number" value={rules.minViralWorks || 1} />
            <em>条，点赞 ≥</em>
            <input min={0} onChange={(event) => setNumberRule("viralLikesThreshold", Number(event.target.value))} type="number" value={rules.viralLikesThreshold || 2000} />
          </label>
          <label className={`review-metric-card ${rules.requireWorkCount10 ? "selected" : ""}`}>
            <input checked={Boolean(rules.requireWorkCount10)} onChange={() => toggleRule("requireWorkCount10")} type="checkbox" />
            <span>主页样本数</span>
            <input min={1} onChange={(event) => setNumberRule("minSampleWorks", Number(event.target.value))} type="number" value={rules.minSampleWorks || 10} />
          </label>
          <label className={`review-metric-card compact ${rules.requireRecentViral ? "selected" : ""}`}>
            <input checked={Boolean(rules.requireRecentViral)} onChange={() => toggleRule("requireRecentViral")} type="checkbox" />
            <span>爆款作品在近 1 个月内</span>
          </label>
          <label className={`review-metric-card compact ${rules.requireRecentUpdate ? "selected" : ""}`}>
            <input checked={Boolean(rules.requireRecentUpdate)} onChange={() => toggleRule("requireRecentUpdate")} type="checkbox" />
            <span>近 1 个月有更新</span>
          </label>
          </div>

          <div className="review-rule-options">
            <label className={onlyPriorityBatch ? "selected" : ""}>
              <input checked={onlyPriorityBatch} onChange={() => setOnlyPriorityBatch((value) => !value)} type="checkbox" />
              <span>只处理高优先级待选</span>
            </label>
            <label>
              <span>多项门槛逻辑</span>
              <select
                onChange={(event) => setRules((current) => ({ ...current, metricMatchMode: event.target.value === "any" ? "any" : "all" }))}
                value={rules.metricMatchMode || "all"}
              >
                <option value="all">需要全部满足</option>
                <option value="any">满足任意一项</option>
              </select>
            </label>
            <div>
              <span>本次应用范围</span>
              <strong>前 {batchCount} 个待选达人</strong>
            </div>
          </div>

          <p className="review-rule-tip">数据门槛只校验画像阶段记录的指标；建议先完成主页样本和 AI 画像，再批量应用门槛。</p>
        </div>
      </section>

      <section className="panel workflow-section workflow-results-section">
        <div className="panel-header">
          <div>
            <span className="workflow-kicker">03 · 待处理达人</span>
            <h2>样本与数据筛选队列</h2>
            <p>
              待补齐/画像 {portraitQueue.length} 个，画像通过待选 {metricQueue.length} 个，数据门槛队列 {batchCount} 个；{batchModeText}。
            </p>
          </div>
        </div>

        {creators.length ? (
          <div className="candidate-grid">
            {creators.map((creator) => {
              const result = results[creator.id];
              return (
                <article className={`candidate-card ${resultTone(result)}`} key={creator.id}>
                  <div className="candidate-head">
                    <label>
                      <span>{creator.name}</span>
                    </label>
                    <strong>{creator.category}</strong>
                  </div>

                  <div className="candidate-metrics">
                    <div>
                      <span>内容样本均赞</span>
                      <strong>{formatNumber(creator.avgLikes)}</strong>
                    </div>
                    <div>
                      <span>内容样本最高赞</span>
                      <strong>{formatNumber(creator.maxLikes)}</strong>
                    </div>
                    <div>
                      <span>内容样本爆款</span>
                      <strong>{creator.viralWorkCount}</strong>
                    </div>
                    <div>
                      <span>主页样本</span>
                      <strong>{creator.sampleWorkCount}</strong>
                    </div>
                  </div>

                  <p className="candidate-title">{result?.screeningSummary || result?.message || result?.error || creator.screeningSummary}</p>

                  <div className="candidate-links">
                    {creator.profileUrl ? (
                      <a href={creator.profileUrl} rel="noreferrer" target="_blank">
                        达人主页
                      </a>
                    ) : (
                      <span>暂无主页链接</span>
                    )}
                  </div>

                  {creator.poolStatus === "pending_review" ? (
                    <button disabled={isBusy} onClick={() => void profileCreators([creator])} type="button">
                      补齐主页样本并 AI 画像
                    </button>
                  ) : (
                    <button disabled={isBusy} onClick={() => reviewCreator(creator)} type="button">
                      {runningId === creator.id ? "筛选中..." : "应用数据门槛"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="empty-state">目前没有完成 AI 画像并通过的待选达人。请先在 Agent 工作台完成主页样本补齐和作品画像初筛。</p>
        )}

        {Object.entries(results).length ? (
          <div className="result-box discover-result">
            <strong>最近筛选结果</strong>
            {Object.entries(results)
              .slice(-5)
              .map(([id, result]) => (
                <p key={id}>{result.error || result.message || result.screeningSummary || statusLabel(result.screeningStatus)}</p>
              ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
