import { NextResponse } from "next/server";
import { evaluateCreatorWithAi } from "@/lib/ai";
import { getCreatorById } from "@/lib/creators";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { id } = await context.params;
  const creator = await getCreatorById(id);

  if (!creator) {
    return NextResponse.json({ error: "没有找到达人。" }, { status: 404 });
  }

  const evaluation = await evaluateCreatorWithAi(creator);

  if (process.env.DATABASE_URL) {
    await saveEvaluation(id, evaluation).catch(() => null);
  }

  return NextResponse.json({ evaluation });
}

async function saveEvaluation(externalId: string, evaluation: Awaited<ReturnType<typeof evaluateCreatorWithAi>>) {
  // prisma singleton from import
  const numericId = Number(externalId);

  try {
    const creator = await prisma.creator.findFirst({
      where: {
        OR: [{ externalId }, ...(Number.isInteger(numericId) ? [{ id: numericId }] : [])]
      }
    });

    if (!creator) return;

    await prisma.aiEvaluation.create({
      data: {
        creatorId: creator.id,
        matchScore: evaluation.matchScore,
        grade: evaluation.grade,
        recommendedAction: evaluation.recommendedAction,
        suggestedCooperation: evaluation.suggestedCooperation,
        riskTags: evaluation.riskTags,
        reason: evaluation.reason,
        negotiationPoint: evaluation.negotiationPoint,
        outreachScript: evaluation.outreachScript
      }
    });
  } finally {
    // prisma singleton — do not disconnect
  }
}
