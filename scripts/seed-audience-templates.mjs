// 种子脚本：创建三品牌 BrandLibrary + 三套固定达人模板（CreatorAudienceTemplate）
// 并把历史「警察小熊 / 医护小熊」任务绑定到对应模板（回填快照）。
// 运行：node scripts/seed-audience-templates.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ---------- 三套模板（结构与 DiscoveryRuleTemplate 完全一致） ----------
const SHUSHUJIA_TEMPLATE = {
  id: "shushujia-police",
  version: 2,
  name: "蜀黍家·警校/公安达人模板",
  matchTerms: ["蜀黍家", "警察小熊", "警校", "警校生", "公安院校", "公安大学", "警院", "藏蓝青春", "警服", "辅警", "公安", "民警"],
  targetAudience: "真实在职辅警、基层公安民警、警校生或公安院校在读学生个人账号",
  targetDescription: "持续分享本人工作/学习日常与真实生活内容",
  discovery: {
    primaryTerms: ["辅警日常", "基层民警日常", "警校生日常", "藏蓝青春", "警服穿搭", "派出所日常", "执勤日常", "警校训练"],
    supportTerms: ["辅警", "公安", "民警", "警校生", "警校", "公安院校", "基层派出所", "执勤", "训练", "制服", "日常", "通勤", "值班"],
    excludeTerms: ["公安联考培训", "招警培训", "辅警培训", "报考指导", "官方账号", "政务号", "媒体号", "案件解说", "普法栏目", "反诈宣传", "执法办案"]
  },
  candidateScreen: {
    instructions: [
      "本轮使用蜀黍家警校/公安达人模板。",
      "keep：有多条真实在职辅警、基层民警、警校生或公安院校学生本人日常线索。",
      "maybe：存在辅警/公安/警校身份、校园、宿舍、训练、制服或藏蓝青春线索，但当前样本不足。",
      "drop：明显为官方媒体、招警/辅警培训、公安联考咨询、案件新闻解说、纯普法科普、政务号或MCN警察IP账号。",
      "辅警/民警偶尔发执勤或工作内容不等于官方宣传号；只要有稳定的本人真实日常和个人生活表达就保留。",
      "警校生发上岸经验不等于培训号；有本人校园生活线索时保留。",
      "这里只做低成本初筛，证据不足时判 maybe，交给主页复筛。"
    ],
    identityTerms: ["辅警", "民警", "公安", "警校生", "警校", "公安院校", "执勤", "值班", "警号", "工作证", "学生证", "藏蓝青春"],
    obviousMismatchTerms: ["医学生", "护士", "护理学生", "医院日常", "驾校", "房产中介", "汽车销售"],
    hardDropTerms: ["报考培训", "招生机构", "公安联考培训", "官方媒体", "案件新闻号", "普法机构", "政务号", "媒体号", "反诈宣传", "执法办案", "MCN警察IP"],
    minSampleLikes: 500
  },
  homepageReview: {
    instructions: [
      "优先真实在职辅警、基层民警、警校生和公安院校在读学生个人账号。",
      "pass 需要稳定的本人辅警/公安/警校身份，以及执勤、训练、值班、校园、宿舍、制服穿搭或通勤等真实日常内容。",
      "官方媒体、招警/辅警培训、公安联考咨询、案件新闻解说、纯普法科普、政务号和MCN警察IP不能进入精选。",
      "普通生活、自拍、穿搭和情绪文案不是负面信号，只要账号同时具有稳定辅警/公安/警校身份即可。",
      "只有单条相关作品、主页主线明显属于其他垂类时，最多判 maybe。"
    ],
    identityTerms: ["辅警", "民警", "公安", "警校生", "警校", "公安院校", "执勤", "值班", "警号", "工作证", "学生证", "藏蓝青春"],
    dailyTerms: ["辅警日常", "民警日常", "警校日常", "警校生活", "校园", "宿舍", "训练", "上课", "队列", "制服", "警服", "通勤", "派出所日常", "执勤", "值班", "毕业季"],
    lifestyleTerms: [],
    dominantRejectTerms: ["报考", "招生", "培训", "公安联考", "案件", "新闻", "执法", "巡逻", "办案", "普法", "官方", "政务", "反诈"],
    minSamplesForFeatured: 6,
    minIdentityWorks: 2,
    minDailyWorks: 2,
    minLifestyleWorks: 0,
    forceFullSample: false
  },
  metricRules: {
    matchMode: "all",
    requireAvgLikes: true,
    avgLikesThreshold: 500,
    requireViralWorks: true,
    viralLikesThreshold: 2000,
    minViralWorks: 1,
    requireSampleWorks: false,
    minSampleWorks: 10,
    requireRecentUpdate: false
  }
};

