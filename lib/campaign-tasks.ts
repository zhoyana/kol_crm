export type CampaignTaskItem = {
  id: number;
  name: string;
  productName: string;
  category: string;
  targetAudience: string;
  targetDescription: string;
  seedKeywords: string[];
  excludeKeywords: string[];
  productSellingPoints: string[];
  outreachTone: string;
  status: string;
  ruleProfileId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignTaskInput = {
  name: string;
  productName: string;
  category?: string;
  targetAudience: string;
  targetDescription: string;
  seedKeywords: string[];
  excludeKeywords?: string[];
  productSellingPoints?: string[];
  outreachTone?: string;
  status?: string;
  ruleProfileId?: number | null;
};

type MiniPrismaClient = {
  campaignTask: {
    findMany: (args?: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
  };
  $disconnect: () => Promise<void>;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function cleanList(value: unknown, limit = 80): string[] {
  if (Array.isArray(value)) return asStringArray(value).slice(0, limit);
  if (typeof value !== "string") return [];
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function toCampaignTask(row: any): CampaignTaskItem {
  return {
    id: row.id,
    name: row.name || "",
    productName: row.productName || "",
    category: row.category || "",
    targetAudience: row.targetAudience || "",
    targetDescription: row.targetDescription || "",
    seedKeywords: asStringArray(row.seedKeywords),
    excludeKeywords: asStringArray(row.excludeKeywords),
    productSellingPoints: asStringArray(row.productSellingPoints),
    outreachTone: row.outreachTone || "",
    status: row.status || "active",
    ruleProfileId: row.ruleProfileId || null,
    createdAt: row.createdAt?.toISOString?.() || "",
    updatedAt: row.updatedAt?.toISOString?.() || ""
  };
}

async function getPrisma(): Promise<MiniPrismaClient> {
  const prismaModule = await new Function("specifier", "return import(specifier)")("@prisma/client");
  const PrismaClient = prismaModule.PrismaClient as new () => MiniPrismaClient;
  return new PrismaClient();
}

export function normalizeCampaignTaskInput(input: any): CampaignTaskInput {
  return {
    name: String(input?.name || "").trim(),
    productName: String(input?.productName || "").trim(),
    category: String(input?.category || "").trim(),
    targetAudience: String(input?.targetAudience || "").trim(),
    targetDescription: String(input?.targetDescription || "").trim(),
    seedKeywords: cleanList(input?.seedKeywords),
    excludeKeywords: cleanList(input?.excludeKeywords),
    productSellingPoints: cleanList(input?.productSellingPoints),
    outreachTone: String(input?.outreachTone || "").trim(),
    status: String(input?.status || "active").trim() || "active",
    ruleProfileId: input?.ruleProfileId ? Number(input.ruleProfileId) : null
  };
}

export function validateCampaignTaskInput(input: CampaignTaskInput): string | null {
  if (!input.name) return "任务名称不能为空。";
  if (!input.productName) return "推广产品不能为空。";
  if (!input.targetAudience) return "目标人群不能为空。";
  if (!input.targetDescription) return "筛选目标说明不能为空。";
  if (input.seedKeywords.length === 0) return "至少需要一个采集关键词。";
  return null;
}

export async function getCampaignTasks(): Promise<CampaignTaskItem[]> {
  if (!process.env.DATABASE_URL) return [];

  try {
    const prisma = await getPrisma();

    try {
      const rows = await prisma.campaignTask.findMany({
        orderBy: [{ updatedAt: "desc" }],
        take: 50
      });

      return rows.map(toCampaignTask);
    } finally {
      await prisma.$disconnect();
    }
  } catch {
    return [];
  }
}

export async function createCampaignTask(input: CampaignTaskInput): Promise<CampaignTaskItem> {
  const prisma = await getPrisma();

  try {
    const row = await prisma.campaignTask.create({
      data: {
        name: input.name,
        productName: input.productName,
        category: input.category || null,
        targetAudience: input.targetAudience,
        targetDescription: input.targetDescription,
        seedKeywords: input.seedKeywords,
        excludeKeywords: input.excludeKeywords || [],
        productSellingPoints: input.productSellingPoints || [],
        outreachTone: input.outreachTone || null,
        status: input.status || "active",
        ruleProfileId: input.ruleProfileId || null
      }
    });

    return toCampaignTask(row);
  } finally {
    await prisma.$disconnect();
  }
}
