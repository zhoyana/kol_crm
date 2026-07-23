import { NextRequest, NextResponse } from "next/server";
import { startDouyinCrawlerTask, type DiscoveryMode } from "@/lib/crawler-tasks";
import type { TopicRuleOptions } from "@/lib/topic-extractor";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    keyword?: string;
    maxNotes?: number;
    discoveryMode?: DiscoveryMode;
    topicLimit?: number;
    publishWindowDays?: number;
    sortBy?: string;
    topicRules?: TopicRuleOptions;
  } | null;

  try {
    const task = startDouyinCrawlerTask({
      keyword: body?.keyword || "",
      maxNotes: body?.maxNotes || 20,
      discoveryMode: body?.discoveryMode || "single",
      topicLimit: body?.topicLimit || 3,
      publishWindowDays: body?.publishWindowDays,
      sortBy: body?.sortBy,
      topicRules: body?.topicRules
    });

    return NextResponse.json(task);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "启动采集任务失败。" }, { status: 400 });
  }
}
