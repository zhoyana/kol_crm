import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const backupDir = path.resolve("backups", "creator-resets");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(backupDir, `creators-before-reset-${stamp}.json`);

try {
  const activeRuns = await prisma.agentRun.count({
    where: { status: { in: ["queued", "running", "paused", "stopping"] } }
  });
  if (activeRuns > 0) {
    throw new Error(`仍有 ${activeRuns} 个 Agent 任务未结束，已停止清理。`);
  }

  const keep = await prisma.creator.findMany({
    where: { accountType: "test_self" },
    select: { id: true, externalId: true, name: true, accountType: true }
  });
  if (keep.length === 0) throw new Error("没有找到 accountType=test_self 的测试达人，已停止清理。");

  const keepIds = keep.map((creator) => creator.id);
  const removing = await prisma.creator.findMany({
    where: { id: { notIn: keepIds } },
    include: {
      works: true,
      outreachLogs: true,
      aiEvaluations: true,
      feedbacks: true,
      campaignTasks: true,
      outreachConversation: {
        include: {
          messages: true,
          aiSuggestions: { include: { feedbacks: true } },
          feedbacks: true
        }
      }
    }
  });

  await mkdir(backupDir, { recursive: true });
  await writeFile(
    backupPath,
    JSON.stringify({ createdAt: new Date().toISOString(), keep, creators: removing }, null, 2),
    "utf8"
  );

  const result = await prisma.creator.deleteMany({ where: { id: { notIn: keepIds } } });
  const remaining = await prisma.creator.findMany({
    select: { id: true, externalId: true, name: true, accountType: true }
  });

  console.log(JSON.stringify({ deleted: result.count, backupPath, remaining }, null, 2));
} finally {
  await prisma.$disconnect();
}
