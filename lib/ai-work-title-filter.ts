import {
  rebuildDiscoveryCandidate,
  type DiscoveryFilterOptions,
  type DouyinDiscoveryCandidate
} from "./douyin-import";

type WorkDecision = {
  awemeId: string;
  decision: "keep" | "maybe" | "drop";
  reason?: string;
};

type WorkForAi = {
  awemeId: string;
  creatorName: string;
  title: string;
  sourceKeyword: string;
  likeCount: number;
  publishedAt: string | null;
};

function compactWorks(candidates: DouyinDiscoveryCandidate[]): WorkForAi[] {
  return candidates
    .flatMap((candidate) =>
      candidate.works.map((work) => ({
        awemeId: work.awemeId,
        creatorName: candidate.name || work.creatorName || "",
        title: work.title,
        sourceKeyword: work.sourceKeyword || "",
        likeCount: work.likeCount,
        publishedAt: work.publishedAt
      }))
    )
    .slice(0, 180);
}

function safeJsonParse(text: string): { decisions?: WorkDecision[]; note?: string } {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    return JSON.parse(jsonText) as { decisions?: WorkDecision[]; note?: string };
  } catch {
    return {};
  }
}

function normalizeDecision(value: unknown): "keep" | "maybe" | "drop" {
  if (value === "keep" || value === "maybe" || value === "drop") return value;
  return "maybe";
}

function buildPrompt(keyword: string, works: WorkForAi[]): string {
  return [
    "你是抖音达人采集中的视频标题语义过滤器。",
    "你的任务不是做关键词匹配，而是判断每条视频是否值得进入达人候选池。",
    "",
    "业务目标：寻找目前在校的警校生/公安院校在读学生/公安院校在读研究生个人创作者，后续用于警察小熊、警察通勤衣服、警校生活周边类合作。",
    "初筛目标是提高召回率，不要求一次判断账号是否最终合适；只要这条视频可能指向目标人群，就应该进入候选，交给后续主页复筛。",
    "",
    "内置强相关方向：警校生、警校生日常、警校生活、警校穿搭、警察日常、警察通勤、公安日常、公安院校日常、公安大学、警院、公安院校研究生、藏蓝青春、警服穿搭、警校vlog、警校宿舍、警校训练、警察小熊、警察玩偶。",
    "内置辅助信号：日常、穿搭、校园、学生、训练、宿舍、制服、藏蓝、通勤、毕业季、vlog、生活记录、军训、上课、体能、校服、校园活动。",
    "内置排除方向：官方号、官方账号、官方大V、蓝V、黄V、认证号、媒体号、机构号、营销号、培训机构、招生咨询、报考咨询、高考志愿、公安联考、考试咨询、招警、备考咨询、分数线、已从业警察、警察工作、执法、巡逻、办案、执勤、出警、案件、事故、新闻报道、解说、讲解、讲座、知识分享、科普、普法、反诈、行业真相、颜值、抽象、整活、搞笑、娱乐、擦边、短剧、游戏、小说、AI生成、封禁、已封。",
    "",
    "保留 keep：",
    "1. 标题、话题、来源关键词、创作者名任一位置出现强相关信号，例如警校生、警校生日常、警校生活、警校穿搭、警察日常、警察通勤、公安日常、藏蓝青春、警服穿搭、警察小熊等。",
    "2. 标题明显体现警校生/警院学生/公安院校学生的真实个人生活。",
    "3. 内容偏日常、校园、宿舍、训练、上课、制服/警服穿搭、通勤、vlog、毕业季、藏蓝青春、警察小熊/警察玩偶。",
    "4. 文案虽然抽象、短、情绪化，或者标题本身没有完整写出警校生，但来源关键词/话题显示它来自强相关搜索，也可以 keep 或 maybe。",
    "5. 从标题看，这条作品有机会帮助找到适合建联的个人达人。",
    "",
    "待观察 maybe：",
    "1. 可能是警校生个人内容，但标题证据不足。",
    "2. 标题比较抽象、玩梗、生活化、没有直接说明身份，但没有明显跑偏。",
    "3. 只看标题还不能确定账号是否垂直，需要后续打开主页复筛。",
    "",
    "排除 drop：",
    "1. 主营报考、招生、培训、升学、高考志愿、公安联考、考试咨询的机构号/老师号/咨询号。",
    "2. 官方号、媒体号、机构号、营销号、蓝V/黄V/认证号倾向的内容。",
    "3. 已从业警察工作号，内容偏执法、巡逻、办案、执勤、出警、案件、事故、新闻报道。",
    "4. 解说、讲解、知识分享、科普、普法、行业真相类内容。",
    "5. 纯颜值、泛穿搭、抽象、娱乐、整活、短剧、游戏、小说、AI生成内容，且没有任何警校/藏蓝/公安院校/制服训练等身份线索。",
    "6. 账号封禁或状态异常。",
    "",
    "注意：",
    "1. 这是初筛，不是终筛。宁愿多保留一些 maybe，也不要因为标题信息少就过早 drop。",
    "2. 不要只保留包含“警校生”三个字的视频；强相关词、来源关键词、话题也可以作为召回依据。",
    "3. 不要因为标题文案抽象、生活化、像日常流水账就直接 drop；真实警校生经常只发普通生活、宿舍、训练、穿搭、毕业季和情绪化文案。",
    "4. 不要因为点赞高就 keep，明显语义不符合仍然 drop。",
    "5. 模板词只是业务偏好，不要机械命中。",
    "6. 在校警校生/公安院校研究生偶尔发布提前批招生工作、考研上岸记录、学校招生活动、迎新介绍，不等于招生培训账号；如果标题同时有警校生、公安大学、公安院校、研究生、日常、校园、同学、宿舍、训练等线索，应 keep 或 maybe。",
    "",
    `当前搜索关键词：${keyword}`,
    "",
    "输出必须是 JSON，不要 Markdown。",
    'JSON 结构：{"decisions":[{"awemeId":"","decision":"keep|maybe|drop","reason":""}],"note":""}',
    "reason 用一句中文说明判断依据。",
    `作品标题列表：${JSON.stringify(works, null, 2)}`
  ].join("\n");
}


