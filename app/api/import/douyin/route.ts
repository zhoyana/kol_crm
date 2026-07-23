import { NextRequest, NextResponse } from "next/server";
import { importDouyinCandidates, parseDouyinCandidates, readLatestDouyinResult } from "@/lib/douyin-import";

type ImportDouyinBody = {
  mode?: "text" | "latest";
  content?: string;
  category?: string;
};

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "还没有配置 DATABASE_URL，请先连接 MySQL。" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as ImportDouyinBody | null;
  const mode = body?.mode || "text";
  const category = body?.category?.trim() || "未分类";

  let content = body?.content?.trim() || "";
  let sourceFile: string | undefined;

  if (mode === "latest") {
    const latest = await readLatestDouyinResult();
    if (!latest) {
      return NextResponse.json(
        {
          error:
            "没有找到 MediaCrawler 的最新结果。请确认目录存在：work/MediaCrawler-main/data/douyin/jsonl，并且里面有 contents jsonl 文件。"
        },
        { status: 404 }
      );
    }

    content = latest.content;
    sourceFile = latest.filePath;
  }

  if (!content) {
    return NextResponse.json({ error: "没有收到可导入的抖音采集结果。" }, { status: 400 });
  }

  const candidates = parseDouyinCandidates(content, category);
  if (candidates.length === 0) {
    return NextResponse.json({ error: "没有识别到可导入的达人。请确认文件是 MediaCrawler jsonl 或候选达人 csv。" }, { status: 400 });
  }

  const result = await importDouyinCandidates(candidates, sourceFile);
  return NextResponse.json(result);
}
