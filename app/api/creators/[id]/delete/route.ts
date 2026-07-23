import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "还没有配置 MySQL，当前不能删除达人。" }, { status: 503 });
  }

  const { id } = await context.params;
  await request.json().catch(() => null);

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

      await prisma.creator.delete({
        where: { id: creator.id }
      });

      return NextResponse.json({
        ok: true,
        creator: {
          id: creator.externalId || String(creator.id),
          name: creator.name,
          poolStatus: "deleted",
          screeningStatus: "manual_deleted"
        }
      });
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "删除达人失败，请确认 MySQL 和 Prisma 正常。" }, { status: 500 });
  }
}
