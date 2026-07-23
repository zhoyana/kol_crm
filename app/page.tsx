import Link from "next/link";
import { formatNumber, getCreators } from "@/lib/creators";

const gradeLabel = {
  S: "S级",
  A: "A级",
  B: "B级",
  C: "C级",
  D: "D级"
};

const priorityLabel = {
  high: "优先",
  medium: "观察",
  low: "暂缓"
};

function isContacted(status: string): boolean {
  return status.includes("已") || status.includes("宸");
}

function isPending(status: string): boolean {
  return status.includes("未") || status.includes("鏈");
}

export default async function Home() {
  const creators = await getCreators();
  const contacted = creators.filter((creator) => isContacted(creator.outreachStatus)).length;
  const pending = creators.filter((creator) => isPending(creator.outreachStatus)).length;
  const highPriority = creators.filter((creator) => creator.priority === "high").length;
  const quoted = creators.filter((creator) => creator.quote).length;
  const sortedCreators = [...creators].sort((a, b) => {
    const score = { high: 3, medium: 2, low: 1 };
    return score[b.priority] - score[a.priority] || b.stablePlay - a.stablePlay;
  });

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
          <a className="active">仪表盘</a>
          <Link href="/discover">达人发现</Link>
          
          <Link href="/creators">达人库</Link>
          <Link href="/tasks">建联任务</Link>
          <Link href="/import">导入 CSV</Link>
          <a>投放项目</a>
          <a>预算复盘</a>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>达人筛选与建联</h1>
            <p>当前使用本地达人数据，目标 CPM 按 15 计算。</p>
          </div>
          <Link className="button-link" href="/import">
            导入 CSV
          </Link>
        </header>

        <section className="metrics">
          <div>
            <span>达人总数</span>
            <strong>{creators.length}</strong>
          </div>
          <div>
            <span>已建联</span>
            <strong>{contacted}</strong>
          </div>
          <div>
            <span>未建联</span>
            <strong>{pending}</strong>
          </div>
          <div>
            <span>优先联系</span>
            <strong>{highPriority}</strong>
          </div>
          <div>
            <span>有报价</span>
            <strong>{quoted}</strong>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>优先建联名单</h2>
              <p>按优先级、稳定播放量排序，报价以 CPM 15 作为谈判锚点。</p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>达人</th>
                  <th>状态</th>
                  <th>粉丝</th>
                  <th>稳定播放</th>
                  <th>当前报价</th>
                  <th>当前 CPM</th>
                  <th>建议报价</th>
                  <th>评级</th>
                  <th>优先级</th>
                </tr>
              </thead>
              <tbody>
                {sortedCreators.map((creator) => (
                  <tr key={creator.id}>
                    <td>
                      <Link className="creator-link" href={`/creators/${creator.id}`}>
                        {creator.name}
                      </Link>
                      <span>{creator.category}</span>
                    </td>
                    <td>{creator.outreachStatus}</td>
                    <td>{formatNumber(creator.fans)}</td>
                    <td>{formatNumber(creator.stablePlay)}</td>
                    <td>{creator.quote ? `¥${formatNumber(creator.quote)}` : "-"}</td>
                    <td className={creator.currentCpm && creator.currentCpm > 20 ? "danger" : ""}>
                      {creator.currentCpm ?? "-"}
                    </td>
                    <td>¥{formatNumber(creator.suggestedPrice)}</td>
                    <td>
                      <span className={`grade grade-${creator.grade.toLowerCase()}`}>{gradeLabel[creator.grade]}</span>
                    </td>
                    <td>
                      <span className={`priority ${creator.priority}`}>{priorityLabel[creator.priority]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
