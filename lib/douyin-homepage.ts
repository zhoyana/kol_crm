import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  parseDouyinDiscoveryCandidates,
  toImportCandidate,
  type DouyinCandidate,
  type DouyinDiscoveryCandidate,
  type DouyinWork
} from "./douyin-import";

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const THREE_MONTH_MS = 90 * 24 * 60 * 60 * 1000;
const VIRAL_LIKES = 2000;
const MIN_AVG_LIKES = 500;
const HOMEPAGE_WORK_LIMIT = 10;
const LIGHT_HOMEPAGE_WORK_LIMIT = 6;

export type HomepageReviewRules = {
  requireAvgLikes500?: boolean;
  requireViral2000?: boolean;
  requireWorkCount10?: boolean;
  requireRecentViral?: boolean;
};

export type HomepageReviewOptions = {
  workLimit?: number;
  allowFullRetry?: boolean;
  skipObviousMismatch?: boolean;
};

type HomepageResult =
  | { ok: true; candidate: DouyinCandidate }
  | { ok: false; reason: string };

export type HomepageBatchReviewResult = {
  externalId: string;
  result: HomepageResult;
};

type HomepageAiDecision = {
  decision: "pass" | "maybe" | "reject";
  confidence: number;
  accountType: "target_student" | "possible_student" | "official_media" | "working_police" | "education_training" | "marketing" | "off_target";
  reason: string;
  positiveSignals: string[];
  negativeSignals: string[];
};

function mediaCrawlerRoot(): string {
  return path.join(process.cwd(), "..", "MediaCrawler-main");
}

function douyinJsonlDir(): string {
  return path.join(mediaCrawlerRoot(), "data", "douyin", "jsonl");
}

function secUidFromCandidate(candidate: DouyinDiscoveryCandidate): string {
  if (candidate.secUid) return candidate.secUid;
  if (candidate.profileUrl?.includes("/user/")) {
    return candidate.profileUrl.split("/user/")[1]?.split("?")[0] || "";
  }
  if (candidate.creatorId?.startsWith("MS4w")) return candidate.creatorId;
  return "";
}

function runMediaCrawlerCreators(secUids: string[], workLimit = HOMEPAGE_WORK_LIMIT): Promise<void> {
  const args = [
    "run",
    "main.py",
    "--platform",
    "dy",
    "--lt",
    "qrcode",
    "--type",
    "creator",
    "--creator_id",
    secUids.join(","),
    "--crawler_max_notes_count",
    String(workLimit),
    "--get_comment",
    "false",
    "--get_sub_comment",
    "false",
    "--save_data_option",
    "jsonl"
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("uv", args, {
      cwd: mediaCrawlerRoot(),
      windowsHide: true,
      shell: true
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `MediaCrawler exited with code ${code}`));
    });
  });
}

function runMediaCrawlerCreator(secUid: string, workLimit = HOMEPAGE_WORK_LIMIT): Promise<void> {
  return runMediaCrawlerCreators([secUid], workLimit);
}

async function listContentFiles(): Promise<string[]> {
  try {
    const names = await readdir(douyinJsonlDir());
    const files = await Promise.all(
      names
        .filter((name) => name.endsWith(".jsonl") && name.includes("contents"))
        .map(async (name) => {
          const filePath = path.join(douyinJsonlDir(), name);
          const fileStat = await stat(filePath);
          return { filePath, mtimeMs: fileStat.mtimeMs };
        })
    );
    return files.sort((a, b) => b.mtimeMs - a.mtimeMs).map((file) => file.filePath);
  } catch {
    return [];
  }
}

async function readRecentCreatorRows(secUid: string, startedAt: number): Promise<string> {
  const files = await listContentFiles();
  const rows: string[] = [];
  const lowerSecUid = secUid.toLowerCase();

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line) as Record<string, unknown>;
        const lastModifyTs = Number(item.last_modify_ts || 0);
        const itemSecUid = String(item.creator_sec_uid || "").toLowerCase();
        if (lastModifyTs >= startedAt - 10_000 && (!itemSecUid || itemSecUid === lowerSecUid)) {
          rows.push(line);
        }
      } catch {
        // Ignore broken rows from partially written jsonl files.
      }
    }
  }

  return rows.join("\n");
}

