import { NextRequest, NextResponse } from "next/server";

type AgentPlanRequest = {
  target?: string;
  category?: string;
};

type AgentPlanResult = {
  name: string;
  category: string;
  targetDescription: string;
  primaryTerms: string[];
  supportTerms: string[];
  excludeTerms: string[];
  minLikeCount: number;
  publishWindowDays: number;
  sortType: string;
  notes: string;
  memorySuggestion: string;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 30) : [];
}

function safeJsonParse(text: string): Partial<AgentPlanResult> {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    return JSON.parse(jsonText) as Partial<AgentPlanResult>;
  } catch {
    return {};
  }
}

function fallbackPlan(target: string, category: string): AgentPlanResult {
  const isPoliceStudent = /警校|警察|公安|藏蓝|警服/.test(target + category);

  if (isPoliceStudent) {
    return {
      name: `${category || "警校生"}达人筛选规则`,
      category: category || "警察小熊",
      targetDescription: target || "寻找目前在校的警校生个人账号，内容偏日常、穿搭、校园生活，适合警察小熊或通勤衣服建联。",
      primaryTerms: ["警校生日常", "警校生活", "警校穿搭", "警校生vlog", "藏蓝青春", "警校训练", "警校宿舍", "警服穿搭"],
      supportTerms: ["警校生", "警校", "公安院校", "校园", "宿舍", "训练", "学生", "大学生", "制服", "日常", "穿搭"],
      excludeTerms: ["报考", "招生", "培训", "升学", "公安联考", "高考志愿", "老师", "机构", "民警", "特警", "交警", "辅警", "派出所", "公安局", "官方", "官号", "蓝V", "黄V", "认证", "新闻", "报道", "案件", "事故", "执法现场", "巡逻", "办案", "执勤", "解说", "讲解", "讲座", "科普", "知识分享", "普法", "反诈", "颜值", "抽象", "封禁", "短剧", "游戏", "AI生成"],
      minLikeCount: 500,
      publishWindowDays: 180,
      sortType: "comprehensive",
      notes: "先用内容初筛找在校警校生个人账号，再用主页复筛排除官方号、营销号和已从业警察账号。",
      memorySuggestion: "如果你后续持续删除报考/执法/官方类账号，可以把这些反馈沉淀到排除词里。"
    };
  }

  return {
    name: `${category || "通用"}达人筛选规则`,
    category: category || "通用",
    targetDescription: target || "寻找适合建联的个人内容创作者。",
    primaryTerms: [],
    supportTerms: [],
    excludeTerms: ["官方", "新闻", "机构", "营销号", "搬运", "AI生成"],
    minLikeCount: 500,
    publishWindowDays: 180,
    sortType: "comprehensive",
    notes: "请先补充更具体的人群、内容场景和不想要的账号类型。",
    memorySuggestion: "建议每次删除达人时记录原因，后续 Agent 才能自动收敛规则。"
  };
}

function normalizePlan(parsed: Partial<AgentPlanResult>, target: string, category: string): AgentPlanResult {
  const fallback = fallbackPlan(target, category);

  return {
    name: String(parsed.name || fallback.name).trim(),
    category: String(parsed.category || fallback.category).trim(),
    targetDescription: String(parsed.targetDescription || fallback.targetDescription).trim(),
    primaryTerms: asStringArray(parsed.primaryTerms).length ? asStringArray(parsed.primaryTerms) : fallback.primaryTerms,
    supportTerms: asStringArray(parsed.supportTerms).length ? asStringArray(parsed.supportTerms) : fallback.supportTerms,
    excludeTerms: asStringArray(parsed.excludeTerms).length ? asStringArray(parsed.excludeTerms) : fallback.excludeTerms,
    minLikeCount: Number(parsed.minLikeCount || fallback.minLikeCount),
    publishWindowDays: Number(parsed.publishWindowDays || fallback.publishWindowDays),
    sortType: String(parsed.sortType || fallback.sortType),
    notes: String(parsed.notes || fallback.notes).trim(),
    memorySuggestion: String(parsed.memorySuggestion || fallback.memorySuggestion).trim()
  };
}

function buildPrompt(target: string, category: string): string {
  return [
    "你是一个达人筛选 Agent 的规则设计器。",
    "你要把用户的自然语言目标，转成可执行的达人筛选规则。",
    "规则会用于抖音达人发现：先搜作品，再筛作者，再进入待复筛池。",
    "请特别注意：强相关词必须窄而准，排除词要主动挡掉明显不适合建联的账号。",
    "如果目标是警校生/警察相关带货合作，优先找真实个人创作者，不要官方号、媒体号、营销号、已从业警察宣传号、报考升学培训号。",
    "如果目标是警校生个人账号，要主动排除：主页内容不垂直、只是偶尔发警校生内容、颜值/泛穿搭/抽象娱乐号、解说讲解类、封禁号、蓝V/黄V/认证号、已从业警察工作号。",
    "输出必须是 JSON，不要 Markdown。",
    'JSON 结构：{"name":"","category":"","targetDescription":"","primaryTerms":[],"supportTerms":[],"excludeTerms":[],"minLikeCount":500,"publishWindowDays":180,"sortType":"comprehensive","notes":"","memorySuggestion":""}',
    "字段说明：",
    "primaryTerms：强相关词，8-18个，只有命中这些词才更可能进候选。",
    "supportTerms：辅助词，8-20个，用于组合判断，单独命中不能代表适配。",
    "excludeTerms：排除词，12-30个，优先排除跑偏账号和跑偏内容。",
    "minLikeCount：内容初筛最低点赞数。",
    "publishWindowDays：作品发布时间窗口，默认180天。",
    "sortType：comprehensive / latest / most_liked。",
    `用户目标：${target}`,
    `品类：${category || "-"}`
  ].join("\n");
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as AgentPlanRequest | null;
  const target = body?.target?.trim() || "";
  const category = body?.category?.trim() || "";

  if (!target) {
    return NextResponse.json({ error: "请先输入本轮筛选目标。" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    return NextResponse.json(fallbackPlan(target, category));
  }

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
          { role: "user", content: buildPrompt(target, category) }
        ]
      })
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json({ error: data?.error?.message || "AI 规则生成失败。" }, { status: response.status });
    }

    const content = String(data?.choices?.[0]?.message?.content || "");
    return NextResponse.json(normalizePlan(safeJsonParse(content), target, category));
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 接口暂时没有响应。";
    return NextResponse.json({ error: message, fallback: fallbackPlan(target, category) }, { status: 500 });
  }
}
