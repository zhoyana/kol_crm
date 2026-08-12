import { buildShushujiaOutreachGuide } from "./brand-outreach-style";
import type { AiProvider } from "./outreach-script";

export type ReplyMessage = {
  direction: "inbound" | "outbound";
  content: string;
  sentAt?: string | Date | null;
};

export type ReplyCreatorContext = {
  id: number;
  name: string;
  profileUrl?: string | null;
  category?: string | null;
  outreachStatus?: string;
  suggestedPrice?: number | null;
  quote?: number | null;
};

export type ReplyCampaignContext = {
  productName?: string;
  targetAudience?: string;
  productSellingPoints?: string[];
  outreachTone?: string | null;
};

export type ReplyAnalysisInput = {
  messages: ReplyMessage[];
  creator: ReplyCreatorContext;
  campaign?: ReplyCampaignContext | null;
  provider?: AiProvider;
};

export type ReplyAnalysis = {
  intent: string;
  intentLabel: string;
  sentiment: string;
  sentimentLabel: string;
  summary: string;
  suggestedAction: string;
  draft: string;
  draftReason: string;
  riskLevel: string;
  source: "ai" | "fallback";
};

type ApiConfig = { apiKey: string; baseUrl: string; model: string };

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
  return String(value || "").replace(/\s+/g, " ").trim();
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

