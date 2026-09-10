import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, service: "kol-crm-web", database: "connected" });
  } catch {
    return NextResponse.json(
      { ok: false, service: "kol-crm-web", database: "unavailable" },
      { status: 503 }
    );
  }
}
