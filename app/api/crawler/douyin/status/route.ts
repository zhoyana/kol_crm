import { NextResponse } from "next/server";
import { getDouyinCrawlerTask } from "@/lib/crawler-tasks";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getDouyinCrawlerTask());
}
