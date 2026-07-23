import { NextRequest, NextResponse } from "next/server";
import type { TopicCandidate } from "@/lib/crawler-tasks";

type TopicRulesRequest = {
  keyword?: string;
  topics?: TopicCandidate[];
  primaryTerms?: string[];
  supportTerms?: string[];
  excludeTerms?: string[];
};

type TopicRulesResult = {
  keep: string[];
  maybe: string[];
  drop: string[];
  primaryTerms: string[];
  supportTerms: string[];
  excludeTerms: string[];
  note: string;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 60) : [];
}

function uniqueTerms(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function safeJsonParse(text: string): Partial<TopicRulesResult> {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    return JSON.parse(jsonText) as Partial<TopicRulesResult>;
  } catch {
    return {};
  }
}

function isPoliceKeyword(keyword: string): boolean {
  return ["警校", "警校生", "警察", "公安", "藏蓝", "警服", "警务"].some((term) => keyword.includes(term));
}

function refinePoliceRules(keyword: string, result: TopicRulesResult): TopicRulesResult {
  if (!isPoliceKeyword(keyword)) return result;

  const broadTerms = new Set(["警察", "公安", "警校", "警员", "民警"]);
  const precisionPrimary = [
    "警校生日常",
    "警校生活",
    "警校穿搭",
    "警察日常",
    "警察通勤",
    "警察穿搭",
    "公安日常",
    "公安穿搭",
    "藏蓝青春",
    "警服穿搭",
    "警察小熊",
    "警察玩偶",
    "公安小熊",
    "警务小熊"
  ];
  const support = [
    "警校生",
    "警校",
    "警察",
    "公安",
    "训练",
    "校园",
    "学生",
    "制服",
    "藏蓝",
    "通勤",
    "日常",
    "穿搭",
    "值勤",
    "毕业季",
    "联考",
    "体能"
  ];
  const exclude = [
    "报考",
    "升学",
    "招生",
    "培训",
    "高考",
    "志愿",
    "分数线",
    "家长必读",
    "升学规划",
    "公务员",
    "招警",
    "备考",
    "考研",
    "上岸",
    "录取",
    "新闻媒体",
    "新闻",
    "案件",
    "事故",
    "执法现场",
    "普法",
    "法律科普",
    "知识分享",
    "科普",
    "剧情",
    "短剧",
    "影视",
    "搞笑",
    "游戏",
    "小说",
    "AI生成",
    "美国警察",
    "海外警察",
    "消防",
    "军训"
  ];

  const modelPrimary = result.primaryTerms.filter((term) => !broadTerms.has(term));
  const movedBroadTerms = result.primaryTerms.filter((term) => broadTerms.has(term));

  return {
    ...result,
    primaryTerms: uniqueTerms([...precisionPrimary, ...modelPrimary]).slice(0, 24),
    supportTerms: uniqueTerms([...movedBroadTerms, ...support, ...result.supportTerms]).slice(0, 30),
    excludeTerms: uniqueTerms([...exclude, ...result.excludeTerms]).slice(0, 40),
    note: [result.note, "已自动收紧：泛词不放强相关，强相关只保留通勤/日常/穿搭/小熊等高意图短语。"].filter(Boolean).join(" ")
  };
}

function buildPrompt(input: {
  keyword: string;
  topics: Array<{ topic: string; count: number; score: number; source: string }>;
  primaryTerms: string[];
  supportTerms: string[];
  excludeTerms: string[];
}): string {
  const hasTopics = input.topics.length > 0;

  return [
    "你是达人营销项目里的检索规则设计师。",
    "业务目标：寻找适合警察日常通勤衣服、警察小熊、公安/警校日常内容合作的真实个人达人。",
    "核心不是找所有警察相关内容，而是找适合带货/建联的个人内容创作者。",
    "强相关词必须是高意图短语，不能只写“警察、公安、警校、警员、民警”这种泛词。",
    "强相关词优先围绕：日常、通勤、穿搭、制服、藏蓝青春、警校生活、警察小熊、警察玩偶。",
    "辅助词可以放泛词，用来组合命中。",
    "排除词要主动挡掉：报考升学、招生培训、新闻媒体、案件事故、执法现场、普法科普、剧情短剧、搞笑游戏、海外警察。",
    "输出必须是 JSON，不要 Markdown，不要解释。",
    'JSON 结构：{"keep":[],"maybe":[],"drop":[],"primaryTerms":[],"supportTerms":[],"excludeTerms":[],"note":""}',
    "字段要求：",
    "keep：适合继续采集的话题；没有话题输入时返回空数组。",
    "maybe：边界话题；没有话题输入时返回空数组。",
    "drop：明显跑偏话题；没有话题输入时返回空数组。",
    "primaryTerms：8-18 个强相关词，短而准，必须能直接在视频标题里证明内容适合建联。",
    "supportTerms：8-20 个辅助词，可以更宽，但不能单独决定入池。",
    "excludeTerms：15-30 个排除词，宁愿多挡明显跑偏内容。",
    "示例 primaryTerms：警校生日常、警察日常、警察通勤、警察穿搭、公安日常、藏蓝青春、警服穿搭、警察小熊。",
    "示例 supportTerms：警校生、警校、警察、公安、训练、校园、制服、通勤、日常、穿搭。",
    "示例 excludeTerms：报考、高考、志愿、招生、培训、新闻、案件、事故、普法、知识分享、科普、短剧、游戏、美国警察。",
    `当前关键词：${input.keyword}`,
    `当前强相关词：${input.primaryTerms.join("，") || "-"}`,
    `当前辅助词：${input.supportTerms.join("，") || "-"}`,
    `当前排除词：${input.excludeTerms.join("，") || "-"}`,
    hasTopics
      ? `话题候选：${JSON.stringify(input.topics, null, 2)}`
      : "当前还没有话题候选，请只根据关键词和业务目标生成 primaryTerms、supportTerms、excludeTerms。"
  ].join("\n");
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as TopicRulesRequest | null;
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    return NextResponse.json({ error: "还没有配置 OPENAI_API_KEY。中转站也用这个变量放 key。" }, { status: 400 });
  }

  const keyword = body?.keyword?.trim() || "";
  if (!keyword) {
    return NextResponse.json({ error: "缺少关键词。" }, { status: 400 });
  }

  const topics = (body?.topics || []).slice(0, 80).map((topic) => ({
    topic: topic.topic,
    count: topic.count,
    score: Math.round(topic.score),
    source: topic.source
  }));

  const prompt = buildPrompt({
    keyword,
    topics,
    primaryTerms: asStringArray(body?.primaryTerms),
    supportTerms: asStringArray(body?.supportTerms),
    excludeTerms: asStringArray(body?.excludeTerms)
  });

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你只输出可解析 JSON。" },
          { role: "user", content: prompt }
        ]
      })
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json({ error: data?.error?.message || "AI 规则生成失败。" }, { status: response.status });
    }

    const content = String(data?.choices?.[0]?.message?.content || "");
    const parsed = safeJsonParse(content);
    const result = refinePoliceRules(keyword, {
      keep: asStringArray(parsed.keep),
      maybe: asStringArray(parsed.maybe),
      drop: asStringArray(parsed.drop),
      primaryTerms: asStringArray(parsed.primaryTerms),
      supportTerms: asStringArray(parsed.supportTerms),
      excludeTerms: asStringArray(parsed.excludeTerms),
      note: String(parsed.note || "")
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 接口没有响应。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
