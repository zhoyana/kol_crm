import {
  parseDouyinDiscoveryCandidates,
  toImportCandidate,
  type DouyinCandidate,
  type DouyinDiscoveryCandidate,
  type DouyinWork
} from "./douyin-import";
import { resolveDiscoveryRuleTemplate } from "./discovery-rule-templates";
import {
  readAgentCachedHomepageRows,
  readAgentRecentHomepageRow,
  readAgentRecentHomepageRows,
  runAgentHomepageCrawl
} from "./douyin-homepage-agent";

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const THREE_MONTH_MS = 90 * 24 * 60 * 60 * 1000;
const VIRAL_LIKES = 2000;
// The Douyin featured gate requires at least 10 valid homepage works. Fetch a
// small buffer so one unavailable/private work does not make every otherwise
// qualified creator fail the sample-count check.
const HOMEPAGE_WORK_LIMIT = 12;
const LIGHT_HOMEPAGE_WORK_LIMIT = 6;

export type HomepageReviewRules = {
  requireAvgLikes500?: boolean;
  requireViral2000?: boolean;
  requireWorkCount10?: boolean;
  requireRecentViral?: boolean;
  requireRecentUpdate?: boolean;
  avgLikesThreshold?: number;
  viralLikesThreshold?: number;
  minViralWorks?: number;
  minSampleWorks?: number;
  metricMatchMode?: "all" | "any";
  campaignTask?: {
    name?: string;
    productName?: string;
    category?: string | null;
    targetAudience?: string;
    targetDescription?: string;
    seedKeywords?: string[];
    excludeKeywords?: string[];
    productSellingPoints?: string[];
    outreachTone?: string | null;
    audienceTemplateId?: number | null;
    audienceTemplateSnapshot?: unknown;
  };
};

export type HomepageReviewOptions = {
  workLimit?: number;
  allowFullRetry?: boolean;
  skipObviousMismatch?: boolean;
};

type HomepageBooleanRuleKey =
  | "requireAvgLikes500"
  | "requireViral2000"
  | "requireWorkCount10"
  | "requireRecentViral"
  | "requireRecentUpdate";

type HomepageResult =
  | { ok: true; candidate: DouyinCandidate; fans?: number; aiCalls?: number }
  | { ok: false; reason: string; fans?: number; aiCalls?: number };

export type HomepageBatchReviewResult = {
  externalId: string;
  result: HomepageResult;
};

type HomepageAiDecision = {
  decision: "pass" | "maybe" | "reject";
  confidence: number;
  accountType: string;
  reason: string;
  positiveSignals: string[];
  negativeSignals: string[];
};

function secUidFromCandidate(candidate: DouyinDiscoveryCandidate): string {
  if (candidate.secUid) return candidate.secUid;
  if (candidate.profileUrl?.includes("/user/")) {
    return candidate.profileUrl.split("/user/")[1]?.split("?")[0] || "";
  }
  if (candidate.creatorId?.startsWith("MS4w")) return candidate.creatorId;
  return "";
}

function isRecentWork(work: DouyinWork): boolean {
  if (!work.publishedAt) return false;
  return new Date(work.publishedAt).getTime() >= Date.now() - ONE_MONTH_MS;
}

function isActiveWork(work: DouyinWork): boolean {
  if (!work.publishedAt) return false;
  return new Date(work.publishedAt).getTime() >= Date.now() - THREE_MONTH_MS;
}

function isRuleEnabled(rules: HomepageReviewRules | undefined, key: HomepageBooleanRuleKey, defaultValue: boolean): boolean {
  return rules?.[key] ?? defaultValue;
}

function normalizeHomepageAiDecision(value: unknown): HomepageAiDecision["decision"] {
  if (value === "pass" || value === "maybe" || value === "reject") return value;
  return "maybe";
}

function normalizeHomepageAccountType(value: unknown): string {
  const normalized = String(value || "").trim();
  return normalized || "possible_target";
}

function safeJsonObject(text: string): Record<string, unknown> {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function splitTaskTerms(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value || "").split(/[,，、\n]/))
        .map((item) => item.trim())
        .filter((item) => item.length >= 2)
    )
  );
}

function taskTargetTerms(task?: HomepageReviewRules["campaignTask"]): string[] {
  if (!task) return [];
  return splitTaskTerms([
    task.targetAudience || "",
    task.targetDescription || "",
    ...(task.seedKeywords || []),
    ...(task.productSellingPoints || [])
  ]);
}

function hasCampaignTaskContext(rules?: HomepageReviewRules): boolean {
  return taskTargetTerms(rules?.campaignTask).length > 0;
}

function campaignTaskLabel(task?: HomepageReviewRules["campaignTask"]): string {
  return task?.targetAudience || task?.name || "当前品类任务";
}

function homepageAiCategoryRubric(task?: HomepageReviewRules["campaignTask"]): string {
  const template = resolveDiscoveryRuleTemplate(task);
  if (template.id !== "medical-bear") return "";

  return [
    "【医护小熊专属 AI 复筛模板】",
    "先总结账号的内容主线，再判断身份；不能先看到“护士/医生/医学生”就直接 pass。",
    "按以下五个维度综合判断：",
    "A. 本人身份：是否能确认作者本人是医学生、护士、医生、规培生或实习医护。",
    "B. 医护实质：最近作品是否持续出现医院、科室、病房、值夜班、查房、轮转、实习等真实经历，而非只挂职业话题。",
    "C. 个人生活：是否有自然的自拍、朋友、通勤、吃饭、旅行、宠物、毕业或生活碎片，能承接人格化周边合作。",
    "D. 内容主线：主页究竟是个人医护生活，还是护考报考/培训求职、医学科普、泛娱乐段子、剧情表演或商业运营。",
    "E. 可迁移性测试：把标题里的“护士/医生”替换成其他职业后，如果多数作品仍然成立，则说明职业只是包装，不是医护实质内容。",
    "",
    "决策边界：",
    "- pass：本人医护身份明确，真实医护学习/工作经历稳定，同时有自然个人生活表达；轻松、搞笑内容可以存在，但不能成为可迁移的泛娱乐主线。",
    "- maybe：像真实医护个人号，但样本不足、真实工作细节偏少，或生活表达不足，尚不能确认是否适合。",
    "- reject：即使本人确为医护，只要主页多数在讲护考、资格证、报考、招聘考试、课程资料、求职培训，也必须拒绝。",
    "- reject：即使每条都带护士/医生话题，只要多数是通用段子、表演、情绪梗或职业人设包装，真实医护工作细节很少，也必须拒绝。",
    "",
    "边界样例：",
    "- 正例“幸运小星兜”：本人医护身份清楚，有多条真实医护经历，也有丰富个人生活表达，可 pass。",
    "- 负例“婉知知”：本人可能是真护士，但主页主线是护考、证书、报名流程、招聘考试和报考答疑，应 reject。",
    "- 负例“刘安静”：使用护士身份和话题，但主页主线是可迁移到其他职业的泛娱乐段子/表演，真实医护实质不足，应 reject。",
    "必须在 reason 中先写清“账号内容主线”，再说明最终判断；不要只复述关键词数量。"
  ].join("\n");
}

