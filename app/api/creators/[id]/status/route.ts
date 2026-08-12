import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const allowedStatuses = new Set(["未建联", "待发送确认", "发送中", "已建联", "需跟进", "已回复", "报价中", "确定合作", "已拒绝", "已放弃"]);
const contactedStatuses = new Set(["发送中", "已建联", "需跟进", "已回复", "报价中", "确定合作"]);

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
      }
    | null;

  if (!body?.outreachStatus || !allowedStatuses.has(body.outreachStatus)) {
    return NextResponse.json({ error: "无效的建联状态。" }, { status: 400 });
  }

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

      if (body.action === "open_contact" && contactedStatuses.has(creator.outreachStatus)) {
        return NextResponse.json(
          { error: `该达人当前状态为“${creator.outreachStatus}”，已阻止重复打开初次建联流程。` },
          { status: 409 }
        );
      }
      if (body.outreachStatus === creator.outreachStatus) {
        return NextResponse.json({
          creator: {
            id: creator.externalId || String(creator.id),
            name: creator.name,
            outreachStatus: creator.outreachStatus,
            cooperationStatus: creator.cooperationStatus
          },
          unchanged: true
        });
      }

      const updated = await prisma.creator.update({
        where: { id: creator.id },
        data: {
          outreachStatus: body.outreachStatus,
          cooperationStatus: body.cooperationStatus ?? creator.cooperationStatus
        }
      });

      await prisma.outreachLog.create({
        data: {
          creatorId: creator.id,
          action: body.action || "update_status",
          content: body.content || null,
          oldStatus: creator.outreachStatus,
          newStatus: body.outreachStatus
        }
      });

      return NextResponse.json({
        creator: {
          id: updated.externalId || String(updated.id),
          name: updated.name,
          outreachStatus: updated.outreachStatus,
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