function formatMessageTimeline(messages: ReplyMessage[]): string {
  return messages
    .slice(-30)
    .map((message, index) => {
      const role = message.direction === "outbound" ? "我方" : "达人";
      const time = message.sentAt
        ? new Date(message.sentAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
        : "";
      return `${index + 1}. [${role}]${time ? `(${time})` : ""}: ${cleanText(message.content)}`;
    })
    .join("\n");
}

function buildCreatorContext(creator: ReplyCreatorContext): string {
  const lines = [
    `达人昵称：${creator.name}`,
    creator.category ? `账号类型：${creator.category}` : "",
    creator.outreachStatus ? `当前建联状态：${creator.outreachStatus}` : "",
    creator.suggestedPrice ? `建议报价：¥${creator.suggestedPrice}` : "",
    creator.quote ? `达人报价：¥${creator.quote}` : ""
  ].filter(Boolean);
  return lines.join("\n");
}

function buildCampaignContext(campaign?: ReplyCampaignContext | null): string {
  if (!campaign) return "未绑定品类任务，请根据达人回复内容自然回复。";
  const points = (campaign.productSellingPoints || []).filter(Boolean);
  return [
    campaign.productName ? `推广产品：${campaign.productName}` : "",
    campaign.targetAudience ? `目标人群：${campaign.targetAudience}` : "",
    points.length ? `产品卖点：${points.join("、")}` : "",
    campaign.outreachTone ? `话术语调：${campaign.outreachTone}` : ""
  ].filter(Boolean).join("\n");
}

function fallbackAnalysis(input: ReplyAnalysisInput): ReplyAnalysis {
  const inboundMessages = input.messages.filter((m) => m.direction === "inbound");
  const lastInbound = inboundMessages[inboundMessages.length - 1];
  const lastContent = cleanText(lastInbound?.content || "");

  let intent = "needs_followup";
  let intentLabel = "需要跟进";
  let sentiment = "neutral";
  let sentimentLabel = "中性";

  if (/多少钱|报价|价格|费用|合作费|坑位|预算/.test(lastContent)) {
    intent = "price_inquiry";
    intentLabel = "报价咨询";
  } else if (/不感兴趣|不需要|算了|不用了|没兴趣|拒绝/.test(lastContent)) {
    intent = "declined";
    intentLabel = "婉拒";
    sentiment = "negative";
    sentimentLabel = "消极";
  } else if (/可以|好的|感兴趣|想了解|怎么合作|发来看看|可以聊聊/.test(lastContent)) {
    intent = "interested";
    intentLabel = "感兴趣";
    sentiment = "positive";
    sentimentLabel = "积极";
  }

  const productName = input.campaign?.productName || "产品";
  const draft = intent === "price_inquiry"
    ? `宝子你好呀，这边是蜀黍家，我们这边${productName}的合作主要是按作品结算的，具体看宝的账号数据来定，方便发一下你的报价嘛？`
    : intent === "interested"
    ? `太好了宝子！这边是蜀黍家，${productName}的活动按照你主页风格拍就行，我把具体要求发你看下？`
    : intent === "declined"
    ? `好的宝子，没关系的，以后有合适的机会再合作呀～`
    : `宝子你好呀，不知道上条消息有没有看到，这边是蜀黍家，${productName}的活动还在进行中，宝看有兴趣了解一下嘛？`;

  return {
    intent,
    intentLabel,
    sentiment,
    sentimentLabel,
    summary: `本地规则识别为「${intentLabel}」，未调用 AI。`,
    suggestedAction: intent === "declined" ? "标记为暂不合作，保留后续触达。" : intent === "price_inquiry" ? "回复报价规则并询问达人报价。" : "继续推进合作流程。",
    draft,
    draftReason: "未配置 AI 或 AI 返回失败，使用意图兜底草稿。",
    riskLevel: intent === "price_inquiry" || intent === "needs_followup" ? "medium" : "low",
    source: "fallback"
  };
}

function normalizeResult(value: Record<string, unknown>, input: ReplyAnalysisInput): ReplyAnalysis {
  const fallback = fallbackAnalysis(input);
  const draft = cleanText(value.draft);
  if (!draft) return fallback;

  const intentMap: Record<string, { intent: string; label: string }> = {
    interested: { intent: "interested", label: "感兴趣" },
    declined: { intent: "declined", label: "婉拒" },
    price_inquiry: { intent: "price_inquiry", label: "报价咨询" },
    needs_followup: { intent: "needs_followup", label: "需要跟进" },
    other: { intent: "other", label: "其他" }
  };
  const sentimentMap: Record<string, { sentiment: string; label: string }> = {
    positive: { sentiment: "positive", label: "积极" },
    neutral: { sentiment: "neutral", label: "中性" },
    negative: { sentiment: "negative", label: "消极" }
  };

  const rawIntent = cleanText(value.intent).toLowerCase();
  const matchedIntent = intentMap[rawIntent] || intentMap.other;
  const rawSentiment = cleanText(value.sentiment).toLowerCase();
  const matchedSentiment = sentimentMap[rawSentiment] || sentimentMap.neutral;

  const riskMap: Record<string, string> = { low: "low", medium: "medium", high: "high" };
  const rawRisk = cleanText(value.riskLevel).toLowerCase();

  return {
    intent: matchedIntent.intent,
    intentLabel: matchedIntent.label,
    sentiment: matchedSentiment.sentiment,
    sentimentLabel: matchedSentiment.label,
    summary: cleanText(value.summary) || fallback.summary,
    suggestedAction: cleanText(value.suggestedAction) || fallback.suggestedAction,
    draft,
    draftReason: cleanText(value.draftReason) || fallback.draftReason,
    riskLevel: riskMap[rawRisk] || fallback.riskLevel,
    source: "ai"
  };
}

export async function analyzeAndDraftReply(input: ReplyAnalysisInput): Promise<ReplyAnalysis> {
  const provider = input.provider || "default";
  const config = getApiConfig(provider);
  if (!config) return fallbackAnalysis(input);

  const inboundMessages = input.messages.filter((m) => m.direction === "inbound");
  if (!inboundMessages.length) return fallbackAnalysis(input);

  const productName = input.campaign?.productName || "产品";
  const payload = {
    creatorContext: buildCreatorContext(input.creator),
    campaignContext: buildCampaignContext(input.campaign),
    styleGuide: buildShushujiaOutreachGuide(productName),
    messageTimeline: formatMessageTimeline(input.messages),
    inboundCount: inboundMessages.length,
    lastInboundMessage: cleanText(inboundMessages[inboundMessages.length - 1].content)
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
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "你是蜀黍家的达人商务助理，负责分析达人私信回复并起草回复话术。",
              "必须只输出可解析 JSON，不要 Markdown。",
              "JSON 字段：intent, sentiment, summary, suggestedAction, draft, draftReason, riskLevel。",
              "intent 只能是以下之一：interested / declined / price_inquiry / needs_followup / other。",
              "sentiment 只能是以下之一：positive / neutral / negative。",
              "riskLevel 只能是以下之一：low / medium / high。low=正常推进无风险，medium=需谨慎（如报价谈判、达人犹豫），high=高风险（如达人不满、可能投诉）。"
            ].join("\n")
          },
          {
            role: "user",
            content: [
              "请分析下面这位达人最近的消息回复，并起草一条回复私信。",
              "",
              "分析要求：",
              "1. intent：判断达人回复的核心意图。",
              "2. sentiment：判断达人语气倾向。",
              "3. summary：用一句话总结达人表达了什么（30字以内）。",
              "4. suggestedAction：给出接下来的建议动作（20字以内）。",
              "5. draft：起草回复私信，必须符合蜀黍家话术风格，控制在 40-120 字。",
              "6. draftReason：说明为什么这样回复（30字以内）。",
              "7. riskLevel：评估本次回复的风险等级。",
              "",
              "回复话术硬性要求：",
              "- 像抖音/微信私信，不像商务邮件。",
              "- 沿用蜀黍家风格：宝子、小宝、宝、蜀黍家，但不要堆叠。",
              "- 如果达人问报价：不要直接报死价格，先问对方报价或说明按数据结算。",
              "- 如果达人感兴趣：顺势推进，发具体要求或问方便的沟通方式。",
              "- 如果达人婉拒：礼貌收尾，留好感，不要纠缠。",
              "- 如果达人需要跟进：简短提醒，不要重复长篇介绍。",
              "- 结尾用轻问句。",
              "",
              `输入数据：\n${JSON.stringify(payload, null, 2)}`
            ].join("\n")
          }
        ]
      })
    });

    if (!response.ok) return fallbackAnalysis(input);

    const data = await response.json().catch(() => null);
    const parsed = safeJsonObject(String(data?.choices?.[0]?.message?.content || ""));
    if (!parsed) return fallbackAnalysis(input);

    return normalizeResult(parsed, input);
  } catch {
    return fallbackAnalysis(input);
  }
}
