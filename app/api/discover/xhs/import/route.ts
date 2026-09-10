import { NextRequest, NextResponse } from "next/server";
import { importXhsCandidates } from "@/lib/xhs-import";
export async function POST(request: NextRequest) { try { const body = await request.json(); return NextResponse.json(await importXhsCandidates(Array.isArray(body?.candidates) ? body.candidates : [], Number(body?.campaignTaskId || 0))); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "小红书达人导入失败" }, { status: 500 }); } }