function buildHomepageAiPrompt(input: {
  original: DouyinDiscoveryCandidate;
  recentWorks: DouyinWork[];
  avgLikes: number;
  maxLikes: number;
  viralWorkCount: number;
  hasRecentUpdate: boolean;
  campaignTask?: HomepageReviewRules["campaignTask"];
}): string {
  const works = input.recentWorks.map((work, index) => ({
    index: index + 1,
    title: work.title,
    likeCount: work.likeCount,
    publishedAt: work.publishedAt,
    sourceKeyword: work.sourceKeyword,
    url: work.url
  }));
  const targetContext = input.campaignTask
    ? [
        `当前品类任务：${input.campaignTask.name || ""}`,
        `推广产品：${input.campaignTask.productName || ""}`,
        `目标人群：${input.campaignTask.targetAudience || ""}`,
        `筛选目标：${input.campaignTask.targetDescription || ""}`,
        `采集关键词：${(input.campaignTask.seedKeywords || []).join("、")}`,
        `排除方向：${(input.campaignTask.excludeKeywords || []).join("、")}`,
        `产品卖点：${(input.campaignTask.productSellingPoints || []).join("、")}`
      ].join("\n")
    : "业务目标：寻找目前在校或高度疑似在校的警校生/公安院校学生/公安院校在读研究生个人创作者，用于警察小熊、警察日常通勤衣服、警校生活周边类合作。";
  const discoveryTemplate = resolveDiscoveryRuleTemplate(input.campaignTask);
  const templateNotes = [
    `当前达人发现规则模板：${discoveryTemplate.name} v${discoveryTemplate.version}`,
    ...discoveryTemplate.homepageReview.instructions,
    `精选最低主页样本数：${discoveryTemplate.homepageReview.minSamplesForFeatured}`,
    `精选最低身份内容数：${discoveryTemplate.homepageReview.minIdentityWorks}`,
    `精选最低日常内容数：${discoveryTemplate.homepageReview.minDailyWorks}`,
    `精选最低非职业生活内容数：${discoveryTemplate.homepageReview.minLifestyleWorks}`
  ].join("\n");

  return [
    "你是达人作品画像初筛助手。请根据作者主页最近作品标题集合，判断这个账号整体是否符合当前品类的目标画像。",
    "",
    targetContext,
    templateNotes,
    homepageAiCategoryRubric(input.campaignTask),
    "如果当前品类任务和通用示例冲突，必须优先按当前品类任务判断；不要把其他品类的目标人群当成通过依据。",
    "不要把官方号、媒体号、机构号、培训招生号、考试咨询号、纯科普营销号、商品号判断为精选达人。",
    "",
    "非常重要：",
    "1. 不要求主页每条作品都写目标身份关键词。真实个人账号可能大量分享生活、宿舍、通勤、值班、学习、工作、普通vlog、情绪化文案。",
    "2. 判断重点是“账号整体是否像目标人群”，不是单条标题是否命中关键词。",
    "3. 如果标题集合中能稳定看到当前任务目标人群身份、学习/工作场景、日常记录、行业生活或产品适配场景线索，可以 pass 或 maybe。",
    "4. 如果只有一条作品相关，其余内容完全不相关，应 maybe 或 reject，除非强烈显示作者本人就是当前任务目标人群。",
    "5. vlog/日常不是天然负面；如果vlog含量不高，且账号有稳定目标身份、学习/工作场景、宿舍/值班/通勤/同学同事生活线索，可以 pass。若主页大半或几乎全部都是 VLOG 模板化日更/周更/流水账，也只能 maybe，不要进入精选。",
    "6. 学习、实习、规培、上岸、入职、毕业等记录如果指向作者本人属于当前目标人群，应视为目标线索；只有主营备考咨询、分数线、报考规划、培训课程的账号才 reject。",
    "7. 颜值、自拍、穿搭、健身、情绪文案不是天然负面；如果账号同时有当前任务目标人群身份线索，并且互动数据不错，这类个人号可以 pass。",
    "",
    "应该通过 pass：明显符合当前品类任务的目标人群，且不是商品/运营/服务账号；内容能体现真实个人身份、日常场景、工作/学习/生活记录或与产品自然结合的场景。pass 只代表进入待选库，不代表数据表现已达到精选门槛。",
    "可以待观察 maybe：有当前任务目标人群线索，但主页样本少、标题抽象、垂直度不够确定；信息不足时必须 maybe，等待补采或人工确认，不能硬猜。",
    "必须拒绝 reject：官方/媒体/机构/营销/蓝V黄V；主营报考招生培训/考试咨询/课程售卖的账号；纯科普引流、商品带货、公司运营、服务号；明显不是当前任务目标人群且缺少目标身份线索。",
    "特别注意：不要因为单条泛内容直接 reject，要看主页整体是否符合当前任务目标人群。",
    "如果简介、昵称或作品标题明显命中当前任务排除方向，即使点赞很高，也应 reject。",
    "如果标题集合大量出现商品、下单、店铺、小店、客服、服务号、购买、福利、橱窗等商业运营信号，应 maybe 或 reject，不能 pass。",
    "如果主页几乎全是泛生活记录，即使有少量目标身份线索，也最多 maybe；如果同时缺少当前任务目标人群线索，则 reject。",
    "",
    "输出必须是 JSON，不要 Markdown。",
    'JSON 结构：{"decision":"pass|maybe|reject","confidence":0.0,"accountType":"target_person|possible_target|official_media|education_training|marketing|off_target","reason":"","positiveSignals":[],"negativeSignals":[]}',
    "",
    `作者昵称：${input.original.name}`,
    `作者粉丝数：${input.original.fans}`,
    `已有账号类型：${input.original.accountType || "未知"}`,
    `已有账号资料：${input.original.notes || "无"}`,
    `初筛样本标题：${input.original.sampleTitle || ""}`,
    `初筛来源关键词：${input.original.sourceKeywords.join("、")}`,
    `主页样本数：${input.recentWorks.length}`,
    `主页样本平均点赞：${input.avgLikes}`,
    `主页样本最高点赞：${input.maxLikes}`,
    `主页样本爆款数：${input.viralWorkCount}`,
    `近1个月是否更新：${input.hasRecentUpdate ? "是" : "否"}`,
    `主页最近作品：${JSON.stringify(works, null, 2)}`,
    input.campaignTask
      ? [
          "当前品类任务上下文：",
          `任务名称：${input.campaignTask.name || ""}`,
          `推广产品：${input.campaignTask.productName || ""}`,
          `目标人群：${input.campaignTask.targetAudience || ""}`,
          `筛选目标：${input.campaignTask.targetDescription || ""}`,
          `采集关键词：${(input.campaignTask.seedKeywords || []).join("、")}`,
          `排除方向：${(input.campaignTask.excludeKeywords || []).join("、")}`,
          `产品卖点：${(input.campaignTask.productSellingPoints || []).join("、")}`,
          "如果当前品类任务和通用规则冲突，优先按当前品类任务判断。"
        ].join("\n")
      : ""
  ].join("\n");
}

