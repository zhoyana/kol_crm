import { NextRequest, NextResponse } from "next/server";

type MiniPrismaClient = {
  creatorFeedback: {
    create: (args: any) => Promise<any>;
  };
  agentMemory: {
    create: (args: any) => Promise<any>;
  };
  $disconnect: () => Promise<void>;
};

async function getPrisma(): Promise<MiniPrismaClient> {
  const prismaModule = await new Function("specifier", "return import(specifier)")("@prisma/client");
  const PrismaClient = prismaModule.PrismaClient as new () => MiniPrismaClient;
  return new PrismaClient();
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as any;
  const decision = String(body?.decision || "").trim();
  const reason = String(body?.reason || "").trim();

  if (!decision || !reason) {
    return NextResponse.json({ error: "decision 和 reason 不能为空。" }, { status: 400 });
  }

  try {
    const prisma = await getPrisma();

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
      await prisma.$disconnect();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "记录反馈失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
