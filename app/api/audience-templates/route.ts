import { NextRequest, NextResponse } from "next/server";
import { prisma as prismaSingleton } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function buildSummary(row: any) {
  const tpl = (row.template && typeof row.template === "object" ? row.template : {}) as any;
  const discovery = tpl.discovery || {};
  const candidateScreen = tpl.candidateScreen || {};
  const homepageReview = tpl.homepageReview || {};
  const metricRules = tpl.metricRules || {};
  const examples = (row.examples && typeof row.examples === "object" ? row.examples : {}) as any;
  return {
    id: row.id,
    brandLibraryId: row.brandLibraryId,
    brandName: row.brandLibrary?.name || null,
    name: row.name,
    category: row.category || null,
    version: row.version,
    isActive: Boolean(row.isActive),
    targetAudience: String(tpl.targetAudience || ""),
    targetDescription: String(tpl.targetDescription || ""),
    discovery: {
      primaryTerms: asStringArray(discovery.primaryTerms),
      supportTerms: asStringArray(discovery.supportTerms),
      excludeTerms: asStringArray(discovery.excludeTerms)
    },
    acceptedIdentities: asStringArray(candidateScreen.identityTerms),
    rejectedAccounts: asStringArray(candidateScreen.hardDropTerms),
    homepageRejectTerms: asStringArray(homepageReview.dominantRejectTerms),
    metricRules: {
      matchMode: metricRules.matchMode || "all",
      requireAvgLikes: Boolean(metricRules.requireAvgLikes),
      avgLikesThreshold: Number(metricRules.avgLikesThreshold || 0),
      requireViralWorks: Boolean(metricRules.requireViralWorks),
      viralLikesThreshold: Number(metricRules.viralLikesThreshold || 0),
      minViralWorks: Number(metricRules.minViralWorks || 0),
      requireSampleWorks: Boolean(metricRules.requireSampleWorks),
      minSampleWorks: Number(metricRules.minSampleWorks || 0),
      requireRecentUpdate: Boolean(metricRules.requireRecentUpdate)
    },
    examples: {
      positive: asStringArray(examples.positive).length,
      pending: asStringArray(examples.pending).length,
      negative: asStringArray(examples.negative).length
    }
  };
}

export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "还没有配置 DATABASE_URL，请先连接 MySQL。" }, { status: 400 });
  }

  const brandId = Number(request.nextUrl.searchParams.get("brandId") || 0);
  try {
    const prisma = prismaSingleton;
    const rows = await prisma.creatorAudienceTemplate.findMany({
      where: {
        isActive: true,
        ...(brandId > 0 ? { brandLibraryId: brandId } : {})
      },
      include: { brandLibrary: true },
      orderBy: [{ brandLibraryId: "asc" }, { id: "asc" }]
    });

    return NextResponse.json({ templates: rows.map(buildSummary) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取人群模板失败。" },
      { status: 500 }
    );
  }
}
