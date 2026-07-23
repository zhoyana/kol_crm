import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const allowedPoolStatuses = new Set(["pending_review", "candidate", "featured", "skipped", "rejected"]);

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "还没有配置 MySQL，当前不能调整达人库类型。" }, { status: 503 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    poolStatus?: string;
    screeningStatus?: string;
    reason?: string;
  } | null;

  if (!body?.poolStatus || !allowedPoolStatuses.has(body.poolStatus)) {
    return NextResponse.json({ error: "无效的达人库类型。" }, { status: 400 });
  }

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

      const reason = body.reason?.trim() || "人工调整达人库类型";
      const updated = await prisma.creator.update({
        where: { id: creator.id },
        data: {
          poolStatus: body.poolStatus,
          screeningStatus: body.screeningStatus || creator.screeningStatus,
          screeningSummary: [creator.screeningSummary, reason].filter(Boolean).join("；")
        }
      });

      await prisma.outreachLog.create({
        data: {
          creatorId: creator.id,
          action: "manual_move_pool",
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
    return NextResponse.json({ error: "达人库类型调整失败，请确认 MySQL 和 Prisma 正常。" }, { status: 500 });
  }
}
