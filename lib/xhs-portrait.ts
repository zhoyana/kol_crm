import { resolveDiscoveryRuleTemplate, type DiscoveryCampaignTask } from "./discovery-rule-templates";

// ============================================================
// 小红书达人身份画像（对齐抖音 AI 主页画像语义）
// 链路：规则硬排除（0 AI 成本）→ AI 画像确认（DeepSeek）→ 模板判定
// 状态语义（与抖音一致）：
//   pending_review / portrait_insufficient —— 有相关线索但样本不足，等待后续关键词结果补充
//   candidate      / portrait_passed       —— 画像符合，进入数据门槛
//   rejected       / portrait_rejected     —— 明确不符合（媒体/搬运/标签党/辅导号等）
// ============================================================

// 大V/媒体/搬运号硬排除信号（跨模板通用）
const MEDIA_NAME_SIGNALS = [
  "栏目", "官方", "频道", "新闻", "日报", "搬运", "译制", "自翻", "媒体", "传媒",
  "电视台", "民生", "运营", "工作室", "mcn", "报业", "周刊", "晚报", "晨报", "都市报"
];
const FOREIGN_CONTENT_SIGNALS = ["外网评论", "外网", "翻译", "译制", "转载", "搬运"];
// 新闻稿特征词（个人日常笔记极少同时使用这些词）
const NEWS_SIGNALS = ["报道", "网友", "据悉", "据了解", "记者", "采访"];
// 商业/官方/辅导号信号（"官方"需精确化，避免 #官方助推/#官方大大求流量 这类求流量标签误伤）
const PROVIDER_SIGNALS = [
  "考研辅导", "报考指导", "招警培训", "培训机构", "辅导班", "代购", "中介",
  "官方账号", "官方客服", "官方号", "官方店", "官方店铺",
  "政务号", "媒体号", "资讯号", "传媒", "反诈宣传", "普法栏目", "案件解说", "新闻号",
  "报考", "招生", "辅导", "联考培训", "咨询号"
];
const FAN_HARD_LIMIT = 100_000;
const TITLE_SAMPLE_LIMIT = 150;

type XhsAiDecision = {
  decision: "pass" | "maybe" | "reject";
  confidence: number;
  accountType: string;
  reason: string;
  positiveSignals: string[];
  negativeSignals: string[];
};

export type XhsPortraitResult = {
  ok: boolean;
  poolStatus: "pending_review" | "candidate" | "rejected";
  screeningStatus: "portrait_insufficient" | "portrait_passed" | "portrait_rejected";
  screeningSummary: string;
  aiCalls: number;
  reason: string;
};

