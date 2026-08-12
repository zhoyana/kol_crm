import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const allowedPoolStatuses = new Set(["pending_review", "candidate", "featured", "skipped", "rejected"]);

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
    poolStatus?: string;
    screeningStatus?: string;
    reason?: string;
    campaignTaskId?: number | string | null;
  } | null;
  const campaignTaskId = normalizeCampaignTaskId(body?.campaignTaskId);

  if (!body?.poolStatus || !allowedPoolStatuses.has(body.poolStatus)) {
    return NextResponse.json({ error: "Invalid creator pool status." }, { status: 400 });
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
        return NextResponse.json({ error: "Creator not found." }, { status: 404 });
      }

      const reason = body.reason?.trim() || "Manual pool status change.";

      if (campaignTaskId) {
        const linked = await prisma.creatorCampaignTask.upsert({
          where: {
            creatorId_campaignTaskId: {
              creatorId: creator.id,
              campaignTaskId
            }
          },
          update: {
            poolStatus: body.poolStatus,
            screeningStatus: body.screeningStatus || "manual_pool_change",
            screeningSummary: [creator.screeningSummary, reason].filter(Boolean).join("；")
          },
          create: {
            creatorId: creator.id,
            campaignTaskId,
            poolStatus: body.poolStatus,
            screeningStatus: body.screeningStatus || "manual_pool_change",
            screeningSummary: reason
          }
        });

        await prisma.outreachLog.create({
          data: {
            creatorId: creator.id,
            action: "manual_move_campaign_pool",
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
      // prisma singleton — do not disconnect
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update creator pool status." }, { status: 500 });
  }
}
