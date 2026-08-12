import { DEFAULT_AGENT_GOAL, normalizeAgentGoal, type AgentGoal } from "@/lib/agent-goals";
import { prisma as prismaSingleton } from "./prisma";

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
  brandLibraryId: number | null;
  brandLibrary: BrandLibraryItem | null;
  audienceTemplateId: number | null;
  audienceTemplateName: string | null;
  audienceTemplateSnapshot?: unknown;
  agentGoalDefaults: AgentGoal;
  createdAt: string;
  updatedAt: string;
};

export type BrandLibraryItem = {
  id: number;
  name: string;
  slug: string;
  description: string;
  status: string;
  sortOrder: number;
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
  brandLibraryId?: number | null;
  /** 绑定的固定达人模板（品牌 → 人群模板 → 任务）。设置后核心筛选规则由模板决定 */
  audienceTemplateId?: number | null;
  /** 允许的少量补充关键词（合并进 seedKeywords） */
  extraSeedKeywords?: string[];
  /** 允许的少量补充排除词（合并进 excludeKeywords） */
  extraExcludeKeywords?: string[];
};

type MiniPrismaClient = {
  campaignTask: {
    findMany: (args?: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  brandLibrary: {
    findMany: (args?: any) => Promise<any[]>;
  };
  creatorAudienceTemplate: {
    findUnique: (args: any) => Promise<any>;
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
    brandLibraryId: row.brandLibraryId || null,
    audienceTemplateId: row.audienceTemplateId || null,
    audienceTemplateName: row.audienceTemplate?.name || null,
    audienceTemplateSnapshot: row.audienceTemplateSnapshot ?? null,
    brandLibrary: row.brandLibrary ? {
      id: row.brandLibrary.id,
      name: row.brandLibrary.name || "",
      slug: row.brandLibrary.slug || "",
      description: row.brandLibrary.description || "",
      status: row.brandLibrary.status || "active",
      sortOrder: Number(row.brandLibrary.sortOrder || 0)
    } : null,
    agentGoalDefaults: normalizeAgentGoal({
      targetFeaturedCount: row.defaultTargetFeaturedCount,
      maxCollectedWorks: row.defaultMaxCollectedWorks,
      maxAiCalls: row.defaultMaxAiCalls,
      maxDurationMinutes: row.defaultMaxDurationMinutes,
      maxNoGrowthRounds: row.defaultMaxNoGrowthRounds,
      maxRounds: row.defaultMaxRounds
    }),
    createdAt: row.createdAt?.toISOString?.() || "",
    updatedAt: row.updatedAt?.toISOString?.() || ""
  };
}

async function getPrisma(): Promise<MiniPrismaClient> {
  return prismaSingleton as unknown as MiniPrismaClient;
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
    ruleProfileId: input?.ruleProfileId ? Number(input.ruleProfileId) : null,
    brandLibraryId: input?.brandLibraryId ? Number(input.brandLibraryId) : null,
    audienceTemplateId: input?.audienceTemplateId ? Number(input.audienceTemplateId) : null,
    extraSeedKeywords: cleanList(input?.extraSeedKeywords),
    extraExcludeKeywords: cleanList(input?.extraExcludeKeywords)
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
        include: { brandLibrary: true, audienceTemplate: true },
        orderBy: [{ updatedAt: "desc" }],
        take: 50
      });

      return rows.map(toCampaignTask);
    } finally {
      // prisma singleton — do not disconnect
    }
  } catch {
    return [];
  }
}

export async function getBrandLibraries(): Promise<BrandLibraryItem[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const prisma = await getPrisma();
    try {
      const rows = await prisma.brandLibrary.findMany({
        where: { status: "active" },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
      });
      return rows.map((row: any) => ({
        id: row.id,
        name: row.name || "",
        slug: row.slug || "",
        description: row.description || "",
        status: row.status || "active",
        sortOrder: Number(row.sortOrder || 0)
      }));
    } finally {
      // prisma singleton — do not disconnect
    }
  } catch {
    return [];
  }
}