function normalized(value: string): string {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

// 去掉话题标签，避免标签党（在非警校内容中打 #警校生 标签）混入
function stripTags(text: string): string {
  return String(text || "").replace(/#[^\s#]+/g, " ").replace(/\s+/g, " ").trim();
}

function safeJsonObject(text: string): Record<string, unknown> {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeAccountType(value: unknown): string {
  const normalized = String(value || "").trim();
  return normalized || "possible_target";
}

// 任务目标词表：模板 identityTerms 为空（generic）时退回任务文本拆词
function identityTermSource(task?: DiscoveryCampaignTask | null): string[] {
  const template = resolveDiscoveryRuleTemplate(task);
  const identityTerms = template.homepageReview.identityTerms || [];
  if (identityTerms.length) return identityTerms;
  const taskText = [
    task?.targetAudience || "",
    task?.targetDescription || "",
    ...(Array.isArray(task?.seedKeywords) ? task.seedKeywords : [])
  ].join(" ");
  return Array.from(
    new Set(
      taskText
        .split(/[,，、\n\s]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2)
    )
  );
}

function isMedicalCampaign(task?: DiscoveryCampaignTask | null): boolean {
  const text = [
    task?.name || "",
    task?.productName || "",
    task?.targetAudience || "",
    task?.targetDescription || "",
    ...(Array.isArray(task?.seedKeywords) ? task.seedKeywords : [])
  ].join(" ");
  return /医护|医学生|医学|护士|护理|医生|规培|医院/.test(text);
}

function medicalPortraitGuidance(task?: DiscoveryCampaignTask | null): string[] {
  if (!isMedicalCampaign(task)) return [];
  return [
    "",
    "【医护小熊专属三档画像（优先级高于通用规则）】",
    "先总结最近作品的账号主线，再判精选/待选/排除；确认作者是医护，只代表身份真实，不代表适合精选。",
    "- pass（精选）：本人医学生/护士/医生/规培身份明确；最近作品持续出现真实学习或工作场景（医院、科室、病房、轮转、值班、夜班、查房、实习、规培等）；整体表达正向、自然、有亲和力，同时包含生活、美食、朋友、成长或兴趣等个人表达。",
    "- maybe（待选）：本人医护身份可信，但最近作品中医护学习/工作内容占比不高、只有少量置顶记录，主页更多是普通生活；或真实场景有一些但样本不足、情绪方向尚不稳定。此类保留，未来补采后可能进入精选。",
    "- reject（排除）：主页主线是抱怨患者/家属/同事、职业怨气、负面吐槽、医患冲突或持续传播消极职业情绪；即使互动高、身份真实也不适合合作。",
    "- reject（排除）：主页主线是考研/保研/护考/考编/招聘考试倒计时、刷题打卡、上岸经验、成绩资料或备考陪伴；个人正在备考不等于培训机构，但受众和内容主线仍不符合本次合作。",
    "- reject（排除）：机构培训、课程资料、报考咨询、医学科普/疾病答疑、医护职业包装的泛娱乐段子或剧情演绎占主页多数。",
    "- 单条高赞医护作品不能覆盖主页主线；至少结合最近多篇作品判断内容占比和持续性。",
    "- 情绪判断看持续主线：偶尔表达辛苦不直接排除；连续多篇以攻击、嘲讽、抱怨和冲突为卖点才 reject。",
    "- 正向不等于喊口号：真实成长、认真工作、同事互动、患者善意、生活热爱和轻松幽默都属于正向信号。",
    "",
    "【本批人工标注锚点】",
    "- 儿科护士持续吐槽患者、家属、实习生或医患矛盾：reject。",
    "- 医学生长期以考研倒计时、备考打卡为主页主线：reject。",
    "- 护士只有少数护理工作记录，其他多为饮食、旅行、日常生活：maybe，进入待选等待补采。",
    "- 医护身份可信，但医院/工作内容只占少数、主页主线不够明确：maybe。",
    "- 规培/医院经历稳定且真实，内容积极友善，同时有生活分享和成长表达：pass。"
  ];
}

function buildXhsPortraitPrompt(input: {
  name: string;
  fans: number;
  works: Array<{ title: string }>;
  task?: DiscoveryCampaignTask | null;
}): string {
  const template = resolveDiscoveryRuleTemplate(input.task);
  const targetContext = input.task
    ? [
        `当前品类任务：${input.task.name || ""}`,
        `推广产品：${input.task.productName || ""}`,
        `目标人群：${input.task.targetAudience || ""}`,
        `筛选目标：${input.task.targetDescription || ""}`,
        `采集关键词：${(input.task.seedKeywords || []).join("、")}`,
        `排除方向：${(input.task.excludeKeywords || []).join("、")}`
      ].join("\n")
    : "业务目标：寻找目前在校或高度疑似在校的警校生/公安院校学生个人创作者，用于警察小熊周边类合作。";
  const works = input.works.slice(0, 10).map((work, index) => {
    const title = String(work.title || "").replace(/\s+/g, " ").trim();
    return `${index + 1}. ${title.slice(0, TITLE_SAMPLE_LIMIT)}`;
  });

  return [
    "你是小红书达人作品画像助手。请根据作者昵称、粉丝数和关键词搜索得到的笔记标题集合，判断这个账号整体是否符合当前品类的目标画像。",
    "",
    targetContext,
    `当前达人发现规则模板：${template.name} v${template.version}`,
    ...template.homepageReview.instructions.map((line) => `- ${line}`),
    ...medicalPortraitGuidance(input.task),
    "",
    "【小红书样本说明（务必遵守）】",
    "1. 小红书关键词搜索可能只返回该作者 1-2 篇笔记；样本不足时只能判 maybe，不能仅凭单篇放行。",
    "2. 判断重点是账号整体是否像目标人群，不是单条标题是否命中关键词。",
    "3. 昵称本身可以作为身份线索：昵称明显指向目标身份（如含学校名、职业、在校身份）时，应视为正向信号。",
    "4. vlog、plog、日常等形式词本身不是身份或优质生活证据；泛校园 vlog、泛情绪 vlog、标签式医学生 vlog 不能仅凭形式放行。",
    "",
    "【必须拒绝的账号类型】",
    "- 仅打 #警校生 等目标标签、但笔记内容与目标人群生活完全无关的标签党账号。",
    "- 剧情小说、AI 创作/AIGC、小说推文、游戏娱乐、电影盘点、泛知识盘点等，即使带目标标签也要拒绝。",
    "- 新闻稿式标题（出现“报道”“网友”“记者”“据悉”“抓获嫌疑人”等新闻口吻）疑似媒体/栏目号，要拒绝。",
    "- 考研辅导、报考咨询、招生宣传、培训课程账号，即使内容提到目标人群也要拒绝。",
    "- 搬运、译制、外网内容账号，名称含栏目/官方/频道/媒体/运营/工作室等信号，粉丝超过 10 万的大 V，都要拒绝。",
    "- 警察执法、新闻案件、普法反诈科普类内容（即使与警察相关），不属于目标画像。",
    "",
    "【决策边界】",
    "- pass：昵称/笔记稳定指向作者本人是目标人群，且有个人视角的校园、宿舍、训练、上课、穿搭、通勤等日常表达。",
    "- maybe：有目标身份线索，但样本太少、只有标签或口号式文案、不够确定。",
    "- reject：媒体/栏目/机构/培训/辅导/招生/新闻/搬运/译制/娱乐/剧情/AIGC/标签党，或内容与目标人群生活无关。",
    "",
    "输出必须是 JSON，不要 Markdown。",
    'JSON 结构：{"decision":"pass|maybe|reject","confidence":0.0,"accountType":"target_person|possible_target|official_media|education_training|marketing|entertainment|off_target","reason":"","positiveSignals":[],"negativeSignals":[]}',
    "",
    `作者昵称：${input.name}`,
    `作者粉丝数：${input.fans}`,
    `笔记样本数：${works.length}`,
    `笔记标题（已去掉话题标签）：\n${works.join("\n")}`
  ].join("\n");
}

async function requestXhsAiDecision(input: {
  name: string;
  fans: number;
  works: Array<{ title: string }>;
  task?: DiscoveryCampaignTask | null;
}): Promise<{ decision: XhsAiDecision | null; aiCalls: number }> {
  const useDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);
  const apiKey = useDeepSeek ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey || !input.works.length) return { decision: null, aiCalls: 0 };

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
          { role: "user", content: buildXhsPortraitPrompt(input) }
        ]
      }),
      signal: AbortSignal.timeout(60_000)
    });
  } catch (error) {
    console.error(`[xhs-portrait] ${input.name} 请求失败：`, error instanceof Error ? error.message : error);
    return { decision: null, aiCalls: 1 };
  }

  if (!response.ok) {
    console.error(`[xhs-portrait] ${input.name} HTTP ${response.status}`);
    return { decision: null, aiCalls: 1 };
  }
  const data = await response.json().catch(() => null);
  const parsed = safeJsonObject(String(data?.choices?.[0]?.message?.content || ""));
  const decision = String(parsed.decision || "");
  if (!["pass", "maybe", "reject"].includes(decision)) {
    return { decision: null, aiCalls: 1 };
  }
  return {
    aiCalls: 1,
    decision: {
      decision: decision as XhsAiDecision["decision"],
      confidence: Math.max(0, Math.min(Number(parsed.confidence || 0.5), 1)),
      accountType: normalizeAccountType(parsed.accountType),
      reason: String(parsed.reason || "AI 未给出明确原因"),
      positiveSignals: Array.isArray(parsed.positiveSignals) ? parsed.positiveSignals.map(String) : [],
      negativeSignals: Array.isArray(parsed.negativeSignals) ? parsed.negativeSignals.map(String) : []
    }
  };
}

