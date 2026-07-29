import Link from "next/link";
import { getCampaignTasks } from "@/lib/campaign-tasks";
import { getCampaignTaskSummaries } from "@/lib/agent-workbench";
import { AgentClient } from "./AgentClient";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const campaignTasks = await getCampaignTasks();
  const summaries = await getCampaignTaskSummaries(campaignTasks.map((task) => task.id));

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
            Agent 工作台
          </Link>
          <Link href="/tasks">建联任务</Link>
          <Link href="/import">导入 CSV</Link>
          <Link href="/">仪表盘</Link>
        </nav>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>Agent 工作台</h1>
            <p>把不同品类拆成任务，让发现、复筛、达人库和建联都围绕同一个目标运转。</p>
          </div>
          <Link className="button-link" href="/discover">
            去达人发现
          </Link>
        </header>

        <AgentClient initialCampaignTasks={campaignTasks} initialSummaries={summaries} />
      </section>
    </main>
  );
}
