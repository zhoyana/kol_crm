import { readFile } from "node:fs/promises";
import path from "node:path";
import { csvRowsToObjects, numberValue } from "./csv";
import { prisma as prismaSingleton } from "./prisma";

export type CreatorPoolStatus = "pending_review" | "candidate" | "featured" | "skipped" | "rejected" | string;

export type Creator = {
  id: string;
  campaignTaskId?: number | null;
  campaignTaskName?: string;
  name: string;
  platform: string;
  profileUrl: string;
  fans: number;
  plays: number[];
  quote: number | null;
  outreachStatus: string;
  cooperationStatus: string;
  category: string;
  contact: string;
  notes: string;
  poolStatus: CreatorPoolStatus;
  screeningStatus: string;
  screeningSummary: string;
  poolUpdatedAt?: string;
  avgPlay: number;
  stablePlay: number;
  currentCpm: number | null;
  suggestedPrice: number;
};

export type OutreachTask = {
  creator: Creator;
  kind: "initial" | "followup" | "negotiate";
  title: string;
  reason: string;
  action: string;
};

export type OutreachLogItem = {
  id: number;
  action: string;
  content: string;
  oldStatus: string;
  newStatus: string;
  createdAt: string;
};

type MiniPrismaClient = {
  creator: {
    findMany: (args?: any) => Promise<any[]>;
    findFirst: (args: any) => Promise<any | null>;
  };
  creatorCampaignTask: {
    findMany: (args?: any) => Promise<any[]>;
  };
  $disconnect: () => Promise<void>;
};

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function isPending(status: string): boolean {
  return status !== "已建联";
}

function isContacted(status: string): boolean {
  return status === "已建联";
}

function pick(record: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]?.trim();
    if (value) return value;
  }
  return "";
}

function normalizePlays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => numberValue(String(item))).filter((item) => item > 0);
}

export function normalizeOutreachStatus(value: unknown): "未建联" | "已建联" {
  const status = String(value || "").trim();
  return ["已建联", "需跟进", "已回复", "报价中", "确定合作", "已拒绝", "已放弃", "发送中"].includes(status) ? "已建联" : "未建联";
}

function buildCreator(input: {
  id: string;
  name: string;
  platform: string;
  profileUrl: string;
  fans: number;
  plays: number[];
  quote: number | null;
  outreachStatus: string;
  cooperationStatus: string;
  category: string;
  contact: string;
  notes: string;
  poolStatus?: CreatorPoolStatus;
  screeningStatus?: string;
  screeningSummary?: string;
  campaignTaskId?: number | null;
  campaignTaskName?: string;
  poolUpdatedAt?: string;
}): Creator {
  const stablePlay = median(input.plays);
  const avgPlay = input.plays.length ? Math.round(input.plays.reduce((sum, item) => sum + item, 0) / input.plays.length) : 0;
  const currentCpm = input.quote && stablePlay ? Number(((input.quote / stablePlay) * 1000).toFixed(1)) : null;
  const suggestedPrice = Math.round((stablePlay / 1000) * 15);

  return {
    ...input,
    outreachStatus: normalizeOutreachStatus(input.outreachStatus),
    campaignTaskId: input.campaignTaskId || null,
    campaignTaskName: input.campaignTaskName || "",
    poolStatus: input.poolStatus || "candidate",
    screeningStatus: input.screeningStatus || "",
    screeningSummary: input.screeningSummary || "",
    avgPlay,
    stablePlay,
    currentCpm,
    suggestedPrice
  };
}

async function getPrisma(): Promise<MiniPrismaClient> {
  return prismaSingleton as unknown as MiniPrismaClient;
}

export async function getCreators(campaignTaskId?: number | null): Promise<Creator[]> {
  const databaseCreators = await getCreatorsFromDatabase(campaignTaskId);
  if (databaseCreators.length > 0) return databaseCreators;

  return getCreatorsFromCsv();
}