export async function evaluateXhsCreatorPortrait(input: {
  name: string;
  fans: number;
  works: Array<{ title: string }>;
  task?: DiscoveryCampaignTask | null;
  disableAi?: boolean;
}): Promise<XhsPortraitResult> {
  const template = resolveDiscoveryRuleTemplate(input.task);
  const review = template.homepageReview;
  const cleanName = normalized(input.name);
  const allRawText = normalized([input.name, ...input.works.map((work) => String(work.title || ""))].join(" "));

  // ---- 第一层：规则硬排除（0 AI 成本）----
  const mediaMatch = MEDIA_NAME_SIGNALS.find((signal) => cleanName.includes(signal));
  if (mediaMatch) {
    return { ok: false, poolStatus: "rejected", screeningStatus: "portrait_rejected",
      screeningSummary: `小红书达人身份验证：名称命中媒体/搬运/官方号信号"${mediaMatch}"，画像不通过`,
      aiCalls: 0, reason: `名称命中媒体/搬运/官方号信号"${mediaMatch}"` };
  }
  const foreignMatch = FOREIGN_CONTENT_SIGNALS.find((signal) => allRawText.includes(signal));
  if (foreignMatch) {
    return { ok: false, poolStatus: "rejected", screeningStatus: "portrait_rejected",
      screeningSummary: `小红书达人身份验证：内容命中搬运/外网信号"${foreignMatch}"，画像不通过`,
      aiCalls: 0, reason: `内容命中搬运/外网信号"${foreignMatch}"` };
  }
  if (input.fans > FAN_HARD_LIMIT) {
    return { ok: false, poolStatus: "rejected", screeningStatus: "portrait_rejected",
      screeningSummary: `小红书达人身份验证：粉丝数 ${input.fans.toLocaleString()} > 10万，极大概率不是目标人群个人号`,
      aiCalls: 0, reason: `粉丝数 ${input.fans.toLocaleString()} > 10万` };
  }
  const provider = PROVIDER_SIGNALS.find((signal) => allRawText.includes(signal));
  if (provider) {
    return { ok: false, poolStatus: "rejected", screeningStatus: "portrait_rejected",
      screeningSummary: `小红书达人身份验证：命中疑似商业/官方/辅导号信号"${provider}"，画像不通过`,
      aiCalls: 0, reason: `命中疑似商业/官方/辅导号信号"${provider}"` };
  }
  const newsMatch = input.works.find((work) => {
    const text = normalized(stripTags(work.title || ""));
    return NEWS_SIGNALS.filter((signal) => text.includes(signal)).length >= 2;
  });
  if (newsMatch) {
    const hits = NEWS_SIGNALS.filter((signal) => normalized(stripTags(newsMatch.title || "")).includes(signal));
    return { ok: false, poolStatus: "rejected", screeningStatus: "portrait_rejected",
      screeningSummary: `小红书达人身份验证：作品呈现新闻稿特征（命中"${hits.join("、")}"），疑似新闻媒体账号`,
      aiCalls: 0, reason: `作品呈现新闻稿特征（命中"${hits.join("、")}"）` };
  }

  // ---- 第二层：规则证据（模板词表 + 个人场景）----
  const identityTerms = identityTermSource(input.task);
  const identityCount = input.works.filter((work) => {
    const text = normalized(stripTags(work.title || ""));
    return identityTerms.some((term) => text.includes(term));
  }).length;
  const lifestyleCount = input.works.filter((work) => {
    const text = normalized(stripTags(work.title || ""));
    return review.lifestyleTerms.some((term) => text.includes(normalized(term)));
  }).length;
  const medicalSceneTerms = ["医院", "值班", "夜班", "规培", "实习", "轮转", "科室", "门诊", "病房", "查房", "白大褂", "护士", "医生", "护理"];
  const medicalExamTerms = ["考研", "保研", "护考", "考编", "考公", "招聘考试", "倒数", "倒计时", "刷题", "备考", "上岸", "分数线"];
  const medicalComplaintTerms = ["吐槽", "被骂", "打耳光", "生气", "受气", "气死", "哭了", "心酸", "不允许", "烦死", "崩溃", "委屈", "奇葩", "无语", "不配合", "最烦", "医患冲突", "患者气"];
  const allContent = normalized(input.works.map((work) => stripTags(work.title || "")).join(" "));
  const hasVlogForm = /vlog|plog/.test(allContent);
  const hasConcreteMedicalScene = medicalSceneTerms.some((term) => allContent.includes(normalized(term)));
  const genericVlogOnly = hasVlogForm && !hasConcreteMedicalScene;
  const medicalCampaign = isMedicalCampaign(input.task);
  const medicalSceneCount = input.works.filter((work) => {
    const text = normalized(stripTags(work.title || ""));
    return medicalSceneTerms.some((term) => text.includes(normalized(term)));
  }).length;
  const medicalExamCount = input.works.filter((work) => {
    const text = normalized(stripTags(work.title || ""));
    return medicalExamTerms.some((term) => text.includes(normalized(term)));
  }).length;
  const medicalComplaintCount = input.works.filter((work) => {
    const text = normalized(stripTags(work.title || ""));
    return medicalComplaintTerms.some((term) => text.includes(normalized(term)));
  }).length;
  const medicalDominantThreshold = Math.max(3, Math.ceil(input.works.length * 0.5));
  const medicalFeaturedEvidence = input.works.length >= 5 && medicalSceneCount >= 3 && medicalSceneCount / input.works.length >= 0.5;

  if (medicalCampaign && medicalExamCount >= medicalDominantThreshold) {
    const reason = `医护画像硬排除：最近 ${input.works.length} 篇中 ${medicalExamCount} 篇为考研/护考/考编等备考内容，主页主线不符合合作画像`;
    return { ok: false, poolStatus: "rejected", screeningStatus: "portrait_rejected", screeningSummary: reason, aiCalls: 0, reason };
  }
  if (medicalCampaign && medicalComplaintCount >= medicalDominantThreshold) {
    const reason = `医护画像硬排除：最近 ${input.works.length} 篇中 ${medicalComplaintCount} 篇为患者/家属/职业负面吐槽，账号情绪主线不适合合作`;
    return { ok: false, poolStatus: "rejected", screeningStatus: "portrait_rejected", screeningSummary: reason, aiCalls: 0, reason };
  }
  // 数量只展示为参考，不再硬性要求 8/3/2；至少需要明确身份线索，
  // 且不能只是泛 vlog/plog 形式或医学生标签。
  const softIdentityEvidence = identityCount >= 1 && !genericVlogOnly;
  const evidenceStatus = `主页样本 ${input.works.length} 篇、身份作品 ${identityCount} 篇、非职业生活作品 ${lifestyleCount} 篇（数量仅参考）`;

  // ---- 第三层：AI 画像确认 ----
  if (input.disableAi) {
    const passed = softIdentityEvidence && (!medicalCampaign || medicalFeaturedEvidence);
    const reason = passed
      ? `具备明确身份证据且不是泛 vlog（${evidenceStatus}），进入待选`
      : medicalCampaign && !medicalFeaturedEvidence
        ? `真实医护学习/工作内容占比不足（${medicalSceneCount}/${input.works.length}），进入待选等待补采`
        : `身份依据不足或仅为泛 vlog（${evidenceStatus}），等待主页作品补齐`;
    return {
      ok: passed,
      poolStatus: passed ? "candidate" : "pending_review",
      screeningStatus: passed ? "portrait_passed" : "portrait_insufficient",
      screeningSummary: `小红书达人身份验证：${reason}`,
      aiCalls: 0,
      reason
    };
  }

  const aiResult = await requestXhsAiDecision({
    name: input.name,
    fans: input.fans,
    works: input.works,
    task: input.task
  });
  const ai = aiResult.decision;

  // 规则证据只用于 AI 不确定/不可用时兜底；AI 明确 reject 时不得强制覆盖。
  const evidenceOverride = identityCount >= 2 && !genericVlogOnly;

  let outcome: "passed" | "insufficient" | "rejected";
  let reason: string;
  if (ai?.decision === "pass") {
    if (softIdentityEvidence && (!medicalCampaign || medicalFeaturedEvidence)) {
      outcome = "passed";
      reason = `AI 画像确认符合，数量不作硬限制（${evidenceStatus}；${ai.accountType}）：${ai.reason}`;
    } else {
      outcome = "insufficient";
      reason = medicalCampaign && !medicalFeaturedEvidence
        ? `AI 判断身份可能符合，但真实医护学习/工作内容占比不足（${medicalSceneCount}/${input.works.length}），进入待选等待补采：${ai.reason}`
        : `AI 判断可能符合，但身份依据不足或仅为泛 vlog（${evidenceStatus}），等待主页作品补齐：${ai.reason}`;
    }
  } else if (ai?.decision === "reject") {
    outcome = "rejected";
    reason = `AI 画像明确排除（${ai.accountType}）：${ai.reason}`;
  } else if (ai?.decision === "maybe") {
    // AI 不确定时，有充分规则证据才放行；否则保留，等待后续关键词采到同一作者的新作品。
    if (evidenceOverride && (!medicalCampaign || medicalFeaturedEvidence)) {
      outcome = "passed";
      reason = `AI 画像待观察，但已有多篇身份依据且不是泛 vlog（${evidenceStatus}）：${ai.reason}`;
    } else {
      outcome = "insufficient";
      reason = `AI 画像待观察，当前身份依据不足或仅为泛 vlog（${evidenceStatus}），等待主页作品补齐：${ai.reason}`;
    }
  } else {
    // AI 不可用/失败：降级为规则证据判定
    if (evidenceOverride && (!medicalCampaign || medicalFeaturedEvidence)) {
      outcome = "passed";
      reason = `AI 画像不可用，按多篇身份依据放行（${evidenceStatus}）`;
    } else {
      outcome = "insufficient";
      reason = `AI 画像不可用且身份依据不足或仅为泛 vlog（${evidenceStatus}），等待主页作品补齐`;
    }
  }

  return {
    ok: outcome === "passed",
    poolStatus: outcome === "passed" ? "candidate" : outcome === "insufficient" ? "pending_review" : "rejected",
    screeningStatus: outcome === "passed" ? "portrait_passed" : outcome === "insufficient" ? "portrait_insufficient" : "portrait_rejected",
    screeningSummary: `小红书达人身份验证（AI 画像）：${reason}`,
    aiCalls: aiResult.aiCalls,
    reason
  };
}
