import { NextRequest, NextResponse } from "next/server";
import { startXhsCrawlerTask } from "@/lib/xhs-crawler-tasks";
export async function POST(request: NextRequest) { try { return NextResponse.json(await startXhsCrawlerTask(await request.json())); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "小红书采集启动失败" }, { status: 500 }); } }
