import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { evaluateXhsCreatorPortrait } from "@/lib/xhs-portrait";
import { queryRedfoxXhsAccountWorks } from "@/lib/xhs-redfox-profile";
import { queryMatrixflowXhsAccountWorks } from "@/lib/xhs-matrixflow-profile";

type BatchRow = {
  ok: boolean;
  externalId: string;
  name: string;
  poolStatus?: string;
  screeningStatus?: string;
  screeningSummary?: string;
  sampleWorkCount?: number;
  aiCalls?: number;
  reason?: string;
  error?: string;
  profileWorksAdded?: number;
  profileFetchError?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ids = Array.isArray(body?.ids) ? body.ids.map(String).filter(Boolean) : [];
    const campaignTaskId = Number(body?.campaignTaskId || 0);
    const workLimit = Math.max(1, Math.min(20, Number(body?.workLimit || 10)));
    if (body?.mode !== "portrait") {
      return NextResponse.json({ error: "小红书接口当前仅处理达人身份画像。" }, { status: 400 });
    }
    const task = campaignTaskId ? await prisma.campaignTask.findUnique({ where: { id: campaignTaskId } }) : null;
    const creators = await prisma.creator.findMany({
      where: { externalId: { in: ids }, platform: "小红书" },
      include: { works: true }
    });
    const results: BatchRow[] = [];
    const homepageProvider = String(process.env.XHS_HOMEPAGE_PROVIDER || "matrixflow").trim().toLowerCase();
    const useMatrixflowHomepage =
      homepageProvider === "matrixflow" ||
      (homepageProvider === "auto" && !String(process.env.REDFOX_API_KEY || "").trim());
    let totalAiCalls = 0;

    for (const creator of creators) {
      let profileWorksAdded = 0;
      let profileFetchError = "";
      const xhsUserid = String(creator.externalId || "").replace(/^xhs-/, "").trim();
      if (xhsUserid) {
        try {
          const profileResult = useMatrixflowHomepage
            ? await queryMatrixflowXhsAccountWorks(xhsUserid, workLimit)
            : null;
          const profileWorks = profileResult
            ? profileResult.works
            : await queryRedfoxXhsAccountWorks(xhsUserid, workLimit);
          if (profileResult && profileResult.fans > 0 && Number(creator.fans || 0) === 0) {
            await prisma.creator.update({ where: { id: creator.id }, data: { fans: profileResult.fans } });
          }
          for (const work of profileWorks) {
            await prisma.creatorWork.upsert({
              where: { creatorExternalId_awemeId: { creatorExternalId: creator.externalId!, awemeId: work.awemeId } },
              create: {
                creatorId: creator.id, creatorExternalId: creator.externalId, creatorName: creator.name,
                creatorProfileUrl: creator.profileUrl, awemeId: work.awemeId, title: work.title, url: work.url,
                publishedAt: work.publishedAt, likeCount: work.likeCount, collectCount: work.collectCount,
                commentCount: work.commentCount, shareCount: work.shareCount, sourceKeyword: "主页作品补齐",
                rawJson: work.rawJson as never
              },
              update: {
                creatorId: creator.id, creatorName: creator.name, creatorProfileUrl: creator.profileUrl,
                title: work.title, url: work.url, publishedAt: work.publishedAt, likeCount: work.likeCount,
                collectCount: work.collectCount, commentCount: work.commentCount, shareCount: work.shareCount,
                rawJson: work.rawJson as never
              }
            });
          }
          profileWorksAdded = profileWorks.length;
        } catch (error) {
          profileFetchError = error instanceof Error ? error.message : "小红书作者作品补齐失败";
        }
      }
      const portraitWorks = await prisma.creatorWork.findMany({
        where: { creatorId: creator.id }, orderBy: { publishedAt: "desc" }, take: workLimit
      });
      const evaluation = await evaluateXhsCreatorPortrait({
        name: creator.name,
        fans: Number(creator.fans || 0),
        works: portraitWorks.map((work) => ({ title: String(work.title || "") })),
        task: task as never
      });
      totalAiCalls += evaluation.aiCalls;

      await prisma.creator.update({
        where: { id: creator.id },
        data: {
          poolStatus: evaluation.poolStatus,
          screeningStatus: evaluation.screeningStatus,
          screeningSummary: evaluation.screeningSummary,
          rejectReason: evaluation.poolStatus === "rejected" ? evaluation.reason : null
        }
      });
      if (campaignTaskId) {
        await prisma.creatorCampaignTask.upsert({
          where: { creatorId_campaignTaskId: { creatorId: creator.id, campaignTaskId } },
          create: {
            creatorId: creator.id,
            campaignTaskId,
            poolStatus: evaluation.poolStatus,
            screeningStatus: evaluation.screeningStatus,
            screeningSummary: evaluation.screeningSummary
          },
          update: {
            poolStatus: evaluation.poolStatus,
            screeningStatus: evaluation.screeningStatus,
            screeningSummary: evaluation.screeningSummary
          }
        });
      }
      results.push({
        ok: evaluation.ok,
        externalId: creator.externalId || String(creator.id),
        name: creator.name,
        poolStatus: evaluation.poolStatus,
        screeningStatus: evaluation.screeningStatus,
        screeningSummary: evaluation.screeningSummary,
        sampleWorkCount: portraitWorks.length,
        profileWorksAdded,
        profileFetchError: profileFetchError || undefined,
        aiCalls: evaluation.aiCalls,
        reason: evaluation.reason
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "portrait",
      total: results.length,
      succeeded: results.filter((item) => item.ok).length,
      rejected: results.filter((item) => !item.ok).length,
      failed: Math.max(0, ids.length - results.length),
      aiCalls: totalAiCalls,
      results
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "小红书画像处理失败" }, { status: 500 });
  }
}
