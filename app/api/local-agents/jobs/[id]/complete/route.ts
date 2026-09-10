import { NextResponse } from "next/server";
import { isCentralAgentAuthorized } from "@/lib/central-agent-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isCentralAgentAuthorized(request)) return NextResponse.json({ error: "Agent token 无效。" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { agentId?: string; ok?: boolean; result?: unknown; error?: string };
  const agentId = String(body.agentId || "").trim();
  const job = await prisma.localAgentJob.findUnique({ where: { id } });
  if (!job || job.agentDeviceId !== agentId) return NextResponse.json({ error: "任务不存在或不属于当前 Agent。" }, { status: 404 });
  await prisma.localAgentJob.update({
    where: { id },
    data: {
      status: body.ok ? "succeeded" : "failed",
      responseBody: body.result === undefined ? undefined : (body.result as any),
      error: body.ok ? null : String(body.error || "本地 Agent 执行失败。").slice(0, 20_000),
      finishedAt: new Date(),
      leaseExpiresAt: null
    }
  });
  return NextResponse.json({ ok: true });
}
