import { generateOutreachScript, type Creator } from "./creators";
import { buildShushujiaOutreachGuide } from "./brand-outreach-style";

export type AiProvider = "default" | "openai";

export type OutreachCampaignTask = {
  id?: number;
  name?: string;
  productName?: string;
  category?: string;
  targetAudience?: string;
  targetDescription?: string;
  seedKeywords?: string[];
  excludeKeywords?: string[];
  productSellingPoints?: string[];
  outreachTone?: string | null;
};

export type OutreachScriptInput = {
  creator: Creator;
  taskKind?: "initial" | "followup" | "negotiate";
  provider?: AiProvider;
  campaignTask?: OutreachCampaignTask | null;
  works?: Array<{
    title?: string | null;
    likeCount?: number | null;
    publishedAt?: Date | string | null;
  }>;
};

export type OutreachScriptResult = {
  script: string;
  angle: string;
  reason: string;
  portrait: string;
  source: "ai" | "fallback";
  provider: AiProvider;
};

type ApiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

function getApiConfig(provider: AiProvider): ApiConfig | null {
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_COMPARE_API_KEY || process.env.OFFICIAL_OPENAI_API_KEY || "";
    if (!apiKey) return null;

    return {
      apiKey,
      baseUrl: (process.env.OPENAI_COMPARE_BASE_URL || process.env.OFFICIAL_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      model: process.env.OPENAI_COMPARE_MODEL || process.env.OFFICIAL_OPENAI_MODEL || "gpt-4o-mini"
    };
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
  if (!apiKey) return null;

  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, ""),
    model: process.env.OPENAI_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat"
  };
}

function cleanText(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function safeJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function taskKindText(kind: OutreachScriptInput["taskKind"]): string {
  if (kind === "followup") return "二次跟进";
  if (kind === "negotiate") return "报价谈判";
  return "初次建联";
}

function poolStatusText(status: string): string {
  if (status === "featured") return "达人精选库";
  if (status === "candidate") return "达人待选库";
  if (status === "pending_review") return "待复筛";
  if (status === "skipped") return "已跳过";
  if (status === "rejected") return "已排除";
  return status || "未分库";
}

function pickSummaryLines(summary: string): string[] {
  return cleanText(summary)
    .split(/[；\n]/)
    .map((line) => cleanText(line))
    .filter(Boolean)
    .slice(0, 8);
}

function topWorks(input: OutreachScriptInput) {
  return (input.works || [])
    .map((work) => ({
      title: cleanText(work.title),
      likeCount: Number(work.likeCount || 0),
      publishedAt: work.publishedAt ? String(work.publishedAt) : ""
    }))
    .filter((work) => work.title)
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, 8);
}

function inferPersonalAnchors(input: OutreachScriptInput): string[] {
  const text = cleanText([input.creator.name, input.creator.category, input.creator.notes, input.creator.screeningSummary, ...topWorks(input).map((work) => work.title)].join(" "));
  const anchors: string[] = [];
  const add = (label: string) => {
    if (!anchors.includes(label)) anchors.push(label);
  };

  if (/宿舍|寝室|桌面|食堂|校园|日常|vlog/i.test(text)) add("校园/宿舍日常");
  if (/训练|跑操|队列|体能|射击|擒拿|警务技能/.test(text)) add("训练日常");
  if (/毕业|毕业季|毕业照|纪念|离校/.test(text)) add("毕业纪念");
  if (/穿搭|制服|警服|ootd|通勤/.test(text)) add("制服/通勤穿搭");
  if (/小熊|玩偶|周边|挂件|桌面/.test(text)) add("小熊周边");
  if (/健身|腹肌|体能/.test(text)) add("体能/健身生活");

  return anchors.length ? anchors.slice(0, 4) : ["主页内容风格"];
}

function buildTaskContext(task?: OutreachCampaignTask | null) {
  return {
    name: task?.name || "未选择品类任务",
    productName: task?.productName || "【产品名】",
    category: task?.category || "",
    targetAudience: task?.targetAudience || "",
    targetDescription: task?.targetDescription || "",
    seedKeywords: asStringArray(task?.seedKeywords),
    excludeKeywords: asStringArray(task?.excludeKeywords),
    productSellingPoints: asStringArray(task?.productSellingPoints),
    outreachTone: task?.outreachTone || "自然、真诚、像正常私信，不要太商务，不要一上来强报价。"
  };
}

function buildCreatorPortrait(input: OutreachScriptInput): string {
  const creator = input.creator;
  const works = topWorks(input);
  const summaryLines = pickSummaryLines(creator.screeningSummary);

  return [
    `账号：${creator.name}，${creator.category || "未分类"}，${poolStatusText(creator.poolStatus)}`,
    `数据：粉丝 ${formatNumber(creator.fans)}，稳定播放 ${formatNumber(creator.stablePlay)}，建议报价 ¥${formatNumber(creator.suggestedPrice)}，评级 ${creator.grade}`,
    summaryLines.length ? `复筛画像：${summaryLines.join("；")}` : "",
    creator.notes ? `备注：${cleanText(creator.notes)}` : "",
    works.length ? `参考作品：${works.map((work, index) => `${index + 1}. ${work.title}（点赞 ${formatNumber(work.likeCount)}）`).join("；")}` : "",
    `可用切入点：${inferPersonalAnchors(input).join("、")}`
  ]
    .filter(Boolean)
    .join("\n");
}

