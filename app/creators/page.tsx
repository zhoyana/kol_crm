import { getBrandLibraries, getCampaignTasks } from "@/lib/campaign-tasks";
import { getCreators } from "@/lib/creators";
import { CreatorLibrary } from "./CreatorLibrary";

export const dynamic = "force-dynamic";

export default async function CreatorsPage({ searchParams }: { searchParams?: Promise<{ campaignTaskId?: string; platform?: string }> }) {
  const params = await searchParams;
  const campaignTaskId = Number(params?.campaignTaskId || 0) || null;
  const initialPlatform = params?.platform === "douyin" ? "抖音" : params?.platform === "xhs" ? "小红书" : "全部";
  const [creators, campaignTasks, brandLibraries] = await Promise.all([getCreators(campaignTaskId), getCampaignTasks(), getBrandLibraries()]);

  return (
    <section className="content workflow-page creators-workflow">
        <header className="topbar">
          <div>
            <h1>达人库</h1>
            <p>统一管理画像通过的待选达人与数据达标的精选达人，后续建联优先从精选库开始。</p>
          </div>
          <button>新增达人</button>
        </header>

        <CreatorLibrary creators={creators} initialBrandLibraries={brandLibraries} initialCampaignTaskId={campaignTaskId} initialCampaignTasks={campaignTasks} initialPlatform={initialPlatform} />
      </section>
  );
}