function formatTerms(terms?: string[]): string {
  return terms?.length ? terms.join("、") : "未单独配置，请结合当前搜索关键词判断";
}

function buildPromptWithFilters(keyword: string, works: WorkForAi[], filters: DiscoveryFilterOptions): string {
  return [
    "你是抖音达人采集中的视频标题语义过滤器。",
    "你的任务不是机械做关键词匹配，而是判断每条视频是否值得进入达人候选池。",
    "",
    `当前搜索关键词：${keyword}`,
    `目标人群/强相关方向：${formatTerms(filters.primaryTerms)}`,
    `辅助信号：${formatTerms(filters.supportTerms)}`,
    `排除方向：${formatTerms(filters.excludeTerms)}`,
    "",
    "初筛目标是提高召回率，不要求一次判断账号是否最终合适；只要这条视频可能指向目标人群，就应该进入候选，交给后续主页复筛。",
    "",
    "保留 keep：",
    "1. 标题、话题、来源关键词、创作者名任一位置出现目标人群或强相关方向。",
    "2. 内容明显体现真实个人身份、行业/学习/工作日常、宿舍/通勤/值班/实习/记录/vlog 等可复筛信号。",
    "3. 文案比较抽象或生活化，但来源关键词或话题已经指向目标人群，也可以 keep 或 maybe。",
    "",
    "待观察 maybe：",
    "1. 可能是目标人群个人内容，但标题证据不足。",
    "2. 标题抽象、玩梗、生活化，没有直接说明身份，但也没有明显跑偏。",
    "3. 只看标题不能确认账号是否垂直，需要后续打开主页复筛。",
    "",
    "排除 drop：",
    "1. 明显命中排除方向，尤其是官方号、机构号、培训招生、考试咨询、课程售卖、营销带货、纯科普引流。",
    "2. 明显不是目标人群，且没有任何目标身份线索。",
    "3. 不要因为点赞高就 keep，语义明显不符合仍然 drop。",
    "",
    "注意：这是初筛，不是终筛。宁愿多保留一些 maybe，也不要因为标题信息少就过早 drop。",
    "",
    "输出必须是 JSON，不要 Markdown。",
    '{"decisions":[{"awemeId":"","decision":"keep|maybe|drop","reason":""}],"note":""}',
    "reason 用一句中文说明判断依据。",
    `作品标题列表：${JSON.stringify(works, null, 2)}`
  ].join("\n");
}
async function requestAiWorkDecisions(keyword: string, works: WorkForAi[], filters: DiscoveryFilterOptions): Promise<WorkDecision[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !works.length) return [];

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const timeoutMs = Math.max(10_000, Number(process.env.AI_WORK_FILTER_TIMEOUT_MS || 90_000));
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你只输出可解析 JSON。" },
          { role: "user", content: buildPromptWithFilters(keyword, works, filters) }
        ]
      })
    });
  } catch (error) {
    console.warn("[ai-work-title-filter] request failed; continuing without AI title filtering", error);
    return [];
  }

  if (!response.ok) return [];
  const data = await response.json().catch(() => null);
  const content = String(data?.choices?.[0]?.message?.content || "");
  const parsed = safeJsonParse(content);
  if (!Array.isArray(parsed.decisions)) return [];

  return parsed.decisions
    .map((item) => ({
      awemeId: String(item.awemeId || "").trim(),
      decision: normalizeDecision(item.decision),
      reason: String(item.reason || "").trim()
    }))
    .filter((item) => item.awemeId);
}

export async function filterCandidatesByAiWorkTitles(
  keyword: string,
  candidates: DouyinDiscoveryCandidate[],
  filters: DiscoveryFilterOptions = {}
): Promise<DouyinDiscoveryCandidate[]> {
  void filters;
  const worksForAi = compactWorks(candidates);
  const aiDecisions = await requestAiWorkDecisions(keyword, worksForAi, filters);
  if (!aiDecisions.length) return candidates;

  const aiDropIds = new Set(aiDecisions.filter((item) => item.decision === "drop").map((item) => item.awemeId));

  return candidates
    .map((candidate) => rebuildDiscoveryCandidate(candidate, candidate.works.filter((work) => !aiDropIds.has(work.awemeId))))
    .filter((candidate): candidate is DouyinDiscoveryCandidate => Boolean(candidate));
}

