import { evaluateXhsCreatorPortrait } from "../lib/xhs-portrait.ts";
import { prisma } from "../lib/prisma.ts";

const task = await prisma.campaignTask.findUnique({
  where: { id: 12 },
  select: { name: true, targetAudience: true, targetDescription: true, seedKeywords: true, excludeKeywords: true, productName: true, audienceTemplateId: true, audienceTemplateSnapshot: true },
});

const targets = ["廖宇靖", "Lark灵", "辞墨", "老段修模", "正本清源"];
const creators = await prisma.creator.findMany({
  where: { platform: "小红书", name: { in: targets } },
  include: { works: { take: 20 } },
});
// 按目标顺序输出
for (const name of targets) {
  const c = creators.find((x) => x.name === name);
  if (!c) { console.log(`\n[${name}] 未找到`); continue; }
  console.log(`\n===== ${name} (fans=${c.fans}) 样本${c.works.length}篇 =====`);
  const result = await evaluateXhsCreatorPortrait({
    name: c.name,
    fans: c.fans,
    works: c.works.map((w) => ({ title: w.title || "" })),
    task: task,
  });
  console.log(`  结果: ${result.ok ? "✅ 放行 candidate" : "❌ 拒绝 rejected"}`);
  console.log(`  原因: ${result.reason}`);
}
await prisma.$disconnect();
