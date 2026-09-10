import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
// 去掉"警校"：红狐把该词匹配到《名侦探柯南》警校五人组/同人内容（run 55 第2轮 14 位候选全为柯南同人/小说推文/咨询号垃圾）
const t12 = await prisma.campaignTask.update({
  where: { id: 12 },
  data: {
    seedKeywords: ["警校生", "警院", "藏蓝青春", "警校生活", "警服穿搭", "警校训练", "警校宿舍", "警校穿搭", "刑警学院"],
  },
  select: { id: true, name: true, seedKeywords: true },
});
console.log("#12", t12.name, JSON.stringify(t12.seedKeywords));
await prisma.$disconnect();
