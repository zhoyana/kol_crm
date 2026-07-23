import { NextRequest, NextResponse } from "next/server";
import { importDouyinCandidates, toImportCandidate, type DouyinDiscoveryCandidate } from "@/lib/douyin-import";

export async function POST(request: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: "还没有配置 DATABASE_URL，请先连接 MySQL。" }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { candidates?: DouyinDiscoveryCandidate[] } | null;
    const candidates = body?.candidates || [];

    if (!candidates.length) {
      return NextResponse.json({ error: "请先选择要导入的候选达人。" }, { status: 400 });
    }

    const pendingReviewCandidates = candidates.map((candidate) => ({
      ...toImportCandidate(candidate),
      poolStatus: "pending_review",
      screeningStatus: "content_passed",
      screeningSummary: `${candidate.screeningSummary || "内容初筛通过"}；等待主页最近18条作品复筛`
    }));

    const result = await importDouyinCandidates(pendingReviewCandidates);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: `加入待复筛池失败：${message}` }, { status: 500 });
  }
}
