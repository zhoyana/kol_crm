import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normalizeCampaignTaskId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "MySQL is not configured." }, { status: 503 });
  }

  const campaignTaskId = normalizeCampaignTaskId(request.nextUrl.searchParams.get("campaignTaskId"));
  const stage = request.nextUrl.searchParams.get("stage") === "reviewing" ? "reviewing" : "profiling";
  if (!campaignTaskId) {
    return NextResponse.json({ error: "缺少有效的品类任务 ID。" }, { status: 400 });
  }

  // prisma singleton from import
  try {
    const links = await prisma.creatorCampaignTask.findMany({
      where: {
        campaignTaskId,
        ...(stage === "reviewing"
          ? {
              OR: [
                {
                  poolStatus: "candidate",
                  screeningStatus: "portrait_passed"
                },
                {
                  poolStatus: "featured",
                  screeningStatus: {
                    in: ["featured_stable", "featured_trending"]
                  }
                }
              ]
            }
          : {
              OR: [
                { poolStatus: "pending_review" },
                {
                  poolStatus: "candidate",
                  screeningStatus: { not: "portrait_passed" }
                }
              ]
            })
      },
      include: {
        creator: {
          select: {
            id: true,
            externalId: true,
            name: true
          }
        }
      },
      orderBy: { updatedAt: "asc" },
      take: 600
    });
    const creators = links.map((link: any) => ({
      id: link.creator.id,
      externalId: link.creator.externalId || String(link.creator.id),
      name: link.creator.name,
      poolStatus: link.poolStatus,
      screeningStatus: link.screeningStatus
    }));

    return NextResponse.json({
      ok: true,
      campaignTaskId,
      stage,
      total: creators.length,
      ids: creators.map((creator: any) => creator.externalId || `db:${creator.id}`),
      creators
    });
  } finally {
    // prisma singleton — do not disconnect
  }
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
    // prisma singleton from import
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
      // prisma singleton — do not disconnect
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to batch send creators to review." }, { status: 500 });
  }
}
