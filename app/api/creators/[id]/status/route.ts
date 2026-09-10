import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const allowedStatuses = new Set(["未建联", "已建联"]);

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL 未配置，当前仍是 CSV 只读模式。" }, { status: 503 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | {
        outreachStatus?: string;
        cooperationStatus?: string;
        action?: string;
        content?: string;
        campaignTaskId?: number | string | null;
      }
    | null;

  if (!body?.outreachStatus || !allowedStatuses.has(body.outreachStatus)) {
    return NextResponse.json({ error: "无效的建联状态。" }, { status: 400 });
  }

  const campaignTaskId = Number(body.campaignTaskId || 0) || null;

  try {
    // prisma singleton from import
    const numericId = Number(id);

    try {
      const creator = await prisma.creator.findFirst({
        where: {
          OR: [{ externalId: id }, ...(Number.isInteger(numericId) ? [{ id: numericId }] : [])]
        }
      });

      if (!creator) {
        return NextResponse.json({ error: "没有找到达人。" }, { status: 404 });
      }


      const taskLink = campaignTaskId
        ? await prisma.creatorCampaignTask.findUnique({
            where: { creatorId_campaignTaskId: { creatorId: creator.id, campaignTaskId } }
          })
        : null;

      if (campaignTaskId && !taskLink) {
        return NextResponse.json({ error: "这个达人不在所选品类任务中。" }, { status: 404 });
      }

      const currentStatus = taskLink?.outreachStatus || creator.outreachStatus;

      if (body.outreachStatus === currentStatus) {
        return NextResponse.json({
          creator: {
            id: creator.externalId || String(creator.id),
            name: creator.name,
            outreachStatus: currentStatus,
            cooperationStatus: creator.cooperationStatus
          },
          unchanged: true
        });
      }

      if (taskLink) {
        await prisma.creatorCampaignTask.update({
          where: { id: taskLink.id },
          data: { outreachStatus: body.outreachStatus }
        });
      } else {
        await prisma.creator.update({
          where: { id: creator.id },
          data: { outreachStatus: body.outreachStatus }
        });
      }

      const updated = body.cooperationStatus === undefined
        ? creator
        : await prisma.creator.update({
            where: { id: creator.id },
            data: { cooperationStatus: body.cooperationStatus }
          });

      await prisma.outreachLog.create({
        data: {
          creatorId: creator.id,
          campaignTaskId,
          action: body.action || "update_status",
          content: body.content || null,
          oldStatus: currentStatus,
          newStatus: body.outreachStatus
        }
      });

      return NextResponse.json({
        creator: {
          id: updated.externalId || String(updated.id),
          name: updated.name,
          outreachStatus: body.outreachStatus,
          cooperationStatus: updated.cooperationStatus
        }
      });
    } finally {
      // prisma singleton — do not disconnect
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "状态更新失败，请确认 MySQL 和 Prisma 已初始化。" }, { status: 500 });
  }
}
