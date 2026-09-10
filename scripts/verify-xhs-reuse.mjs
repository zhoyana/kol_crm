import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VERIFY_TASK_NAME = '蜀黍家-小红书(验证)';

async function main() {
  // 蜀黍家品牌 + 模板（平台无关，可直接复用）
  const brand = await prisma.brandLibrary.findFirst({ where: { slug: 'shushujia' } });
  const tpl = await prisma.creatorAudienceTemplate.findFirst({ where: { brandLibraryId: brand.id } });
  console.log('蜀黍家 brand id =', brand.id, '| 模板 id =', tpl.id);
  console.log('模板 platform 无关字段 targetAudience =', tpl.template?.targetAudience);

  // 幂等：先清掉上次验证残留（任务 + 关联 + 测试达人），再建新的
  const prev = await prisma.campaignTask.findFirst({ where: { name: VERIFY_TASK_NAME } });
  if (prev) {
    await prisma.creatorCampaignTask.deleteMany({ where: { campaignTaskId: prev.id } });
    await prisma.campaignTask.delete({ where: { id: prev.id } });
    await prisma.creator.deleteMany({ where: { externalId: { in: ['xhs-verify-1', 'xhs-verify-2'] } } });
    console.log('已清理上次验证残留 task id =', prev.id);
  }

  // 1) 复用蜀黍家模板，建一个小红书平台任务（平台维度独立于品牌）
  const task = await prisma.campaignTask.create({
    data: {
      name: VERIFY_TASK_NAME,
      productName: '测试产品',
      category: '警校',
      targetAudience: tpl.template.targetAudience,
      targetDescription: tpl.template.targetDescription,
      seedKeywords: tpl.template.discovery?.primaryTerms || [],
      excludeKeywords: tpl.template.discovery?.excludeTerms || [],
      productSellingPoints: [],
      status: 'active',
      platform: '小红书',
      brandLibraryId: brand.id,
      audienceTemplateId: tpl.id,
      audienceTemplateSnapshot: tpl.template
    }
  });
  console.log('已建小红书任务 id =', task.id, '| platform =', task.platform);

  // 2) 导入两个小红书示例达人并关联到该任务（平台隔离的关键：按 campaignTaskId 关联）
  const samples = [
    { externalId: 'xhs-verify-1', name: '小红书警校生A', platform: '小红书', category: '警校', fans: 50000, plays: [] },
    { externalId: 'xhs-verify-2', name: '小红书日常B', platform: '小红书', category: '生活', fans: 30000, plays: [] }
  ];
  for (const s of samples) {
    const u = await prisma.creator.upsert({ where: { externalId: s.externalId }, update: s, create: s });
    await prisma.creatorCampaignTask.upsert({
      where: { creatorId_campaignTaskId: { creatorId: u.id, campaignTaskId: task.id } },
      update: {},
      create: { creatorId: u.id, campaignTaskId: task.id }
    });
  }
  console.log('已导入并关联 2 个小红书达人');

  // 3) 查询该任务的达人，验证平台隔离（任务 platform 与关联达人 platform 一致、无跨平台混入）
  const linked = await prisma.creatorCampaignTask.findMany({
    where: { campaignTaskId: task.id },
    include: { creator: true }
  });
  console.log('--- 小红书任务关联的达人 ---');
  const platforms = new Set();
  for (const l of linked) {
    console.log(`  ${l.creator.name} | platform=${l.creator.platform}`);
    platforms.add(l.creator.platform);
  }
  const taskOk = task.platform === '小红书';
  const linkedOk = platforms.size === 1 && platforms.has('小红书');
  const ok = taskOk && linkedOk;
  console.log(ok
    ? '\nPASS: 任务 platform=小红书 且关联达人均为小红书，跨平台未混淆'
    : '\nFAIL: 出现平台不一致或跨平台混入');

  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
