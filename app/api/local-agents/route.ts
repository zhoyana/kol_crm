import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.LOCAL_AGENT_MODE !== "queue") {
    return NextResponse.json({ mode: "direct", agents: [] });
  }
  const onlineAfter = new Date(Date.now() - 45_000);
  const agents = await prisma.localAgentDevice.findMany({
    where: { lastSeenAt: { gte: onlineAfter } },
    orderBy: [{ name: "asc" }, { lastSeenAt: "desc" }],
    select: { id: true, name: true, version: true, capabilities: true, lastSeenAt: true }
  });
  return NextResponse.json({ mode: "queue", agents });
}
