import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

type MiniPrismaClient = {
  creatorWork: {
    deleteMany: (args?: any) => Promise<{ count: number }>;
  };
  $disconnect: () => Promise<void>;
};

async function getPrisma(): Promise<MiniPrismaClient> {
  const prismaModule = await import("@prisma/client");
  const PrismaClient = prismaModule.PrismaClient as new () => MiniPrismaClient;
  return new PrismaClient();
}

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
    const prisma = await getPrisma();
    try {
      const result = await prisma.creatorWork.deleteMany();
      deletedWorks = result.count;
    } finally {
      await prisma.$disconnect();
    }
  }

  const deletedJsonlFiles = await clearDouyinJsonlFiles();

  return NextResponse.json({
    deletedWorks,
    deletedJsonlFiles
  });
}
