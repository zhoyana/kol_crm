import { NextRequest, NextResponse } from "next/server";
import { createRuleProfile, getRuleProfiles } from "@/lib/agent-store";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 60) : [];
}

export async function GET() {
  const profiles = await getRuleProfiles();
  return NextResponse.json({ profiles });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as any;

  if (!body?.name?.trim()) {
    return NextResponse.json({ error: "规则名称不能为空。" }, { status: 400 });
  }

  if (!body?.targetDescription?.trim()) {
    return NextResponse.json({ error: "筛选目标不能为空。" }, { status: 400 });
  }

  try {
    const profile = await createRuleProfile({
      name: body.name,
      category: body.category,
      targetDescription: body.targetDescription,
      primaryTerms: asStringArray(body.primaryTerms),
      supportTerms: asStringArray(body.supportTerms),
      excludeTerms: asStringArray(body.excludeTerms),
      minLikeCount: Number(body.minLikeCount || 500),
      publishWindowDays: Number(body.publishWindowDays || 180),
      sortType: body.sortType || "comprehensive",
      notes: body.notes || ""
    });

    return NextResponse.json({ profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存规则模板失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
