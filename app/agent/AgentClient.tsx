"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CampaignTaskItem } from "@/lib/campaign-tasks";
import type { CampaignTaskSummary } from "@/lib/agent-workbench";
import { AgentPipelineDashboard } from "./AgentPipelineDashboard";

type CampaignTaskDraft = {
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

const defaultCampaignTask: CampaignTaskDraft = {
  name: "警校生-警察小熊",
  productName: "警察小熊周边",
  category: "警察周边",
  targetAudience: "在校警校生、警校日常分享者",
  targetDescription:
    "寻找真实在校警校生个人账号，内容可以是校园生活、训练、通勤穿搭、宿舍日常、警校身份记录或轻生活分享。排除官方号、营销号、报考培训号、法考号、已从业警察科普号和纯颜值擦边账号。",
  seedKeywords: "警校生，警校生活，警校生日常，藏蓝青春",
  excludeKeywords: "官方号，蓝V，黄V，认证号，报考，招生，培训，法考，公务员考试，警察执法，警察新闻",
  productSellingPoints:
    "警察小熊，可爱但不幼稚，适合作为警校生活、通勤穿搭、宿舍桌面或包挂的小物件。",
  outreachTone:
    "自然、真诚、像正常私信，不要太商务，不要一上来强推报价，可以参考“宝子你好，我是蜀黍家PR，感觉你的风格和我们的产品很搭，想邀请你一起创作”。"
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
  initialCampaignTasks,
  initialSummaries
}: {
  initialCampaignTasks: CampaignTaskItem[];
  initialSummaries: CampaignTaskSummary[];
}) {
  const [campaignTasks, setCampaignTasks] = useState(initialCampaignTasks);
  const [summaries, setSummaries] = useState(initialSummaries);
  const [selectedCampaignTaskId, setSelectedCampaignTaskId] = useState(
    initialCampaignTasks[0]?.id ? String(initialCampaignTasks[0].id) : ""
  );
  const [taskDraft, setTaskDraft] = useState(defaultCampaignTask);
  const [taskSaving, setTaskSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selectedTask = useMemo(
    () => campaignTasks.find((task) => String(task.id) === selectedCampaignTaskId) || null,
    [campaignTasks, selectedCampaignTaskId]
  );

  const selectedSummary = useMemo(() => {
    if (!selectedTask) return null;
    return summaries.find((item) => item.campaignTaskId === selectedTask.id) || createEmptySummary(selectedTask.id);
  }, [selectedTask, summaries]);

  const totalCounts = useMemo(() => {
    return summaries.reduce(
      (acc, item) => {
        acc.pendingReview += item.counts.pendingReview;
        acc.candidate += item.counts.candidate;
        acc.featured += item.counts.featured;
        acc.featuredUncontacted += item.counts.featuredUncontacted;
        return acc;
      },
      { pendingReview: 0, candidate: 0, featured: 0, featuredUncontacted: 0 }
    );
  }, [summaries]);

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
          name: taskDraft.name,
          productName: taskDraft.productName,
          category: taskDraft.category,
          targetAudience: taskDraft.targetAudience,
          targetDescription: taskDraft.targetDescription,
          seedKeywords: splitTerms(taskDraft.seedKeywords),
          excludeKeywords: splitTerms(taskDraft.excludeKeywords),
          productSellingPoints: splitTerms(taskDraft.productSellingPoints),
          outreachTone: taskDraft.outreachTone
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
      <section className="metrics">
        <div>
          <span>品类任务</span>
          <strong>{campaignTasks.length}</strong>
        </div>
        <div>
          <span>全部待复筛</span>
          <strong>{totalCounts.pendingReview}</strong>
        </div>
        <div>
          <span>全部精选</span>
          <strong>{totalCounts.featured}</strong>
        </div>
        <div>
          <span>精选未建联</span>
          <strong>{totalCounts.featuredUncontacted}</strong>
        </div>
      </section>

      <section className="panel agent-panel">
        <div className="panel-header">
          <div>
            <h2>当前任务</h2>
            <p>选择一个品类任务，Agent 会按这个任务判断你下一步该发现、复筛还是建联。</p>
          </div>
        </div>

        <div className="agent-workbench-grid">
          <label className="agent-task-select">
            <span>品类任务</span>
            <select
              value={selectedCampaignTaskId}
              onChange={(event) => setSelectedCampaignTaskId(event.target.value)}
            >
              {campaignTasks.length === 0 ? <option value="">还没有任务</option> : null}
              {campaignTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </select>
          </label>

          {selectedTask && selectedSummary ? (
            <>
              <div className="agent-suggestion">
                <span>Agent 建议</span>
                <strong>{selectedSummary.recommendation.title}</strong>
                <p>{selectedSummary.recommendation.reason}</p>
                <Link className="button-link" href={selectedSummary.recommendation.primaryHref}>
                  {selectedSummary.recommendation.primaryAction}
                </Link>
              </div>

              <div className="agent-task-info">
                <span>{selectedTask.productName}</span>
                <strong>{selectedTask.targetAudience}</strong>
                <p>{selectedTask.targetDescription}</p>
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
                <span>待复筛</span>
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
              <Link href={selectedSummary.links.review}>2. 达人复筛</Link>
              <Link href={selectedSummary.links.creators}>3. 达人库</Link>
              <Link href={selectedSummary.links.tasks}>4. 建联任务</Link>
            </div>
          </>
        ) : null}
      </section>

      <section className="panel agent-panel">
        <div className="panel-header">
          <div>
            <h2>新增品类任务</h2>
            <p>以后添加其他品类，就在这里新建任务。比如“警校生-通勤裤”“医生-护腰垫”，每个任务有自己的关键词、排除方向、产品卖点和建联语气。</p>
          </div>
          <button onClick={saveCampaignTask} disabled={taskSaving} type="button">
            {taskSaving ? "保存中..." : "保存任务"}
          </button>
        </div>

        <div className="campaign-task-form">
          <label>
            <span>任务名称</span>
            <input value={taskDraft.name} onChange={(event) => updateTaskDraft("name", event.target.value)} />
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
            <span>目标人群</span>
            <input
              value={taskDraft.targetAudience}
              onChange={(event) => updateTaskDraft("targetAudience", event.target.value)}
            />
          </label>
          <label className="wide">
            <span>筛选目标说明</span>
            <textarea
              value={taskDraft.targetDescription}
              onChange={(event) => updateTaskDraft("targetDescription", event.target.value)}
            />
          </label>
          <label>
            <span>采集关键词</span>
            <textarea
              value={taskDraft.seedKeywords}
              onChange={(event) => updateTaskDraft("seedKeywords", event.target.value)}
            />
          </label>
          <label>
            <span>排除方向</span>
            <textarea
              value={taskDraft.excludeKeywords}
              onChange={(event) => updateTaskDraft("excludeKeywords", event.target.value)}
            />
          </label>
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
      </section>

      {message ? <p className="form-error">{message}</p> : null}

      {selectedTask ? <AgentPipelineDashboard key={selectedTask.id} task={selectedTask} /> : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>已有任务</h2>
            <p>每个任务都是一条独立业务线。后续同一个达人可以在不同任务下有不同结论。</p>
          </div>
        </div>

        <div className="campaign-task-list">
          {campaignTasks.length === 0 ? (
            <p className="empty-state">还没有品类任务。先保存一个，再去达人发现页开始测试。</p>
          ) : (
            campaignTasks.map((task) => (
              <article className="campaign-task-card" key={task.id}>
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
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