async function requestHomepageAiDecision(input: {
  original: DouyinDiscoveryCandidate;
  recentWorks: DouyinWork[];
  avgLikes: number;
  maxLikes: number;
  viralWorkCount: number;
  hasRecentUpdate: boolean;
  campaignTask?: HomepageReviewRules["campaignTask"];
}): Promise<{ decision: HomepageAiDecision | null; aiCalls: number }> {
  // Homepage portraits are a high-volume workflow. Use the configured
  // DeepSeek account first; the legacy OpenAI relay currently has no quota and
  // silently turned every otherwise-complete portrait into "信息不足".
  const useDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);
  const apiKey = useDeepSeek ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey || !input.recentWorks.length) return { decision: null, aiCalls: 0 };

  const baseUrl = (
    useDeepSeek
      ? process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
      : process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const model = useDeepSeek
    ? process.env.DEEPSEEK_MODEL || "deepseek-chat"
    : process.env.OPENAI_MODEL || "gpt-4o-mini";
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        ...(useDeepSeek ? { thinking: { type: "disabled" } } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你只输出可解析 JSON。" },
          { role: "user", content: buildHomepageAiPrompt(input) }
        ]
      }),
      signal: AbortSignal.timeout(60_000)
    });
  } catch (error) {
    console.error(
      `[homepage-ai] ${input.original.externalId} 请求失败：`,
      error instanceof Error ? error.message : error
    );
    return { decision: null, aiCalls: 1 };
  }

  if (!response.ok) {
    console.error(`[homepage-ai] ${input.original.externalId} HTTP ${response.status}`);
    return { decision: null, aiCalls: 1 };
  }
  const data = await response.json().catch(() => null);
  const parsed = safeJsonObject(String(data?.choices?.[0]?.message?.content || ""));
  const positiveSignals = Array.isArray(parsed.positiveSignals) ? parsed.positiveSignals.map(String) : [];
  const negativeSignals = Array.isArray(parsed.negativeSignals) ? parsed.negativeSignals.map(String) : [];

  return {
    aiCalls: 1,
    decision: {
      decision: normalizeHomepageAiDecision(parsed.decision),
      confidence: Math.max(0, Math.min(Number(parsed.confidence || 0.5), 1)),
      accountType: normalizeHomepageAccountType(parsed.accountType),
      reason: String(parsed.reason || "AI 未给出明确原因"),
      positiveSignals,
      negativeSignals
    }
  };
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalizedText(term)));
}

function countWorksByTerms(works: DouyinWork[], terms: string[]): number {
  return works.filter((work) => includesAny(normalizedText(work.title), terms)).length;
}

function countExplicitPersonalLifestyleWorks(works: DouyinWork[]): number {
  return countWorksByTerms(works, [
    "自拍",
    "宿舍生活",
    "宿舍日常",
    "通勤记录",
    "下班后",
    "下班去",
    "下班生活",
    "和朋友",
    "朋友聚会",
    "朋友一起",
    "闺蜜",
    "同学聚会",
    "旅行",
    "旅游",
    "宠物",
    "猫咪",
    "狗狗",
    "探店",
    "聚餐",
    "美食",
    "做饭",
    "吃播",
    "逛街",
    "健身",
    "毕业旅行",
    "日常生活",
    "生活碎片",
    "跳舞",
    "舞蹈",
    "约会",
    "恋爱",
    "回家过年",
    "周末出游"
  ]);
}

function medicalHomepageHardRejectReason(
  original: DouyinDiscoveryCandidate,
  homepage: DouyinDiscoveryCandidate,
  works: DouyinWork[]
): string | null {
  const accountText = normalizedText(
    [
      original.name,
      original.sampleTitle || "",
      homepage.name,
      homepage.sampleTitle || ""
    ].join(" ")
  );
  const examAccountTerms = [
    "护考小技巧",
    "考公考编",
    "护士资格证培训",
    "护考培训",
    "护考资料",
    "视频同款全套网课",
    "全套网课",
    "护考课程",
    "护士招聘考试",
    "报考咨询"
  ];
  if (includesAny(accountText, examAccountTerms)) {
    return "账号定位以护考、报考、招聘考试或课程资料为主，医护身份不能覆盖该负向主线。";
  }

  const examWorkTerms = [
    "护考",
    "护士资格证",
    "护士执业证",
    "电子化注册",
    "合格证明",
    "注册流程",
    "报考",
    "报名流程",
    "准考证",
    "成绩查询",
    "考点",
    "题库",
    "必考",
    "考公",
    "考编",
    "三支一扶",
    "招聘考试",
    "招聘考点",
    "求职渠道",
    "找工作",
    "网课"
  ];
  const examWorkCount = countWorksByTerms(works, examWorkTerms);
  if (works.length >= 6 && examWorkCount >= Math.max(4, Math.ceil(works.length * 0.5))) {
    return `最近 ${works.length} 条中有 ${examWorkCount} 条以护考、报考或求职考试为主，属于考试就业知识账号。`;
  }

  const educationAccountTerms = [
    "护理老师",
    "护理教师",
    "护理讲师",
    "教护理",
    "护考老师",
    "医学老师"
  ];
  const scienceAndTeachingTerms = [
    "科普",
    "健康知识",
    "医学知识",
    "疾病",
    "症状",
    "治疗",
    "误区",
    "血管",
    "血压",
    "一分钟了解",
    "护理教学",
    "护理操作",
    "操作流程",
    "处理流程",
    "一次讲清",
    "讲透",
    "知识点",
    "实习必做",
    "实习须知",
    "实习注意",
    "注射",
    "打针",
    "导尿",
    "插管",
    "备考",
    "教资",
    "护资",
    "考试"
  ];
  const scienceAndTeachingCount = countWorksByTerms(works, scienceAndTeachingTerms);
  const personalLifestyleCount = countExplicitPersonalLifestyleWorks(works);
  if (
    includesAny(accountText, educationAccountTerms) &&
    works.length >= 6 &&
    scienceAndTeachingCount >= 3
  ) {
    return `账号定位为护理/医学教学，最近作品以教学、实习答疑或考试内容为主，粉丝受众不符合医护小熊。`;
  }
  if (
    works.length >= 8 &&
    scienceAndTeachingCount >= Math.max(3, Math.ceil(works.length * 0.35)) &&
    personalLifestyleCount < 2
  ) {
    return `最近 ${works.length} 条中有 ${scienceAndTeachingCount} 条为医学科普或护理教学，且个人生活内容不足，粉丝受众不符合医护小熊。`;
  }
  if (works.length >= 8 && personalLifestyleCount < 2) {
    return `最近 ${works.length} 条中明确的非职业个人生活内容仅 ${personalLifestyleCount} 条；主页以医护工作、学业或职业经历为主，不符合医护小熊精选要求。`;
  }
  const entertainmentTerms = [
    "段子",
    "剧情",
    "演绎",
    "短剧",
    "剧本",
    "情景剧",
    "角色扮演",
    "一人分饰",
    "连续剧",
    "搞笑",
    "哈哈",
    "班搭子",
    "装傻",
    "精神状态",
    "猜一猜",
    "农夫与蛇",
    "猴子",
    "养殖场",
    "你干甚去了",
    "变成这样",
    "熬夜",
    "温柔对待"
  ];
  const explicitStagedTerms = [
    "剧情演绎",
    "情景演绎",
    "情景剧",
    "短剧",
    "剧本",
    "角色扮演",
    "一人分饰",
    "连续剧"
  ];
  const vlogTerms = [
    "vlog",
    "日常生活记录",
    "生活记录",
    "日常记录",
    "旅行记录",
    "宠物日常",
    "猫咪日常",
    "我的一天"
  ];
  const entertainmentCount = countWorksByTerms(works, entertainmentTerms);
  const explicitStagedCount = countWorksByTerms(works, explicitStagedTerms);
  const vlogCount = countWorksByTerms(works, vlogTerms);
  if (
    works.length >= 6 &&
    (
      explicitStagedCount >= 2 ||
      (
        explicitStagedCount >= 1 &&
        entertainmentCount >= Math.ceil(works.length * 0.3)
      )
    )
  ) {
    return `最近 ${works.length} 条以剧情演绎、角色扮演或剧本内容为主，不属于真实医护个人日常。`;
  }
  if (
    works.length >= 8 &&
    entertainmentCount >= Math.ceil(works.length * 0.5)
  ) {
    return `最近 ${works.length} 条中有 ${entertainmentCount} 条以泛娱乐段子/表演为主，不属于真实医护个人日常。`;
  }
  if (
    works.length >= 8 &&
    vlogCount >= Math.ceil(works.length * 0.8)
  ) {
    return `最近 ${works.length} 条中有 ${vlogCount} 条为 Vlog/生活记录，内容结构过度单一，不符合医护小熊精选要求。`;
  }

  return null;
}