async function readRecentCreatorRowsBySecUid(secUids: string[], startedAt: number): Promise<Map<string, string>> {
  const files = await listContentFiles();
  const rowsBySecUid = new Map(secUids.map((secUid) => [secUid.toLowerCase(), [] as string[]]));
  const secUidSet = new Set(secUids.map((secUid) => secUid.toLowerCase()));

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line) as Record<string, unknown>;
        const lastModifyTs = Number(item.last_modify_ts || 0);
        if (lastModifyTs < startedAt - 10_000) continue;

        const itemSecUid = String(item.creator_sec_uid || "").toLowerCase();
        if (!itemSecUid || !secUidSet.has(itemSecUid)) continue;
        rowsBySecUid.get(itemSecUid)?.push(line);
      } catch {
        // Ignore broken rows from partially written jsonl files.
      }
    }
  }

  return new Map(Array.from(rowsBySecUid.entries()).map(([secUid, rows]) => [secUid, rows.join("\n")]));
}

function isRecentWork(work: DouyinWork): boolean {
  if (!work.publishedAt) return false;
  return new Date(work.publishedAt).getTime() >= Date.now() - ONE_MONTH_MS;
}

function isActiveWork(work: DouyinWork): boolean {
  if (!work.publishedAt) return false;
  return new Date(work.publishedAt).getTime() >= Date.now() - THREE_MONTH_MS;
}

function isRuleEnabled(rules: HomepageReviewRules | undefined, key: keyof HomepageReviewRules, defaultValue: boolean): boolean {
  return rules?.[key] ?? defaultValue;
}

function normalizeHomepageAiDecision(value: unknown): HomepageAiDecision["decision"] {
  if (value === "pass" || value === "maybe" || value === "reject") return value;
  return "maybe";
}

function normalizeHomepageAccountType(value: unknown): HomepageAiDecision["accountType"] {
  const values: HomepageAiDecision["accountType"][] = [
    "target_student",
    "possible_student",
    "official_media",
    "working_police",
    "education_training",
    "marketing",
    "off_target"
  ];
  return values.includes(value as HomepageAiDecision["accountType"]) ? (value as HomepageAiDecision["accountType"]) : "possible_student";
}