const BAIYI_TEMPLATE = {
  id: "baiyi-medical",
  version: 5,
  name: "白衣印象·医护/医学生达人模板",
  matchTerms: ["白衣印象", "医护小熊", "医护", "医学生", "医生", "护士", "护理", "规培", "实习医生"],
  targetAudience: "真实医学生、护理学生、规培生、实习医生、护士或医生个人账号",
  targetDescription: "有真实医院/学习日常，也有自然的个人生活表达",
  discovery: {
    primaryTerms: ["医学生日常", "护士日常", "医院日常", "护理学生", "规培日常", "实习医生日常", "医护通勤", "白大褂日常"],
    supportTerms: ["医学生", "护士", "医生", "护理", "规培", "实习", "轮转", "值班", "夜班", "科室", "病房"],
    excludeTerms: ["纯医学科普", "疾病讲解", "育儿科普", "升学规划", "考研培训", "招生咨询", "剧情演绎", "漫画故事", "医疗机构", "医美带货", "器械销售"]
  },
  candidateScreen: {
    instructions: [
      "本轮使用白衣印象医护达人模板。",
      "keep：有多条真实医学生、护理学生、规培生、实习医生、护士或医生本人日常线索。",
      "maybe：存在医护身份或医院场景线索但样本少；证据不足时不要误删。",
      "drop：黄V/职业认证/权威认证账号、大V、纯医学科普、疾病讲解、育儿科普、升学规划、考研培训、招生咨询、剧情漫画故事、医生IP运营培训或机构账号。",
      "真人医护账号即使主要做科普，只要仍有本人值班、上班或生活记录线索，就判 maybe。",
      "正向标杆是小体量真实医学生/医护个人号：多条医学生、夜班、患者或医院场景，同时有朋友、自拍、搞笑、跳舞、精神状态或生活碎片等个人表达；即使平均点赞不到500，只要身份稳定且出现过2000+作品，也应优先保留。",
      "这里只做低成本初筛，不要求现在满足主页精选的完整样本数量。"
    ],
    identityTerms: ["医学生", "医生", "护士", "护理", "规培", "实习医生", "医护", "医院", "科室", "值班", "夜班", "轮转", "白大褂"],
    obviousMismatchTerms: ["警校生", "公安院校", "驾校", "健身教练", "房产中介", "汽车销售"],
    hardDropTerms: [
      "医学培训机构", "医疗机构官方", "招生咨询", "考研培训", "纯医学科普", "疾病讲解号",
      "账号运营", "账号孵化", "医生IP", "医疗IP", "代运营", "短视频运营", "短视频服务",
      "运营培训", "运营咨询", "爆款形式", "热门形式", "敏感词", "违规词", "科室账号", "医美带货", "器械销售"
    ],
    minSampleLikes: 500
  },
  homepageReview: {
    instructions: [
      "账号需要稳定呈现本人医护身份，并以真实工作/学习日常、同事互动、轻松表达或非医护个人生活为主。",
      "pass 需要多条医院、值班、夜班、规培、实习、轮转、科室、病房或白大褂等本人医护日常。",
      "黄V/职业认证/权威认证账号、大V、纯医学科普、疾病讲解、升学规划、护考报考培训、招聘考试、医生IP运营培训、剧情漫画故事和机构账号必须直接排除，不能进入待选。",
      "本人是护士或医生不能自动放行；护考/报考/求职考试占主页多数，或护士标签包装的泛娱乐段子占主页多数时，必须直接排除。",
      "医护口播答疑或科普即使由真人发布，只要主页主要是疾病知识、教学或答疑且缺少真实日常和个人表达，也最多判 maybe。",
      "最近至少 8 条作品中必须有至少 2 条明确的非职业个人生活内容；主页几乎全是医院工作、夜班、科研、论文、学历或就业经历时必须直接排除。",
      "样本不足、身份内容不足或真实医护日常不足时只能进入待选。"
    ],
    identityTerms: ["医学生", "医生", "护士", "护理", "规培", "实习医生", "医护", "医院", "科室", "值班", "夜班", "轮转", "白大褂"],
    dailyTerms: ["医学生日常", "护士日常", "医院日常", "值班", "夜班", "上班", "规培", "实习", "轮转", "科室", "门诊", "病房", "查房", "白大褂"],
    lifestyleTerms: ["自拍", "宿舍", "通勤", "下班", "和朋友", "朋友聚会", "朋友一起", "闺蜜", "同学聚会", "旅行", "宠物", "探店", "聚餐", "美食", "做饭", "吃播", "逛街", "健身", "毕业", "日常生活", "生活碎片", "精神状态", "跳舞", "搞笑", "情绪", "娱乐"],
    dominantRejectTerms: ["科普", "疾病讲解", "育儿", "志愿", "考研", "保研", "分数线", "就业薪资", "升学规划", "护考", "护士资格证", "报考", "招聘考试", "考公", "考编", "网课", "剧情", "演绎", "段子", "漫画", "故事"],
    minSamplesForFeatured: 8,
    minIdentityWorks: 3,
    minDailyWorks: 3,
    minLifestyleWorks: 2,
    forceFullSample: true
  },
  metricRules: {
    matchMode: "any",
    requireAvgLikes: true,
    avgLikesThreshold: 500,
    requireViralWorks: true,
    viralLikesThreshold: 2000,
    minViralWorks: 1,
    requireSampleWorks: false,
    minSampleWorks: 10,
    requireRecentUpdate: false
  }
};

