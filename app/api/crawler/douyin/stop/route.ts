import { NextResponse } from "next/server";
import { stopDouyinCrawlerTask } from "@/lib/crawler-tasks";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(stopDouyinCrawlerTask());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "停止采集失败。"
      },
      { status: 400 }
    );
  }
}
