import Link from "next/link";
import { formatNumber, generateOutreachScript, getCreators, getOutreachTasks } from "@/lib/creators";
import { TaskActions } from "./TaskActions";

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

export default async function TasksPage() {
  const creators = await getCreators();
  const tasks = getOutreachTasks(creators);
  const initialTasks = tasks.filter((task) => task.kind === "initial");
  const negotiateTasks = tasks.filter((task) => task.kind === "negotiate");
  const followupTasks = tasks.filter((task) => task.kind === "followup");

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <strong>KOL CRM</strong>
            <span>达人筛选工作台</span>
          </div>
        </div>
        <nav>
          <Link href="/agent">筛选 Agent</Link>
          <Link href="/discover">达人发现</Link>
          <Link href="/">仪表盘</Link>
          <Link href="/creators">达人库</Link>
          <a className="active">建联任务</a>
          <Link href="/import">导入 CSV</Link>
          <a>投放项目</a>
          <a>预算复盘</a>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>建联任务</h1>
            <p>把待联系、待谈价、待跟进的达人拆成今天能执行的清单。</p>
          </div>
          <Link className="button-link" href="/creators">
            回到达人库
          </Link>
        </header>

        <section className="metrics">
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

        <section className="task-board">
          <TaskColumn title="初次建联" description="还没有联系过，适合先发送合作意向或询价。" tasks={initialTasks} />
          <TaskColumn title="报价谈判" description="已知报价偏高，需要用 CPM 作为谈价锚点。" tasks={negotiateTasks} />
          <TaskColumn title="二次跟进" description="已经联系过，但合作状态还没有落定。" tasks={followupTasks} />
        </section>
      </section>
    </main>
  );
}

function TaskColumn({
  title,
  description,
  tasks
}: {
  title: string;
  description: string;
  tasks: ReturnType<typeof getOutreachTasks>;
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