function templateFeaturedBlockReason(
  works: DouyinWork[],
  campaignTask?: HomepageReviewRules["campaignTask"]
): string | null {
  const template = resolveDiscoveryRuleTemplate(campaignTask);
  if (template.id === "generic") return null;

  const review = template.homepageReview;
  const identityCount = countWorksByTerms(works, review.identityTerms);
  const dailyCount = countWorksByTerms(works, review.dailyTerms);
  const lifestyleCount = countWorksByTerms(works, review.lifestyleTerms);
  const rejectCount = countWorksByTerms(works, review.dominantRejectTerms);

  if (works.length < review.minSamplesForFeatured) {
    return `${template.name}精选至少需要查看 ${review.minSamplesForFeatured} 条主页作品；当前样本不足，只能进入待选。`;
  }
  if (identityCount < review.minIdentityWorks) {
    return `${template.name}需要稳定的目标身份或学习/工作场景；当前身份内容不足，只能进入待选。`;
  }
  if (dailyCount < review.minDailyWorks) {
    return `${template.name}需要多条目标人群日常作品；当前日常内容不足，只能进入待选。`;
  }
  if (lifestyleCount < review.minLifestyleWorks) {
    return `${template.name}需要至少 ${review.minLifestyleWorks} 条明确的非职业个人生活内容；当前生活分享不足，只能进入待选。`;
  }
  if (works.length >= 4 && rejectCount >= Math.ceil(works.length * 0.6)) {
    return `${template.name}排除方向内容占主页多数，只能进入待选。`;
  }
  return null;
}

function medicalFeaturedBlockReason(original: DouyinDiscoveryCandidate, works: DouyinWork[]): string | null {
  const text = normalizedText(
    [
      original.name,
      original.category || "",
      original.sampleTitle || "",
      original.screeningSummary || "",
      original.notes || "",
      ...works.map((work) => work.title)
    ].join(" ")
  );
  const educationPlanningTerms = [
    "高考",
    "志愿",
    "报考",
    "选专业",
    "医学类专业",
    "专业选择",
    "专业指南",
    "分数线",
    "考研",
    "保研",
    "上岸",
    "备考",
    "规划",
    "薪资",
    "就业",
    "专硕",
    "学硕",
    "博士规划",
    "硕士规划"
  ];
  const scienceTerms = [
    "科普",
    "医学科普",
    "疾病",
    "急性喉炎",
    "病毒",
    "发烧",
    "症状",
    "治疗",
    "儿童",
    "宝宝",
    "孩子",
    "家长",
    "儿科",
    "细胞",
    "生物",
    "解剖",
    "机制",
    "知识分享"
  ];
  const stagedTerms = ["剧情", "演绎", "短剧", "故事", "漫画", "插画", "小说", "人设", "段子", "配音"];
  const nonDailyHit =
    includesAny(text, educationPlanningTerms) ||
    includesAny(text, scienceTerms) ||
    includesAny(text, stagedTerms);
  const medicalTemplate = resolveDiscoveryRuleTemplate({ name: "医护小熊" }).homepageReview;
  const dailyCount = countWorksByTerms(works, medicalTemplate.dailyTerms);
  const identityCount = countWorksByTerms(works, medicalTemplate.identityTerms);
  const adviceCount = countWorksByTerms(works, medicalTemplate.dominantRejectTerms);


  if (works.length < 8) {
    return "医护小熊精选至少需要查看 8 条主页作品；当前样本不足，只能进入待选。";
  }

  if (identityCount < 3) {
    return "医护小熊精选需要稳定的本人医护身份或工作/学习场景，当前身份信号不足，降为待选。";
  }

  if (adviceCount >= Math.ceil(works.length * 0.6)) {
    return "主页大部分是医护口播答疑、科普或经验输出，不是以个人生活分享为主，降为待选。";
  }
  if (nonDailyHit && dailyCount < 3) {
    return "医护小熊精选要求真实医学生/医护日常；主页更偏科普、升学规划或剧情演绎，降为待选";
  }

  if (works.length >= 4 && dailyCount < 2) {
    return "医护小熊精选需要多条医学生/医护日常作品，当前主页日常信号不足，降为待选";
  }


  if (works.length >= 4 && identityCount < 2) {
    return "医护小熊精选需要稳定的本人医护身份或工作/学习场景，当前主页的身份信号不足，降为待选。";
  }

  return null;
}

function nonFeaturedReason(original: DouyinDiscoveryCandidate, works: DouyinWork[], campaignTask?: HomepageReviewRules["campaignTask"]): string | null {
  const text = normalizedText(
    [
      original.name,
      original.category || "",
      original.sampleTitle || "",
      original.screeningSummary || "",
      original.notes || "",
      ...works.map((work) => work.title)
    ].join(" ")
  );

  const commerceTerms = [
    "同款",
    "鞋",
    "作训鞋",
    "执勤鞋",
    "警校鞋",
    "制服",
    "商品",
    "下单",
    "店铺",
    "小店",
    "客服",
    "服务号",
    "专属",
    "文创",
    "挂件",
    "周边",
    "购买",
    "福利",
    "橱窗",
    "供应",
    "定制",
    "批发",
    "团购"
  ];
  const operatorTerms = ["运营", "公司", "品牌", "官方客服", "商家", "商单", "带货", "种草号"];
  if (includesAny(text, [...commerceTerms, ...operatorTerms])) {
    return "疑似商品号/公司运营号，只能进入待选库人工确认，不进入精选库";
  }

  const template = resolveDiscoveryRuleTemplate(campaignTask);
  if (template.id === "medical-bear") {
    const medicalReason = medicalFeaturedBlockReason(original, works);
    if (medicalReason) return medicalReason;
  }

  const templateReason = templateFeaturedBlockReason(works, campaignTask);
  if (templateReason) return templateReason;

  // 医护模板已经在 medicalFeaturedBlockReason 中用更明确的 Vlog/
  // 生活记录词和 80% 阈值检查“主页几乎全是 Vlog”。不要再套用下面
  // 包含“日常、记录、一天”等宽泛词的通用规则，否则真实医护日常也
  // 会被当作流水账误排除。
  if (template.id === "medical-bear") return null;

  const vlogTerms = [
    "vlog",
    "日常",
    "生活记录",
    "记录",
    "随拍",
    "碎碎念",
    "老家日常",
    "寒假",
    "一天",
    "一日",
    "恋爱",
    "沉浸式",
    "带你体验",
    "体验警校生",
    "第一人称",
    "普通警校生",
    "挑战警校生",
    "请勿当真",
    "剧情",
    "连续剧"
  ];
  const vlogCount = countWorksByTerms(works, vlogTerms);
  const mostlyVlog = works.length >= 4 && vlogCount >= Math.ceil(works.length * 0.5);
  const targetTerms = taskTargetTerms(campaignTask);
  if (targetTerms.length) {
    const taskSignalCount = countWorksByTerms(works, targetTerms);
    if (mostlyVlog) {
      return taskSignalCount >= 2
        ? `主页大半是 vlog/日常流水账，虽然有${campaignTaskLabel(campaignTask)}线索，但只进入待选库，不进入精选库`
        : `主页以泛vlog/日常系列记录为主，且缺少稳定${campaignTaskLabel(campaignTask)}线索，只进入待选库，不进入精选库`;
    }

    return null;
  }

  const policeSchoolIdentityTerms = [
    "警校",
    "警校生",
    "警校生活",
    "警校生日常",
    "公安院校",
    "公安大学",
    "中国人民公安大学",
    "公安大学",
    "警院",
    "研究生",
    "研一",
    "学硕",
    "专硕",
    "学生证",
    "藏蓝青春",
    "训练",
    "宿舍",
    "校园",
    "制服",
    "警服",
    "毕业季",
    "提前批招生工作"
  ];
  const identityCount = countWorksByTerms(works, policeSchoolIdentityTerms);
  const hasStablePoliceSchoolIdentity =
    identityCount >= 2 || includesAny(text, ["警校生", "警校生活", "公安院校", "公安大学", "中国人民公安大学", "研究生", "研一", "学硕", "藏蓝青春"]);

  if (mostlyVlog) {
    return hasStablePoliceSchoolIdentity
      ? "主页大半是 vlog/日常流水账，虽然有警校身份线索，但只进入待选库，不进入精选库"
      : "主页以泛vlog/沉浸式体验/日常系列记录为主，且缺少稳定警校身份线索，只进入待选库，不进入精选库";
  }

  return null;
}

