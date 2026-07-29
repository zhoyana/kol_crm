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
import { resolveDiscoveryRuleTemplate } from "./discovery-rule-templates";

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const THREE_MONTH_MS = 90 * 24 * 60 * 60 * 1000;
const VIRAL_LIKES = 2000;
const MIN_AVG_LIKES = 500;
const HOMEPAGE_WORK_LIMIT = 10;
const LIGHT_HOMEPAGE_WORK_LIMIT = 6;
const HOMEPAGE_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export type HomepageReviewRules = {
  requireAvgLikes500?: boolean;
  requireViral2000?: boolean;
  requireWorkCount10?: boolean;
  requireRecentViral?: boolean;
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
  };
};

export type HomepageReviewOptions = {
  workLimit?: number;
  allowFullRetry?: boolean;
  skipObviousMismatch?: boolean;
};

type HomepageBooleanRuleKey = "requireAvgLikes500" | "requireViral2000" | "requireWorkCount10" | "requireRecentViral";

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
  accountType: string;
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
    "--max_concurrency_num",
    "2",
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

async function readCachedCreatorRowsBySecUid(secUids: string[], minWorks: number): Promise<Map<string, string>> {
  const files = (await listContentFiles()).filter((filePath) => path.basename(filePath).includes("creator_contents"));
  const rowsBySecUid = new Map(secUids.map((secUid) => [secUid.toLowerCase(), new Map<string, string>()]));
  const secUidSet = new Set(secUids.map((secUid) => secUid.toLowerCase()));
  const cacheCutoff = Date.now() - HOMEPAGE_CACHE_TTL_MS;

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line) as Record<string, unknown>;
        const lastModifyTs = Number(item.last_modify_ts || 0);
        if (lastModifyTs < cacheCutoff) continue;

        const itemSecUid = String(item.creator_sec_uid || "").toLowerCase();
        const awemeId = String(item.aweme_id || "");
        if (!itemSecUid || !awemeId || !secUidSet.has(itemSecUid)) continue;
        const rows = rowsBySecUid.get(itemSecUid);
        if (rows && !rows.has(awemeId)) rows.set(awemeId, line);
      } catch {
        // Ignore broken rows from partially written jsonl files.
      }
    }
  }

  return new Map(
    Array.from(rowsBySecUid.entries())
      .filter(([, rows]) => rows.size >= minWorks)
      .map(([secUid, rows]) => [secUid, Array.from(rows.values()).join("\n")])
  );
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

