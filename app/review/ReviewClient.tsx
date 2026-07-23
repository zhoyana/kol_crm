"use client";

import { useMemo, useState } from "react";
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
  workLimit?: number;
  allowFullRetry?: boolean;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function statusLabel(status?: string): string {
  if (status === "featured_stable") return "精选库：稳定优质";
  if (status === "featured_trending") return "精选库：近期流量好";
  if (status === "candidate_potential") return "待选库：潜力观察";
  if (status === "candidate_observe") return "待选库：普通观察";
  if (status === "inactive_or_failed") return "跳过";
  return status || "待复筛";
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
  const sorted = [...creators].sort((a, b) => creatorPriority(b) - creatorPriority(a));
  if (!onlyPriorityBatch) return sorted.slice(0, 10);

  const priorityCreators = sorted.filter(isPriorityCreator);
  return (priorityCreators.length ? priorityCreators : sorted).slice(0, 10);
}

export function ReviewClient({ initialCreators }: { initialCreators: ReviewCreator[] }) {
  const [creators, setCreators] = useState([...initialCreators].sort((a, b) => creatorPriority(b) - creatorPriority(a)));
  const [runningId, setRunningId] = useState<number | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [results, setResults] = useState<Record<number, ReviewResult>>({});
  const [onlyPriorityBatch, setOnlyPriorityBatch] = useState(true);
  const [batchWorkLimit, setBatchWorkLimit] = useState(3);
  const [rules, setRules] = useState<HomepageReviewRules>({
    requireAvgLikes500: true,
    requireViral2000: true,
    requireWorkCount10: false,
    requireRecentViral: false
  });

  const selectedRuleLabels = useMemo(() => {
    const labels = [];
    if (rules.requireAvgLikes500) labels.push("平均点赞 > 500");
    if (rules.requireViral2000) labels.push("出现点赞 > 2000 爆款");
    if (rules.requireWorkCount10) labels.push("作品总数 > 10");
    if (rules.requireRecentViral) labels.push("爆款在近 1 个月内");
    return labels.length ? labels.join(" + ") : "不设置精选条件，活跃账号都进入精选库";
  }, [rules]);

  function toggleRule(key: keyof HomepageReviewRules) {
    setRules((current) => ({ ...current, [key]: !current[key] }));
  }

  async function reviewCreator(creator: ReviewCreator, options: ReviewRunOptions = {}) {
    const workLimit = options.workLimit || 6;
    if (!options.keepRunningState) setRunningId(creator.id);
    setResults((current) => ({
      ...current,
      [creator.id]: { message: `正在抓取主页最近${workLimit}条作品${options.allowFullRetry ? "，必要时再升级10条" : ""}...` }
    }));

    try {
      const response = await fetch(`/api/review/douyin/${encodeURIComponent(creator.externalId || String(creator.id))}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules,
          workLimit,
          allowFullRetry: options.allowFullRetry ?? true,
          skipObviousMismatch: true
        })
      });
      const data = (await response.json()) as ReviewResult;

      if (!response.ok) {
        setResults((current) => ({
          ...current,
          [creator.id]: { error: data.error || "复筛失败" }
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
        [creator.id]: { error: "复筛接口没有响应，请确认本地服务和 MediaCrawler 正常。" }
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
          next[creator.id] = { message: `已进入批量队列：本轮抓取主页最近${batchWorkLimit}条作品...` };
        }
        return next;
      });

      const response = await fetch("/api/review/douyin/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: batch.map((creator) => creator.externalId || String(creator.id)),
          rules,
          workLimit: batchWorkLimit,
          skipObviousMismatch: true
        })
      });
      const data = (await response.json()) as BatchReviewResponse;

      if (!response.ok) {
        setResults((current) => {
          const next = { ...current };
          for (const creator of batch) {
            next[creator.id] = { error: data.error || "批量复筛失败" };
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

  const isBusy = runningId !== null || isBatchRunning;
  const priorityCount = creators.filter(isPriorityCreator).length;
  const batchCount = buildBatchQueue(creators, onlyPriorityBatch).length;
  const batchModeText = onlyPriorityBatch && priorityCount === 0 && creators.length ? "暂无强候选，将按综合优先级跑普通候选" : "优先复筛高赞、强候选和疑似活跃达人";

  return (
    <div className="discover-stack">
      <section className="panel review-note">
        <h2>待复筛池</h2>
        <p>这里的达人已经通过内容初筛。批量复筛默认只跑强候选，并用更少主页作品先快速判断；单个达人仍可手动复筛。</p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>精选库规则</h2>
            <p>当前规则：{selectedRuleLabels}</p>
          </div>
          <button disabled={!batchCount || isBusy} onClick={reviewAll} type="button">
            {isBatchRunning ? "批量复筛中..." : `批量复筛前${batchCount}个`}
          </button>
        </div>

        <div className="review-speed-row">
          <label className={onlyPriorityBatch ? "selected" : ""}>
            <input checked={onlyPriorityBatch} onChange={() => setOnlyPriorityBatch((value) => !value)} type="checkbox" />
            <span>批量只跑强候选/AI保留</span>
          </label>
          <label>
            <span>批量抓取作品数</span>
            <select onChange={(event) => setBatchWorkLimit(Number(event.target.value))} value={batchWorkLimit}>
              <option value={3}>3条：最快，先粗筛</option>
              <option value={6}>6条：平衡</option>
              <option value={10}>10条：更完整</option>
            </select>
          </label>
        </div>

        <div className="topic-list">
          <label className={rules.requireAvgLikes500 ? "selected" : ""}>
            <input checked={Boolean(rules.requireAvgLikes500)} onChange={() => toggleRule("requireAvgLikes500")} type="checkbox" />
            <span>平均点赞 &gt; 500</span>
          </label>
          <label className={rules.requireViral2000 ? "selected" : ""}>
            <input checked={Boolean(rules.requireViral2000)} onChange={() => toggleRule("requireViral2000")} type="checkbox" />
            <span>出现点赞 &gt; 2000 爆款</span>
          </label>
          <label className={rules.requireWorkCount10 ? "selected" : ""}>
            <input checked={Boolean(rules.requireWorkCount10)} onChange={() => toggleRule("requireWorkCount10")} type="checkbox" />
            <span>作品总数 &gt; 10</span>
          </label>
          <label className={rules.requireRecentViral ? "selected" : ""}>
            <input checked={Boolean(rules.requireRecentViral)} onChange={() => toggleRule("requireRecentViral")} type="checkbox" />
            <span>爆款作品在近 1 个月内</span>
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>待复筛达人</h2>
            <p>
              当前 {creators.length} 个。批量队列 {batchCount} 个，强候选 {priorityCount} 个；{batchModeText}。
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
                      <span>状态</span>
                      <strong>{statusLabel(result?.screeningStatus)}</strong>
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

                  <button disabled={isBusy} onClick={() => reviewCreator(creator)} type="button">
                    {runningId === creator.id ? "复筛中..." : "轻量复筛这个达人"}
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="empty-state">待复筛池现在是空的。先去达人发现页把内容初筛通过的人加入待复筛池。</p>
        )}

        {Object.entries(results).length ? (
          <div className="result-box discover-result">
            <strong>最近复筛结果</strong>
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
