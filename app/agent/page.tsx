import Link from "next/link";
import { getRuleProfiles } from "@/lib/agent-store";
import { getCampaignTasks } from "@/lib/campaign-tasks";
import { AgentClient } from "./AgentClient";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const profiles = await getRuleProfiles();
  const campaignTasks = await getCampaignTasks();

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
          <Link href="/discover">达人发现</Link>
          <Link href="/review">达人复筛</Link>
          <Link href="/creators">达人库</Link>
          <Link className="active" href="/agent">
            筛选 Agent
          </Link>
          <Link href="/tasks">建联任务</Link>
          <Link href="/import">导入 CSV</Link>
          <Link href="/">仪表盘</Link>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>筛选 Agent</h1>
            <p>把你的筛选目标转成可保存、可复用、后续可学习的规则模板。</p>
          </div>
          <Link className="button-link" href="/discover">
            去达人发现
          </Link>
        </header>

        <AgentClient initialProfiles={profiles} initialCampaignTasks={campaignTasks} />
      </section>
    </main>
  );
}
