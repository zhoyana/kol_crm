import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as any;
  const decision = String(body?.decision || "").trim();
  const reason = String(body?.reason || "").trim();

  if (!decision || !reason) {
    return NextResponse.json({ error: "decision 和 reason 不能为空。" }, { status: 400 });
  }

  try {
    // prisma singleton from import

    try {
      const feedback = await prisma.creatorFeedback.create({
        data: {
          creatorId: Number.isFinite(Number(body.creatorId)) ? Number(body.creatorId) : null,
          ruleProfileId: Number.isFinite(Number(body.ruleProfileId)) ? Number(body.ruleProfileId) : null,
          decision,
          reason,
          note: body.note ? String(body.note) : null,
          snapshot: body.snapshot || undefined
        }
      });

      const memory = await prisma.agentMemory.create({
        data: {
          scope: body.ruleProfileId ? "rule_profile" : "global",
          key: `feedback:${decision}:${reason}`,
          value: body.note ? String(body.note) : `用户对达人做出 ${decision} 判断，原因是：${reason}`,
          confidence: 0.7,
          source: "creator_feedback",
          ruleProfileId: Number.isFinite(Number(body.ruleProfileId)) ? Number(body.ruleProfileId) : null
        }
      });

      return NextResponse.json({ feedback, memory });
    } finally {
      // prisma singleton — do not disconnect
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "记录反馈失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
