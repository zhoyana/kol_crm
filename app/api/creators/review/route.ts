import { NextRequest, NextResponse } from "next/server";

function normalizeCampaignTaskId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "MySQL is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    ids?: string[];
    reason?: string;
    campaignTaskId?: number | string | null;
  } | null;
  const ids = Array.from(new Set((body?.ids || []).map((id) => String(id).trim()).filter(Boolean)));
  const campaignTaskId = normalizeCampaignTaskId(body?.campaignTaskId);

  if (!ids.length) {
    return NextResponse.json({ error: "Missing creator ids." }, { status: 400 });
  }

  try {
    const prismaModule = await new Function("specifier", "return import(specifier)")("@prisma/client");
    const prisma = new prismaModule.PrismaClient();
    const numericIds = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id));
    const reason = body?.reason?.trim() || "Batch send to review.";

    try {
      const creators = await prisma.creator.findMany({
        where: {
          OR: [{ externalId: { in: ids } }, ...(numericIds.length ? [{ id: { in: numericIds } }] : [])]
        }
      });

      if (!creators.length) {
        return NextResponse.json({ error: "No matching creators found." }, { status: 404 });
      }

      if (campaignTaskId) {
        await prisma.$transaction([
          ...creators.map((creator: any) =>
            prisma.creatorCampaignTask.upsert({
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
            })
          ),
          prisma.outreachLog.createMany({
            data: creators.map((creator: any) => ({
              creatorId: creator.id,
              action: "manual_batch_send_campaign_to_review",
              content: reason,
              oldStatus: creator.poolStatus,
              newStatus: "pending_review"
            }))
          })
        ]);

        return NextResponse.json({
          ok: true,
          campaignTaskId,
          count: creators.length,
          ids: creators.map((creator: any) => creator.externalId || String(creator.id))
        });
      }

      const reviewableCreators = creators.filter((creator: any) => ["candidate", "skipped"].includes(creator.poolStatus));

      if (!reviewableCreators.length) {
        return NextResponse.json({ error: "No reviewable creators in the current result." }, { status: 404 });
      }

      await prisma.$transaction([
        prisma.creator.updateMany({
          where: { id: { in: reviewableCreators.map((creator: any) => creator.id) } },
          data: {
            poolStatus: "pending_review",
            screeningStatus: "manual_recheck"
          }
        }),
        prisma.outreachLog.createMany({
          data: reviewableCreators.map((creator: any) => ({
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
        count: reviewableCreators.length,
        ids: reviewableCreators.map((creator: any) => creator.externalId || String(creator.id))
      });
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to batch send creators to review." }, { status: 500 });
  }
}