function safeJsonObject(text: string): Record<string, unknown> {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    return JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildHomepageAiPrompt(input: {
  original: DouyinDiscoveryCandidate;
  recentWorks: DouyinWork[];
  avgLikes: number;
  maxLikes: number;
  viralWorkCount: number;
  hasRecentUpdate: boolean;
}): string {
  const works = input.recentWorks.map((work, index) => ({
    index: index + 1,
    title: work.title,
    likeCount: work.likeCount,
    publishedAt: work.publishedAt,
    sourceKeyword: work.sourceKeyword,
    url: work.url
  }));

  return [
    "你是达人主页复筛助手。请根据作者主页最近作品标题集合，判断这个账号整体是否符合建联目标。",
    "",
    "业务目标：寻找目前在校或高度疑似在校的警校生/公安院校学生/公安院校在读研究生个人创作者，用于警察小熊、警察日常通勤衣服、警校生活周边类合作。",
    "不要把已经就业的警察、公安自媒体、警察科普号、反诈普法号、执法记录号、地方公安媒体号判断为合格达人。",
    "不要把公司运营账号、商品号、服务号、卖鞋卖制服卖警校周边的账号判断为精选达人。",
    "",
    "非常重要：",
    "1. 不要求主页每条作品都写“警校生”。真实个人账号可能大量分享生活、宿舍、训练、校园、穿搭、毕业季、普通vlog、情绪化文案。",
    "2. 判断重点是“账号整体是否像目标人群”，不是单条标题是否命中关键词。",
    "3. 如果标题集合中能稳定看到警校身份、公安院校、公安大学、警院、在读研究生、藏蓝青春、警校生活/训练/宿舍/校园/穿搭等线索，可以 pass 或 maybe。",
    "4. 如果只有一条作品相关，其余内容完全不相关，应 maybe 或 reject，除非强烈显示作者本人就是警校生。",
    "5. vlog/日常不是天然负面；如果vlog含量不高，且账号有稳定警校身份、公安大学/警院在读身份、校园、制服、训练、宿舍、同学生活线索，可以 pass。若主页大半或几乎全部都是 VLOG 模板化日更/周更/流水账，即使是警校生，也只能 maybe，不要进入精选。",
    "6. 考研上岸记录、研一/学硕/专硕、中国人民公安大学等信息，如果指向作者本人已经在公安院校读书，应视为目标人群线索；只有主营备考咨询、分数线、报考规划、培训课程的账号才 reject。",
    "7. 颜值、自拍、穿搭、健身、情绪文案不是天然负面；如果账号同时有稳定警校/公安院校身份、制服或校园训练线索，并且互动数据不错，这类个人号反而适合警察小熊周边等种草合作，可以 pass。",
    "",
    "应该通过 pass：明显是在校警校生/公安院校在读研究生个人号，且不只是专职vlog流水账，也不是商品/运营/服务账号；内容可包含警校生活、训练、宿舍、校园、穿搭、毕业季、个人视角警校vlog、公安大学读研生活。",
    "可以待观察 maybe：有警校生身份线索，但主页样本少、标题抽象、垂直度不够确定；或主页多数是vlog/日常但仍像个人账号；或看起来可能是公司运营/商品号但还需人工确认。",
    "必须拒绝 reject：官方/媒体/机构/营销/蓝V黄V；主营报考招生培训/高考志愿/公安联考/分数线/上岸备考的咨询号；法考、法学生、法学院、司法考试、律师备考等法律考试/法学生账号；已从业警察工作号；执法巡逻办案执勤出警案件新闻；解说讲解科普知识分享；反诈普法、警情通报、便民提醒、公安宣传、自媒体矩阵；纯娱乐短剧游戏AI生成且缺少警校身份线索。",
    "特别注意：在校警校生偶尔发布或参与提前批招生工作、学校招生活动、迎新介绍，不等于招生培训账号。只要主页整体仍是个人在校警校生日常/宿舍/训练/校园生活，应 pass 或 maybe，不要因为单条招生相关标题直接 reject。",
    "如果简介、昵称或作品标题体现“公安自媒体、公安局、派出所、民警、辅警、交警、特警、普法、反诈、警情、执法、办案、警察新闻”，即使点赞很高，也应 reject。",
    "如果标题集合大量出现“同款、鞋、作训鞋、执勤鞋、警校鞋、制服、商品、下单、店铺、小店、客服、服务号、专属、文创、挂件、周边、购买、福利、橱窗”，应 maybe 或 reject，不能 pass。",
    "如果主页几乎全是“vlog、日常、生活记录、随拍”这类泛生活记录，即使有警校身份，也最多 maybe，不能 pass；如果同时缺少稳定警校身份/训练/宿舍/校园线索，则 reject。",
    "",
    "输出必须是 JSON，不要 Markdown。",
    'JSON 结构：{"decision":"pass|maybe|reject","confidence":0.0,"accountType":"target_student|possible_student|official_media|working_police|education_training|marketing|off_target","reason":"","positiveSignals":[],"negativeSignals":[]}',
    "",
    `作者昵称：${input.original.name}`,
    `初筛样本标题：${input.original.sampleTitle || ""}`,
    `初筛来源关键词：${input.original.sourceKeywords.join("、")}`,
    `主页样本数：${input.recentWorks.length}`,
    `主页样本平均点赞：${input.avgLikes}`,
    `主页样本最高点赞：${input.maxLikes}`,
    `主页样本爆款数：${input.viralWorkCount}`,
    `近1个月是否更新：${input.hasRecentUpdate ? "是" : "否"}`,
    `主页最近作品：${JSON.stringify(works, null, 2)}`
  ].join("\n");
}

async function requestHomepageAiDecision(input: {
  original: DouyinDiscoveryCandidate;
  recentWorks: DouyinWork[];
  avgLikes: number;
  maxLikes: number;
  viralWorkCount: number;
  hasRecentUpdate: boolean;
}): Promise<HomepageAiDecision | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !input.recentWorks.length) return null;

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
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
        { role: "user", content: buildHomepageAiPrompt(input) }
      ]
    })
  });

  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  const parsed = safeJsonObject(String(data?.choices?.[0]?.message?.content || ""));
  const positiveSignals = Array.isArray(parsed.positiveSignals) ? parsed.positiveSignals.map(String) : [];
  const negativeSignals = Array.isArray(parsed.negativeSignals) ? parsed.negativeSignals.map(String) : [];

  return {
    decision: normalizeHomepageAiDecision(parsed.decision),
    confidence: Math.max(0, Math.min(Number(parsed.confidence || 0.5), 1)),
    accountType: normalizeHomepageAccountType(parsed.accountType),
    reason: String(parsed.reason || "AI 未给出明确原因"),
    positiveSignals,
    negativeSignals
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

function nonFeaturedReason(original: DouyinDiscoveryCandidate, works: DouyinWork[]): string | null {
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

function candidateKeepReason(original: DouyinDiscoveryCandidate, works: DouyinWork[]): string | null {
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
): Promise<DouyinCandidate | null> {
  const recentWorks = homepage.works.slice(0, workLimit);
  const hasRecentUpdate = recentWorks.some(isRecentWork);
  const hasActiveUpdate = recentWorks.some(isActiveWork);
  if (!hasActiveUpdate) return null;

  const avgLikes = recentWorks.length
    ? Math.round(recentWorks.reduce((sum, work) => sum + work.likeCount, 0) / recentWorks.length)
    : 0;
  const maxLikes = recentWorks.reduce((max, work) => Math.max(max, work.likeCount), 0);
  const viralWorkCount = recentWorks.filter((work) => work.likeCount > VIRAL_LIKES).length;
  const hasViralWork = viralWorkCount > 0;
  const hasRecentViralWork = recentWorks.some((work) => work.likeCount > VIRAL_LIKES && isRecentWork(work));
  const workCount = recentWorks.length;
  const aiDecision = await requestHomepageAiDecision({
    original,
    recentWorks,
    avgLikes,
    maxLikes,
    viralWorkCount,
    hasRecentUpdate
  });

  const keepReason = candidateKeepReason(original, recentWorks);
  const keepDespiteAiReject = aiDecision?.decision === "reject" && Boolean(keepReason);
  if (aiDecision?.decision === "reject" && !keepDespiteAiReject) return null;
  const featuredBlockReason = nonFeaturedReason(original, recentWorks);
  const hasStrongPoliceSchoolIdentity = keepReason?.includes("警校/公安院校") ?? false;
  const hardAiRejectTypes: HomepageAiDecision["accountType"][] = [
    "official_media",
    "working_police",
    "education_training",
    "marketing"
  ];
  const hardAiRejected = aiDecision?.decision === "reject" && hardAiRejectTypes.includes(aiDecision.accountType);

  const matchedFeaturedRules = [
    !isRuleEnabled(rules, "requireAvgLikes500", true) || avgLikes > MIN_AVG_LIKES,
    !isRuleEnabled(rules, "requireViral2000", true) || hasViralWork,
    !isRuleEnabled(rules, "requireWorkCount10", false) || workCount > 10,
    !isRuleEnabled(rules, "requireRecentViral", false) || hasRecentViralWork,
    hasActiveUpdate
  ].every(Boolean);

  let poolStatus = "candidate";
  let screeningStatus = "candidate_observe";
  const aiAllowsFeatured =
    aiDecision?.decision === "pass" ||
    (hasStrongPoliceSchoolIdentity && hasViralWork && avgLikes > MIN_AVG_LIKES && !hardAiRejected);

  if (matchedFeaturedRules && aiAllowsFeatured && !featuredBlockReason) {
    poolStatus = "featured";
    screeningStatus = hasRecentViralWork ? "featured_trending" : "featured_stable";
  } else if (hasViralWork && avgLikes > MIN_AVG_LIKES) {
    screeningStatus = "candidate_potential";
  }

  const screeningSummary = [
    `主页复筛通过：最近${workCount}条作品中${hasRecentUpdate ? "近1个月有更新" : "近1个月未确认更新，但近3个月有更新"}`,
    aiDecision ? `AI账号画像：${aiDecision.decision}，${aiDecision.reason}` : "AI账号画像：未启用，按规则进入待确认",
    keepDespiteAiReject && keepReason ? `AI未通过精选判断，但保留待选：${keepReason}` : "",
    aiDecision?.decision !== "pass" && aiAllowsFeatured ? "AI未明确通过，但警校身份与数据表现较强，允许进入精选" : "",
    featuredBlockReason ? `非精选原因：${featuredBlockReason}` : "",
    hasViralWork ? "出现点赞超过2000的爆款作品" : "未发现点赞超过2000的爆款作品",
    `主页样本平均点赞 ${avgLikes}`,
    workCount > 10 ? "作品数超过10" : "作品数不超过10",
    hasRecentViralWork ? "近1个月出现爆款" : "近1个月未发现爆款",
    matchedFeaturedRules ? "命中当前勾选规则，进入精选库" : "未完全命中当前勾选规则，进入待选库"
  ].filter(Boolean).join("；");

  return {
    ...toImportCandidate(homepage),
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
    await runMediaCrawlerCreator(secUid);
  } catch (error) {
    return {
      ok: false,
      reason: `${candidate.name} 主页采集失败：${error instanceof Error ? error.message : "未知错误"}`
    };
  }

  const content = await readRecentCreatorRows(secUid, startedAt);
  const homepageCandidates = parseDouyinDiscoveryCandidates(content, candidate.category || "未分类", {
    requireRecentQualified: false
  });
  const homepageCandidate = homepageCandidates.find((item) => item.secUid === secUid || item.creatorId === secUid) || homepageCandidates[0];

  if (!homepageCandidate?.works.length) {
    return { ok: false, reason: `${candidate.name} 未读取到主页作品，跳过` };
  }

  const verified = await withHomepageDecision(candidate, homepageCandidate, rules);
  if (!verified) {
    return { ok: false, reason: `${candidate.name} 主页整体画像不符合或最近3个月无有效更新，跳过` };
  }

  return { ok: true, candidate: verified };
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
    await runMediaCrawlerCreator(secUid, workLimit);
  } catch (error) {
    return {
      ok: false,
      reason: `${candidate.name} 主页采集失败：${error instanceof Error ? error.message : "未知错误"}`
    };
  }

  const content = await readRecentCreatorRows(secUid, startedAt);
  const homepageCandidates = parseDouyinDiscoveryCandidates(content, candidate.category || "未分类", {
    requireRecentQualified: false
  });
  const homepageCandidate = homepageCandidates.find((item) => item.secUid === secUid || item.creatorId === secUid) || homepageCandidates[0];

  if (!homepageCandidate?.works.length) {
    return { ok: false, reason: `${candidate.name} 未读取到主页作品，跳过` };
  }

  const verified = await withHomepageDecision(candidate, homepageCandidate, rules, workLimit);
  if (!verified) {
    return { ok: false, reason: `${candidate.name} 主页整体画像不符合或最近3个月无有效更新，跳过` };
  }

  return { ok: true, candidate: verified };
}

export async function verifyDouyinHomepageCandidateFast(
  candidate: DouyinDiscoveryCandidate,
  rules?: HomepageReviewRules,
  options: HomepageReviewOptions = {}
): Promise<HomepageResult> {
  if (options.skipObviousMismatch) {
    const skipReason = getObviousHomepageSkipReason(candidate);
    if (skipReason) return { ok: false, reason: skipReason };
  }

  const workLimit = Math.max(1, Math.min(Number(options.workLimit || LIGHT_HOMEPAGE_WORK_LIMIT), HOMEPAGE_WORK_LIMIT));
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
    (lightResult.candidate.screeningStatus === "candidate_observe" ||
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
  const workLimit = Math.max(1, Math.min(Number(options.workLimit || LIGHT_HOMEPAGE_WORK_LIMIT), HOMEPAGE_WORK_LIMIT));
  const prepared = candidates.map((candidate) => {
    const secUid = secUidFromCandidate(candidate);
    const skipReason = options.skipObviousMismatch ? getObviousHomepageSkipReason(candidate) : null;
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

  const startedAt = Date.now();
  const secUids = Array.from(new Set(crawlItems.map((item) => item.secUid)));
  try {
    await runMediaCrawlerCreators(secUids, workLimit);
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return [
      ...immediateResults,
      ...crawlItems.map((item) => ({
        externalId: item.candidate.externalId,
        result: { ok: false as const, reason: `${item.candidate.name} 主页批量采集失败：${message}` }
      }))
    ];
  }

  async function reviewItems(items: typeof crawlItems, limit: number, rowsStartedAt: number): Promise<HomepageBatchReviewResult[]> {
    const retrySecUids = Array.from(new Set(items.map((item) => item.secUid)));
    const retryRowsBySecUid = await readRecentCreatorRowsBySecUid(retrySecUids, rowsStartedAt);

    return Promise.all(items.map(async (item) => {
      const content = retryRowsBySecUid.get(item.secUid.toLowerCase()) || "";
      const homepageCandidates = parseDouyinDiscoveryCandidates(content, item.candidate.category || "未分类", {
        requireRecentQualified: false
      });
      const homepageCandidate =
        homepageCandidates.find((candidate) => candidate.secUid === item.secUid || candidate.creatorId === item.secUid) || homepageCandidates[0];

      if (!homepageCandidate?.works.length) {
        return {
          externalId: item.candidate.externalId,
          result: { ok: false as const, reason: `${item.candidate.name} 未读取到主页作品，跳过` }
        };
      }

      const verified = await withHomepageDecision(item.candidate, homepageCandidate, rules, limit);
      if (!verified) {
        return {
          externalId: item.candidate.externalId,
          result: { ok: false as const, reason: `${item.candidate.name} 主页整体画像不符合或最近3个月无有效更新，跳过` }
        };
      }

      return {
        externalId: item.candidate.externalId,
        result: { ok: true as const, candidate: verified }
      };
    }));
  }

  const reviewed = await reviewItems(crawlItems, workLimit, startedAt);

  const retryItems = options.allowFullRetry && workLimit < HOMEPAGE_WORK_LIMIT
    ? crawlItems.filter((item) => {
        const result = reviewed.find((review) => review.externalId === item.candidate.externalId)?.result;
        if (!result) return false;
        if (!result.ok) return true;
        return result.candidate.screeningStatus === "candidate_observe";
      })
    : [];

  if (retryItems.length) {
    const retryStartedAt = Date.now();
    try {
      await runMediaCrawlerCreators(Array.from(new Set(retryItems.map((item) => item.secUid))), HOMEPAGE_WORK_LIMIT);
      const retryReviewed = await reviewItems(retryItems, HOMEPAGE_WORK_LIMIT, retryStartedAt);
      const retryMap = new Map(retryReviewed.map((item) => [item.externalId, item]));
      return [...immediateResults, ...reviewed.map((item) => retryMap.get(item.externalId) || item)];
    } catch {
      return [...immediateResults, ...reviewed];
    }
  }

  return [...immediateResults, ...reviewed];
}
