import { NextRequest, NextResponse } from "next/server";

export async function PATCH(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "还没有配置 MySQL，当前不能批量加入复筛。" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { ids?: string[]; reason?: string } | null;
  const ids = Array.from(new Set((body?.ids || []).map((id) => String(id).trim()).filter(Boolean)));

  if (!ids.length) {
    return NextResponse.json({ error: "缺少要复筛的达人。" }, { status: 400 });
  }

  try {
    const prismaModule = await new Function("specifier", "return import(specifier)")("@prisma/client");
    const prisma = new prismaModule.PrismaClient();
    const numericIds = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id));
    const reason = body?.reason?.trim() || "批量加入复筛：后续条件可能变化，需要重新判断主页作品";

    try {
      const creators = await prisma.creator.findMany({
        where: {
          poolStatus: { in: ["candidate", "skipped"] },
          OR: [{ externalId: { in: ids } }, ...(numericIds.length ? [{ id: { in: numericIds } }] : [])]
        }
      });

      if (!creators.length) {
        return NextResponse.json({ error: "当前筛选结果里没有可加入复筛的待选库达人。" }, { status: 404 });
      }

      await prisma.$transaction([
        prisma.creator.updateMany({
          where: { id: { in: creators.map((creator: any) => creator.id) } },
          data: {
            poolStatus: "pending_review",
            screeningStatus: "manual_recheck"
          }
        }),
        prisma.outreachLog.createMany({
          data: creators.map((creator: any) => ({
            creatorId: creator.id,
            action: "manual_batch_send_to_review",
            content: reason,
            oldStatus: creator.poolStatus,
            newStatus: "pending_review"
          }))
        })
      ]);

      return NextResponse.json({
        ok: true,
        count: creators.length,
        ids: creators.map((creator: any) => creator.externalId || String(creator.id))
      });
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "批量加入复筛失败，请确认 MySQL 和 Prisma 正常。" }, { status: 500 });
  }
}
