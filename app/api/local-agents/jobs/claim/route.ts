import { NextResponse } from "next/server";
import { isCentralAgentAuthorized } from "@/lib/central-agent-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isCentralAgentAuthorized(request)) return NextResponse.json({ error: "Agent token 无效。" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { agentId?: string; name?: string; version?: string; capabilities?: string[] };
  const agentId = String(body.agentId || "").trim().slice(0, 128);
  if (!agentId) return NextResponse.json({ error: "缺少 Agent ID。" }, { status: 400 });
  const now = new Date();
  await prisma.localAgentDevice.upsert({
    where: { id: agentId },
    create: { id: agentId, name: String(body.name || agentId).slice(0, 100), version: String(body.version || "unknown").slice(0, 30), capabilities: body.capabilities || [], lastSeenAt: now },
    update: { name: String(body.name || agentId).slice(0, 100), version: String(body.version || "unknown").slice(0, 30), capabilities: body.capabilities || [], status: "online", lastSeenAt: now }
  });
  const candidate = await prisma.localAgentJob.findFirst({
    where: {
      agentDeviceId: agentId,
      OR: [{ status: "queued" }, { status: "running", leaseExpiresAt: { lt: now } }]
    },
    orderBy: { createdAt: "asc" }
  });
  if (!candidate) return NextResponse.json({ job: null });
  const claimed = await prisma.localAgentJob.updateMany({
    where: {
      id: candidate.id,
      OR: [{ status: "queued" }, { status: "running", leaseExpiresAt: { lt: now } }]
    },
    data: { status: "running", claimedAt: now, leaseExpiresAt: new Date(now.getTime() + Math.max(60_000, candidate.timeoutMs + 30_000)), error: null }
  });
  if (claimed.count !== 1) return NextResponse.json({ job: null });
  return NextResponse.json({ job: { id: candidate.id, pathname: candidate.pathname, method: candidate.method, body: candidate.requestBody, timeoutMs: candidate.timeoutMs } });
}
