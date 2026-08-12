/**
 * 品牌收敛：把历史遗留的「白衣天使」统一到「白衣印象」
 * - 迁移任务的 brandLibraryId（不触碰达人数据，达人通过 CreatorCampaignTask 关联任务）
 * - 归档旧品牌（status=archived，不删除，随时可恢复）
 * - 规整三品牌排序：蜀黍家 → 白衣印象 → 上岸达
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const LEGACY_SLUG = "baiyi-tianshi"; // 白衣天使（旧）
const TARGET_SLUG = "baiyi"; // 白衣印象（正）
const ORDER = [
  { slug: "shushujia", sortOrder: 1 },
  { slug: "baiyi", sortOrder: 2 },
  { slug: "shanganda", sortOrder: 3 },
];

try {
  const legacy = await prisma.brandLibrary.findUnique({ where: { slug: LEGACY_SLUG } });
  const target = await prisma.brandLibrary.findUnique({ where: { slug: TARGET_SLUG } });

  if (!target) {
    console.log("目标品牌「白衣印象」不存在，中止。");
  } else if (!legacy) {
    console.log("旧品牌「白衣天使」不存在，无需迁移。");
  } else {
    const moving = await prisma.campaignTask.findMany({
      where: { brandLibraryId: legacy.id },
      select: { id: true, name: true },
    });
    console.log(`待迁移任务 ${moving.length} 个：`, moving.map((t) => `[${t.id}]${t.name}`).join(", ") || "(无)");

    const moved = await prisma.campaignTask.updateMany({
      where: { brandLibraryId: legacy.id },
      data: { brandLibraryId: target.id },
    });
    console.log(`已迁移任务: ${moved.count} 个 -> 品牌[${target.id}]${target.name}`);

    const movedTpl = await prisma.creatorAudienceTemplate.updateMany({
      where: { brandLibraryId: legacy.id },
      data: { brandLibraryId: target.id },
    });
    console.log(`已迁移模板: ${movedTpl.count} 个`);

    await prisma.brandLibrary.update({ where: { id: legacy.id }, data: { status: "archived" } });
    console.log(`已归档旧品牌: [${legacy.id}] ${legacy.name} (status=archived，数据保留)`);
  }

  for (const o of ORDER) {
    const b = await prisma.brandLibrary.findUnique({ where: { slug: o.slug } });
    if (b) {
      await prisma.brandLibrary.update({ where: { id: b.id }, data: { sortOrder: o.sortOrder, status: "active" } });
      console.log(`排序: [${b.id}] ${b.name} -> sortOrder=${o.sortOrder}`);
    }
  }

  console.log("\n=== 修复后品牌列表（下拉可见的 active） ===");
  const actives = await prisma.brandLibrary.findMany({
    where: { status: "active" },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  for (const b of actives) {
    const tc = await prisma.campaignTask.count({ where: { brandLibraryId: b.id } });
    const pc = await prisma.creatorAudienceTemplate.count({ where: { brandLibraryId: b.id, isActive: true } });
    console.log(`  [${b.id}] ${b.name} (${b.slug})  任务${tc} 模板${pc}`);
  }
} catch (e) {
  console.error("ERR:", e.message);
} finally {
  await prisma.$disconnect();
}
