import { getBrandLibraries, getCampaignTasks } from "@/lib/campaign-tasks";
import { getCreators } from "@/lib/creators";
import { CreatorLibrary } from "./CreatorLibrary";

export const dynamic = "force-dynamic";

export default async function CreatorsPage({ searchParams }: { searchParams?: Promise<{ campaignTaskId?: string }> }) {
  const params = await searchParams;
  const campaignTaskId = Number(params?.campaignTaskId || 0) || null;
  const [creators, campaignTasks, brandLibraries] = await Promise.all([getCreators(campaignTaskId), getCampaignTasks(), getBrandLibraries()]);
  const pendingReview = creators.filter((creator) => creator.poolStatus === "pending_review").length;
  const candidate = creators.filter((creator) => creator.poolStatus === "candidate").length;
  const featured = creators.filter((creator) => creator.poolStatus === "featured").length;
  const contacted = creators.filter((creator) => creator.outreachStatus.includes("已")).length;

  return (
    <section className="content workflow-page creators-workflow">
        <header className="topbar">
          <div>
            <h1>达人库</h1>
            <p>统一管理样本/画像队列、画像通过待选库和数据达标精选库，后续建联优先从精选库开始。</p>
          </div>
          <button>新增达人</button>
        </header>

        <section className="metrics workflow-metrics">
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
            <span>样本/画像队列</span>
            <strong>{pendingReview}</strong>
          </div>
          <div>
            <span>已建联</span>
            <strong>{contacted}</strong>
          </div>
        </section>

        <CreatorLibrary creators={creators} initialBrandLibraries={brandLibraries} initialCampaignTaskId={campaignTaskId} initialCampaignTasks={campaignTasks} />
      </section>
  );
}
