import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const taskSpecs = [
  {
    name: "警校生通勤裤推广达人",
    productName: "警校生通勤裤",
    category: "服饰 / 通勤裤",
    targetAudience: "警校在校生、公安院校学生、警校毕业生，以及持续分享警校学习、训练和日常生活的个人创作者。",
    targetDescription: "寻找具有真实警校生身份或稳定警校内容标签的个人达人。内容应包含警校日常、训练体测、上课实习、宿舍生活、公安联考备考或毕业就业等场景。优先真人出镜、具备穿搭展示能力且稳定更新的中腰部或素人达人；排除招生培训机构、搬运号、新闻号、官方单位账号及仅偶尔提及警校的泛学生账号。",
    seedKeywords: ["警校生穿搭", "警校生日常", "公安院校日常", "警校训练日常", "警校女生"],
    excludeKeywords: ["警校培训", "招生咨询", "招警培训", "公安联考培训", "公考机构", "课程销售", "新闻搬运", "影视剪辑", "官方发布"],
    productSellingPoints: ["版型利落但不过度正式", "适合上课、实习和日常通勤", "活动方便，适合久坐和步行", "容易搭配衬衫、T恤和外套", "不宣传为警服或制式服装"],
    outreachTone: "年轻、自然、真诚，像同龄人交流；从达人具体的警校日常、训练或穿搭内容切入，不夸大身份，不使用官方指定、制服同款等表述。"
  },
  {
    name: "警察小熊玩偶推广达人",
    productName: "警察小熊玩偶",
    category: "玩偶 / 警校纪念礼物",
    targetAudience: "警校在校生、公安联考备考人群、警校毕业生、警属，以及分享警校生活和职业理想的年轻创作者。",
    targetDescription: "寻找具有警校身份、警校生活经历或稳定公安院校内容标签的个人达人。优先擅长宿舍生活、校园记录、礼物分享、开箱、桌面布置和情绪表达的创作者；排除官方单位、警务新闻号、培训机构、商品搬运号及无法确认警校关联的账号。",
    seedKeywords: ["警校宿舍", "警校礼物", "警校生日常", "警察小熊", "公安联考上岸"],
    excludeKeywords: ["警用品批发", "警用装备", "制服销售", "培训招生", "公安联考培训", "公考机构", "新闻搬运", "影视剪辑", "官方账号"],
    productSellingPoints: ["警校生活与成长经历的纪念", "适合作为入学、毕业、上岸或生日礼物", "适合宿舍、书桌和卧室布置", "强调陪伴感、仪式感和情绪价值", "不暗示官方授权或真实执法身份"],
    outreachTone: "温暖、轻松、有同龄感；结合达人的入学、训练、宿舍、联考或毕业内容，突出纪念和陪伴，不消费职业身份，不使用官方背书式表达。"
  }
];

try {
  const brand = await prisma.brandLibrary.findUnique({ where: { slug: "shushujia" } });
  if (!brand) throw new Error("未找到“蜀黍家”品牌库，请先运行品牌库初始化脚本。");
  const audienceTemplate = await prisma.creatorAudienceTemplate.findFirst({
    where: { brandLibraryId: brand.id, isActive: true, name: { contains: "警校" } },
    orderBy: { version: "desc" }
  });

  for (const spec of taskSpecs) {
    const existing = await prisma.campaignTask.findFirst({ where: { name: spec.name, productName: spec.productName } });
    const shared = {
      ...spec,
      platform: "抖音",
      status: "active",
      brandLibraryId: brand.id,
      audienceTemplateId: audienceTemplate?.id || null,
      audienceTemplateSnapshot: audienceTemplate?.template || undefined,
      defaultTargetFeaturedCount: 5,
      defaultMaxCollectedWorks: 20,
      defaultMaxAiCalls: 20,
      defaultMaxDurationMinutes: 30,
      defaultMaxNoGrowthRounds: 1,
      defaultMaxRounds: 2
    };
    const saved = existing
      ? await prisma.campaignTask.update({ where: { id: existing.id }, data: shared })
      : await prisma.campaignTask.create({ data: shared });
    console.log(`${existing ? "已更新" : "已创建"} #${saved.id} ${saved.name}`);
  }
} finally {
  await prisma.$disconnect();
}
