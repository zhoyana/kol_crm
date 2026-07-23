import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "还没有配置 MySQL，当前不能加入复筛。" }, { status: 503 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { reason?: string } | null;

  try {
    const prismaModule = await new Function("specifier", "return import(specifier)")("@prisma/client");
    const prisma = new prismaModule.PrismaClient();
    const numericId = Number(id);

    try {
      const creator = await prisma.creator.findFirst({
        where: {
          OR: [{ externalId: id }, ...(Number.isInteger(numericId) ? [{ id: numericId }] : [])]
        }
      });

      if (!creator) {
        return NextResponse.json({ error: "没有找到这个达人。" }, { status: 404 });
      }

      if (creator.poolStatus === "rejected") {
        return NextResponse.json({ error: "已排除达人不能直接加入复筛，请先确认是否要恢复。" }, { status: 400 });
      }

      const reason = body?.reason?.trim() || "人工加入复筛：后续条件可能变化，需要重新判断主页作品";
      const updated = await prisma.creator.update({
        where: { id: creator.id },
        data: {
          poolStatus: "pending_review",
          screeningStatus: "manual_recheck",
          screeningSummary: [creator.screeningSummary, reason].filter(Boolean).join("；")
        }
      });

      await prisma.outreachLog.create({
        data: {
          creatorId: creator.id,
          action: "manual_send_to_review",
          content: reason,
          oldStatus: creator.poolStatus,
          newStatus: updated.poolStatus
        }
      });

      return NextResponse.json({
        ok: true,
        creator: {
          id: updated.externalId || String(updated.id),
          name: updated.name,
          poolStatus: updated.poolStatus,
          screeningStatus: updated.screeningStatus,
          screeningSummary: updated.screeningSummary
        }
      });
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "加入复筛失败，请确认 MySQL 和 Prisma 正常。" }, { status: 500 });
  }
}
