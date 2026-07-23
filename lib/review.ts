export type ReviewCreator = {
  id: number;
  externalId: string;
  name: string;
  platform: string;
  profileUrl: string;
  category: string;
  screeningSummary: string;
  avgLikes: number;
  maxLikes: number;
  recentWorkCount: number;
  viralWorkCount: number;
  updatedAt: string;
};

type MiniPrismaClient = {
  creator: {
    findMany: (args: Record<string, unknown>) => Promise<any[]>;
  };
  $disconnect: () => Promise<void>;
};

async function getPrisma(): Promise<MiniPrismaClient> {
  const prismaModule = await new Function("specifier", "return import(specifier)")("@prisma/client");
  const PrismaClient = prismaModule.PrismaClient as new () => MiniPrismaClient;
  return new PrismaClient();
}

export async function getPendingReviewCreators(): Promise<ReviewCreator[]> {
  if (!process.env.DATABASE_URL) return [];

  const prisma = await getPrisma();
  try {
    const rows = await prisma.creator.findMany({
      where: { poolStatus: "pending_review" },
      orderBy: [{ updatedAt: "desc" }],
      take: 80
    });

    return rows.map((row) => ({
      id: row.id,
      externalId: row.externalId || String(row.id),
      name: row.name,
      platform: row.platform,
      profileUrl: row.profileUrl || "",
      category: row.category || "未分类",
      screeningSummary: row.screeningSummary || "",
      avgLikes: row.avgLikes || 0,
      maxLikes: row.maxLikes || 0,
      recentWorkCount: row.recentWorkCount || 0,
      viralWorkCount: row.viralWorkCount || 0,
      updatedAt: row.updatedAt.toISOString()
    }));
  } finally {
    await prisma.$disconnect();
  }
}
