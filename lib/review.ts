import { prisma as prismaSingleton } from "./prisma";

export type ReviewCreator = {
  id: number;
  campaignTaskId?: number | null;
  campaignTaskName?: string;
  externalId: string;
  name: string;
  platform: string;
  profileUrl: string;
  category: string;
  poolStatus: string;
  screeningStatus: string;
  screeningSummary: string;
  avgLikes: number;
  maxLikes: number;
  recentWorkCount: number;
  viralWorkCount: number;
  sampleWorkCount: number;
  updatedAt: string;
};

type MiniPrismaClient = {
  creator: {
    findMany: (args: Record<string, unknown>) => Promise<any[]>;
  };
  campaignTask: {
    findUnique: (args: Record<string, unknown>) => Promise<any | null>;
  };
  creatorCampaignTask: {
    findMany: (args: Record<string, unknown>) => Promise<any[]>;
  };
  $disconnect: () => Promise<void>;
};

async function getPrisma(): Promise<MiniPrismaClient> {
  return prismaSingleton as unknown as MiniPrismaClient;
}

function splitTerms(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value || "").split(/[,，、\n]/))
        .map((item) => item.trim())
        .filter((item) => item.length >= 2)
    )
  );
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function taskTerms(task: any): string[] {
  if (!task) return [];
  return splitTerms([
    task.targetAudience || "",
    task.targetDescription || "",
    ...(Array.isArray(task.seedKeywords) ? task.seedKeywords : [])
  ]);
}

function taskExcludeTerms(task: any): string[] {
  if (!task) return [];
  return splitTerms(Array.isArray(task.excludeKeywords) ? task.excludeKeywords : []);
}

function creatorMatchesTask(row: any, terms: string[], excludeTerms: string[]): boolean {
  if (!terms.length) return false;
  const categoryText = normalizedText(row.category || "");
  const contentText = normalizedText(
    [
      row.name,
      row.screeningSummary || "",
      row.notes || ""
    ].join(" ")
  );
  const searchableText = normalizedText(
    [
      row.name,
      row.category || "",
      row.screeningSummary || "",
      row.notes || ""
    ].join(" ")
  );
  if (excludeTerms.some((term) => contentText.includes(normalizedText(term)))) return false;

  const matchedTerms = terms.filter((term) => searchableText.includes(normalizedText(term)));
  if (matchedTerms.length >= 2) return true;
  if (matchedTerms.some((term) => categoryText.includes(normalizedText(term)))) return true;

  return matchedTerms.some((term) => normalizedText(term).length >= 4);
}

function summaryForTask(summary: string, task: any): string {
  if (!task) return summary;
  const excludeTerms = taskExcludeTerms(task);
  const normalizedSummary = normalizedText(summary);
  const hasExcludedTaskTerms = excludeTerms.some((term) => normalizedSummary.includes(normalizedText(term)));
  if (!hasExcludedTaskTerms) return summary;

  return `已进入「${task.name || "当前品类任务"}」待复筛池，等待按当前任务重新抓取主页作品并复筛。`;
}

function normalizedQueuePoolStatus(poolStatus: string, screeningStatus: string): string {
  if (poolStatus === "candidate" && screeningStatus !== "portrait_passed") return "pending_review";
  return poolStatus;
}

function toReviewCreatorFromLink(row: any): ReviewCreator {
  const summary = row.screeningSummary || row.creator.screeningSummary || "";
  const screeningStatus = row.screeningStatus || row.creator.screeningStatus || "homepage_sample_pending";
  const poolStatus = normalizedQueuePoolStatus(row.poolStatus || row.creator.poolStatus || "pending_review", screeningStatus);
  return {
    id: row.creator.id,
    campaignTaskId: row.campaignTaskId,
    campaignTaskName: row.campaignTask?.name || "",
    externalId: row.creator.externalId || String(row.creator.id),
    name: row.creator.name,
    platform: row.creator.platform,
    profileUrl: row.creator.profileUrl || "",
    category: row.campaignTask?.category || row.creator.category || "未分类",
    poolStatus,
    screeningStatus,
    screeningSummary: summaryForTask(summary, row.campaignTask),
    avgLikes: row.creator.avgLikes || 0,
    maxLikes: row.creator.maxLikes || 0,
    recentWorkCount: row.creator.recentWorkCount || 0,
    viralWorkCount: row.creator.viralWorkCount || 0,
    sampleWorkCount: row.creator._count?.works || 0,
    updatedAt: row.updatedAt.toISOString()
  };
}

function toReviewCreatorFromGlobal(row: any, campaignTaskId: number | null = null, campaignTaskName = "", campaignTask: any = null): ReviewCreator {
  const summary = row.screeningSummary || "";
  const screeningStatus = row.screeningStatus || "homepage_sample_pending";
  const poolStatus = normalizedQueuePoolStatus(row.poolStatus || "pending_review", screeningStatus);
  return {
    id: row.id,
    campaignTaskId,
    campaignTaskName,
    externalId: row.externalId || String(row.id),
    name: row.name,
    platform: row.platform,
    profileUrl: row.profileUrl || "",
    category: campaignTask?.category || row.category || "未分类",
    poolStatus,
    screeningStatus,
    screeningSummary: summaryForTask(summary, campaignTask),
    avgLikes: row.avgLikes || 0,
    maxLikes: row.maxLikes || 0,
    recentWorkCount: row.recentWorkCount || 0,
    viralWorkCount: row.viralWorkCount || 0,
    sampleWorkCount: row._count?.works || 0,
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function getPendingReviewCreators(campaignTaskId?: number | null): Promise<ReviewCreator[]> {
  if (!process.env.DATABASE_URL) return [];

  const prisma = await getPrisma();
  try {
    if (campaignTaskId) {
      const [campaignTask, rows, globalRows] = await Promise.all([
        prisma.campaignTask.findUnique({
          where: { id: campaignTaskId }
        }),
        prisma.creatorCampaignTask.findMany({
          where: {
            campaignTaskId,
            poolStatus: { in: ["pending_review", "candidate"] }
          },
          include: {
            campaignTask: true,
            creator: {
              include: {
                _count: { select: { works: true } }
              }
            }
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 80
        }),
        prisma.creator.findMany({
          where: {
            poolStatus: { in: ["pending_review", "candidate"] },
            campaignTasks: {
              none: {
                campaignTaskId,
                poolStatus: { in: ["pending_review", "candidate"] }
              }
            }
          },
          include: {
            _count: { select: { works: true } }
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 120
        })
      ]);
      const linkedIds = new Set(rows.map((row) => row.creator.id));
      const terms = taskTerms(campaignTask);
      const excludeTerms = taskExcludeTerms(campaignTask);
      const inferredRows = globalRows
        .filter((row) => !linkedIds.has(row.id))
        .filter((row) => creatorMatchesTask(row, terms, excludeTerms))
        .slice(0, Math.max(0, 80 - rows.length));

      return [
        ...rows.map(toReviewCreatorFromLink),
        ...inferredRows.map((row) => toReviewCreatorFromGlobal(row, campaignTaskId, campaignTask?.name || "", campaignTask))
      ];
    }

    const rows = await prisma.creator.findMany({
        where: {
          poolStatus: { in: ["pending_review", "candidate"] }
        },
        include: {
          _count: { select: { works: true } }
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 80
      });

    return rows.map((row) => toReviewCreatorFromGlobal(row));
  } finally {
    // prisma singleton — do not disconnect
  }
}