async function getCreatorsFromDatabase(campaignTaskId?: number | null): Promise<Creator[]> {
  if (!process.env.DATABASE_URL) return [];

  try {
    const prisma = await getPrisma();

    try {
      if (campaignTaskId) {
        const rows = await prisma.creatorCampaignTask.findMany({
          where: {
            campaignTaskId,
            poolStatus: { in: ["pending_review", "candidate", "featured", "skipped"] }
          },
          include: {
            campaignTask: true,
            creator: true
          },
          orderBy: [{ poolStatus: "asc" }, { updatedAt: "desc" }]
        });

        return rows.map((row: any) =>
          buildCreator({
            id: row.creator.externalId || String(row.creator.id),
            campaignTaskId: row.campaignTaskId,
            campaignTaskName: row.campaignTask?.name || "",
            name: row.creator.name,
            platform: row.creator.platform,
            profileUrl: row.creator.profileUrl || "",
            fans: row.creator.fans,
            plays: normalizePlays(row.creator.plays),
            quote: row.creator.quote,
            outreachStatus: row.outreachStatus || "未建联",
            cooperationStatus: row.creator.cooperationStatus || "-",
            category: row.campaignTask?.category || row.creator.category || "未分类",
            contact: row.creator.contact || "-",
            notes: row.notes || row.creator.notes || "",
            poolStatus: row.poolStatus || row.creator.poolStatus || "candidate",
            screeningStatus: row.screeningStatus || row.creator.screeningStatus || "",
            screeningSummary: row.screeningSummary || row.creator.screeningSummary || "",
            poolUpdatedAt: row.updatedAt?.toISOString?.() || ""
          })
        );
      }

      const rows = await prisma.creator.findMany({
        where: {
          poolStatus: { in: ["pending_review", "candidate", "featured", "skipped"] }
        },
        orderBy: [{ poolStatus: "asc" }, { outreachStatus: "asc" }, { fans: "desc" }]
      });

      return rows.map((row: any) =>
        buildCreator({
          id: row.externalId || String(row.id),
          campaignTaskId: null,
          campaignTaskName: "",
          name: row.name,
          platform: row.platform,
          profileUrl: row.profileUrl || "",
          fans: row.fans,
          plays: normalizePlays(row.plays),
          quote: row.quote,
          outreachStatus: row.outreachStatus || "未建联",
          cooperationStatus: row.cooperationStatus || "-",
          category: row.category || "未分类",
          contact: row.contact || "-",
          notes: row.notes || "",
          poolStatus: row.poolStatus || "candidate",
          screeningStatus: row.screeningStatus || "",
          screeningSummary: row.screeningSummary || "",
          poolUpdatedAt: row.updatedAt?.toISOString?.() || ""
        })
      );
    } finally {
      // prisma singleton — do not disconnect
    }
  } catch {
    return [];
  }
}

async function getCreatorsFromCsv(): Promise<Creator[]> {
  const filePath = path.join(process.cwd(), "data", "creators.csv");
  const csv = await readFile(filePath, "utf8");
  const records = csvRowsToObjects(csv);

  return records.map((record, index) => {
    const plays = [1, 2, 3, 4, 5]
      .map((item) => numberValue(pick(record, [`播放${item}`, `播放量${item}`, `play${item}`])))
      .filter((value) => value > 0);

    return buildCreator({
      id: pick(record, ["达人ID", "externalId", "external_id", "id"]) || String(index + 1),
      name: pick(record, ["达人昵称", "昵称", "name", "creator_name"]) || "未命名达人",
      platform: pick(record, ["平台", "platform"]) || "抖音",
      profileUrl: pick(record, ["主页链接", "主页", "profileUrl", "profile_url"]),
      fans: numberValue(pick(record, ["粉丝数", "粉丝", "fans"])),
      plays,
      quote: numberValue(pick(record, ["报价", "quote", "price"])) || null,
      outreachStatus: pick(record, ["建联状态", "状态", "outreachStatus", "outreach_status"]) || "未建联",
      cooperationStatus: pick(record, ["合作状态", "确定合作", "cooperationStatus", "cooperation_status"]) || "-",
      category: pick(record, ["类目", "分类", "category"]) || "未分类",
      contact: pick(record, ["联系方式", "微信联系方式", "微信", "contact"]) || "-",
      notes: pick(record, ["备注", "沟通记录", "notes"]),
      poolStatus: pick(record, ["库类型", "poolStatus", "pool_status"]) || "candidate"
    });
  });
}