export function getObviousHomepageSkipReason(candidate: DouyinDiscoveryCandidate): string | null {
  const profileText = normalizedText(
    [
      candidate.name,
      candidate.category || ""
    ].join(" ")
  );
  const contentText = normalizedText(
    [
      candidate.name,
      candidate.category || "",
      candidate.sampleTitle || "",
      ...candidate.works.slice(0, 6).map((work) => work.title)
    ].join(" ")
  );

  const hasPoliceSchoolStudyIdentity = includesAny(contentText, [
    "警校",
    "警校生",
    "警校生活",
    "警校青春",
    "公安院校",
    "公安大学",
    "中国人民公安大学",
    "警院",
    "藏蓝青春",
    "训练",
    "宿舍",
    "校园",
    "学生证",
    "研究生",
    "研一",
    "学硕",
    "专硕"
  ]);

  const hardAccountSkipTerms = [
    "封禁",
    "已封",
    "蓝v",
    "蓝V",
    "黄v",
    "黄V",
    "机构",
    "官方",
    "官方号",
    "官方账号",
    "媒体",
    "媒体号"
  ];
  const hardContentSkipTerms = [
    "解说",
    "讲解",
    "讲座",
    "知识分享",
    "规划",
    "培训",
    "志愿",
    "分数线",
    "法考",
    "法学生",
    "法学院",
    "司法考试",
    "法律职业资格",
    "律师备考",
    "老师",
    "咨询",
    "新闻",
    "行业真相",
    "知识分享",
    "科普",
    "普法",
    "案件",
    "事故",
    "美国警察",
    "海外警察"
  ];
  const workingPoliceSkipTerms = [
    "执法",
    "巡逻",
    "办案",
    "执勤",
    "出警",
    "抓捕",
    "民警",
    "特警",
    "交警",
    "辅警",
    "派出所",
    "公安局"
  ];

  const matchedAccount = hardAccountSkipTerms.find((term) => profileText.includes(normalizedText(term)));
  if (matchedAccount) return `${candidate.name} 命中前置跳过词“${matchedAccount}”，不抓主页，节省复筛时间`;

  const matched = hardContentSkipTerms.find((term) => contentText.includes(normalizedText(term)));
  if (matched) return `${candidate.name} 命中前置跳过词“${matched}”，不抓主页，节省复筛时间`;

  const workingPoliceMatched = workingPoliceSkipTerms.find((term) => contentText.includes(normalizedText(term)));
  if (workingPoliceMatched && !hasPoliceSchoolStudyIdentity) {
    return `${candidate.name} 命中前置跳过词“${workingPoliceMatched}”，不抓主页，节省复筛时间`;
  }

  return null;
}

function candidateKeepReason(original: DouyinDiscoveryCandidate, works: DouyinWork[], campaignTask?: HomepageReviewRules["campaignTask"]): string | null {
  const text = normalizedText(
    [
      original.name,
      original.category || "",
      original.sampleTitle || "",
      original.screeningSummary || "",
      original.notes || "",
      ...works.map((work) => work.title)
    ].join(" ")
  );
  const targetTerms = taskTargetTerms(campaignTask);
  if (targetTerms.length && includesAny(text, targetTerms)) {
    return `有${campaignTaskLabel(campaignTask)}相关身份/场景线索，非精选时仍保留到待选库`;
  }

  const policeSchoolIdentityTerms = [
    "警校",
    "警校生",
    "警校生活",
    "警校日常",
    "警校女大",
    "警校大女",
    "公安院校",
    "公安大学",
    "中国人民公安大学",
    "警院",
    "藏蓝青春",
    "学生证",
    "宿舍",
    "训练",
    "校园",
    "在校",
    "研一",
    "研究生",
    "学硕",
    "专硕"
  ];
  const edgeRelevantTerms = [
    "战术",
    "摄影",
    "大疆",
    "osmo",
    "pocket",
    "装备",
    "特警",
    "训练场",
    "制服",
    "警服",
    "警察小熊",
    "警校小熊",
    "周边"
  ];
  const hasPoliceSchoolSignal = includesAny(text, policeSchoolIdentityTerms);
  if (hasPoliceSchoolSignal) {
    return "有警校/公安院校/校园生活身份线索，非精选时仍保留到待选库";
  }

  const hasEdgeSignal = includesAny(text, edgeRelevantTerms);
  if (hasEdgeSignal) {
    return "有战术/摄影/装备/周边等边缘相关线索，非精选时保留待人工判断";
  }

  return null;
}

