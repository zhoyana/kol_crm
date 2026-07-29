export type DiscoveryCampaignTask = {
  name?: string;
  productName?: string;
  category?: string | null;
  targetAudience?: string;
  targetDescription?: string;
  seedKeywords?: string[];
  excludeKeywords?: string[];
  productSellingPoints?: string[];
};

export type DiscoveryRuleTemplate = {
  id: "police-bear" | "medical-bear" | "generic";
  version: number;
  name: string;
  matchTerms: string[];
  discovery: {
    primaryTerms: string[];
    supportTerms: string[];
    excludeTerms: string[];
  };
  candidateScreen: {
    instructions: string[];
    identityTerms: string[];
    obviousMismatchTerms: string[];
    hardDropTerms: string[];
    minSampleLikes: number;
  };
  homepageReview: {
    instructions: string[];
    identityTerms: string[];
    dailyTerms: string[];
    lifestyleTerms: string[];
    dominantRejectTerms: string[];
    minSamplesForFeatured: number;
    minIdentityWorks: number;
    minDailyWorks: number;
    minLifestyleWorks: number;
    forceFullSample: boolean;
  };
};

export const POLICE_BEAR_TEMPLATE: DiscoveryRuleTemplate = {
  id: "police-bear",
  version: 1,
  name: "警察小熊达人发现模板",
  matchTerms: ["警察小熊", "警校", "警校生", "公安院校", "公安大学", "警院", "藏蓝青春", "警服"],
  discovery: {
    primaryTerms: ["警校生日常", "警校生活", "警校穿搭", "警校生vlog", "藏蓝青春", "警校训练", "警校宿舍", "警服穿搭"],
    supportTerms: ["警校生", "警校", "公安院校", "公安大学", "校园", "宿舍", "训练", "制服", "日常", "通勤"],
    excludeTerms: ["报考培训", "招生机构", "公安联考培训", "官方账号", "媒体号", "案件解说", "普法科普", "已从业警察工作号"]
  },
  candidateScreen: {
    instructions: [
      "本轮使用警察小熊达人发现模板。",
      "keep：有多条真实在校警校生、公安院校学生或在读研究生本人日常线索。",
      "maybe：存在警校身份、校园、宿舍、训练、制服或藏蓝青春线索，但当前样本不足。",
      "drop：明显为官方媒体、报考招生培训、公安联考咨询、已从业警察工作宣传、案件新闻或纯普法科普账号。",
      "警校生偶尔发布招生季、上岸或毕业内容不等于培训号；有本人校园生活线索时保留。",
      "这里只做低成本初筛，证据不足时判 maybe，交给主页复筛。"
    ],
    identityTerms: ["警校生", "警校", "公安院校", "公安大学", "警院", "藏蓝青春", "学生证", "在校", "研究生"],
    obviousMismatchTerms: ["医学生", "护士", "护理学生", "医院日常", "驾校", "房产中介", "汽车销售"],
    hardDropTerms: ["报考培训", "招生机构", "公安联考培训", "官方媒体", "案件新闻号", "普法机构"],
    minSampleLikes: 500
  },
  homepageReview: {
    instructions: [
      "优先真实在校警校生、公安院校学生和在读研究生个人账号。",
      "pass 需要稳定的本人警校身份，以及校园、宿舍、训练、上课、制服穿搭或通勤等日常内容。",
      "官方媒体、招生培训、联考咨询、已从业警察工作宣传、案件新闻和纯普法科普不能进入精选。",
      "普通生活、自拍、穿搭和情绪文案不是负面信号，只要账号同时具有稳定警校身份即可。",
      "只有单条警校相关作品、主页主线明显属于其他垂类时，最多判 maybe。"
    ],
    identityTerms: ["警校生", "警校", "公安院校", "公安大学", "警院", "藏蓝青春", "学生证", "在校", "研究生"],
    dailyTerms: ["警校日常", "警校生活", "校园", "宿舍", "训练", "上课", "队列", "制服", "警服", "通勤", "毕业季"],
    lifestyleTerms: [],
    dominantRejectTerms: ["报考", "招生", "培训", "公安联考", "案件", "新闻", "执法", "巡逻", "办案", "普法", "官方"],
    minSamplesForFeatured: 6,
    minIdentityWorks: 2,
    minDailyWorks: 2,
    minLifestyleWorks: 0,
    forceFullSample: false
  }
};

