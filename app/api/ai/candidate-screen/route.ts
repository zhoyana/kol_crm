import { NextRequest, NextResponse } from "next/server";
import type { DouyinDiscoveryCandidate } from "@/lib/douyin-import";

type CandidateScreenRequest = {
  keyword?: string;
  candidates?: DouyinDiscoveryCandidate[];
};

type CandidateDecision = {
  id: string;
  decision: "keep" | "maybe" | "drop";
  reason: string;
};

function safeJsonParse(text: string): { decisions?: CandidateDecision[]; note?: string } {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    return JSON.parse(jsonText) as { decisions?: CandidateDecision[]; note?: string };
  } catch {
    return {};
  }
}

function normalizeDecision(value: unknown): "keep" | "maybe" | "drop" {
  if (value === "keep" || value === "maybe" || value === "drop") return value;
  return "maybe";
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function compactCandidate(candidate: DouyinDiscoveryCandidate) {
  return {
    id: candidate.externalId,
    name: candidate.name,
    accountType: candidate.accountType,
    rejectReason: candidate.rejectReason,
    currentBadge: candidate.screeningStatus,
    profileUrl: candidate.profileUrl,
    sampleAwemeUrl: candidate.sampleAwemeUrl,
    metrics: {
      workCount: candidate.workCount,
      avgLikes: candidate.avgLikes,
      maxLikes: candidate.maxLikes,
      viralWorkCount: candidate.viralWorkCount,
      recentWorkCount: candidate.recentWorkCount,
      hasRecentQualifiedWork: candidate.hasRecentQualifiedWork,
      hasRecentUpdate: candidate.hasRecentUpdate
    },
    sampleTitle: candidate.sampleTitle,
    screeningSummary: candidate.screeningSummary,
    works: candidate.works.slice(0, 10).map((work) => ({
      title: work.title,
      likeCount: work.likeCount,
      publishedAt: work.publishedAt,
      sourceKeyword: work.sourceKeyword,
      url: work.url
    }))
  };
}

function textIncludesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalizeText(term)));
}

function localHardDecision(candidate: DouyinDiscoveryCandidate): CandidateDecision | null {
  const text = normalizeText(
    [
      candidate.name,
      candidate.category || "",
      candidate.accountType || "",
      candidate.rejectReason || "",
      candidate.sampleTitle || "",
      candidate.screeningSummary || "",
      ...candidate.works.slice(0, 10).map((work) => `${work.title} ${work.sourceKeyword || ""}`)
    ].join(" ")
  );
  const hasPoliceSchoolStudyIdentity = textIncludesAny(text, [
    "警校",
    "警校生",
    "警校生活",
    "公安院校",
    "公安大学",
    "中国人民公安大学",
    "警院",
    "藏蓝青春",
    "研究生",
    "研一",
    "学硕",
    "专硕",
    "学生证",
    "训练",
    "宿舍"
  ]);

  const dropRules: Array<[string, string[]]> = [
    [
      "疑似官方/认证/机构账号，建联难度高",
      ["official", "government", "media", "school_account", "official_account", "蓝v", "蓝V", "黄v", "黄V", "认证", "官方", "官号", "媒体", "政务"]
    ],
    ["账号封禁或状态异常", ["封禁", "已封", "账号封禁", "用户封禁"]],
    [
      "内容偏讲解/解说/知识分享，不适合达人建联",
      ["解说", "讲解", "讲座", "知识分享", "科普", "普法", "行业真相", "政策", "法规"]
    ],
    [
      "内容偏已从业警察工作场景，不是目标警校生个人账号",
      ["警察工作", "执法", "巡逻", "办案", "执勤", "出警", "抓捕", "警情", "民警", "特警", "交警", "辅警", "派出所", "公安局"]
    ],
    [
      "内容偏培训/考试/备考咨询，不是建联达人",
      ["培训", "高考志愿", "公安联考", "考试", "招警", "备考", "上岸", "分数线", "咨询"]
    ],
    ["内容偏颜值/抽象/泛娱乐，垂直度不足", ["颜值", "抽象", "整活", "搞笑", "娱乐", "擦边"]]
  ];

  for (const [reason, terms] of dropRules) {
    if (textIncludesAny(text, terms)) {
      const isEducationExamRule = reason.includes("培训") || reason.includes("考试") || reason.includes("备考");
      if (isEducationExamRule && hasPoliceSchoolStudyIdentity) continue;
      return { id: candidate.externalId, decision: "drop", reason };
    }
  }

  if (!candidate.works.some((work) => work.likeCount > 500)) {
    return { id: candidate.externalId, decision: "drop", reason: "样本作品点赞未超过500，不满足最低数据要求" };
  }

  return null;
}

