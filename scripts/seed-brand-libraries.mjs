import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const brands = [
    { name: "蜀黍家", slug: "shushujia", description: "警察小熊相关达人品牌库，覆盖警校生、辅警与基层公安赛道。", sortOrder: 10 },
    { name: "白衣天使", slug: "baiyi-tianshi", description: "医护小熊相关达人品牌库，覆盖医护、医学生与医院日常赛道。", sortOrder: 20 },
    { name: "上岸达", slug: "shanganda", description: "毕业生相关达人品牌库，后续承接毕业季、求职与职场新人赛道。", sortOrder: 30 }
  ];

  const saved = new Map();
  for (const brand of brands) {
    const row = await prisma.brandLibrary.upsert({ where: { slug: brand.slug }, update: brand, create: brand });
    saved.set(brand.slug, row);
  }

  await prisma.campaignTask.updateMany({ where: { id: 1 }, data: { brandLibraryId: saved.get("shushujia").id } });
  await prisma.campaignTask.updateMany({ where: { id: 2 }, data: { brandLibraryId: saved.get("baiyi-tianshi").id } });
  console.log("品牌库已初始化：蜀黍家、白衣天使、上岸达；现有任务归属已更新。");
} finally {
  await prisma.$disconnect();
}
