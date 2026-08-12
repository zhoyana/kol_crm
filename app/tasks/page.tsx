import Link from "next/link";
import { getBrandLibraries, getCampaignTasks } from "@/lib/campaign-tasks";
import { formatNumber, generateOutreachScript, getCreators, getOutreachTasks } from "@/lib/creators";
import { TaskActions } from "./TaskActions";
import { TaskCampaignPicker } from "./TaskCampaignPicker";
import { BatchOutreachPanel } from "./BatchOutreachPanel";
import { InboxMonitorPanel } from "./InboxMonitorPanel";
import { getOutreachInbox } from "@/lib/outreach-inbox";

export const dynamic = "force-dynamic";

const taskLabel = {
  initial: "初次建联",
  followup: "二次跟进",
  negotiate: "报价谈判"
};

const priorityLabel = {
  high: "优先",
  medium: "观察",
  low: "暂缓"
};

export default async function TasksPage({ searchParams }: { searchParams?: Promise<{ campaignTaskId?: string }> }) {
  const params = await searchParams;
  const campaignTaskId = Number(params?.campaignTaskId || 0) || null;
  const [campaignTasks, creators, brandLibraries, conversations] = await Promise.all([getCampaignTasks(), getCreators(campaignTaskId), getBrandLibraries(), getOutreachInbox(campaignTaskId)]);
  const selectedCampaignTask = campaignTasks.find((task) => task.id === campaignTaskId) || null;
  const tasks = getOutreachTasks(creators);
  const initialTasks = tasks.filter((task) => task.kind === "initial");
  const negotiateTasks = tasks.filter((task) => task.kind === "negotiate");
  const followupTasks = tasks.filter((task) => task.kind === "followup");
  const creatorsLink = campaignTaskId ? `/creators?campaignTaskId=${campaignTaskId}` : "/creators";
  const batchCandidates = initialTasks.map((task) => ({
    creatorId: task.creator.id,
    creatorName: task.creator.name,
    profileUrl: task.creator.profileUrl,
    taskKind: task.kind,
    defaultScript: generateOutreachScript(task.creator)
  }));

  return (
    <section className="content workflow-page tasks-workflow">
        <header className="topbar">
          <div>
            <h1>建联任务</h1>
            <p>按品类任务从精选库生成今天可执行的建联清单，复制话术后人工确认发送。</p>
          </div>
          <Link className="button-link" href={creatorsLink}>
            回到达人库
          </Link>
        </header>

        <TaskCampaignPicker brandLibraries={brandLibraries} campaignTasks={campaignTasks} selectedCampaignTask={selectedCampaignTask} />
        <BatchOutreachPanel campaignTaskId={campaignTaskId} candidates={batchCandidates} />
        <InboxMonitorPanel conversations={conversations.map((item: any) => ({ id: item.id, status: item.status, lastPreview: item.lastPreview, lastInboundAt: item.lastInboundAt?.toISOString() || null, unreadCount: item.unreadCount, creator: item.creator }))} />

        <section className="metrics workflow-metrics">
          <div>
            <span>任务总数</span>
            <strong>{tasks.length}</strong>
          </div>
          <div>
            <span>初次建联</span>
            <strong>{initialTasks.length}</strong>
          </div>
          <div>
            <span>报价谈判</span>
            <strong>{negotiateTasks.length}</strong>
          </div>
          <div>
            <span>二次跟进</span>
            <strong>{followupTasks.length}</strong>
          </div>
          <div>
            <span>建议今日完成</span>
            <strong>{Math.min(tasks.length, 5)}</strong>
          </div>
        </section>

        <section className="task-board workflow-task-board">
          <TaskColumn
            campaignTaskId={campaignTaskId}
            description="还没有联系过，适合先发送品类任务下的个性化合作意向。"
            tasks={initialTasks}
            title="初次建联"
          />
          <TaskColumn
            campaignTaskId={campaignTaskId}
            description="已知报价偏高，需要用 CPM 和品类预算作为谈价锚点。"
            tasks={negotiateTasks}
            title="报价谈判"
          />
          <TaskColumn campaignTaskId={campaignTaskId} description="已经联系过，但合作状态还没有落定。" tasks={followupTasks} title="二次跟进" />
        </section>
      </section>
  );
}

function TaskColumn({
  title,
  description,
  tasks,
  campaignTaskId
}: {
  title: string;
  description: string;
  tasks: ReturnType<typeof getOutreachTasks>;
  campaignTaskId: number | null;
}) {
  return (
    <section className="panel task-column">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <strong>{tasks.length}</strong>
      </div>

      <div className="task-list">
        {tasks.length === 0 ? (
          <p className="empty-state">暂无任务</p>
        ) : (
          tasks.map((task) => {
            const script = generateOutreachScript(task.creator);

            return (
              <article className="task-card" key={`${task.kind}-${task.creator.id}`}>
                <div className="task-card-head">
                  <div>
                    <span className={`task-type ${task.kind}`}>{taskLabel[task.kind]}</span>
                    <Link href={`/creators/${task.creator.id}`}>{task.creator.name}</Link>
                  </div>
                  <span className={`priority ${task.creator.priority}`}>{priorityLabel[task.creator.priority]}</span>
                </div>
                <p className="outreach-status-mark">
                  建联状态：<strong>{task.creator.outreachStatus}</strong>
                </p>

                <dl className="task-meta">
                  <div>
                    <dt>稳定播放</dt>
                    <dd>{formatNumber(task.creator.stablePlay)}</dd>
                  </div>
                  <div>
                    <dt>建议报价</dt>
                    <dd>¥{formatNumber(task.creator.suggestedPrice)}</dd>
                  </div>
                  <div>
                    <dt>当前 CPM</dt>
                    <dd className={task.creator.currentCpm && task.creator.currentCpm > 20 ? "danger" : ""}>
                      {task.creator.currentCpm ?? "-"}
                    </dd>
                  </div>
                </dl>

                <p className="task-reason">{task.reason}</p>
                <p className="task-action">{task.action}</p>

                <TaskActions
                  campaignTaskId={campaignTaskId}
                  creatorId={task.creator.id}
                  creatorName={task.creator.name}
                  profileUrl={task.creator.profileUrl}
                  script={script}
                  taskKind={task.kind}
                />
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
