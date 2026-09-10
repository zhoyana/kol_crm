import { NextResponse } from "next/server";
import { stopXhsCrawlerTask } from "@/lib/xhs-crawler-tasks";
export async function POST() { return NextResponse.json(await stopXhsCrawlerTask()); }
