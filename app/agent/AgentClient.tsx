"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { BrandLibraryItem, CampaignTaskItem } from "@/lib/campaign-tasks";
import { BrandTaskPicker } from "@/app/components/BrandTaskPicker";
import type { CampaignTaskSummary } from "@/lib/agent-workbench";
import { AgentPipelineDashboard } from "./AgentPipelineDashboard";

type CampaignTaskDraft = {
  brandLibraryId: string;
  name: string;
  productName: string;
  category: string;
  targetAudience: string;
  targetDescription: string;
  seedKeywords: string;
  excludeKeywords: string;
  productSellingPoints: string;
  outreachTone: string;
};

type AudienceTemplateSummary = {
  id: number;
  brandLibraryId: number;
  brandName: string | null;
  name: string;
  category: string | null;
  targetAudience: string;
  targetDescription: string;
  discovery: { primaryTerms: string[]; supportTerms: string[]; excludeTerms: string[] };
  acceptedIdentities: string[];
  rejectedAccounts: string[];
  metricRules: {
    avgLikesThreshold: number;
    viralLikesThreshold: number;
    minViralWorks: number;
    requireAvgLikes: boolean;
    requireViralWorks: boolean;
  };
  examples: { positive: number; pending: number; negative: number };
};

const defaultCampaignTask: CampaignTaskDraft = {
  brandLibraryId: "",
  name: "",
  productName: "",
  category: "",
  targetAudience: "",
  targetDescription: "",
  seedKeywords: "",
  excludeKeywords: "",
  productSellingPoints: "",
  outreachTone: ""
};

