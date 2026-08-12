import Link from "next/link";
import { getBrandLibraries, getCampaignTasks } from "@/lib/campaign-tasks";
import { getPendingReviewCreators } from "@/lib/review";
import { ReviewClient } from "./ReviewClient";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: { searchParams?: Promise<{ campaignTaskId?: string }> }) {
  const params = await searchParams;
  const campaignTaskId = Number(params?.campaignTaskId || 0) || null;
  const [creators, campaignTasks, brandLibraries] = await Promise.all([getPendingReviewCreators(campaignTaskId), getCampaignTasks(), getBrandLibraries()]);

  return (
    <section className="content workflow-page review-workflow">
        <header className="topbar review-topbar">
          <div>
            <h1>达人复筛</h1>
            <p>读取画像阶段已经记录的主页指标，按可配置数据门槛决定进入精选库或留在待选库。</p>
          </div>
          <Link className="button-link" href="/discover">
            返回达人发现
          </Link>
        </header>

        <ReviewClient initialBrandLibraries={brandLibraries} initialCampaignTaskId={campaignTaskId} initialCampaignTasks={campaignTasks} initialCreators={creators} />
      </section>
  );
}
