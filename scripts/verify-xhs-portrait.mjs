import { PrismaClient } from "@prisma/client";
import { evaluateXhsCreatorPortrait } from "../lib/xhs-portrait.ts";

const prisma = new PrismaClient();
const task = await prisma.campaignTask.findUnique({ where: { id: 12 } });
if (!task) throw new Error("任务 12 不存在");

console.log("DEEPSEEK_API_KEY 配置：", process.env.DEEPSEEK_API_KEY ? "已配置" : "未配置");

console.log("\n========== A. 任务 12 真实达人画像复评（10 位，消耗 AI 调用） ==========");
const links = await prisma.creatorCampaignTask.findMany({
  where: { campaignTaskId: 12 },
  include: { creator: { select: { id: true, externalId: true, name: true, fans: true } } }
});
for (const l of links) {
  const works = await prisma.creatorWork.findMany({ where: { creatorId: l.creator.id } });
  const result = await evaluateXhsCreatorPortrait({
    name: l.creator.name,
    fans: Number(l.creator.fans || 0),
    works: works.map((w) => ({ title: String(w.title || "") })),
    task: task
  });
  console.log(`[${result.poolStatus}/${result.screeningStatus}] ${l.creator.name} (${l.creator.externalId}) fans=${l.creator.fans} works=${works.length}`);
  console.log(`    ${result.screeningSummary}`);
}

console.log("\n========== B. 合成正向样本（真实警校生，验证不误杀） ==========");
const positives = [
  { name: "小陆的警校日记", fans: 3200, works: [{ title: "今天警校训练完累瘫了，宿舍躺平的一天 #警校生 #日常" }, { title: "警校食堂开饭啦，十块钱吃撑 #警校生活" }] },
  { name: "公大在读小李", fans: 15000, works: [{ title: "中国人民公安大学的食堂，比想象中好吃 #公安大学 #校园生活" }, { title: "公安大学通勤穿搭，藏蓝是我的幸运色 #公大 #警服穿搭" }] },
  { name: "阿泽的藏蓝青春", fans: 8900, works: [{ title: "警校生早操日常，天没亮就集合，冷死我了 #警校生 #早操 #藏蓝青春" }] },
  { name: "某某警校大三", fans: 4300, works: [{ title: "警校生的体测周，八百米跑完人没了 #警校生 #体测" }] }
];
for (const p of positives) {
  const result = await evaluateXhsCreatorPortrait({ ...p, task });
  console.log(`[${result.poolStatus}] ${p.name} fans=${p.fans} works=${p.works.length}`);
  console.log(`    ${result.screeningSummary}`);
}

console.log("\n========== C. 合成负向样本（标签党/媒体/辅导，验证不误放） ==========");
const negatives = [
  { name: "影视剪辑君", fans: 50000, works: [{ title: "警校生高燃混剪！看得热血沸腾 #警校生 #混剪" }] },
  { name: "XX警校考研辅导", fans: 12000, works: [{ title: "警校考研一对一辅导，带你上岸 #警校考研" }] },
  { name: "快乐小饼干", fans: 3000, works: [{ title: "躲猫猫游戏新地图，太刺激了 #警校生 #steam游戏" }] },
  { name: "潮流前线", fans: 80000, works: [{ title: "X战警里最帅的镜头 #警校生 #电影" }] }
];
for (const n of negatives) {
  const result = await evaluateXhsCreatorPortrait({ ...n, task });
  console.log(`[${result.poolStatus}] ${n.name} fans=${n.fans} works=${n.works.length}`);
  console.log(`    ${result.screeningSummary}`);
}

await prisma.$disconnect();
console.log("\n验证完成");
