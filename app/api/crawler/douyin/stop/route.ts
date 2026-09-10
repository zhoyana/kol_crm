import { NextResponse } from "next/server";
import { stopDouyinCrawlerTask } from "@/lib/crawler-tasks";
import { agentIdFromRequest } from "@/lib/central-agent-auth";
import { withLocalAgentDevice } from "@/lib/local-agent-client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withLocalAgentDevice(agentIdFromRequest(request), async () => {
  try {
    return NextResponse.json(await stopDouyinCrawlerTask());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "停止采集失败。"
      },
      { status: 400 }
    );
  }
  });
}