function taskText(task?: HomepageReviewRules["campaignTask"]): string {
  if (!task) return "";
  return [
    task.name,
    task.productName,
    task.category || "",
    task.targetAudience,
    task.targetDescription,
    ...(task.seedKeywords || []),
    ...(task.productSellingPoints || [])
  ].filter(Boolean).join(" ");
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
    "你是达人主页复筛助手。请根据作者主页最近作品标题集合，判断这个账号整体是否符合当前建联目标。",
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
    "应该通过 pass：明显符合当前品类任务的目标人群，且不是商品/运营/服务账号；内容能体现真实个人身份、日常场景、工作/学习/生活记录或与产品自然结合的场景。",
    "可以待观察 maybe：有当前任务目标人群线索，但主页样本少、标题抽象、垂直度不够确定；或主页多数是vlog/日常但仍像个人账号；或看起来可能是公司运营/商品号但还需人工确认。",
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

function medicalHomepageHardRejectReason(
  original: DouyinDiscoveryCandidate,
  homepage: DouyinDiscoveryCandidate,
  works: DouyinWork[]
): string | null {
  const accountText = normalizedText(
    [
      original.name,
      original.sampleTitle || "",
      original.notes || "",
      homepage.name,
      homepage.sampleTitle || "",
      homepage.notes || ""
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

  const entertainmentTerms = [
    "段子",
    "剧情",
    "演绎",
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
  const substantiveMedicalTerms = [
    "医院",
    "病房",
    "科室",
    "查房",
    "交班",
    "接班",
    "值班",
    "夜班",
    "急诊",
    "门诊",
    "手术室",
    "护理操作",
    "输液",
    "实习",
    "规培",
    "轮转"
  ];
  const entertainmentCount = countWorksByTerms(works, entertainmentTerms);
  const substantiveMedicalCount = countWorksByTerms(works, substantiveMedicalTerms);
  if (
    works.length >= 8 &&
    entertainmentCount >= Math.ceil(works.length * 0.5) &&
    substantiveMedicalCount < Math.ceil(works.length * 0.3)
  ) {
    return `最近 ${works.length} 条以泛娱乐段子/表演为主，真实医护工作内容仅 ${substantiveMedicalCount} 条，职业标签只是内容包装。`;
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
  const lifestyleCount = countWorksByTerms(works, medicalTemplate.lifestyleTerms);
  const adviceCount = countWorksByTerms(works, medicalTemplate.dominantRejectTerms);


  if (works.length < 8) {
    return "医护小熊精选至少需要查看 8 条主页作品；当前样本不足，只能进入待选。";
  }

  if (identityCount < 3) {
    return "医护小熊精选需要稳定的本人医护身份或工作/学习场景，当前身份信号不足，降为待选。";
  }

  if (lifestyleCount < 2) {
    return "医护小熊精选必须同时出现明确的非医护个人生活分享；当前主页主要是医护内容或口播，降为待选。";
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

  if (works.length >= 4 && lifestyleCount < 2) {
    return "医护小熊精选需要同时看到真实的个人生活分享和医护内容；当前主页偏单一医护内容，降为待选。";
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
): Promise<DouyinCandidate | null> {
  const recentWorks = homepage.works.slice(0, workLimit);
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
    return null;
  }
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
  const discoveryTemplate = resolveDiscoveryRuleTemplate(rules?.campaignTask);
  const isMedicalBear = discoveryTemplate.id === "medical-bear";
  if (isMedicalBear && medicalHomepageHardRejectReason(original, homepage, recentWorks)) {
    return null;
  }
  const aiDecision = await requestHomepageAiDecision({
    original,
    recentWorks,
    avgLikes,
    maxLikes,
    viralWorkCount,
    hasRecentUpdate,
    campaignTask: rules?.campaignTask
  });

  const keepReason = candidateKeepReason(original, recentWorks, rules?.campaignTask);
  const keepDespiteAiReject = aiDecision?.decision === "reject" && Boolean(keepReason) && !isMedicalBear;
  if (aiDecision?.decision === "reject" && !keepDespiteAiReject) return null;
  const featuredBlockReason = nonFeaturedReason(original, recentWorks, rules?.campaignTask);
  const hasStrongTaskIdentity = Boolean(keepReason);
  const hardAiRejectTypes = [
    "official_media",
    "working_police",
    "education_training",
    "marketing"
  ];
  const hardAiRejected = aiDecision?.decision === "reject" && hardAiRejectTypes.includes(aiDecision.accountType);

  const requiresAvgLikes = isRuleEnabled(rules, "requireAvgLikes500", true);
  const requiresViralWork = isRuleEnabled(rules, "requireViral2000", true);
  const engagementMatched = isMedicalBear && requiresAvgLikes && requiresViralWork
    ? avgLikes >= 300 || hasViralWork
    : (!requiresAvgLikes || avgLikes > MIN_AVG_LIKES) && (!requiresViralWork || hasViralWork);

  const matchedFeaturedRules = [
    engagementMatched,
    !isRuleEnabled(rules, "requireWorkCount10", false) || workCount > 10,
    !isRuleEnabled(rules, "requireRecentViral", false) || hasRecentViralWork,
    hasActiveUpdate
  ].every(Boolean);

  let poolStatus = "candidate";
  let screeningStatus = "candidate_observe";
  const aiAllowsFeatured =
    aiDecision?.decision === "pass" ||
    (aiDecision?.decision !== "reject" &&
      hasStrongTaskIdentity &&
      engagementMatched &&
      (!isMedicalBear || hasViralWork || avgLikes >= 300) &&
      !hardAiRejected);

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
    aiDecision?.decision !== "pass" && aiAllowsFeatured ? `AI未明确通过，但${campaignTaskLabel(rules?.campaignTask)}与数据表现较强，允许进入精选` : "",
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

  const template = resolveDiscoveryRuleTemplate(rules?.campaignTask);
  const minCachedWorks = Math.max(6, template.homepageReview.minSamplesForFeatured);
  const allSecUids = Array.from(new Set(crawlItems.map((item) => item.secUid)));
  const cachedRowsBySecUid = await readCachedCreatorRowsBySecUid(allSecUids, minCachedWorks);
  const cachedItems = crawlItems.filter((item) => cachedRowsBySecUid.has(item.secUid.toLowerCase()));
  const uncachedItems = crawlItems.filter((item) => !cachedRowsBySecUid.has(item.secUid.toLowerCase()));

  async function reviewItems(
    items: typeof crawlItems,
    limit: number,
    rowsStartedAt: number,
    providedRows?: Map<string, string>
  ): Promise<HomepageBatchReviewResult[]> {
    const retrySecUids = Array.from(new Set(items.map((item) => item.secUid)));
    const retryRowsBySecUid = providedRows || await readRecentCreatorRowsBySecUid(retrySecUids, rowsStartedAt);

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

  const cachedReviewed = cachedItems.length
    ? await reviewItems(cachedItems, HOMEPAGE_WORK_LIMIT, 0, cachedRowsBySecUid)
    : [];

  let freshlyReviewed: HomepageBatchReviewResult[] = [];
  if (uncachedItems.length) {
    const startedAt = Date.now();
    const secUids = Array.from(new Set(uncachedItems.map((item) => item.secUid)));
    try {
      await runMediaCrawlerCreators(secUids, workLimit);
      freshlyReviewed = await reviewItems(uncachedItems, workLimit, startedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      freshlyReviewed = uncachedItems.map((item) => ({
        externalId: item.candidate.externalId,
        result: { ok: false as const, reason: `${item.candidate.name} 主页批量采集失败：${message}` }
      }));
    }
  }
  const reviewed = [...cachedReviewed, ...freshlyReviewed];

  const retryItems = options.allowFullRetry && workLimit < HOMEPAGE_WORK_LIMIT
    ? uncachedItems.filter((item) => {
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
