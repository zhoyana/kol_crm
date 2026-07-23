import Link from "next/link";
import { ImportForm } from "./ImportForm";

export default function ImportPage() {
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
          <Link href="/tasks">建联任务</Link>
          <a className="active">数据导入</a>
          <a>投放项目</a>
          <a>预算复盘</a>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>数据导入</h1>
            <p>先接入抖音采集结果，后续星图、蒲公英、小红书都可以复用同一套入库规则。</p>
          </div>
          <Link className="button-link" href="/creators">
            查看达人库
          </Link>
        </header>

        <ImportForm />
      </section>
    </main>
  );
}