function uniqueTerms(...lists: (string[] | undefined)[]): string[] {
  const out = new Set<string>();
  for (const list of lists) {
    for (const item of (list || [])) {
      const t = String(item || "").trim();
      if (t) out.add(t);
    }
  }
  return Array.from(out);
}

/**
 * 当任务绑定了固定达人模板时，核心筛选规则由模板决定（服务端权威，前端不可篡改）：
 * 关键词/排除词/目标描述均来自模板快照，仅允许合并少量补充关键词。
 */
async function resolveTemplateOverrides(prisma: MiniPrismaClient, input: CampaignTaskInput): Promise<{
  targetAudience: string;
  targetDescription: string;
  seedKeywords: string[];
  excludeKeywords: string[];
  audienceTemplateId: number | null;
  audienceTemplateSnapshot: unknown;
}> {
  if (!input.audienceTemplateId) {
    return {
      targetAudience: input.targetAudience,
      targetDescription: input.targetDescription,
      seedKeywords: input.seedKeywords,
      excludeKeywords: input.excludeKeywords || [],
      audienceTemplateId: null,
      audienceTemplateSnapshot: undefined
    };
  }

  const template = await prisma.creatorAudienceTemplate.findUnique({ where: { id: input.audienceTemplateId } });
  if (!template) {
    // 模板不存在则回退到表单输入
    return {
      targetAudience: input.targetAudience,
      targetDescription: input.targetDescription,
      seedKeywords: input.seedKeywords,
      excludeKeywords: input.excludeKeywords || [],
      audienceTemplateId: null,
      audienceTemplateSnapshot: undefined
    };
  }

  const tpl = (template.template && typeof template.template === "object" ? template.template : {}) as any;
  const discovery = tpl.discovery || {};
  return {
    targetAudience: String(tpl.targetAudience || input.targetAudience || "").trim() || input.targetAudience,
    targetDescription: String(tpl.targetDescription || input.targetDescription || "").trim() || input.targetDescription,
    seedKeywords: uniqueTerms(discovery.primaryTerms, discovery.supportTerms, input.extraSeedKeywords),
    excludeKeywords: uniqueTerms(discovery.excludeTerms, input.extraExcludeKeywords),
    audienceTemplateId: template.id,
    audienceTemplateSnapshot: tpl
  };
}

export async function createCampaignTask(input: CampaignTaskInput): Promise<CampaignTaskItem> {
  const prisma = await getPrisma();

  try {
    const overrides = await resolveTemplateOverrides(prisma, input);

    const row = await prisma.campaignTask.create({
      data: {
        name: input.name,
        productName: input.productName,
        category: input.category || null,
        targetAudience: overrides.targetAudience,
        targetDescription: overrides.targetDescription,
        seedKeywords: overrides.seedKeywords,
        excludeKeywords: overrides.excludeKeywords,
        productSellingPoints: input.productSellingPoints || [],
        outreachTone: input.outreachTone || null,
        status: input.status || "active",
        ruleProfileId: input.ruleProfileId || null,
        brandLibraryId: input.brandLibraryId || null,
        audienceTemplateId: overrides.audienceTemplateId,
        audienceTemplateSnapshot: overrides.audienceTemplateSnapshot
      },
      include: { brandLibrary: true, audienceTemplate: true }
    });

    return toCampaignTask(row);
  } finally {
    // prisma singleton — do not disconnect
  }
}

export async function updateCampaignTaskAgentGoal(id: number, value: unknown): Promise<CampaignTaskItem> {
  const goal = normalizeAgentGoal(value, DEFAULT_AGENT_GOAL);
  const prisma = await getPrisma();
  try {
    const row = await prisma.campaignTask.update({
      where: { id },
      data: {
        defaultTargetFeaturedCount: goal.targetFeaturedCount,
        defaultMaxCollectedWorks: goal.maxCollectedWorks,
        defaultMaxAiCalls: goal.maxAiCalls,
        defaultMaxDurationMinutes: goal.maxDurationMinutes,
        defaultMaxNoGrowthRounds: goal.maxNoGrowthRounds,
        defaultMaxRounds: goal.maxRounds
      },
      include: { brandLibrary: true }
    });
    return toCampaignTask(row);
  } finally {
    // prisma singleton — do not disconnect
  }
}
