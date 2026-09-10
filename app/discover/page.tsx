import Link from "next/link";
import { getBrandLibraries, getCampaignTasks } from "@/lib/campaign-tasks";
import { DiscoverClient } from "./DiscoverClient";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const [campaignTasks, brandLibraries] = await Promise.all([getCampaignTasks(), getBrandLibraries()]);

  return (
    <section className="content workflow-page discover-workflow">
        <header className="topbar">
          <div>
            <h1>达人发现</h1>
            <p>输入关键词，从采集结果里筛出内容初筛通过的作者，先加入待复筛池。</p>
          </div>
          <Link className="button-link" href="/review">
            去画像与复筛
          </Link>
        </header>

        <DiscoverClient initialBrandLibraries={brandLibraries} initialCampaignTasks={campaignTasks} />
      </section>
  );
}