async function withHomepageDecision(
  original: DouyinDiscoveryCandidate,
  homepage: DouyinDiscoveryCandidate,
  rules?: HomepageReviewRules,
  workLimit = HOMEPAGE_WORK_LIMIT
): Promise<HomepageResult> {
  const recentWorks = homepage.works.slice(0, workLimit);
  const refreshedFans = Math.max(Number(original.fans || 0), Number(homepage.fans || 0));
  const hardHomepageAccountTypes = [
    "official",
    "brand",
    "shop",
    "media",
    "government",
    "school",
    "verified",
    "professional_verified",
    "marketing_agency",
    "education_training"
  ];
  if (
    original.rejectReason ||
    homepage.rejectReason ||
    hardHomepageAccountTypes.includes(String(original.accountType || "").toLowerCase()) ||
    hardHomepageAccountTypes.includes(String(homepage.accountType || "").toLowerCase()) ||
    original.fans >= 100_000 ||
    homepage.fans >= 100_000
  ) {
    const reason = original.rejectReason || homepage.rejectReason
      || (original.fans >= 100_000 || homepage.fans >= 100_000 ? "粉丝数达到或超过10万，命中大V硬排除" : "账号类型命中机构、媒体、认证号或营销培训硬排除");
    return { ok: false, reason: `${original.name || homepage.name}：${reason}`, fans: refreshedFans, aiCalls: 0 };
  }
  const hasRecentUpdate = recentWorks.some(isRecentWork);
  const hasActiveUpdate = recentWorks.some(isActiveWork);
  if (!hasActiveUpdate) return { ok: false, reason: `${original.name || homepage.name}：最近3个月没有有效更新`, fans: refreshedFans, aiCalls: 0 };

  const avgLikes = recentWorks.length
    ? Math.round(recentWorks.reduce((sum, work) => sum + work.likeCount, 0) / recentWorks.length)
    : 0;
  const maxLikes = recentWorks.reduce((max, work) => Math.max(max, work.likeCount), 0);
  const viralWorkCount = recentWorks.filter((work) => work.likeCount > VIRAL_LIKES).length;
  const hasViralWork = viralWorkCount > 0;
  const hasRecentViralWork = recentWorks.some((work) => work.likeCount > VIRAL_LIKES && isRecentWork(work));
  const workCount = recentWorks.length;
  const discoveryTemplate = resolveDiscoveryRuleTemplate(rules?.campaignTask);
  const isMedicalBear = discoveryTemplate.id === "medical-bear";
  const medicalHardRejectReason = isMedicalBear ? medicalHomepageHardRejectReason(original, homepage, recentWorks) : null;
  if (medicalHardRejectReason) {
    return { ok: false, reason: `${original.name || homepage.name}：医护画像硬排除——${medicalHardRejectReason}`, fans: refreshedFans, aiCalls: 0 };
  }
  const aiResult = await requestHomepageAiDecision({
    original: { ...original, fans: refreshedFans },
    recentWorks,
    avgLikes,
    maxLikes,
    viralWorkCount,
    hasRecentUpdate,
    campaignTask: rules?.campaignTask
  });
  const aiDecision = aiResult.decision;

  const keepReason = candidateKeepReason(original, recentWorks, rules?.campaignTask);
  if (aiDecision?.decision === "reject") {
    return { ok: false, reason: `${original.name || homepage.name}：AI画像排除——${aiDecision.reason}`, fans: refreshedFans, aiCalls: aiResult.aiCalls };
  }
  const portraitConcern = nonFeaturedReason(original, recentWorks, rules?.campaignTask);
  // "maybe" is intentionally conservative. When the deterministic template
  // has all required evidence and AI also found a positive target-identity
  // signal, it is safe to advance to the metric gate instead of repeatedly
  // crawling the same complete homepage sample.
  const aiSupported =
    aiDecision?.decision === "pass" ||
    (aiDecision?.decision === "maybe" && Boolean(keepReason));
  // AI 明确判定画像 pass 时先进入待选库，数据是否足够由下一阶段的
  // 数据门槛决定。portraitConcern 属于软提示，只约束 maybe；纯科普、
  // 机构号、无关账号、近乎全 Vlog 等硬排除已在前面直接返回 rejected。
  const portraitPassed = aiDecision?.decision === "pass" || (aiSupported && !portraitConcern);
  const hasCompleteRuleSample = recentWorks.length >= discoveryTemplate.homepageReview.minSamplesForFeatured;
  const portraitRejectedByRules = aiDecision?.decision !== "pass" && Boolean(portraitConcern) && hasCompleteRuleSample;
  const poolStatus = portraitPassed ? "candidate" : portraitRejectedByRules ? "rejected" : "pending_review";
  const screeningStatus = portraitPassed
    ? "portrait_passed"
    : portraitRejectedByRules
      ? "portrait_rejected"
      : "portrait_insufficient";
  const sortedLikes = recentWorks.map((work) => work.likeCount).sort((a, b) => a - b);
  const medianLikes = sortedLikes.length
    ? sortedLikes.length % 2
      ? sortedLikes[Math.floor(sortedLikes.length / 2)]
      : Math.round((sortedLikes[sortedLikes.length / 2 - 1] + sortedLikes[sortedLikes.length / 2]) / 2)
    : 0;

  const screeningSummary = [
    `主页样本已补齐：最近${workCount}条作品中${hasRecentUpdate ? "近1个月有更新" : "近1个月未确认更新，但近3个月有更新"}`,
    aiDecision ? `AI作品画像：${aiDecision.decision}，${aiDecision.reason}` : "AI作品画像：接口未启用或未返回结果，标记为信息不足",
    aiDecision?.decision === "maybe" && keepReason ? `存在目标身份线索，但 AI 证据不足：${keepReason}` : "",
    portraitConcern ? `规则提示：${portraitConcern}` : "",
    portraitPassed
      ? "画像符合，进入待选库"
      : portraitRejectedByRules
        ? "主页样本已完整但不符合画像规则，予以排除"
        : "画像证据不足，等待补采或人工确认",
    hasViralWork ? "出现点赞超过2000的作品" : "未发现点赞超过2000的作品",
    `主页样本平均点赞 ${avgLikes}，中位点赞 ${medianLikes}，最高点赞 ${maxLikes}`,
    hasRecentViralWork ? "近1个月出现爆款" : "近1个月未发现爆款",
    "数据指标已记录，精选阶段不再重复打开主页"
  ].filter(Boolean).join("；");

  return {
    ok: true,
    fans: refreshedFans,
    aiCalls: aiResult.aiCalls,
    candidate: {
      ...toImportCandidate(homepage),
    fans: refreshedFans,
    name: original.name || homepage.name,
    profileUrl: original.profileUrl || homepage.profileUrl,
    category: original.category || homepage.category,
    contact: original.contact,
    quote: original.quote,
    accountType: aiDecision?.accountType || homepage.accountType || original.accountType,
    poolStatus,
    screeningStatus,
    screeningSummary,
    avgLikes,
    maxLikes,
    recentWorkCount: recentWorks.filter(isRecentWork).length,
    viralWorkCount,
    works: recentWorks,
    plays: recentWorks.map((work) => work.likeCount).filter((value) => value > 0),
      notes: `${original.notes || ""}\n\n${screeningSummary}`.trim()
    }
  };
}

