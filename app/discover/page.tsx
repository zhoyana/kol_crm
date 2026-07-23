import Link from "next/link";
import { DiscoverClient } from "./DiscoverClient";

export default function DiscoverPage() {
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
          <Link href="/">仪表盘</Link>
          <a className="active">达人发现</a>
          <Link href="/review">达人复筛</Link>
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
            <h1>达人发现</h1>
            <p>输入关键词，从采集结果里筛出内容初筛通过的作者，先加入待复筛池。</p>
          </div>
          <Link className="button-link" href="/review">
            去达人复筛
          </Link>
        </header>

        <DiscoverClient />
      </section>
    </main>
  );
}
