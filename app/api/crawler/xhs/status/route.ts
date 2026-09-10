import { NextResponse } from "next/server";
import { getXhsCrawlerTask } from "@/lib/xhs-crawler-tasks";
export async function GET() { return NextResponse.json(getXhsCrawlerTask()); }
