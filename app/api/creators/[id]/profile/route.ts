import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type ProfileBody = {
  profileUrl?: string;
  contact?: string;
  quote?: number | null;
  outreachStatus?: string;
  cooperationStatus?: string;
  notes?: string;
};

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "还没有配置 MySQL，当前不能保存编辑。" }, { status: 503 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as ProfileBody | null;

  if (!body) {
    return NextResponse.json({ error: "没有收到要保存的内容。" }, { status: 400 });
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

      const quote = typeof body.quote === "number" && Number.isFinite(body.quote) ? Math.max(0, Math.round(body.quote)) : null;
      const updated = await prisma.creator.update({
        where: { id: creator.id },
        data: {
          profileUrl: cleanText(body.profileUrl),
          contact: cleanText(body.contact),
          quote,
          outreachStatus: cleanText(body.outreachStatus) || creator.outreachStatus,
          cooperationStatus: cleanText(body.cooperationStatus),
          notes: cleanText(body.notes)
        }
      });

      await prisma.outreachLog.create({
        data: {
          creatorId: creator.id,
          action: "update_profile",
          content: "更新达人详情资料",
          oldStatus: creator.outreachStatus,
          newStatus: updated.outreachStatus
        }
      });

      return NextResponse.json({
        creator: {
          id: updated.externalId || String(updated.id),
          name: updated.name
        }
      });
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "保存失败，请确认 MySQL 和 Prisma 正常。" }, { status: 500 });
  }
}