export function applyHomepageMetricRules(
  candidate: DouyinDiscoveryCandidate,
  rules?: HomepageReviewRules
): DouyinCandidate {
  const works = candidate.works || [];
  const isDouyin = candidate.platform === "抖音";
  const avgLikesThreshold = Math.max(isDouyin ? 500 : 0, Number(rules?.avgLikesThreshold ?? 500));
  const viralLikesThreshold = Math.max(isDouyin ? 2000 : 0, Number(rules?.viralLikesThreshold ?? 2000));
  const minViralWorks = Math.max(1, Number(rules?.minViralWorks ?? 1));
  const minSampleWorks = Math.max(isDouyin ? 10 : 1, Number(rules?.minSampleWorks ?? 10));
  const viralWorks = works.filter((work) => work.likeCount > viralLikesThreshold);
  const recentViralWorks = viralWorks.filter(isRecentWork);
  const recentWorks = works.filter(isRecentWork);
  const discoveryTemplate = resolveDiscoveryRuleTemplate(rules?.campaignTask);
  const semanticRejectReason = discoveryTemplate.id === "medical-bear"
    ? medicalHomepageHardRejectReason(candidate, candidate, works)
    : null;

  if (semanticRejectReason) {
    const screeningSummary = [
      candidate.screeningSummary || "",
      `内容类型复核未通过：${semanticRejectReason}`,
      "本次仅使用数据库已有主页作品重算，未重新采集、未重新调用 AI"
    ].filter(Boolean).join("；");
    return {
      ...toImportCandidate(candidate),
      poolStatus: "rejected",
      screeningStatus: "portrait_rejected",
      screeningSummary,
      notes: `${candidate.notes || ""}\n\n${screeningSummary}`.trim()
    };
  }

  if (candidate.screeningStatus !== "portrait_passed" || candidate.poolStatus !== "candidate") {
    return {
      ...toImportCandidate(candidate),
      poolStatus: candidate.poolStatus,
      screeningStatus: candidate.screeningStatus,
      screeningSummary: `${candidate.screeningSummary || ""}；画像尚未通过，未执行数据门槛晋级`
    };
  }

  const requiresAvgLikes = isDouyin || isRuleEnabled(rules, "requireAvgLikes500", true);
  const requiresViralWork = isDouyin || isRuleEnabled(rules, "requireViral2000", true);
  const engagementChecks = [
    ...(requiresAvgLikes ? [candidate.avgLikes > avgLikesThreshold] : []),
    ...(requiresViralWork ? [viralWorks.length >= minViralWorks] : [])
  ];
  const engagementMatched = engagementChecks.length === 0
    ? true
    : rules?.metricMatchMode === "any"
      ? engagementChecks.some(Boolean)
      : engagementChecks.every(Boolean);
  const metricsDisabled = engagementChecks.length === 0;
  const requireSampleWorks = isDouyin || isRuleEnabled(rules, "requireWorkCount10", false);
  const requireRecentUpdate = isDouyin || isRuleEnabled(rules, "requireRecentUpdate", false);
  const checks = [
    engagementMatched,
    !requireSampleWorks || works.length >= minSampleWorks,
    !isRuleEnabled(rules, "requireRecentViral", false) || recentViralWorks.length >= minViralWorks,
    !requireRecentUpdate || recentWorks.length > 0
  ];
  const matched = !metricsDisabled && checks.every(Boolean);
  const screeningStatus = matched
    ? recentViralWorks.length
      ? "featured_trending"
      : "featured_stable"
    : candidate.avgLikes > avgLikesThreshold || viralWorks.length
      ? "candidate_potential"
      : "candidate_observe";
  const ruleSummary = [
    requiresAvgLikes ? `平均点赞 > ${avgLikesThreshold}：${candidate.avgLikes > avgLikesThreshold ? "通过" : "未通过"}` : "",
    requiresViralWork ? `点赞 > ${viralLikesThreshold} 的作品至少 ${minViralWorks} 条：${viralWorks.length >= minViralWorks ? "通过" : "未通过"}` : "",
    requireSampleWorks ? `主页样本至少 ${minSampleWorks} 条：${works.length >= minSampleWorks ? "通过" : "未通过"}` : "",
    isRuleEnabled(rules, "requireRecentViral", false) ? `近1个月爆款：${recentViralWorks.length ? "通过" : "未通过"}` : "",
    requireRecentUpdate ? `近1个月更新：${recentWorks.length ? "通过" : "未通过"}` : ""
  ].filter(Boolean);

  return {
    ...toImportCandidate(candidate),
    poolStatus: matched ? "featured" : "candidate",
    screeningStatus,
    screeningSummary: [
      candidate.screeningSummary || "",
      ruleSummary.length ? `数据门槛：${ruleSummary.join("；")}` : "未启用有效数据门槛，不允许进入精选库",
      matched ? "数据门槛通过，进入精选库" : "数据门槛未完全通过，留在待选库"
    ].filter(Boolean).join("；")
  };
}

export async function verifyDouyinHomepageCandidate(
  candidate: DouyinDiscoveryCandidate,
  rules?: HomepageReviewRules
): Promise<HomepageResult> {
  const secUid = secUidFromCandidate(candidate);
  if (!secUid) {
    return { ok: false, reason: `${candidate.name} 缺少 sec_uid 或主页链接，无法复筛` };
  }

  const startedAt = Date.now();
  try {
    await runAgentHomepageCrawl([secUid], HOMEPAGE_WORK_LIMIT);
  } catch (error) {
    return {
      ok: false,
      reason: `${candidate.name} 主页采集失败：${error instanceof Error ? error.message : "未知错误"}`
    };
  }

  const content = await readAgentRecentHomepageRow(secUid, startedAt);
  const homepageCandidates = parseDouyinDiscoveryCandidates(content, candidate.category || "未分类", {
    requireRecentQualified: false,
    includeRejected: true
  });
  const homepageCandidate = homepageCandidates.find((item) => item.secUid === secUid || item.creatorId === secUid) || homepageCandidates[0];

  if (!homepageCandidate?.works.length) {
    return { ok: false, reason: `${candidate.name} 未读取到主页作品，跳过` };
  }

  const verified = await withHomepageDecision(candidate, homepageCandidate, rules);
  return verified;
}

async function verifyDouyinHomepageCandidateWithLimit(
  candidate: DouyinDiscoveryCandidate,
  rules: HomepageReviewRules | undefined,
  workLimit: number
): Promise<HomepageResult> {
  const secUid = secUidFromCandidate(candidate);
  if (!secUid) {
    return { ok: false, reason: `${candidate.name} 缺少 sec_uid 或主页链接，无法复筛` };
  }

  const startedAt = Date.now();
  try {
    await runAgentHomepageCrawl([secUid], workLimit);
  } catch (error) {
    return {
      ok: false,
      reason: `${candidate.name} 主页采集失败：${error instanceof Error ? error.message : "未知错误"}`
    };
  }

  const content = await readAgentRecentHomepageRow(secUid, startedAt);
  const homepageCandidates = parseDouyinDiscoveryCandidates(content, candidate.category || "未分类", {
    requireRecentQualified: false,
    includeRejected: true
  });
  const homepageCandidate = homepageCandidates.find((item) => item.secUid === secUid || item.creatorId === secUid) || homepageCandidates[0];

  if (!homepageCandidate?.works.length) {
    return { ok: false, reason: `${candidate.name} 未读取到主页作品，跳过` };
  }

  const verified = await withHomepageDecision(candidate, homepageCandidate, rules, workLimit);
  return verified;
}

export async function verifyDouyinHomepageCandidateFast(
  candidate: DouyinDiscoveryCandidate,
  rules?: HomepageReviewRules,
  options: HomepageReviewOptions = {}
): Promise<HomepageResult> {
  if (options.skipObviousMismatch) {
    const skipReason = hasCampaignTaskContext(rules) ? null : getObviousHomepageSkipReason(candidate);
    if (skipReason) return { ok: false, reason: skipReason };
  }

  const requestedWorkLimit = Math.max(1, Math.min(Number(options.workLimit || LIGHT_HOMEPAGE_WORK_LIMIT), HOMEPAGE_WORK_LIMIT));
  const workLimit = resolveDiscoveryRuleTemplate(rules?.campaignTask).homepageReview.forceFullSample
    ? HOMEPAGE_WORK_LIMIT
    : requestedWorkLimit;
  const lightResult = await verifyDouyinHomepageCandidateWithLimit(candidate, rules, workLimit);

  if (!lightResult.ok) {
    if (options.allowFullRetry && workLimit < HOMEPAGE_WORK_LIMIT) {
      return verifyDouyinHomepageCandidateWithLimit(candidate, rules, HOMEPAGE_WORK_LIMIT);
    }
    return lightResult;
  }
  if (lightResult.candidate.poolStatus === "featured") return lightResult;

  const needsFullRetry =
    Boolean(options.allowFullRetry) &&
    workLimit < HOMEPAGE_WORK_LIMIT &&
    (lightResult.candidate.screeningStatus === "portrait_insufficient" ||
      isRuleEnabled(rules, "requireWorkCount10", false) ||
      isRuleEnabled(rules, "requireRecentViral", false));

  if (!needsFullRetry) return lightResult;
  return verifyDouyinHomepageCandidateWithLimit(candidate, rules, HOMEPAGE_WORK_LIMIT);
}

