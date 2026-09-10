import { NextRequest, NextResponse } from "next/server";
import { continueDouyinCrawlerWithTopics } from "@/lib/crawler-tasks";
import { agentIdFromRequest } from "@/lib/central-agent-auth";
import { withLocalAgentDevice } from "@/lib/local-agent-client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return withLocalAgentDevice(agentIdFromRequest(request), () => handlePost(request));
}

async function handlePost(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { topics?: string[] } | null;

  try {
    const task = await continueDouyinCrawlerWithTopics(body?.topics || []);
    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "继续采集失败。" }, { status: 400 });
  }
}