function buildPrompt(keyword: string, candidates: DouyinDiscoveryCandidate[]): string {
  return [
    "你是达人建联前的候选人过滤助手。",
    "本轮唯一目标：找目前在校的警校生/公安院校在读学生/公安院校在读研究生个人创作者，适合警察小熊、警察通勤衣服、警校生活类合作。",
    "只能根据候选人的结构化摘要判断，不要脑补主页没有展示的信息。",
    "",
    "keep 标准：",
    "1. 明显像目前在校警校生/警院学生/公安院校学生/公安院校在读研究生的个人账号。",
    "2. 内容围绕警校生日常、宿舍、上课、训练、校园、穿搭、vlog、毕业季等在校场景。",
    "3. 至少一个样本作品点赞 > 500。",
    "4. 主页/样本内容垂直，后续适合人工建联。",
    "",
    "maybe 标准：",
    "1. 可能是在校警校生，但证据不够。",
    "2. 只有少量警校生内容，主页垂直度还需要人工打开确认。",
    "",
    "drop 标准：",
    "1. 只是刚好发过警校生内容，但账号主线是颜值、泛穿搭、抽象、娱乐、整活。",
    "2. 解说、讲解、知识分享、科普、普法、行业真相类账号。",
    "3. 官方号、媒体号、机构号、营销号、蓝V、黄V、认证号。",
    "4. 已从业警察号，内容是执法、巡逻、办案、执勤、出警、案件、事故、新闻报道。",
    "5. 主营报考、招生、培训、升学、公安联考、考试咨询类账号。",
    "6. 但在校警校生/公安院校研究生偶尔发布提前批招生工作、考研上岸记录、学校招生活动、迎新介绍，不等于招生培训账号；如果同时有在校日常、宿舍、训练、校园生活、公安大学/警院在读线索，应 keep 或 maybe。",
    "7. 账号封禁或状态异常。",
    "8. 没有样本作品点赞超过500。",
    "",
    "输出必须是 JSON，不要 Markdown。",
    'JSON 结构：{"decisions":[{"id":"","decision":"keep|maybe|drop","reason":""}],"note":""}',
    "reason 用中文，简短说明保留/观察/排除原因。",
    `当前关键词：${keyword}`,
    `候选达人：${JSON.stringify(candidates.map(compactCandidate), null, 2)}`
  ].join("\n");
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CandidateScreenRequest | null;
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    return NextResponse.json({ error: "还没有配置 OPENAI_API_KEY。DeepSeek 或中转站也可以用这个变量保存 key。" }, { status: 400 });
  }

  const keyword = body?.keyword?.trim() || "";
  const candidates = (body?.candidates || []).slice(0, 60);
  if (!keyword || !candidates.length) {
    return NextResponse.json({ error: "缺少关键词或候选达人。" }, { status: 400 });
  }

  const localDecisions = candidates.map(localHardDecision).filter((item): item is CandidateDecision => Boolean(item));
  const localDropIds = new Set(localDecisions.map((item) => item.id));
  const modelCandidates = candidates.filter((candidate) => !localDropIds.has(candidate.externalId));

  if (!modelCandidates.length) {
    return NextResponse.json({ decisions: localDecisions, note: "候选已被本地硬规则全部过滤。" });
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
          { role: "user", content: buildPrompt(keyword, modelCandidates) }
        ]
      })
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json({ error: data?.error?.message || "AI 候选过滤失败。" }, { status: response.status });
    }

    const content = String(data?.choices?.[0]?.message?.content || "");
    const parsed = safeJsonParse(content);
    const decisions = Array.isArray(parsed.decisions)
      ? parsed.decisions
          .map((item) => ({
            id: String(item.id || "").trim(),
            decision: normalizeDecision(item.decision),
            reason: String(item.reason || "").trim()
          }))
          .filter((item) => item.id)
      : [];

    return NextResponse.json({ decisions: [...localDecisions, ...decisions], note: String(parsed.note || "") });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 候选过滤接口没有响应。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
