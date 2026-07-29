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

      const reason = body?.reason?.trim() || "Manual send to review.";

      if (campaignTaskId) {
        const linked = await prisma.creatorCampaignTask.upsert({
          where: {
            creatorId_campaignTaskId: {
              creatorId: creator.id,
              campaignTaskId
            }
          },
          update: {
            poolStatus: "pending_review",
            screeningStatus: "manual_recheck",
            screeningSummary: [creator.screeningSummary, reason].filter(Boolean).join("；")
          },
          create: {
            creatorId: creator.id,
            campaignTaskId,
            poolStatus: "pending_review",
            screeningStatus: "manual_recheck",
            screeningSummary: reason
          }
        });

        await prisma.outreachLog.create({
          data: {
            creatorId: creator.id,
            action: "manual_send_campaign_to_review",
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
            screeningStatus: linked.screeningStatus,
            screeningSummary: linked.screeningSummary
          }
        });
      }

      if (creator.poolStatus === "rejected") {
        return NextResponse.json({ error: "Rejected creators cannot be sent to review directly." }, { status: 400 });
      }

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
    return NextResponse.json({ error: "Failed to send creator to review." }, { status: 500 });
  }
}