export const MEDICAL_BEAR_TEMPLATE: DiscoveryRuleTemplate = {
  id: "medical-bear",
  version: 1,
  name: "医护小熊达人发现模板",
  matchTerms: ["医护小熊", "医护", "医学生", "医生", "护士", "护理", "规培", "实习医生"],
  discovery: {
    primaryTerms: ["医学生日常", "护士日常", "医院日常", "护理学生", "规培日常", "实习医生日常", "医护通勤", "白大褂日常"],
    supportTerms: ["医学生", "护士", "医生", "护理", "规培", "实习", "轮转", "值班", "夜班", "科室", "病房"],
    excludeTerms: ["纯医学科普", "疾病讲解", "育儿科普", "升学规划", "考研培训", "招生咨询", "剧情演绎", "漫画故事", "医疗机构"]
  },
  candidateScreen: {
    instructions: [
      "本轮使用医护小熊达人发现模板。",
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
      "医学培训机构",
      "医疗机构官方",
      "招生咨询",
      "考研培训",
      "纯医学科普",
      "疾病讲解号",
      "账号运营",
      "账号孵化",
      "医生IP",
      "医疗IP",
      "代运营",
      "短视频运营",
      "短视频服务",
      "运营培训",
      "运营咨询",
      "爆款形式",
      "热门形式",
      "敏感词",
      "违规词",
      "科室账号"
    ],
    minSampleLikes: 500
  },
  homepageReview: {
    instructions: [
      "账号必须同时呈现稳定的本人医护身份/工作或学习场景，以及真实的非医护个人生活分享。",
      "pass 需要多条医院、值班、夜班、规培、实习、轮转、科室、病房或白大褂等本人医护日常。",
      "黄V/职业认证/权威认证账号、大V、纯医学科普、疾病讲解、升学规划、护考报考培训、招聘考试、医生IP运营培训、剧情漫画故事和机构账号必须直接排除，不能进入待选。",
      "本人是护士或医生不能自动放行；护考/报考/求职考试占主页多数，或护士标签包装的泛娱乐段子占主页多数时，必须直接排除。",
      "医护口播答疑或科普即使由真人发布，只要缺少明确的非医护生活内容，也最多判 maybe。",
      "样本不足、身份内容不足或个人生活内容不足时只能进入待选。"
    ],
    identityTerms: ["医学生", "医生", "护士", "护理", "规培", "实习医生", "医护", "医院", "科室", "值班", "夜班", "轮转", "白大褂"],
    dailyTerms: ["医学生日常", "护士日常", "医院日常", "值班", "夜班", "上班", "规培", "实习", "轮转", "科室", "门诊", "病房", "查房", "白大褂"],
    lifestyleTerms: ["自拍", "宿舍", "通勤", "下班", "朋友", "旅行", "宠物", "吃饭", "逛街", "健身", "毕业", "日常生活", "生活碎片", "精神状态", "跳舞", "搞笑", "情绪", "娱乐"],
    dominantRejectTerms: ["科普", "疾病讲解", "育儿", "志愿", "考研", "保研", "分数线", "就业薪资", "升学规划", "护考", "护士资格证", "报考", "招聘考试", "考公", "考编", "网课", "剧情", "演绎", "段子", "漫画", "故事"],
    minSamplesForFeatured: 8,
    minIdentityWorks: 3,
    minDailyWorks: 3,
    minLifestyleWorks: 2,
    forceFullSample: true
  }
};

export const GENERIC_DISCOVERY_TEMPLATE: DiscoveryRuleTemplate = {
  id: "generic",
  version: 1,
  name: "通用达人发现模板",
  matchTerms: [],
  discovery: { primaryTerms: [], supportTerms: [], excludeTerms: [] },
  candidateScreen: {
    instructions: [
      "按当前品类任务判断账号是否值得进入主页复筛。",
      "垂直证据充分判 keep；可能相关但证据不足判 maybe；明显错垂类、机构号或营销号才判 drop。",
      "初筛优先保证召回率，无法确定时判 maybe。"
    ],
    identityTerms: [],
    obviousMismatchTerms: [],
    hardDropTerms: [],
    minSampleLikes: 500
  },
  homepageReview: {
    instructions: ["优先真实个人创作者；证据不足时进入待选，不要仅凭单条作品进入精选。"],
    identityTerms: [],
    dailyTerms: [],
    lifestyleTerms: [],
    dominantRejectTerms: [],
    minSamplesForFeatured: 6,
    minIdentityWorks: 0,
    minDailyWorks: 0,
    minLifestyleWorks: 0,
    forceFullSample: false
  }
};

export const DISCOVERY_RULE_TEMPLATES = [MEDICAL_BEAR_TEMPLATE, POLICE_BEAR_TEMPLATE];

function normalize(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

export function campaignTaskText(task?: DiscoveryCampaignTask | null): string {
  if (!task) return "";
  return [
    task.name,
    task.productName,
    task.category || "",
    task.targetAudience,
    task.targetDescription,
    ...(task.seedKeywords || []),
    ...(task.excludeKeywords || []),
    ...(task.productSellingPoints || [])
  ].filter(Boolean).join(" ");
}

export function resolveDiscoveryRuleTemplate(task?: DiscoveryCampaignTask | null): DiscoveryRuleTemplate {
  const text = normalize(campaignTaskText(task));
  return DISCOVERY_RULE_TEMPLATES.find((template) => template.matchTerms.some((term) => text.includes(normalize(term))))
    || GENERIC_DISCOVERY_TEMPLATE;
}
