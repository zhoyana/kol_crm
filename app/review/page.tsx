import Link from "next/link";
import { getBrandLibraries, getCampaignTasks } from "@/lib/campaign-tasks";
import { getPendingReviewCreators } from "@/lib/review";
import { ReviewClient } from "./ReviewClient";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: { searchParams?: Promise<{ campaignTaskId?: string; platform?: string }> }) {
  const params = await searchParams;
  const campaignTaskId = Number(params?.campaignTaskId || 0) || null;
  const initialPlatform = params?.platform === "douyin" ? "抖音" : params?.platform === "xhs" ? "小红书" : "全部";
  const [allCreators, campaignTasks, brandLibraries] = await Promise.all([getPendingReviewCreators(campaignTaskId), getCampaignTasks(), getBrandLibraries()]);
  const creators = allCreators.filter((creator) => initialPlatform === "全部" || creator.platform === initialPlatform);

  return (
    <section className="content workflow-page review-workflow">
        <header className="topbar review-topbar">
          <div>
            <h1>画像与复筛</h1>
            <p>生成内容画像、筛选数据表现，并将达人自动分流到待选库或精选库。</p>
          </div>
          <Link className="button-link" href="/discover">
            返回达人发现
          </Link>
        </header>

        <ReviewClient initialBrandLibraries={brandLibraries} initialCampaignTaskId={campaignTaskId} initialCampaignTasks={campaignTasks} initialCreators={creators} initialPlatform={initialPlatform} />
      </section>
  );
}
