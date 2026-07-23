import Link from "next/link";
import { getCreators } from "@/lib/creators";
import { CreatorLibrary } from "./CreatorLibrary";

export default async function CreatorsPage() {
  const creators = await getCreators();
  const pendingReview = creators.filter((creator) => creator.poolStatus === "pending_review").length;
  const candidate = creators.filter((creator) => creator.poolStatus === "candidate").length;
  const featured = creators.filter((creator) => creator.poolStatus === "featured").length;
  const contacted = creators.filter((creator) => creator.outreachStatus.includes("已")).length;

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
          <Link className="active" href="/creators">
            达人库
          </Link>
          <Link href="/review">达人复筛</Link>
          <Link href="/tasks">建联任务</Link>
          <a>投放项目</a>
          <a>预算复盘</a>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>达人库</h1>
            <p>统一管理待复筛、待选库和精选库达人，后续建联优先从精选库开始。</p>
          </div>
          <button>新增达人</button>
        </header>

        <section className="metrics">
          <div>
            <span>达人总数</span>
            <strong>{creators.length}</strong>
          </div>
          <div>
            <span>达人精选库</span>
            <strong>{featured}</strong>
          </div>
          <div>
            <span>达人待选库</span>
            <strong>{candidate}</strong>
          </div>
          <div>
            <span>待复筛池</span>
            <strong>{pendingReview}</strong>
          </div>
          <div>
            <span>已建联</span>
            <strong>{contacted}</strong>
          </div>
        </section>

        <CreatorLibrary creators={creators} />
      </section>
    </main>
  );
}
