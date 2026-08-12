import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function douyinJsonlDir(): string {
  return path.resolve(process.cwd(), "..", "MediaCrawler-main", "data", "douyin", "jsonl");
}

async function clearDouyinJsonlFiles(): Promise<number> {
  try {
    const dir = douyinJsonlDir();
    const names = await readdir(dir);
    const jsonlFiles = names.filter((name) => name.endsWith(".jsonl"));
    await Promise.all(jsonlFiles.map((name) => unlink(path.join(dir, name)).catch(() => undefined)));
    return jsonlFiles.length;
  } catch {
    return 0;
  }
}

export async function POST() {
  let deletedWorks = 0;

  if (process.env.DATABASE_URL) {
    // prisma singleton from import
    try {
      const result = await prisma.creatorWork.deleteMany();
      deletedWorks = result.count;
    } catch {
      // ignore deletion errors
    }
  }

  const deletedJsonlFiles = await clearDouyinJsonlFiles();

  return NextResponse.json({
    deletedWorks,
    deletedJsonlFiles
  });
}
