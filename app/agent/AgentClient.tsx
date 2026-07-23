"use client";

import { useMemo, useState } from "react";
import type { ScreeningRuleProfileItem } from "@/lib/agent-store";
import type { CampaignTaskItem } from "@/lib/campaign-tasks";

type AgentPlan = {
  name: string;
  category: string;
  targetDescription: string;
  primaryTerms: string[];
  supportTerms: string[];
  excludeTerms: string[];
  minLikeCount: number;
  publishWindowDays: number;
  sortType: string;
  notes: string;
  memorySuggestion: string;
};

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

const defaultTarget =
  "寻找目前在校的警校生个人账号，内容偏日常、穿搭、校园生活，适合警察小熊或警察通勤服建联；不要报考号、官方号、营销号、已从业警察号。";

const defaultCampaignTask: CampaignTaskDraft = {
  name: "警校生-警察小熊",
  productName: "警察小熊周边",
  category: "警察周边",
  targetAudience: "在校警校生、警校日常分享者",
  targetDescription:
    "寻找真实在校警校生个人账号，内容可以是校园生活、训练、通勤穿搭、宿舍日常或警校身份相关记录；排除官方号、营销号、报考培训号、已从业警察科普号。",
  seedKeywords: "警校生，警校生日常，藏蓝青春，警校生活",
  excludeKeywords: "官方号，蓝V，黄V，报考，招生，培训，法考，公务员考试，警察执法，警察新闻",
  productSellingPoints: "警察小熊，可爱但不幼稚，适合作为警校生活/通勤场景里的小挂件或桌面摆件",
  outreachTone: "自然、真诚、像正常私信，不要太商务，不要一上来强推报价。"
};

