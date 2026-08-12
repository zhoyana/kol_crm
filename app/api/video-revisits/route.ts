import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchDouyinVideoDetail } from "@/lib/video-revisit";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET() {
  const targets = await prisma.videoRevisitTarget.findMany({
    include: { campaignTask: true, visits: { orderBy: { revisitedAt: "desc" }, take: 20 } },
    orderBy: { updatedAt: "desc" },
    take: 100
  });
  return NextResponse.json({ targets });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { videoUrl?: string; category?: string; campaignTaskId?: number | string | null };
    const videoUrl = String(body.videoUrl || "").trim();
    if (!videoUrl) return NextResponse.json({ error: "请粘贴视频链接" }, { status: 400 });
    const campaignTaskId = body.campaignTaskId ? Number(body.campaignTaskId) : null;
    const task = campaignTaskId
      ? await prisma.campaignTask.findUnique({ where: { id: campaignTaskId }, select: { id: true, name: true, category: true, productName: true } })
      : null;
    if (campaignTaskId && !task) return NextResponse.json({ error: "所选品类任务不存在" }, { status: 400 });

    const detail = await fetchDouyinVideoDetail(videoUrl);
    const category = String(body.category || task?.category || task?.productName || task?.name || "未分类").trim();
    const target = await prisma.videoRevisitTarget.upsert({
      where: { awemeId: detail.awemeId },
      create: {
        awemeId: detail.awemeId, videoUrl: detail.videoUrl, title: detail.title,
        creatorName: detail.creatorName, publishedAt: detail.publishedAt, category,
        campaignTaskId: task?.id || null
      },
      update: {
        videoUrl: detail.videoUrl, title: detail.title, creatorName: detail.creatorName,
        publishedAt: detail.publishedAt, category, campaignTaskId: task?.id || null
      }
    });
    await prisma.videoRevisitRecord.create({
      data: {
        targetId: target.id, likeCount: detail.likeCount, commentCount: detail.commentCount,
        rawJson: detail.rawJson as Prisma.InputJsonValue
      }
    });
    const saved = await prisma.videoRevisitTarget.findUnique({
      where: { id: target.id },
      include: { campaignTask: true, visits: { orderBy: { revisitedAt: "desc" }, take: 20 } }
    });
    return NextResponse.json({ target: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "数据回访失败";
    const busy = /等待.*超时|占用任务|采集资源/.test(message);
    const invalid = /请输入完整|仅支持抖音/.test(message);
    return NextResponse.json(
      { error: busy ? "抖音采集资源正在被其他任务占用，请稍后再试" : message },
      { status: busy ? 409 : invalid ? 400 : 500 }
    );
  }
}
