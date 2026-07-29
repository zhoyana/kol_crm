import Link from "next/link";
import { getCampaignTasks } from "@/lib/campaign-tasks";
import { getPendingReviewCreators } from "@/lib/review";
import { ReviewClient } from "./ReviewClient";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: { searchParams?: Promise<{ campaignTaskId?: string }> }) {
  const params = await searchParams;
  const campaignTaskId = Number(params?.campaignTaskId || 0) || null;
  const [creators, campaignTasks] = await Promise.all([getPendingReviewCreators(campaignTaskId), getCampaignTasks()]);

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
          <Link className="active" href="/review">
            达人复筛
          </Link>
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
            <h1>达人复筛</h1>
            <p>抓取达人主页最近10条作品，按可配置条件判断进入精选库或待选库。</p>
          </div>
          <Link className="button-link" href="/discover">
            返回达人发现
          </Link>
        </header>

        <ReviewClient initialCampaignTaskId={campaignTaskId} initialCampaignTasks={campaignTasks} initialCreators={creators} />
      </section>
    </main>
  );
}