const SHANGANDA_TEMPLATE = {
  id: "shanganda-graduate",
  version: 1,
  name: "上岸达·毕业生达人模板",
  matchTerms: ["上岸达", "毕业生", "应届", "毕业季", "求职", "考公", "考研"],
  targetAudience: "真实应届毕业生或毕业2年内的大学生个人账号",
  targetDescription: "持续分享本人毕业季、求职、考公考编或职场新人日常，有真实的个人生活表达",
  discovery: {
    primaryTerms: ["毕业日常", "应届毕业生", "毕业季vlog", "求职日常", "考公日记", "毕业生vlog", "找工作日常", "毕业穿搭", "职场新人日常", "答辩日常"],
    supportTerms: ["毕业生", "应届", "大四", "研三", "毕业季", "求职", "找工作", "考公", "上岸", "答辩", "论文", "毕业典礼", "校招", "实习", "租房", "入职"],
    excludeTerms: ["考公培训", "考研机构", "求职辅导", "论文代写", "就业指导", "公务员培训", "事业单位培训", "机构号", "官方号", "课程销售", "保过班", "协议班"]
  },
  candidateScreen: {
    instructions: [
      "本轮使用上岸达毕业生达人模板。",
      "keep：有多条真实应届/毕业1-2年/大四研三/考公考研本人的毕业季、求职、考公或职场新人日常线索。",
      "maybe：存在毕业生身份、答辩、求职或考公线索，但当前样本不足。",
      "drop：求职培训机构、考研机构、论文代写、就业指导官方、高校官方、HR招聘号、职业规划博主、保过班销售或MCN运营毕业生人设号。",
      "毕业生偶尔发求职季、上岸或毕业内容不等于机构号；有本人校园/求职生活线索时保留。",
      "这里只做低成本初筛，证据不足时判 maybe，交给主页复筛。"
    ],
    identityTerms: ["应届毕业生", "大四", "研三", "毕业季", "求职", "考公", "应届生", "202X届", "毕业生", "校招", "实习", "租房", "入职"],
    obviousMismatchTerms: ["医学生", "护士", "警校生", "房产中介", "汽车销售", "育儿科普"],
    hardDropTerms: ["考公培训机构", "考研机构", "求职辅导", "论文代写", "就业指导官方", "高校官方", "HR招聘号", "职业规划博主", "保过班销售", "机构号", "课程销售"],
    minSampleLikes: 300
  },
  homepageReview: {
    instructions: [
      "账号需要稳定呈现本人毕业生/应届身份，并以真实毕业季、答辩、求职面试、考公复习、租房、职场新人等日常为主，同时有自然个人生活表达。",
      "pass 需要多条毕业季、答辩、求职面试、考公复习、校招宣讲、实习或职场新人日常。",
      "考公培训机构、考研机构、求职辅导、论文服务、就业指导、课程销售、保过班、职业规划鸡汤或官方招聘宣传必须直接排除，不能进入待选。",
      "本人是毕业生不能自动放行；主页几乎全是培训广告、机构宣传或求职课程占多数时，必须直接排除。",
      "样本不足、身份内容不足或真实毕业/求职日常不足时只能进入待选。"
    ],
    identityTerms: ["应届毕业生", "大四", "研三", "毕业季", "求职", "考公", "应届生", "202X届", "毕业生", "校招", "实习", "租房", "入职"],
    dailyTerms: ["毕业季日常", "答辩", "毕业典礼", "求职面试", "找工作", "考公复习", "校招宣讲", "实习日常", "租房", "入职", "职场新人日常", "论文写作", "毕业旅行"],
    lifestyleTerms: ["自拍", "穿搭", "美食", "毕业旅行", "朋友", "探店", "健身", "追剧", "情绪日常", "生活碎片", "宠物", "搞笑", "宿舍"],
    dominantRejectTerms: ["考公培训", "考研培训", "求职辅导", "论文服务", "就业指导", "课程销售", "保过班", "职业规划", "招聘广告", "机构宣传", "鸡汤文"],
    minSamplesForFeatured: 6,
    minIdentityWorks: 2,
    minDailyWorks: 2,
    minLifestyleWorks: 1,
    forceFullSample: false
  },
  metricRules: {
    matchMode: "any",
    requireAvgLikes: true,
    avgLikesThreshold: 300,
    requireViralWorks: true,
    viralLikesThreshold: 1500,
    minViralWorks: 1,
    requireSampleWorks: false,
    minSampleWorks: 10,
    requireRecentUpdate: false
  }
};

