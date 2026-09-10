import { NextResponse } from "next/server";
import { downloadVideoRevisitBatch, getVideoRevisitBatch, startVideoRevisitBatch } from "@/lib/video-revisit-batch";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const agentDeviceId = String(form.get("agentDeviceId") || "").trim() || undefined;
  if (!(file instanceof File)) return NextResponse.json({ error: "请选择 Excel 文件。" }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: "目前只支持 .xlsx 文件。" }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "Excel 文件不能超过 20MB。" }, { status: 400 });
  const job = startVideoRevisitBatch(Buffer.from(await file.arrayBuffer()), file.name, agentDeviceId);
  return NextResponse.json({ job }, { status: 202 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "缺少批次 ID。" }, { status: 400 });
  if (url.searchParams.get("download") === "1") {
    const output = downloadVideoRevisitBatch(id);
    if (!output) return NextResponse.json({ error: "结果尚未生成或已经过期。" }, { status: 404 });
    return new NextResponse(new Uint8Array(output.data), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(output.fileName)}`,
        "cache-control": "no-store"
      }
    });
  }
  const job = getVideoRevisitBatch(id);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "批次不存在或已经过期。" }, { status: 404 });
}