export async function verifyDouyinHomepageCandidatesBatch(
  candidates: DouyinDiscoveryCandidate[],
  rules?: HomepageReviewRules,
  options: HomepageReviewOptions = {}
): Promise<HomepageBatchReviewResult[]> {
  const requestedWorkLimit = Math.max(1, Math.min(Number(options.workLimit || LIGHT_HOMEPAGE_WORK_LIMIT), HOMEPAGE_WORK_LIMIT));
  const workLimit = resolveDiscoveryRuleTemplate(rules?.campaignTask).homepageReview.forceFullSample
    ? HOMEPAGE_WORK_LIMIT
    : requestedWorkLimit;
  const prepared = candidates.map((candidate) => {
    const secUid = secUidFromCandidate(candidate);
    const skipReason = options.skipObviousMismatch && !hasCampaignTaskContext(rules) ? getObviousHomepageSkipReason(candidate) : null;
    return { candidate, secUid, skipReason };
  });

  const immediateResults = prepared
    .filter((item) => !item.secUid || item.skipReason)
    .map((item) => ({
      externalId: item.candidate.externalId,
      result: {
        ok: false as const,
        reason: item.skipReason || `${item.candidate.name} 缺少 sec_uid 或主页链接，无法复筛`
      }
    }));

  const crawlItems = prepared.filter((item) => item.secUid && !item.skipReason);
  if (!crawlItems.length) return immediateResults;

  async function reviewFromDiscoverySample(
    item: (typeof crawlItems)[number],
    failureReason: string,
    limit: number
  ): Promise<HomepageBatchReviewResult> {
    if (!item.candidate.works.length) {
      return {
        externalId: item.candidate.externalId,
        result: { ok: false as const, reason: `${item.candidate.name} ${failureReason}；关键词阶段也没有可用作品样本` }
      };
    }

    const fallback = await withHomepageDecision(item.candidate, item.candidate, rules, limit);
    const caveat = `主页接口受限，降级使用关键词阶段已有的 ${Math.min(item.candidate.works.length, limit)} 条作品；结果为低样本判断`;
    if (!fallback.ok) {
      return {
        externalId: item.candidate.externalId,
        result: { ...fallback, reason: `${fallback.reason}；${caveat}` }
      };
    }
    const screeningSummary = String(fallback.candidate.screeningSummary || "")
      .replace(/^主页样本已补齐：/, `${caveat}：`);
    return {
      externalId: item.candidate.externalId,
      result: {
        ...fallback,
        candidate: {
          ...fallback.candidate,
          screeningSummary,
          notes: `${fallback.candidate.notes || ""}\n\n${caveat}`.trim()
        }
      }
    };
  }

  const template = resolveDiscoveryRuleTemplate(rules?.campaignTask);
  // Samples below the hard Douyin metric gate are not reusable as a complete
  // cache hit. Re-crawl them so legacy 6/8-work portraits can reach 10 works.
  const minCachedWorks = Math.max(10, template.homepageReview.minSamplesForFeatured);
  const allSecUids = Array.from(new Set(crawlItems.map((item) => item.secUid)));
  const cachedRowsBySecUid = await readAgentCachedHomepageRows(allSecUids, minCachedWorks);
  const cachedItems = crawlItems.filter((item) => cachedRowsBySecUid.has(item.secUid.toLowerCase()));
  const uncachedItems = crawlItems.filter((item) => !cachedRowsBySecUid.has(item.secUid.toLowerCase()));

  async function reviewItems(
    items: typeof crawlItems,
    limit: number,
    rowsStartedAt: number,
    providedRows?: Map<string, string>
  ): Promise<HomepageBatchReviewResult[]> {
    const retrySecUids = Array.from(new Set(items.map((item) => item.secUid)));
    const retryRowsBySecUid = providedRows || await readAgentRecentHomepageRows(retrySecUids, rowsStartedAt);

    return Promise.all(items.map(async (item) => {
      try {
        const content = retryRowsBySecUid.get(item.secUid.toLowerCase()) || "";
        const homepageCandidates = parseDouyinDiscoveryCandidates(content, item.candidate.category || "未分类", {
          requireRecentQualified: false,
          includeRejected: true
        });
        const homepageCandidate =
          homepageCandidates.find((candidate) => candidate.secUid === item.secUid || candidate.creatorId === item.secUid) || homepageCandidates[0];

        if (!homepageCandidate?.works.length) {
          return reviewFromDiscoverySample(item, "未读取到主页作品", limit);
        }

        const verified = await withHomepageDecision(item.candidate, homepageCandidate, rules, limit);
        return {
          externalId: item.candidate.externalId,
          result: verified
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知错误";
        console.error(`[homepage-review] ${item.candidate.externalId} 画像失败：`, message);
        return {
          externalId: item.candidate.externalId,
          result: { ok: false as const, reason: `${item.candidate.name} 画像处理失败：${message}` }
        };
      }
    }));
  }

  const cachedReviewed = cachedItems.length
    ? await reviewItems(cachedItems, HOMEPAGE_WORK_LIMIT, 0, cachedRowsBySecUid)
    : [];

  let freshlyReviewed: HomepageBatchReviewResult[] = [];
  if (uncachedItems.length) {
    const startedAt = Date.now();
    const secUids = Array.from(new Set(uncachedItems.map((item) => item.secUid)));
    try {
      await runAgentHomepageCrawl(secUids, workLimit);
      freshlyReviewed = await reviewItems(uncachedItems, workLimit, startedAt);
      const unreadableCount = freshlyReviewed.filter(
        (item) => !item.result.ok && /未读取到主页作品/.test(item.result.reason)
      ).length;
      const unhealthyThreshold = Math.max(2, Math.ceil(uncachedItems.length * 0.5));
      if (unreadableCount >= unhealthyThreshold) {
        console.warn(
          `[homepage-review] 主页采集有效率偏低：本批 ${uncachedItems.length} 位需补采达人中有 ${unreadableCount} 位未读取到主页作品。` +
          "继续处理有效达人；空返回账号保留在采集不完整队列，不写成画像信息不足。"
        );
      }
    } catch (error) {
      const batchMessage = error instanceof Error ? error.message : "未知错误";
      console.warn(`[homepage-review] 批量主页采集失败，改用关键词阶段已有作品做低样本画像：${batchMessage}`);
      freshlyReviewed = await Promise.all(
        uncachedItems.map((item) => reviewFromDiscoverySample(item, `主页采集失败：${batchMessage}`, workLimit))
      );
    }
  }
  const reviewed = [...cachedReviewed, ...freshlyReviewed];

  // A cached homepage sample can still be too small or too weak to support a
  // portrait decision. Those creators must be freshly crawled as well; limiting
  // retries to uncachedItems would incorrectly leave them in "待补采" without
  // ever opening the dedicated CDP Chrome.
  const retryItems = options.allowFullRetry && workLimit < HOMEPAGE_WORK_LIMIT
    ? crawlItems.filter((item) => {
        const result = reviewed.find((review) => review.externalId === item.candidate.externalId)?.result;
        if (!result) return false;
        if (!result.ok) return true;
        return result.candidate.screeningStatus === "portrait_insufficient";
      })
    : [];

  if (retryItems.length) {
    const retryStartedAt = Date.now();
    try {
      await runAgentHomepageCrawl(Array.from(new Set(retryItems.map((item) => item.secUid))), HOMEPAGE_WORK_LIMIT, 1);
      const retryReviewed = await reviewItems(retryItems, HOMEPAGE_WORK_LIMIT, retryStartedAt);
      const retryMap = new Map(retryReviewed.map((item) => [item.externalId, item]));
      return [...immediateResults, ...reviewed.map((item) => {
        const retried = retryMap.get(item.externalId);
        if (!retried) return item;
        return {
          ...retried,
          result: {
            ...retried.result,
            aiCalls: Number(item.result.aiCalls || 0) + Number(retried.result.aiCalls || 0)
          }
        };
      })];
    } catch (error) {
      console.warn(
        `[homepage-review] 完整样本重试失败，保留首轮画像结果：${error instanceof Error ? error.message : "未知错误"}`
      );
      return [...immediateResults, ...reviewed];
    }
  }

  return [...immediateResults, ...reviewed];
}