function splitTerms(value: string): string[] {
  return value
    .split(/[,\n，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createEmptySummary(campaignTaskId: number): CampaignTaskSummary {
  const query = `campaignTaskId=${campaignTaskId}`;
  return {
    campaignTaskId,
    counts: {
      total: 0,
      pendingReview: 0,
      candidate: 0,
      featured: 0,
      skipped: 0,
      featuredUncontacted: 0,
      contacted: 0
    },
    recommendation: {
      title: "先补达人池",
      reason: "这个品类任务下面还没有达人数据，先去达人发现采一批候选。",
      primaryAction: "去达人发现",
      primaryHref: `/discover?${query}`
    },
    links: {
      discover: `/discover?${query}`,
      review: `/review?${query}`,
      creators: `/creators?${query}`,
      tasks: `/tasks?${query}`
    }
  };
}

export function AgentClient({
  initialBrandLibraries,
  initialCampaignTasks,
  initialSummaries
}: {
  initialBrandLibraries: BrandLibraryItem[];
  initialCampaignTasks: CampaignTaskItem[];
  initialSummaries: CampaignTaskSummary[];
}) {
  const [campaignTasks, setCampaignTasks] = useState(initialCampaignTasks);
  const [summaries, setSummaries] = useState(initialSummaries);
  const [selectedCampaignTaskId, setSelectedCampaignTaskId] = useState(
    initialCampaignTasks[0]?.id ? String(initialCampaignTasks[0].id) : ""
  );
  const [taskDraft, setTaskDraft] = useState({ ...defaultCampaignTask, brandLibraryId: initialBrandLibraries[0]?.id ? String(initialBrandLibraries[0].id) : "" });
  const [taskSaving, setTaskSaving] = useState(false);
  const [message, setMessage] = useState("");

  // 选品牌后自动加载对应的固定达人模板；命中后核心筛选规则锁定，仅允许补充少量关键词
  const [audienceTemplate, setAudienceTemplate] = useState<AudienceTemplateSummary | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [extraSeed, setExtraSeed] = useState("");
  const [extraExclude, setExtraExclude] = useState("");

  useEffect(() => {
    const brandId = Number(taskDraft.brandLibraryId) || 0;
    if (!brandId) {
      setAudienceTemplate(null);
      return;
    }
    let cancelled = false;
    setTemplateLoading(true);
    fetch(`/api/audience-templates?brandId=${brandId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const templates: AudienceTemplateSummary[] = data?.templates || [];
        const tmpl = templates[0] || null;
        setAudienceTemplate(tmpl);
        if (tmpl) {
          // 核心筛选规则由模板决定，预填为只读展示
          setTaskDraft((draft) => ({
            ...draft,
            targetAudience: tmpl.targetAudience || draft.targetAudience,
            targetDescription: tmpl.targetDescription || draft.targetDescription,
            seedKeywords: tmpl.discovery.primaryTerms.join("，"),
            excludeKeywords: tmpl.discovery.excludeTerms.join("，")
          }));
          setExtraSeed("");
          setExtraExclude("");
        }
      })
      .catch(() => {
        if (!cancelled) setAudienceTemplate(null);
      })
      .finally(() => {
        if (!cancelled) setTemplateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskDraft.brandLibraryId]);

  const selectedTask = useMemo(
    () => campaignTasks.find((task) => String(task.id) === selectedCampaignTaskId) || null,
    [campaignTasks, selectedCampaignTaskId]
  );

  const selectedSummary = useMemo(() => {
    if (!selectedTask) return null;
    return summaries.find((item) => item.campaignTaskId === selectedTask.id) || createEmptySummary(selectedTask.id);
  }, [selectedTask, summaries]);

  function updateTaskDraft(field: keyof CampaignTaskDraft, value: string) {
    setTaskDraft((draft) => ({ ...draft, [field]: value }));
  }

  async function saveCampaignTask() {
    setTaskSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/campaign-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandLibraryId: Number(taskDraft.brandLibraryId) || null,
          name: taskDraft.name,
          productName: taskDraft.productName,
          category: taskDraft.category,
          targetAudience: taskDraft.targetAudience,
          targetDescription: taskDraft.targetDescription,
          seedKeywords: splitTerms(taskDraft.seedKeywords),
          excludeKeywords: splitTerms(taskDraft.excludeKeywords),
          productSellingPoints: splitTerms(taskDraft.productSellingPoints),
          outreachTone: taskDraft.outreachTone,
          audienceTemplateId: audienceTemplate ? audienceTemplate.id : null,
          extraSeedKeywords: splitTerms(extraSeed),
          extraExcludeKeywords: splitTerms(extraExclude)
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "保存品类任务失败");
      }

      const task = data.task as CampaignTaskItem;
      setCampaignTasks((items) => [task, ...items]);
      setSummaries((items) => [createEmptySummary(task.id), ...items]);
      setSelectedCampaignTaskId(String(task.id));
      setMessage("已保存品类任务。下一步可以去达人发现，用这个任务开始采集。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存品类任务失败");
    } finally {
      setTaskSaving(false);
    }
  }

  return (
    <div className="agent-stack">
      <section className="panel agent-panel agent-current-task-panel">
        <div className="panel-header">
          <div>
            <span className="agent-section-kicker">01 · 当前任务</span>
            <h2>当前任务</h2>
            <p>先确认本次要推进的任务，再执行完整筛选流程。</p>
          </div>
          <label className="agent-task-select">
            <span>切换任务</span>
            <BrandTaskPicker brandLibraries={initialBrandLibraries} campaignTasks={campaignTasks} onTaskChange={setSelectedCampaignTaskId} selectedTaskId={selectedCampaignTaskId} storageKey="agent-brand-library" />
          </label>
        </div>

        <div className="agent-workbench-grid">
          {selectedTask && selectedSummary ? (
            <>
              <div className="agent-task-info">
                <span className="agent-product-tag">{selectedTask.productName}</span>
                <h3>{selectedTask.name}</h3>
                <strong>{selectedTask.targetAudience}</strong>
                <p>{selectedTask.targetDescription}</p>
              </div>

              <div className="agent-suggestion">
                <span>Agent 下一步建议</span>
                <strong>{selectedSummary.recommendation.title}</strong>
                <p>{selectedSummary.recommendation.reason}</p>
                <Link className="button-link" href={selectedSummary.recommendation.primaryHref}>
                  {selectedSummary.recommendation.primaryAction}
                </Link>
              </div>
            </>
          ) : (
            <p className="empty-state">先保存一个品类任务，Agent 工作台才知道围绕什么目标推进。</p>
          )}
        </div>

        {selectedSummary ? (
          <>
            <div className="agent-rule-meta">
              <div>
                <span>待补样本/画像</span>
                <strong>{selectedSummary.counts.pendingReview}</strong>
              </div>
              <div>
                <span>达人待选库</span>
                <strong>{selectedSummary.counts.candidate}</strong>
              </div>
              <div>
                <span>达人精选库</span>
                <strong>{selectedSummary.counts.featured}</strong>
              </div>
              <div>
                <span>已跳过</span>
                <strong>{selectedSummary.counts.skipped}</strong>
              </div>
              <div>
                <span>精选未建联</span>
                <strong>{selectedSummary.counts.featuredUncontacted}</strong>
              </div>
              <div>
                <span>精选已建联</span>
                <strong>{selectedSummary.counts.contacted}</strong>
              </div>
            </div>

            <div className="workflow-actions">
              <Link href={selectedSummary.links.discover}>1. 达人发现</Link>
              <Link href={selectedSummary.links.review}>2. 样本与数据筛选</Link>
              <Link href={selectedSummary.links.creators}>3. 达人库</Link>
              <Link href={selectedSummary.links.tasks}>4. 建联任务</Link>
            </div>
          </>
        ) : null}
      </section>

      {selectedTask ? (
        <AgentPipelineDashboard
          key={selectedTask.id}
          task={selectedTask}
          featuredAtStart={selectedSummary?.counts.featured || 0}
          onTaskUpdated={(updatedTask) => setCampaignTasks((items) => items.map((item) => item.id === updatedTask.id ? updatedTask : item))}
        />
      ) : null}

      <section className="panel agent-panel agent-task-management-panel">
        <div className="panel-header">
          <div>
            <span className="agent-section-kicker">03 · 任务管理</span>
            <h2>任务管理</h2>
            <p>新建任务，或点选已有任务设为当前推进目标。</p>
          </div>
          <span className="agent-task-count">{campaignTasks.length} 个任务</span>
        </div>

        <details className="agent-create-details">
          <summary>
            <span>
              <strong>填写新任务配置</strong>
              <small>任务目标、采集关键词、排除方向、产品卖点和建联语气</small>
            </span>
            <b>展开填写</b>
          </summary>

          <div className="campaign-task-form">
          <label>
            <span>所属品牌库</span>
            <select value={taskDraft.brandLibraryId} onChange={(event) => updateTaskDraft("brandLibraryId", event.target.value)}>
              {initialBrandLibraries.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </select>
          </label>

          {templateLoading ? (
            <p className="template-loading">正在加载该品牌的人群模板…</p>
          ) : audienceTemplate ? (
            <div className="audience-template-card">
              <div className="audience-template-head">
                <span className="agent-section-kicker">已绑定固定达人模板</span>
                <strong>{audienceTemplate.name}</strong>
              </div>
              <div className="audience-template-grid">
                <div>
                  <span>可接受身份</span>
                  <p>{audienceTemplate.acceptedIdentities.join("、") || "—"}</p>
                </div>
                <div>
                  <span>排除账号类型</span>
                  <p>{audienceTemplate.rejectedAccounts.join("、") || "—"}</p>
                </div>
                <div>
                  <span>核心采集词</span>
                  <p>{audienceTemplate.discovery.primaryTerms.join("、")}</p>
                </div>
                <div>
                  <span>排除词</span>
                  <p>{audienceTemplate.discovery.excludeTerms.join("、")}</p>
                </div>
                <div>
                  <span>数据门槛</span>
                  <p>
                    {audienceTemplate.metricRules.requireAvgLikes ? `平均赞≥${audienceTemplate.metricRules.avgLikesThreshold} ` : ""}
                    {audienceTemplate.metricRules.requireViralWorks ? `爆款≥${audienceTemplate.metricRules.viralLikesThreshold}（${audienceTemplate.metricRules.minViralWorks}条）` : ""}
                  </p>
                </div>
                <div>
                  <span>校准案例</span>
                  <p>正例 {audienceTemplate.examples.positive} · 边界 {audienceTemplate.examples.pending} · 负例 {audienceTemplate.examples.negative}</p>
                </div>
              </div>
              <p className="audience-template-note">核心筛选规则已由品牌模板锁定，下方仅可补充少量关键词，不能随意更改。</p>
            </div>
          ) : null}

          <label>
            <span>任务名称</span>
            <input value={taskDraft.name} placeholder="例如：通勤裤-蜀黍家" onChange={(event) => updateTaskDraft("name", event.target.value)} />
          </label>
          <label>
            <span>推广产品</span>
            <input
              value={taskDraft.productName}
              onChange={(event) => updateTaskDraft("productName", event.target.value)}
            />
          </label>
          <label>
            <span>品类</span>
            <input value={taskDraft.category} onChange={(event) => updateTaskDraft("category", event.target.value)} />
          </label>
          <label>
            <span>目标人群 {audienceTemplate ? "（模板锁定）" : ""}</span>
            <input
              value={taskDraft.targetAudience}
              disabled={!!audienceTemplate}
              onChange={(event) => updateTaskDraft("targetAudience", event.target.value)}
            />
          </label>
          <label className="wide">
            <span>筛选目标说明 {audienceTemplate ? "（模板锁定）" : ""}</span>
            <textarea
              value={taskDraft.targetDescription}
              disabled={!!audienceTemplate}
              onChange={(event) => updateTaskDraft("targetDescription", event.target.value)}
            />
          </label>
          <label>
            <span>采集关键词 {audienceTemplate ? "（模板锁定）" : ""}</span>
            <textarea
              value={taskDraft.seedKeywords}
              disabled={!!audienceTemplate}
              onChange={(event) => updateTaskDraft("seedKeywords", event.target.value)}
            />
          </label>
          <label>
            <span>排除方向 {audienceTemplate ? "（模板锁定）" : ""}</span>
            <textarea
              value={taskDraft.excludeKeywords}
              disabled={!!audienceTemplate}
              onChange={(event) => updateTaskDraft("excludeKeywords", event.target.value)}
            />
          </label>
          {audienceTemplate ? (
            <>
              <label>
                <span>补充采集关键词（可选，合并进模板规则）</span>
                <textarea
                  value={extraSeed}
                  placeholder="少量补充词，逗号分隔，如：交警、铁路公安"
                  onChange={(event) => setExtraSeed(event.target.value)}
                />
              </label>
              <label>
                <span>补充排除词（可选，合并进模板规则）</span>
                <textarea
                  value={extraExclude}
                  placeholder="少量排除词，逗号分隔"
                  onChange={(event) => setExtraExclude(event.target.value)}
                />
              </label>
            </>
          ) : null}
          <label>
            <span>产品卖点</span>
            <textarea
              value={taskDraft.productSellingPoints}
              onChange={(event) => updateTaskDraft("productSellingPoints", event.target.value)}
            />
          </label>
          <label>
            <span>建联语气</span>
            <textarea
              value={taskDraft.outreachTone}
              onChange={(event) => updateTaskDraft("outreachTone", event.target.value)}
            />
          </label>
          </div>

          <div className="agent-create-actions">
            <span>保存后会自动切换到新任务。</span>
            <button onClick={saveCampaignTask} disabled={taskSaving} type="button">
              {taskSaving ? "保存中..." : "保存任务"}
            </button>
          </div>
        </details>
        <div className="agent-existing-tasks-inner">
          <div className="agent-existing-head">
            <span className="agent-section-kicker">已有任务</span>
            <h3>已有任务</h3>
          </div>
          <div className="campaign-task-list">
            {campaignTasks.length === 0 ? (
              <p className="empty-state">还没有任务。先保存一个，再去达人发现页开始测试。</p>
            ) : (
              campaignTasks.map((task) => {
                const isCurrent = String(task.id) === selectedCampaignTaskId;
                return (
                  <article
                    className={`campaign-task-card${isCurrent ? " is-current" : ""}`}
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedCampaignTaskId(String(task.id))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedCampaignTaskId(String(task.id));
                      }
                    }}
                  >
                    <div>
                      <strong>{task.name}</strong>
                      <span>{task.status}</span>
                    </div>
                    <p>{task.targetDescription}</p>
                    <dl>
                      <div>
                        <dt>产品</dt>
                        <dd>{task.productName}</dd>
                      </div>
                      <div>
                        <dt>关键词</dt>
                        <dd>{task.seedKeywords.slice(0, 8).join("，") || "-"}</dd>
                      </div>
                    </dl>
                    {isCurrent ? <span className="agent-current-badge">当前任务</span> : null}
                  </article>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