function fallbackOutreachScript(input: OutreachScriptInput): OutreachScriptResult {
  return {
    script: generateOutreachScript(input.creator),
    angle: "本地兜底话术",
    reason: "未配置 AI 或 AI 返回失败，使用本地兜底话术。",
    portrait: buildCreatorPortrait(input),
    source: "fallback",
    provider: input.provider || "default"
  };
}

function normalizeResult(value: Record<string, unknown>, input: OutreachScriptInput): OutreachScriptResult {
  const fallback = fallbackOutreachScript(input);
  const script = cleanText(value.script);
  if (!script) return fallback;

  return {
    script,
    angle: cleanText(value.angle) || fallback.angle,
    reason: cleanText(value.reason) || fallback.reason,
    portrait: cleanText(value.portrait) || fallback.portrait,
    source: "ai",
    provider: input.provider || "default"
  };
}

export async function generateAiOutreachScript(input: OutreachScriptInput): Promise<OutreachScriptResult> {
  const provider = input.provider || "default";
  const config = getApiConfig(provider);
  if (!config) return fallbackOutreachScript(input);

  const taskContext = buildTaskContext(input.campaignTask);
  const payload = {
    taskKind: taskKindText(input.taskKind),
    brand: {
      name: "蜀黍家",
      product: taskContext.productName,
      targetAudience: taskContext.targetAudience,
      targetDescription: taskContext.targetDescription,
      sellingPoints: taskContext.productSellingPoints,
      outreachTone: taskContext.outreachTone
    },
    taskContext,
    styleGuide: buildShushujiaOutreachGuide(taskContext.productName),
    creatorPortrait: buildCreatorPortrait(input),
    personalAnchors: inferPersonalAnchors(input),
    recentWorks: topWorks(input)
  };

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.85,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "你是蜀黍家的达人商务，擅长写自然、短、像真实私信的达人建联话术。必须只输出可解析 JSON，不要 Markdown。字段包括 script, angle, reason, portrait。生成时必须遵守以下绝对禁止项：禁止出现微信、QQ、手机号、电话、二维码、邮箱、链接、加好友、滴滴我、联系我、私我等任何外部联系方式；禁止出现合作、推广、广告、商务、品牌方求合作、CPS、分佣、佣金、报价、价格、费用等商业敏感词；不要涉及报价、价格、佣金、费用、结算方式等商业细节。"
          },
          {
            role: "user",
            content: [
              "请为下面这个达人生成一条个性化建联私信。",
              "硬性要求：",
              "1. script 控制在 45-110 字，短、自然、像抖音/小红书/微信私信。",
              "2. 必须结合 personalAnchors 或 recentWorks 里的 1 个具体点轻轻带一下，不要写成群发模板。",
              "3. 必须沿用蜀黍家的基础话术风格：宝子、小宝、活动、产品、感兴趣、方便聊聊，但不要照抄示例。",
              "4. 产品名优先使用当前品类任务里的 productName，不要自己乱编品类。",
              "5. 如果任务里有 outreachTone，必须遵守它。",
              "6. 不要写：不是广告、共创优质内容、非常契合、期待您的回复、内容数据还不错。",
              "7. 不确定达人身份时，不要断言身份，改成“刷到你分享过相关内容”。",
              "8. 结尾用轻问句，比如：有兴趣了解一下嘛、方便聊聊吗、宝看有兴趣一起参与吗。",
              "9. 绝对禁止出现任何外部联系方式：微信、QQ、手机号、电话、二维码、邮箱、链接、加好友、滴滴我、联系我、私我等。",
              "10. 绝对禁止出现商业敏感词：合作、推广、广告、商务、品牌方求合作、CPS、分佣、佣金、报价、价格、费用等。",
              "11. 不要涉及报价、价格、佣金、费用、结算方式等商业细节。",
              "12. 每日生成话术前，从示例列表中按日期循环选择 1 个主要切入角度（如按星期 1-7 循环），再在该角度基础上做个性化变体，避免连续两天使用同一套切入。",
              `输入数据：${JSON.stringify(payload, null, 2)}`
            ].join("\n")
          }
        ]
      })
    });

    if (!response.ok) return fallbackOutreachScript(input);

    const data = await response.json().catch(() => null);
    const parsed = safeJsonObject(String(data?.choices?.[0]?.message?.content || ""));
    if (!parsed) return fallbackOutreachScript(input);

    return normalizeResult(parsed, input);
  } catch {
    return fallbackOutreachScript(input);
  }
}