function splitTerms(value: string): string[] {
  return value
    .split(/[,\n，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinTerms(value: string[]): string {
  return value.join("，");
}

export function AgentClient({
  initialProfiles,
  initialCampaignTasks
}: {
  initialProfiles: ScreeningRuleProfileItem[];
  initialCampaignTasks: CampaignTaskItem[];
}) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [campaignTasks, setCampaignTasks] = useState(initialCampaignTasks);
  const [taskDraft, setTaskDraft] = useState(defaultCampaignTask);
  const [target, setTarget] = useState(defaultTarget);
  const [category, setCategory] = useState("警察小熊");
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [primaryText, setPrimaryText] = useState("");
  const [supportText, setSupportText] = useState("");
  const [excludeText, setExcludeText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taskSaving, setTaskSaving] = useState(false);
  const [message, setMessage] = useState("");

  const profileStats = useMemo(() => {
    const active = profiles.filter((item) => item.isActive).length;
    const categories = new Set(profiles.map((item) => item.category).filter(Boolean)).size;
    return { active, categories };
  }, [profiles]);

  async function generatePlan() {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, category })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "生成失败");
      }

      setPlan(data);
      setPrimaryText(joinTerms(data.primaryTerms || []));
      setSupportText(joinTerms(data.supportTerms || []));
      setExcludeText(joinTerms(data.excludeTerms || []));
      setMessage("已生成规则草案。你可以先人工调整，再保存成模板。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    if (!plan) return;
    setSaving(true);
    setMessage("");

    try {
      const payload = {
        ...plan,
        primaryTerms: splitTerms(primaryText),
        supportTerms: splitTerms(supportText),
        excludeTerms: splitTerms(excludeText)
      };

      const response = await fetch("/api/agent/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "保存失败");
      }

      setProfiles((items) => [data.profile, ...items]);
      setMessage("已保存为规则模板。下一步可以把它接到达人发现页，一键加载使用。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

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

      setCampaignTasks((items) => [data.task, ...items]);
      setMessage("已保存品类任务。下一步可以把它接到达人发现页，采集时直接选择任务。");
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
          <span>规则模板</span>
          <strong>{profiles.length}</strong>
        </div>
        <div>
          <span>品类任务</span>
          <strong>{campaignTasks.length}</strong>
        </div>
        <div>
          <span>启用模板</span>
          <strong>{profileStats.active}</strong>
        </div>
        <div>
          <span>覆盖品类</span>
          <strong>{profileStats.categories}</strong>
        </div>
      </section>

      <section className="panel agent-panel">
        <div className="panel-header">
          <div>
            <h2>品类任务</h2>
            <p>把一次业务目标保存下来，比如“警校生-警察小熊”或“警校生-通勤裤”。后续达人发现、复筛和建联都可以围绕这个任务执行。</p>
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
            <input value={taskDraft.productName} onChange={(event) => updateTaskDraft("productName", event.target.value)} />
          </label>
          <label>
            <span>品类</span>
            <input value={taskDraft.category} onChange={(event) => updateTaskDraft("category", event.target.value)} />
          </label>
          <label>
            <span>目标人群</span>
            <input value={taskDraft.targetAudience} onChange={(event) => updateTaskDraft("targetAudience", event.target.value)} />
          </label>
          <label className="wide">
            <span>筛选目标说明</span>
            <textarea value={taskDraft.targetDescription} onChange={(event) => updateTaskDraft("targetDescription", event.target.value)} />
          </label>
          <label>
            <span>采集关键词</span>
            <textarea value={taskDraft.seedKeywords} onChange={(event) => updateTaskDraft("seedKeywords", event.target.value)} />
          </label>
          <label>
            <span>排除方向</span>
            <textarea value={taskDraft.excludeKeywords} onChange={(event) => updateTaskDraft("excludeKeywords", event.target.value)} />
          </label>
          <label>
            <span>产品卖点</span>
            <textarea value={taskDraft.productSellingPoints} onChange={(event) => updateTaskDraft("productSellingPoints", event.target.value)} />
          </label>
          <label>
            <span>建联语气</span>
            <textarea value={taskDraft.outreachTone} onChange={(event) => updateTaskDraft("outreachTone", event.target.value)} />
          </label>
        </div>

        <div className="campaign-task-list">
          {campaignTasks.length === 0 ? (
            <p className="empty-state">还没有品类任务。先保存一个，后面再接到达人发现页。</p>
          ) : (
            campaignTasks.map((task) => (
              <article className="campaign-task-card" key={task.id}>
                <div>
                  <strong>{task.name}</strong>
                  <span>{task.status}</span>
                </div>
                <p>{task.targetAudience}</p>
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

      <section className="panel agent-panel">
        <div className="panel-header">
          <div>
            <h2>生成筛选方案</h2>
            <p>先用自然语言告诉 Agent 你要找谁，它会生成强相关词、辅助词、排除词和基础门槛。</p>
          </div>
          <button onClick={generatePlan} disabled={loading}>
            {loading ? "生成中..." : "生成规则"}
          </button>
        </div>

        <div className="agent-form">
          <label>
            <span>本轮筛选目标</span>
            <textarea value={target} onChange={(event) => setTarget(event.target.value)} />
          </label>
          <label>
            <span>品类/项目</span>
            <input value={category} onChange={(event) => setCategory(event.target.value)} />
          </label>
        </div>
      </section>

      {plan ? (
        <section className="panel agent-panel">
          <div className="panel-header">
            <div>
              <h2>{plan.name}</h2>
              <p>{plan.targetDescription}</p>
            </div>
            <button onClick={saveProfile} disabled={saving}>
              {saving ? "保存中..." : "保存模板"}
            </button>
          </div>

          <div className="agent-rule-grid">
            <label>
              <span>强相关词</span>
              <textarea value={primaryText} onChange={(event) => setPrimaryText(event.target.value)} />
            </label>
            <label>
              <span>辅助词</span>
              <textarea value={supportText} onChange={(event) => setSupportText(event.target.value)} />
            </label>
            <label>
              <span>排除词</span>
              <textarea value={excludeText} onChange={(event) => setExcludeText(event.target.value)} />
            </label>
          </div>

          <div className="agent-rule-meta">
            <div>
              <span>最低点赞</span>
              <strong>{plan.minLikeCount}</strong>
            </div>
            <div>
              <span>发布时间</span>
              <strong>{plan.publishWindowDays} 天内</strong>
            </div>
            <div>
              <span>排序依据</span>
              <strong>{plan.sortType}</strong>
            </div>
          </div>

          <div className="agent-note">
            <strong>Agent 说明</strong>
            <p>{plan.notes}</p>
            <p>{plan.memorySuggestion}</p>
          </div>
        </section>
      ) : null}

      {message ? <p className="form-error">{message}</p> : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>已保存规则模板</h2>
            <p>这些模板后续会成为 Agent 的长期记忆，也可以按品类加载到达人发现页。</p>
          </div>
        </div>

        <div className="agent-profile-list">
          {profiles.length === 0 ? (
            <p className="empty-state">还没有保存过规则模板。先生成一版，再保存。</p>
          ) : (
            profiles.map((profile) => (
              <article key={profile.id} className="agent-profile-card">
                <div>
                  <strong>{profile.name}</strong>
                  <span>{profile.category || "未分类"}</span>
                </div>
                <p>{profile.targetDescription}</p>
                <dl>
                  <div>
                    <dt>强相关</dt>
                    <dd>{profile.primaryTerms.slice(0, 8).join("，") || "-"}</dd>
                  </div>
                  <div>
                    <dt>排除</dt>
                    <dd>{profile.excludeTerms.slice(0, 10).join("，") || "-"}</dd>
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
