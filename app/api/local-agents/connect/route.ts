import { NextResponse } from "next/server";
import { isCentralAgentAuthorized } from "@/lib/central-agent-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isCentralAgentAuthorized(request)) return NextResponse.json({ error: "Agent token 无效。" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = String(body.agentId || "").trim().slice(0, 128);
  if (!id) return NextResponse.json({ error: "缺少 Agent ID。" }, { status: 400 });
  const name = String(body.name || id).trim().slice(0, 100) || id;
  const version = String(body.version || "unknown").trim().slice(0, 30);
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities.map(String).slice(0, 20) : [];
  const agent = await prisma.localAgentDevice.upsert({
    where: { id },
    create: { id, name, version, capabilities, status: "online", lastSeenAt: new Date() },
    update: { name, version, capabilities, status: "online", lastSeenAt: new Date() }
  });
  return NextResponse.json({ ok: true, agentId: agent.id });
}
