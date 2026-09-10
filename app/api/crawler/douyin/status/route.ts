import { NextResponse } from "next/server";
import { getDouyinCrawlerTask } from "@/lib/crawler-tasks";
import { agentIdFromRequest } from "@/lib/central-agent-auth";
import { withLocalAgentDevice } from "@/lib/local-agent-client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withLocalAgentDevice(agentIdFromRequest(request), async () => {
  try {
    return NextResponse.json(await getDouyinCrawlerTask());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法读取本地 Agent 状态。" },
      { status: 503 }
    );
  }
  });
}
