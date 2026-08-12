import { prisma as prismaSingleton } from "./prisma";

export type ScreeningRuleProfileItem = {
  id: number;
  name: string;
  category: string;
  targetDescription: string;
  primaryTerms: string[];
  supportTerms: string[];
  excludeTerms: string[];
  minLikeCount: number;
  publishWindowDays: number;
  sortType: string;
  notes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ScreeningRuleProfileInput = {
  name: string;
  category?: string;
  targetDescription: string;
  primaryTerms: string[];
  supportTerms: string[];
  excludeTerms: string[];
  minLikeCount?: number;
  publishWindowDays?: number;
  sortType?: string;
  notes?: string;
};

type MiniPrismaClient = {
  screeningRuleProfile: {
    findMany: (args?: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
  };
  agentMemory: {
    findMany: (args?: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
  };
  creatorFeedback: {
    create: (args: any) => Promise<any>;
  };
  $disconnect: () => Promise<void>;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function toRuleProfile(row: any): ScreeningRuleProfileItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category || "",
    targetDescription: row.targetDescription || "",
    primaryTerms: asStringArray(row.primaryTerms),
    supportTerms: asStringArray(row.supportTerms),
    excludeTerms: asStringArray(row.excludeTerms),
    minLikeCount: row.minLikeCount || 500,
    publishWindowDays: row.publishWindowDays || 180,
    sortType: row.sortType || "comprehensive",
    notes: row.notes || "",
    isActive: Boolean(row.isActive),
    createdAt: row.createdAt?.toISOString?.() || "",
    updatedAt: row.updatedAt?.toISOString?.() || ""
  };
}

async function getPrisma(): Promise<MiniPrismaClient> {
  return prismaSingleton as unknown as MiniPrismaClient;
}

export async function getRuleProfiles(): Promise<ScreeningRuleProfileItem[]> {
  if (!process.env.DATABASE_URL) return [];

  try {
    const prisma = await getPrisma();

    try {
      const rows = await prisma.screeningRuleProfile.findMany({
        orderBy: [{ updatedAt: "desc" }],
        take: 20
      });

      return rows.map(toRuleProfile);
    } finally {
      // prisma singleton — do not disconnect
    }
  } catch {
    return [];
  }
}

export async function createRuleProfile(input: ScreeningRuleProfileInput): Promise<ScreeningRuleProfileItem> {
  const prisma = await getPrisma();

  try {
    const row = await prisma.screeningRuleProfile.create({
      data: {
        name: input.name.trim(),
        category: input.category?.trim() || null,
        targetDescription: input.targetDescription.trim(),
        primaryTerms: input.primaryTerms,
        supportTerms: input.supportTerms,
        excludeTerms: input.excludeTerms,
        minLikeCount: input.minLikeCount || 500,
        publishWindowDays: input.publishWindowDays || 180,
        sortType: input.sortType || "comprehensive",
        notes: input.notes?.trim() || null
      }
    });

    return toRuleProfile(row);
  } finally {
    await prisma.$disconnect();
  }
}