export async function getCreatorById(id: string): Promise<Creator | undefined> {
  const creators = await getCreators();
  return creators.find((creator) => creator.id === id);
}

export async function getOutreachLogsByCreatorId(id: string): Promise<OutreachLogItem[]> {
  if (!process.env.DATABASE_URL) return [];

  try {
    const prisma = await getPrisma();
    const numericId = Number(id);

    try {
      const creator = await prisma.creator.findFirst({
        where: {
          OR: [{ externalId: id }, ...(Number.isInteger(numericId) ? [{ id: numericId }] : [])]
        },
        include: {
          outreachLogs: {
            orderBy: { createdAt: "desc" }
          }
        }
      });

      return (
        creator?.outreachLogs.map((log: any) => ({
          id: log.id,
          action: log.action,
          content: log.content || "",
          oldStatus: log.oldStatus || "-",
          newStatus: log.newStatus || "-",
          createdAt: log.createdAt.toISOString()
        })) ?? []
      );
    } finally {
      // prisma singleton — do not disconnect
    }
  } catch {
    return [];
  }
}

export function getOutreachTasks(creators: Creator[]): OutreachTask[] {
  const tasks: OutreachTask[] = [];
  const featuredCreators = creators.filter((creator) => creator.poolStatus === "featured");

  for (const creator of featuredCreators) {
    if (isPending(creator.outreachStatus)) {
      tasks.push({
        creator,
        kind: "initial",
        title: "初次建联",
        reason: "尚未建立联系",
        action: "发送初次建联话术"
      });
      continue;
    }

    if (creator.currentCpm && creator.currentCpm > 20 && !creator.cooperationStatus.includes("拒绝")) {
      tasks.push({
        creator,
        kind: "negotiate",
        title: "报价谈判",
        reason: `当前 CPM ${creator.currentCpm}，高于目标 CPM 15`,
        action: "用建议报价作为谈价锚点"
      });
      continue;
    }

    if (isContacted(creator.outreachStatus) && !creator.cooperationStatus.includes("确定") && !creator.cooperationStatus.includes("拒绝")) {
      tasks.push({
        creator,
        kind: "followup",
        title: "二次跟进",
        reason: "已建联但合作状态未确认",
        action: "跟进档期、报价或合作意向"
      });
    }
  }

  return tasks.sort((a, b) => {
    const kindScore = { initial: 3, negotiate: 2, followup: 1 };
    return (
      kindScore[b.kind] - kindScore[a.kind] ||
      b.creator.stablePlay - a.creator.stablePlay
    );
  });
}

export function generateOutreachScript(creator: Creator): string {
  const avgPlayText = creator.avgPlay >= 10000 ? `${(creator.avgPlay / 10000).toFixed(1)}万` : `${creator.avgPlay}`;
  const suggestedPriceText = formatNumber(creator.suggestedPrice);

  if (creator.stablePlay >= 50000) {
    return [
      "您好，我是负责达人合作的小李。",
      `看到您的账号内容质量和数据都比较稳定，平均播放大概 ${avgPlayText}，和我们想合作的方向比较契合。`,
      "我们想了解一下近期短视频合作报价和档期，合作形式可以是内容植入、口播或场景化种草。",
      `我们根据稳定播放量预估的合作预算大概在 ¥${suggestedPriceText} 左右，具体也想听听您这边的报价。`,
      "方便加个微信进一步沟通吗？"
    ].join("\n\n");
  }

  return [
    "您好，关注到您的内容数据还不错，想了解一下近期有没有商务合作档期。",
    "我们在筛选一批适合做内容种草的达人，想先了解一下您的短视频合作报价。",
    "方便的话可以发一下报价和合作形式吗？"
  ].join("\n\n");
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}
