import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// 查廖宇靖、Lark灵、辞墨、露桐芊的完整作品样本
const targets = ["廖宇靖", "Lark灵", "辞墨", "颜值主播", "正本清源"];
const creators = await prisma.creator.findMany({
  where: { platform: "小红书", name: { in: targets } },
  include: { works: { take: 20 } },
});
for (const c of creators) {
  console.log(`\n===== ${c.name} (${c.externalId}) fans=${c.fans} =====`);
  console.log(`rejectReason: ${c.rejectReason}`);
  for (const w of c.works) {
    console.log(`  [${w.likeCount}赞] ${String(w.title || "").replace(/\n/g, " / ").slice(0, 120)}`);
  }
}
await prisma.$disconnect();
