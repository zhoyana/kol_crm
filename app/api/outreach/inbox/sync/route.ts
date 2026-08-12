import { NextResponse } from "next/server";
import { syncOutreachInbox } from "@/lib/outreach-inbox";

export const runtime = "nodejs";

export async function POST() {
  try { return NextResponse.json(await syncOutreachInbox()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "回复同步失败" }, { status: 502 }); }
}