const BRANDS = [
  { slug: "shushujia", name: "蜀黍家", description: "警校 / 公安 / 辅警 人群品牌", template: SHUSHUJIA_TEMPLATE,
    examples: { positive: ["只想睡个好觉 https://v.douyin.com/s__szH3JnvE/", "彭于晏的于 https://v.douyin.com/gNX2SlFFdzI/", "太困了. https://v.douyin.com/TIxLxEXNsVM/"], pending: ["符合警校生身份但长时间未更新 https://v.douyin.com/eqmGOfzeQlY/", "有身份线索但主页样本不足 https://v.douyin.com/ojsMJP5MPhc/"], negative: [] } },
  { slug: "baiyi", name: "白衣印象", description: "医护 / 医学生 / 医院日常 人群品牌", template: BAIYI_TEMPLATE,
    examples: { positive: ["小许同学 https://v.douyin.com/FeHXGxD5kj0/", "苏泼汝爱斯 https://v.douyin.com/LMrbzWF1KO0/", "小文颖 https://v.douyin.com/DpZAoPBupZY/"], pending: ["https://v.douyin.com/yJqhIduAeKE/", "https://v.douyin.com/ZpTWwMT_QDE/"], negative: [] } },
  { slug: "shanganda", name: "上岸达", description: "毕业生 人群品牌", template: SHANGANDA_TEMPLATE,
    examples: { positive: ["https://v.douyin.com/2G4sO-wE4Iw/", "https://v.douyin.com/IlJxKGER3QA/"], pending: ["https://v.douyin.com/sp_8kCK30YI/"], negative: [] } }
];

async function main() {
  const templateIds = {};
  for (const brand of BRANDS) {
    const brandRow = await prisma.brandLibrary.upsert({
      where: { slug: brand.slug },
      update: { name: brand.name, description: brand.description, status: "active" },
      create: { slug: brand.slug, name: brand.name, description: brand.description, status: "active", sortOrder: 0 }
    });

    const existing = await prisma.creatorAudienceTemplate.findFirst({
      where: { brandLibraryId: brandRow.id, name: brand.template.name }
    });

    const row = existing
      ? await prisma.creatorAudienceTemplate.update({
          where: { id: existing.id },
          data: { category: "audience", version: brand.template.version, isActive: true, template: brand.template, examples: brand.examples, notes: brand.description }
        })
      : await prisma.creatorAudienceTemplate.create({
          data: {
            brandLibraryId: brandRow.id,
            name: brand.template.name,
            category: "audience",
            version: brand.template.version,
            isActive: true,
            template: brand.template,
            examples: brand.examples,
            notes: brand.description
          }
        });

    templateIds[brand.slug] = row.id;
    console.log(`[OK] 品牌=${brand.name} 模板=${brand.template.name} (id=${row.id})`);
  }

  // 历史映射：把现有「警察小熊 / 医护小熊」任务绑定到对应模板并回填快照
  const historyMap = [
    { match: "警察小熊", slug: "shushujia" },
    { match: "医护小熊", slug: "baiyi" }
  ];
  for (const h of historyMap) {
    const tmplId = templateIds[h.slug];
    const tasks = await prisma.campaignTask.findMany({ where: { name: { contains: h.match } } });
    for (const t of tasks) {
      const tmpl = await prisma.creatorAudienceTemplate.findUnique({ where: { id: tmplId } });
      await prisma.campaignTask.update({
        where: { id: t.id },
        data: { audienceTemplateId: tmplId, audienceTemplateSnapshot: tmpl.template }
      });
      console.log(`[绑定] 任务「${t.name}」→ 模板 id=${tmplId}`);
    }
    if (tasks.length === 0) console.log(`[跳过] 未找到名称含「${h.match}」的任务`);
  }

  console.log("种子完成。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
