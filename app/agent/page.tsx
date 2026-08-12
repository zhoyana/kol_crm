import { getBrandLibraries, getCampaignTasks } from "@/lib/campaign-tasks";
import { getCampaignTaskSummaries } from "@/lib/agent-workbench";
import { AgentClient } from "./AgentClient";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const [campaignTasks, brandLibraries] = await Promise.all([getCampaignTasks(), getBrandLibraries()]);
  const summaries = await getCampaignTaskSummaries(campaignTasks.map((task) => task.id));

  return (
    <section className="content workflow-page agent-workflow">
        <header className="topbar">
          <div>
            <h1>Agent 工作台</h1>
            <p>选择任务，一键完成发现、画像、数据筛选与建联准备。</p>
          </div>
        </header>

        <AgentClient initialBrandLibraries={brandLibraries} initialCampaignTasks={campaignTasks} initialSummaries={summaries} />
      </section>
  );
}
