import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function normalizeCampaignTaskId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "MySQL is not configured." }, { status: 503 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    reason?: string;
    campaignTaskId?: number | string | null;
  } | null;
  const campaignTaskId = normalizeCampaignTaskId(body?.campaignTaskId);

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
        return NextResponse.json({ error: "Creator not found." }, { status: 404 });
      }

      const reason = body?.reason?.trim() || "Manual delete.";

      if (campaignTaskId) {
        const linked = await prisma.creatorCampaignTask.upsert({
          where: {
            creatorId_campaignTaskId: {
              creatorId: creator.id,
              campaignTaskId
            }
          },
          update: {
            poolStatus: "deleted",
            screeningStatus: "manual_deleted",
            notes: reason
          },
          create: {
            creatorId: creator.id,
            campaignTaskId,
            poolStatus: "deleted",
            screeningStatus: "manual_deleted",
            notes: reason
          }
        });

        await prisma.outreachLog.create({
          data: {
            creatorId: creator.id,
            action: "manual_delete_from_campaign",
            content: reason,
            oldStatus: creator.poolStatus,
            newStatus: linked.poolStatus
          }
        });

        return NextResponse.json({
          ok: true,
          campaignTaskId,
          creator: {
            id: creator.externalId || String(creator.id),
            name: creator.name,
            poolStatus: linked.poolStatus,
            screeningStatus: linked.screeningStatus
          }
        });
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
    return NextResponse.json({ error: "Failed to delete creator." }, { status: 500 });
  }
}
