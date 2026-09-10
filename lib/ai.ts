import type { Creator } from "./creators";
import { formatNumber, generateOutreachScript } from "./creators";
import { buildShushujiaOutreachGuide } from "./brand-outreach-style";

export type AiEvaluationResult = {
  matchScore: number;
  recommendedAction: string;
  suggestedCooperation: string;
  riskTags: string[];
  reason: string;
  negotiationPoint: string;
  outreachScript: string;
  source: "ai" | "fallback";
};

type ApiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

function fallbackEvaluation(creator: Creator): AiEvaluationResult {
  const isExpensive = creator.currentCpm != null && creator.currentCpm > 20;
  const score = creator.stablePlay >= 100000 ? 88 : creator.stablePlay >= 50000 ? 80 : creator.stablePlay >= 20000 ? 68 : 52;

  return {
    matchScore: score,
    recommendedAction: creator.poolStatus === "featured" ? "建议建联" : creator.poolStatus === "candidate" ? "可进入建联验证" : "暂缓",
    suggestedCooperation: creator.stablePlay > 100000 ? "轻量内容合作 / 场景化植入" : "轻量内容合作 / 询价测试",
    riskTags: isExpensive ? ["报价偏高"] : creator.stablePlay === 0 ? ["播放数据不足"] : [],
    reason: `该达人稳定播放约 ${formatNumber(creator.stablePlay)}。${
      isExpensive ? "当前 CPM 高于目标 CPM 15，建议先谈价。" : "数据可以进入建联验证。"
    }`,
    negotiationPoint: `建议以 ¥${formatNumber(creator.suggestedPrice)} 作为谈价锚点，围绕稳定播放量和目标 CPM 15 沟通。`,
    outreachScript: generateOutreachScript(creator),
    source: "fallback"
  };
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

function normalizeEvaluation(value: unknown, creator: Creator): AiEvaluationResult {
  const fallback = fallbackEvaluation(creator);
  const data = value as Partial<AiEvaluationResult>;
  const riskTags = Array.isArray(data.riskTags) ? data.riskTags.map(String) : fallback.riskTags;
  const outreachScript = String(data.outreachScript || "").trim();

  if (!outreachScript) return fallback;

  return {
    matchScore: Math.max(0, Math.min(100, Number(data.matchScore ?? fallback.matchScore))),
    recommendedAction: String(data.recommendedAction ?? fallback.recommendedAction),
    suggestedCooperation: String(data.suggestedCooperation ?? fallback.suggestedCooperation),
    riskTags,
    reason: String(data.reason ?? fallback.reason),
    negotiationPoint: String(data.negotiationPoint ?? fallback.negotiationPoint),
    outreachScript,
    source: "ai"
  };
}

function apiConfig(): ApiConfig | null {
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
    .split(/[；;\n]/)
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line) => /AI|画像|复筛|精选|待选|爆款|平均点赞|近1个月|作品数|警校|训练|宿舍|毕业|vlog|日常|非精选|跳过|排除/.test(line))
    .slice(0, 8);
}

function inferPersonalAnchors(creator: Creator): string[] {
  const text = cleanText([creator.name, creator.category, creator.notes, creator.screeningSummary].join(" "));
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
  if (/招生|报考|升学|联考|法考|法学生|官方|媒体|新闻|科普/.test(text)) add("需要谨慎确认的账号属性");

  return anchors.length ? anchors.slice(0, 4) : ["主页内容风格"];
}

function creatorPortrait(creator: Creator): string {
  const summaryLines = pickSummaryLines(creator.screeningSummary);
  const anchors = inferPersonalAnchors(creator);

  return [
    `账号：${creator.name}`,
    `库类型：${poolStatusText(creator.poolStatus)}`,
    `类目/标签：${creator.category || "未分类"}`,
    `数据：粉丝 ${formatNumber(creator.fans)}，稳定播放 ${formatNumber(creator.stablePlay)}，建议报价 ¥${formatNumber(creator.suggestedPrice)}`,
    summaryLines.length ? `复筛画像：${summaryLines.join("；")}` : "",
    creator.notes ? `备注：${cleanText(creator.notes)}` : "",
    `可用切入点：${anchors.join("、")}`
  ]
    .filter(Boolean)
    .join("\n");
}

export async function evaluateCreatorWithAi(creator: Creator): Promise<AiEvaluationResult> {
  const config = apiConfig();
  if (!config) return fallbackEvaluation(creator);

  const productName = "警察小熊周边";
  const payload = {
    brand: {
      name: "蜀黍家",
      product: productName,
      targetAudience: "在校警校生、警校生活内容创作者、适合警察小熊或相关周边自然植入的个人账号",
      productContext: "产品偏警校身份记忆、宿舍桌面、训练包挂件、毕业纪念、日常小礼物，不适合官方号、媒体号、纯科普号和已从业警察工作号。"
    },
    styleGuide: buildShushujiaOutreachGuide(productName),
    creator: {
      name: creator.name,
      platform: creator.platform,
      category: creator.category,
      profileUrl: creator.profileUrl,
      fans: creator.fans,
      avgPlay: creator.avgPlay,
      stablePlay: creator.stablePlay,
      quote: creator.quote,
      currentCpm: creator.currentCpm,
      suggestedPrice: creator.suggestedPrice,
      outreachStatus: creator.outreachStatus,
      portrait: creatorPortrait(creator),
      personalAnchors: inferPersonalAnchors(creator)
    }
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
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是蜀黍家的品牌商务，负责判断达人合作价值，并生成自然短私信。必须只输出可解析 JSON，不要 Markdown。字段包括 matchScore, recommendedAction, suggestedCooperation, riskTags, reason, negotiationPoint, outreachScript。"
          },
          {
            role: "user",
            content: [
              "请基于达人画像评估这个达人，并生成一条有区分度的建联话术。",
              "判断规则：",
              "1. 优先看 creator.portrait 和 personalAnchors，不要只按播放量写通用话术。",
              "2. 如果疑似官方号、媒体号、营销号、纯科普/新闻号、已从业警察工作号，要降低分数并写入 riskTags。",
              "3. 如果是普通在校警校生或高度疑似警校生，即使内容生活化、vlog、穿搭、训练、毕业，也可以尝试合作。",
              "话术规则：",
              buildShushujiaOutreachGuide(productName),
              "4. outreachScript 控制在 45-95 字，像抖音/小红书/微信私信，不要像商务邮件。",
              "5. outreachScript 必须自然引用 1 个 personalAnchor 或画像里的具体场景。",
              "6. 不要照抄参考样本，不要写“不是广告”“共创优质内容”“期待您的回复”。",
              "7. 不确定身份时不要断言“你是警校生”，改成“刷到你分享过警校/训练/校园相关内容”。",
              `输入数据：${JSON.stringify(payload, null, 2)}`
            ].join("\n")
          }
        ]
      })
    });

    if (!response.ok) return fallbackEvaluation(creator);

    const data = await response.json().catch(() => null);
    const parsed = safeJsonObject(String(data?.choices?.[0]?.message?.content || ""));
    if (!parsed) return fallbackEvaluation(creator);

    return normalizeEvaluation(parsed, creator);
  } catch {
    return fallbackEvaluation(creator);
  }
}
