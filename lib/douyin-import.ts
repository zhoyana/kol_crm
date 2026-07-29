import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { csvRowsToObjects, numberValue } from "./csv";

const DISCOVERY_WINDOW_DAYS = 180;
const ONE_MONTH_DAYS = 30;
const MIN_RECENT_LIKES = 500;
const VIRAL_LIKES = 2000;
const MIN_AVG_LIKES = 500;

export type DouyinWork = {
  awemeId: string;
  creatorExternalId?: string | null;
  creatorName?: string | null;
  creatorProfileUrl?: string | null;
  title: string;
  url: string;
  publishedAt: string | null;
  likeCount: number;
  collectCount: number;
  commentCount: number;
  shareCount: number;
  sourceKeyword: string;
  rawJson?: Record<string, unknown>;
};

export type DouyinCandidate = {
  externalId: string;
  name: string;
  platform: string;
  profileUrl: string | null;
  category: string | null;
  fans: number;
  plays: number[];
  quote: number | null;
  outreachStatus: string;
  cooperationStatus: string | null;
  contact: string | null;
  poolStatus: string;
  accountType: string;
  rejectReason: string | null;
  screeningStatus: string;
  screeningSummary: string | null;
  lastPublishedAt: string | null;
  avgLikes: number;
  maxLikes: number;
  recentWorkCount: number;
  viralWorkCount: number;
  notes: string | null;
  works: DouyinWork[];
};

export type DouyinDiscoveryCandidate = DouyinCandidate & {
  creatorId: string;
  secUid: string;
  sourceKeywords: string[];
  workCount: number;
  totalLikes: number;
  totalCollects: number;
  totalComments: number;
  totalShares: number;
  sampleAwemeUrl: string;
  sampleTitle: string;
  hasRecentQualifiedWork: boolean;
  hasRecentUpdate: boolean;
  hasViralWork: boolean;
};

export type DiscoverySortBy = "relevance" | "latest" | "likes" | "avgLikes";

export type DiscoveryFilterOptions = {
  publishWindowDays?: number;
  sortBy?: DiscoverySortBy;
  primaryTerms?: string[];
  supportTerms?: string[];
  excludeTerms?: string[];
  useAiWorkFilter?: boolean;
  skipTextRules?: boolean;
};

type ImportSummary = {
  imported: number;
  updated: number;
  skipped: number;
  total: number;
  errors: string[];
  sourceFile?: string;
};

type MiniPrismaClient = {
  creator: {
    findUnique: (args: any) => Promise<any | null>;
    upsert: (args: any) => Promise<any>;
  };
  creatorWork: {
    upsert: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    deleteMany?: (args?: any) => Promise<{ count: number }>;
  };
  $disconnect: () => Promise<void>;
};

export function makeDouyinExternalId(value: string): string {
  return `douyin-${value}`.replace(/\s+/g, "-").toLowerCase();
}

function textValue(record: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]?.trim();
    if (value) return value;
  }
  return "";
}

function buildProfileUrl(secUid: string): string {
  return secUid ? `https://www.douyin.com/user/${secUid}` : "";
}

function parseDouyinTime(value: unknown): string | null {
  const raw = Number(value || 0);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw > 10_000_000_000 ? raw : raw * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function daysAgo(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function isWithinDays(isoDate: string | null, days: number): boolean {
  if (!isoDate) return false;
  return new Date(isoDate).getTime() >= daysAgo(days);
}

function normalizeIntentText(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function splitDiscoveryKeywords(value: string): string[] {
  return value
    .split(/[,，、\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function policeDiscoveryKeywordMatched(keyword: string): boolean {
  const normalized = normalizeIntentText(keyword);
  return [
    "\u8b66\u6821\u751f",
    "\u8b66\u6821",
    "\u8b66\u5bdf",
    "\u516c\u5b89",
    "\u85cf\u84dd",
    "\u8b66\u670d",
    "\u8b66\u52a1"
  ].some((term) => normalized.includes(normalizeIntentText(term)));
}

function strictDiscoveryIntentTerms(keyword: string): { primary: string[]; support: string[] } {
  if (!policeDiscoveryKeywordMatched(keyword)) return discoveryIntentTerms(keyword);

  return {
    primary: [
      "\u8b66\u6821\u751f",
      "\u8b66\u6821\u65e5\u5e38",
      "\u8b66\u6821\u751f\u6d3b",
      "\u8b66\u6821\u7a7f\u642d",
      "\u8b66\u5bdf\u65e5\u5e38",
      "\u8b66\u5bdf\u901a\u52e4",
      "\u8b66\u5bdf\u7a7f\u642d",
      "\u516c\u5b89\u65e5\u5e38",
      "\u516c\u5b89\u7a7f\u642d",
      "\u85cf\u84dd\u9752\u6625",
      "\u8b66\u670d\u7a7f\u642d",
      "\u8b66\u5bdf\u5c0f\u718a",
      "\u8b66\u5bdf\u73a9\u5076",
      "\u516c\u5b89\u5c0f\u718a",
      "\u8b66\u52a1\u5c0f\u718a"
    ],
    support: [
      "\u8b66\u5bdf",
      "\u516c\u5b89",
      "\u8bad\u7ec3",
      "\u6821\u56ed",
      "\u5b66\u751f",
      "\u8054\u8003",
      "\u4f53\u80fd",
      "\u6bd5\u4e1a\u5b63",
      "\u901a\u52e4",
      "\u65e5\u5e38",
      "\u7a7f\u642d",
      "\u5236\u670d",
      "\u85cf\u84dd"
    ]
  };
}

function defaultExcludeTerms(keyword: string): string[] {
  if (!policeDiscoveryKeywordMatched(keyword)) return [];

  return [
    "\u9ad8\u8003",
    "\u5fd7\u613f",
    "\u62a5\u8003",
    "\u5206\u6570\u7ebf",
    "\u5bb6\u957f\u5fc5\u8bfb",
    "\u5347\u5b66\u89c4\u5212",
    "\u62db\u751f",
    "\u57f9\u8bad",
    "\u8003\u8bd5",
    "\u516c\u52a1\u5458",
    "\u62db\u8b66",
    "\u5907\u8003",
    "\u8003\u7814",
    "\u4e0a\u5cb8",
    "\u5f55\u53d6",
    "\u9662\u6821",
    "\u5927\u5b66\u6392\u540d",
    "\u4e13\u4e1a\u6392\u540d",
    "\u77ed\u5267",
    "\u5c0f\u8bf4",
    "ai\u751f\u6210",
    "\u6e38\u620f",
    "\u7f8e\u56fd\u8b66\u5bdf",
    "\u56fd\u5916\u8b66\u5bdf",
    "\u65b0\u95fb",
    "\u6848\u4ef6",
    "\u4e8b\u6545",
    "\u89e3\u8bf4",
    "\u8bb2\u89e3",
    "\u8bb2\u5ea7",
    "\u77e5\u8bc6\u5206\u4eab",
    "\u79d1\u666e",
    "\u666e\u6cd5",
    "\u53cd\u8bc8",
    "\u6267\u6cd5",
    "\u5de1\u903b",
    "\u529e\u6848",
    "\u6267\u52e4",
    "\u8b66\u60c5",
    "\u51fa\u8b66",
    "\u6293\u6355",
    "\u6c11\u8b66",
    "\u7279\u8b66",
    "\u4ea4\u8b66",
    "\u8f85\u8b66",
    "\u6d3e\u51fa\u6240",
    "\u516c\u5b89\u5c40",
    "\u989c\u503c",
    "\u62bd\u8c61",
    "\u5c01\u7981",
    "\u5df2\u5c01",
    "\u84ddv",
    "\u84ddV",
    "\u9ec4v",
    "\u9ec4V",
    "\u6d88\u9632",
    "\u519b\u8bad"
  ];
}

function discoveryIntentTerms(keyword: string): { primary: string[]; support: string[] } {
  const normalized = normalizeIntentText(keyword);

  if (["警校生", "警校"].some((term) => normalized.includes(term))) {
    return {
      primary: ["警校生", "警校", "警校日常", "警校生活", "警校训练", "公安联考", "警察学院", "中国人民公安大学", "藏蓝", "藏蓝青春"],
      support: ["警察", "公安", "训练", "校园", "学生", "联考", "体能"]
    };
  }

  return {
    primary: [keyword].filter(Boolean),
    support: []
  };
}

function textMatchesDiscoveryIntent(text: string, keyword: string): boolean {
  const normalizedText = normalizeIntentText(text);
  const { primary, support } = strictDiscoveryIntentTerms(keyword);
  const normalizedPrimary = primary.map(normalizeIntentText).filter(Boolean);
  const normalizedSupport = support.map(normalizeIntentText).filter(Boolean);

  if (!normalizedPrimary.length) return true;
  if (normalizedPrimary.some((term) => normalizedText.includes(term))) return true;

  const supportHits = normalizedSupport.filter((term) => normalizedText.includes(term)).length;
  return supportHits >= 2;
}

function discoveryIntentScore(text: string, keyword: string): number {
  const normalizedText = normalizeIntentText(text);
  const { primary, support } = strictDiscoveryIntentTerms(keyword);
  const normalizedPrimary = primary.map(normalizeIntentText).filter(Boolean);
  const normalizedSupport = support.map(normalizeIntentText).filter(Boolean);
  const primaryHits = normalizedPrimary.filter((term) => normalizedText.includes(term)).length;
  const supportHits = normalizedSupport.filter((term) => normalizedText.includes(term)).length;
  return primaryHits * 100 + supportHits * 20;
}

function rawItemMatchesDiscoveryIntent(item: Record<string, unknown>, keyword: string): boolean {
  return textMatchesDiscoveryIntent(
    [
      item.title,
      item.desc,
      item.creator_nickname,
      item.nickname
    ]
      .map((value) => String(value || ""))
      .join(" "),
    keyword
  );
}

function candidateMatchesDiscoveryIntent(candidate: DouyinDiscoveryCandidate, keyword: string): boolean {
  return textMatchesDiscoveryIntent(
    [
      candidate.name,
      candidate.category || "",
      candidate.sampleTitle,
      candidate.notes || "",
      candidate.sourceKeywords.join(" "),
      ...candidate.works.map((work) => `${work.title} ${work.sourceKeyword}`)
    ].join(" "),
    keyword
  );
}

function candidateDiscoveryScore(candidate: DouyinDiscoveryCandidate, keyword: string): number {
  return discoveryIntentScore(
    [
      candidate.name,
      candidate.category || "",
      candidate.sampleTitle,
      candidate.notes || "",
      candidate.sourceKeywords.join(" "),
      ...candidate.works.map((work) => `${work.title} ${work.sourceKeyword}`)
    ].join(" "),
    keyword
  );
}

function normalizeFilterTerms(terms?: string[]): string[] {
  return Array.from(new Set((terms || []).map((term) => normalizeIntentText(term)).filter(Boolean)));
}

function candidateSearchText(candidate: DouyinDiscoveryCandidate): string {
  return normalizeIntentText(
    [
      candidate.name,
      candidate.category || "",
      candidate.sampleTitle,
      candidate.notes || "",
      candidate.sourceKeywords.join(" "),
      ...candidate.works.map((work) => `${work.title} ${work.sourceKeyword}`)
    ].join(" ")
  );
}

function candidateContentText(candidate: DouyinDiscoveryCandidate): string {
  return normalizeIntentText(
    [
      candidate.name,
      candidate.sampleTitle,
      candidate.notes || "",
      ...candidate.works.map((work) => work.title)
    ].join(" ")
  );
}

function candidateLatestTime(candidate: DouyinDiscoveryCandidate): number {
  return Math.max(...candidate.works.map((work) => (work.publishedAt ? new Date(work.publishedAt).getTime() : 0)), 0);
}

function candidateHasQualifiedWorkInWindow(candidate: DouyinDiscoveryCandidate, publishWindowDays?: number): boolean {
  const days = Number(publishWindowDays ?? DISCOVERY_WINDOW_DAYS);
  if (!days || days <= 0) return candidate.works.some((work) => work.likeCount >= MIN_RECENT_LIKES);
  return candidate.works.some((work) => Boolean(work.publishedAt) && isWithinDays(work.publishedAt, days) && work.likeCount >= MIN_RECENT_LIKES);
}

function workMatchesEditableTerms(work: DouyinWork, keyword: string, filters?: DiscoveryFilterOptions): boolean {
  const text = normalizeIntentText([work.creatorName || "", work.title].join(" "));
  const fallbackTerms = strictDiscoveryIntentTerms(keyword);
  const primaryTerms = normalizeFilterTerms(filters?.primaryTerms?.length ? filters.primaryTerms : fallbackTerms.primary);
  const supportTerms = normalizeFilterTerms(filters?.supportTerms?.length ? filters.supportTerms : fallbackTerms.support);
  const excludeTerms = normalizeFilterTerms([...defaultExcludeTerms(keyword), ...(filters?.excludeTerms || [])]);

  if (excludeTerms.some((term) => text.includes(term))) return false;
  if (primaryTerms.some((term) => text.includes(term))) return true;

  const supportHits = supportTerms.filter((term) => text.includes(term)).length;
  return supportHits >= Math.min(3, supportTerms.length || 3);
}

function pruneCandidateWorks(candidate: DouyinDiscoveryCandidate, keyword: string, filters?: DiscoveryFilterOptions): DouyinDiscoveryCandidate | null {
  const works = candidate.works.filter((work) => workMatchesEditableTerms(work, keyword, filters));
  if (!works.length) return null;

  return finalizeCandidate({
    externalId: candidate.externalId,
    creatorId: candidate.creatorId,
    secUid: candidate.secUid,
    name: candidate.name,
    platform: candidate.platform,
    profileUrl: candidate.profileUrl,
    category: candidate.category,
    fans: candidate.fans,
    quote: candidate.quote,
    outreachStatus: candidate.outreachStatus,
    cooperationStatus: candidate.cooperationStatus,
    contact: candidate.contact,
    sourceKeywords: candidate.sourceKeywords,
    works,
    accountType: candidate.accountType,
    rejectReason: candidate.rejectReason
  });
}

function candidateMatchesEditableTerms(candidate: DouyinDiscoveryCandidate, keyword: string, filters?: DiscoveryFilterOptions): boolean {
  const text = candidateContentText(candidate);
  const fallbackTerms = strictDiscoveryIntentTerms(keyword);
  const primaryTerms = normalizeFilterTerms(filters?.primaryTerms?.length ? filters.primaryTerms : fallbackTerms.primary);
  const supportTerms = normalizeFilterTerms(filters?.supportTerms?.length ? filters.supportTerms : fallbackTerms.support);
  const excludeTerms = normalizeFilterTerms([...defaultExcludeTerms(keyword), ...(filters?.excludeTerms || [])]);

  if (excludeTerms.some((term) => text.includes(term))) return false;

  if (primaryTerms.some((term) => text.includes(term))) return true;

  const supportHits = supportTerms.filter((term) => text.includes(term)).length;
  return supportHits >= Math.min(3, supportTerms.length || 3);
}

function editableTermScore(candidate: DouyinDiscoveryCandidate, filters?: DiscoveryFilterOptions): number {
  const text = candidateContentText(candidate);
  const primaryHits = normalizeFilterTerms(filters?.primaryTerms).filter((term) => text.includes(term)).length;
  const supportHits = normalizeFilterTerms(filters?.supportTerms).filter((term) => text.includes(term)).length;
  return primaryHits * 120 + supportHits * 20;
}

function candidateLooksLikeOffTargetEducation(candidate: DouyinDiscoveryCandidate): boolean {
  const text = candidateContentText(candidate);
  if (defaultExcludeTerms(candidate.sourceKeywords.join(" ")).map(normalizeIntentText).some((term) => text.includes(term))) return true;

  const offTargetTerms = [
    "报考",
    "高考",
    "志愿",
    "分数线",
    "家长必读",
    "升学规划",
    "招生",
    "培训",
    "考试",
    "公务员",
    "招警",
    "备考",
    "考研",
    "上岸"
  ].map(normalizeIntentText);

  return offTargetTerms.some((term) => text.includes(term));
}

function candidateHasEditablePrimarySignal(candidate: DouyinDiscoveryCandidate, filters?: DiscoveryFilterOptions): boolean {
  const primaryTerms = normalizeFilterTerms(filters?.primaryTerms);
  if (!primaryTerms.length) return true;
  const text = candidateContentText(candidate);
  return primaryTerms.some((term) => text.includes(term));
}

function adjustCandidateScreening(candidate: DouyinDiscoveryCandidate, filters?: DiscoveryFilterOptions): DouyinDiscoveryCandidate {
  if (candidate.screeningStatus !== "candidate_strong") return candidate;

  const shouldDemote = candidateLooksLikeOffTargetEducation(candidate) || !candidateHasEditablePrimarySignal(candidate, filters);
  if (!shouldDemote) return candidate;

  const screeningSummary = `${candidate.screeningSummary || ""}；语义降级：疑似报考/升学/考试内容，不作为强候选`;
  return {
    ...candidate,
    screeningStatus: "candidate_observe",
    screeningSummary
  };
}

export function applyDiscoveryFilters(
  candidates: DouyinDiscoveryCandidate[],
  keyword: string,
  filters: DiscoveryFilterOptions = {}
): DouyinDiscoveryCandidate[] {
  const sortBy = filters.sortBy || "relevance";
  const textFiltered = filters.skipTextRules
    ? candidates
    : candidates
        .map((candidate) => pruneCandidateWorks(candidate, keyword, filters))
        .filter((candidate): candidate is DouyinDiscoveryCandidate => Boolean(candidate))
        .filter((candidate) => candidateMatchesEditableTerms(candidate, keyword, filters));
  const filtered = textFiltered
    .filter((candidate) => candidateHasQualifiedWorkInWindow(candidate, filters.publishWindowDays))
    .map((candidate) => (filters.skipTextRules ? candidate : adjustCandidateScreening(candidate, filters)));

  return filtered.sort((a, b) => {
    if (sortBy === "latest") return candidateLatestTime(b) - candidateLatestTime(a);
    if (sortBy === "likes") return b.maxLikes - a.maxLikes || b.avgLikes - a.avgLikes;
    if (sortBy === "avgLikes") return b.avgLikes - a.avgLikes || b.maxLikes - a.maxLikes;

    const relevanceDiff =
      candidateDiscoveryScore(b, keyword) + editableTermScore(b, filters) - candidateDiscoveryScore(a, keyword) - editableTermScore(a, filters);
    return relevanceDiff || b.viralWorkCount - a.viralWorkCount || b.maxLikes - a.maxLikes || b.avgLikes - a.avgLikes;
  });
}

function latestDate(works: DouyinWork[]): string | null {
  const times = works.map((work) => (work.publishedAt ? new Date(work.publishedAt).getTime() : 0)).filter((time) => time > 0);
  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString();
}

function guessAccountType(name: string, notes?: string | null): { accountType: string; rejectReason: string | null } {
  const text = `${name} ${notes || ""}`;
  if (/护考小技巧|考公考编|护考培训|护考资料|全套网课|护考课程|护士资格证.{0,8}(培训|课程)|护士招聘考试|报考咨询/i.test(text)) {
    return { accountType: "education_training", rejectReason: "exam_training_or_career_guidance_account" };
  }
  if (/账号运营|账号孵化|代运营|短视频运营|短视频服务|医生ip|医疗ip|爆款形式|热门形式|运营培训|运营咨询/i.test(text)) {
    return { accountType: "marketing_agency", rejectReason: "marketing_or_incubation_account" };
  }
  if (/主任医师|副主任医师|主治医师|主任医生|医学专家|公立三甲|三甲医院|医院.{0,8}主任|医学会|委员会.{0,8}委员/i.test(text)) {
    return { accountType: "professional_verified", rejectReason: "professional_authority_account" };
  }
  const rules: Array<[string, string, RegExp]> = [
    ["official", "official_account", /官方|官号|认证|蓝v|蓝V|企业认证|官方认证/i],
    ["brand", "brand_account", /旗舰店|品牌|专卖店|旗舰号|官方旗舰/i],
    ["shop", "shop_account", /店铺|小店|商城|好物馆|严选|优选/i],
    ["media", "media_account", /新闻|媒体|日报|电视台|广播|观察|资讯/i],
    ["government", "government_account", /政务|警方|公安|检察|法院|交警|消防/i],
    ["school", "school_account", /学校|大学|学院|招生办|教务|团委/i]
  ];

  for (const [accountType, rejectReason, regexp] of rules) {
    if (regexp.test(text)) return { accountType, rejectReason };
  }

  return { accountType: "personal", rejectReason: null };
}

function creatorVerifyText(item: Record<string, unknown>): string {
  const verificationType = String(item.creator_verification_type || "").trim();
  const enterpriseText = [
    item.creator_custom_verify,
    item.creator_enterprise_verify_reason,
    item.creator_is_enterprise_verify
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  const hasEnterpriseSignal = enterpriseText.some((value) => value && value !== "false" && value !== "0" && value !== "null");

  return [
    hasEnterpriseSignal ? "蓝V 企业认证 官方认证" : "",
    item.creator_signature,
    verificationType ? `verification_type:${verificationType}` : "",
    item.creator_custom_verify,
    item.creator_enterprise_verify_reason,
    item.creator_is_enterprise_verify
  ]
    .map((value) => String(value || ""))
    .filter(Boolean)
    .join(" ");
}

function noteLine(label: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return `${label}: ${value}`;
}

function buildNotes(candidate: {
  sourceKeywords: string[];
  sampleAwemeUrl: string;
  sampleTitle: string;
  workCount: number;
  totalLikes: number;
  totalCollects: number;
  totalComments: number;
  totalShares: number;
  secUid?: string;
  screeningSummary?: string | null;
}): string {
  return [
    "来源: MediaCrawler 抖音关键词发现",
    noteLine("关键词", candidate.sourceKeywords.join(",")),
    noteLine("样本作品", candidate.sampleAwemeUrl),
    noteLine("作品标题", candidate.sampleTitle),
    noteLine("作品数", candidate.workCount),
    noteLine("总点赞", candidate.totalLikes),
    noteLine("总收藏", candidate.totalCollects),
    noteLine("总评论", candidate.totalComments),
    noteLine("总分享", candidate.totalShares),
    noteLine("sec_uid", candidate.secUid),
    noteLine("筛选说明", candidate.screeningSummary)
  ]
    .filter(Boolean)
    .join("\n");
}

function makeWork(item: Record<string, unknown>, category: string): DouyinWork | null {
  const awemeId = String(item.aweme_id || "");
  const url = String(item.aweme_url || "");
  if (!awemeId || !url) return null;

  return {
    awemeId,
    creatorExternalId: null,
    creatorName: null,
    creatorProfileUrl: null,
    title: String(item.title || item.desc || ""),
    url,
    publishedAt: parseDouyinTime(item.create_time),
    likeCount: numberValue(String(item.liked_count || "")),
    collectCount: numberValue(String(item.collected_count || "")),
    commentCount: numberValue(String(item.comment_count || "")),
    shareCount: numberValue(String(item.share_count || "")),
    sourceKeyword: String(item.source_keyword || category || ""),
    rawJson: item
  };
}

function toDiscoveryCandidate(item: Record<string, unknown>, category: string): DouyinDiscoveryCandidate | null {
  const work = makeWork(item, category);
  if (!work) return null;

  const secUid = String(item.creator_sec_uid || "");
  const uid = String(item.creator_uid || "");
  const hash = String(item.creator_hash || "");
  const creatorId = secUid || uid || hash;
  if (!creatorId) return null;

  const profileUrl = String(item.creator_profile_url || "") || buildProfileUrl(secUid);
  const sourceKeyword = work.sourceKeyword || category || "";
  const name = String(item.creator_nickname || item.nickname || "抖音达人");
  const externalId = makeDouyinExternalId(creatorId);
  work.creatorExternalId = externalId;
  work.creatorName = name;
  work.creatorProfileUrl = profileUrl || null;

  const { accountType, rejectReason } = guessAccountType(name, creatorVerifyText(item));

  return finalizeCandidate({
    externalId,
    creatorId,
    secUid,
    name,
    platform: "抖音",
    profileUrl: profileUrl || null,
    category: category || sourceKeyword || "未分类",
    fans: numberValue(String(item.creator_follower_count || item.follower_count || item.fans || "")),
    quote: null,
    outreachStatus: "未建联",
    cooperationStatus: null,
    contact: null,
    sourceKeywords: sourceKeyword ? [sourceKeyword] : [],
    works: [work],
    accountType,
    rejectReason
  });
}

function dedupeWorks(works: DouyinWork[]): DouyinWork[] {
  const map = new Map<string, DouyinWork>();
  for (const work of works) map.set(work.awemeId, work);
  return Array.from(map.values());
}

function finalizeCandidate(input: {
  externalId: string;
  creatorId: string;
  secUid: string;
  name: string;
  platform: string;
  profileUrl: string | null;
  category: string | null;
  fans: number;
  quote: number | null;
  outreachStatus: string;
  cooperationStatus: string | null;
  contact: string | null;
  sourceKeywords: string[];
  works: DouyinWork[];
  accountType: string;
  rejectReason: string | null;
}): DouyinDiscoveryCandidate {
  const works = dedupeWorks(input.works);
  const workCount = works.length;
  const totalLikes = works.reduce((sum, work) => sum + work.likeCount, 0);
  const totalCollects = works.reduce((sum, work) => sum + work.collectCount, 0);
  const totalComments = works.reduce((sum, work) => sum + work.commentCount, 0);
  const totalShares = works.reduce((sum, work) => sum + work.shareCount, 0);
  const avgLikes = workCount ? Math.round(totalLikes / workCount) : 0;
  const maxLikes = works.reduce((max, work) => Math.max(max, work.likeCount), 0);
  const recentWorkCount = works.filter((work) => isWithinDays(work.publishedAt, DISCOVERY_WINDOW_DAYS)).length;
  const viralWorkCount = works.filter((work) => work.likeCount >= VIRAL_LIKES).length;
  const hasRecentQualifiedWork = works.some((work) => isWithinDays(work.publishedAt, DISCOVERY_WINDOW_DAYS) && work.likeCount >= MIN_RECENT_LIKES);
  const hasRecentUpdate = works.some((work) => isWithinDays(work.publishedAt, ONE_MONTH_DAYS));
  const hasViralWork = viralWorkCount > 0;
  const sampleWork = [...works].sort((a, b) => b.likeCount - a.likeCount)[0];
  const screeningStatus =
    input.rejectReason
      ? "rejected_account"
      : hasRecentUpdate && hasRecentQualifiedWork && hasViralWork && avgLikes >= MIN_AVG_LIKES
        ? "candidate_strong"
        : "candidate_observe";
  const screeningSummary = [
    hasRecentQualifiedWork ? "内容初筛通过：近6个月有点赞超过500的相关作品" : "内容初筛未通过：近6个月暂未发现点赞超过500的相关作品",
    hasViralWork ? "样本中出现点赞超过2000的爆款作品" : "样本中暂未发现点赞超过2000的爆款作品",
    `当前采集样本平均点赞 ${avgLikes}`,
    hasRecentUpdate ? "采集样本中近1个月有更新，主页活跃度仍需复筛" : "采集样本中未确认近1个月更新，主页活跃度仍需复筛"
  ].join("；");

  return {
    ...input,
    works,
    workCount,
    totalLikes,
    totalCollects,
    totalComments,
    totalShares,
    avgLikes,
    maxLikes,
    recentWorkCount,
    viralWorkCount,
    hasRecentQualifiedWork,
    hasRecentUpdate,
    hasViralWork,
    sampleAwemeUrl: sampleWork?.url || "",
    sampleTitle: sampleWork?.title || "",
    plays: works.map((work) => work.likeCount).filter((value) => value > 0),
    poolStatus: input.rejectReason ? "rejected" : "candidate",
    screeningStatus,
    screeningSummary,
    lastPublishedAt: latestDate(works),
    notes: buildNotes({
      sourceKeywords: input.sourceKeywords,
      sampleAwemeUrl: sampleWork?.url || "",
      sampleTitle: sampleWork?.title || "",
      workCount,
      totalLikes,
      totalCollects,
      totalComments,
      totalShares,
      secUid: input.secUid,
      screeningSummary
    })
  };
}

export function rebuildDiscoveryCandidate(candidate: DouyinDiscoveryCandidate, works: DouyinWork[]): DouyinDiscoveryCandidate | null {
  if (!works.length) return null;

  return finalizeCandidate({
    externalId: candidate.externalId,
    creatorId: candidate.creatorId,
    secUid: candidate.secUid,
    name: candidate.name,
    platform: candidate.platform,
    profileUrl: candidate.profileUrl,
    category: candidate.category,
    fans: candidate.fans,
    quote: candidate.quote,
    outreachStatus: candidate.outreachStatus,
    cooperationStatus: candidate.cooperationStatus,
    contact: candidate.contact,
    sourceKeywords: candidate.sourceKeywords,
    works,
    accountType: candidate.accountType,
    rejectReason: candidate.rejectReason
  });
}

function mergeDiscoveryCandidates(
  candidates: DouyinDiscoveryCandidate[],
  options: { requireRecentQualified?: boolean; keyword?: string } = {}
): DouyinDiscoveryCandidate[] {
  const map = new Map<string, DouyinDiscoveryCandidate>();

  for (const candidate of candidates) {
    const current = map.get(candidate.externalId);
    if (!current) {
      map.set(candidate.externalId, candidate);
      continue;
    }

    const sourceKeywords = Array.from(new Set([...current.sourceKeywords, ...candidate.sourceKeywords])).filter(Boolean);
    map.set(
      candidate.externalId,
      finalizeCandidate({
        externalId: current.externalId,
        creatorId: current.creatorId,
        secUid: current.secUid || candidate.secUid,
        name: current.name || candidate.name,
        platform: current.platform,
        profileUrl: current.profileUrl || candidate.profileUrl,
        category: current.category || candidate.category,
        fans: Math.max(current.fans, candidate.fans),
        quote: current.quote || candidate.quote,
        outreachStatus: current.outreachStatus,
        cooperationStatus: current.cooperationStatus,
        contact: current.contact,
        sourceKeywords,
        works: [...current.works, ...candidate.works],
        accountType: current.accountType !== "personal" ? current.accountType : candidate.accountType,
        rejectReason: current.rejectReason || candidate.rejectReason
      })
    );
  }

  const merged = Array.from(map.values()).filter((candidate) => candidate.poolStatus !== "rejected");
  const filtered = options.requireRecentQualified === false ? merged : merged.filter((candidate) => candidate.hasRecentQualifiedWork);
  return filtered.sort((a, b) => {
    const relevanceDiff = options.keyword ? candidateDiscoveryScore(b, options.keyword) - candidateDiscoveryScore(a, options.keyword) : 0;
    return relevanceDiff || b.viralWorkCount - a.viralWorkCount || b.maxLikes - a.maxLikes || b.avgLikes - a.avgLikes;
  });
}

function parseJsonlDiscovery(input: string, category: string, options: { requireRecentQualified?: boolean } = {}): DouyinDiscoveryCandidate[] {
  const rows = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return toDiscoveryCandidate(JSON.parse(line), category);
      } catch {
        return null;
      }
    })
    .filter((candidate): candidate is DouyinDiscoveryCandidate => Boolean(candidate));

  return mergeDiscoveryCandidates(rows, options);
}

function parseCandidateCsv(record: Record<string, string>, category: string): DouyinDiscoveryCandidate | null {
  const creatorId = textValue(record, ["creator_id", "达人ID", "externalId", "external_id", "id"]);
  const name = textValue(record, ["nickname", "达人昵称", "name", "creator_name"]);
  if (!creatorId && !name) return null;

  const profileUrl = textValue(record, ["profile_url", "主页链接", "profileUrl"]);
  const sourceKeywords = textValue(record, ["source_keywords", "来源关键词", "关键词"])
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const sampleAwemeUrl = textValue(record, ["sample_aweme_url", "样本作品", "作品链接"]);
  const sampleTitle = textValue(record, ["sample_title", "作品标题"]);
  const totalLikes = numberValue(textValue(record, ["total_likes", "总点赞"]));
  const id = creatorId || name;
  const externalId = makeDouyinExternalId(id);
  const { accountType, rejectReason } = guessAccountType(name);
  const now = new Date().toISOString();

  return finalizeCandidate({
    externalId,
    creatorId: id,
    secUid: profileUrl.includes("/user/") ? profileUrl.split("/user/")[1]?.split("?")[0] || "" : "",
    name: name || "抖音达人",
    platform: "抖音",
    profileUrl: profileUrl || null,
    category: category || sourceKeywords[0] || "未分类",
    fans: numberValue(textValue(record, ["fans", "粉丝数", "粉丝"])),
    quote: null,
    outreachStatus: "未建联",
    cooperationStatus: null,
    contact: null,
    sourceKeywords,
    works: [
      {
        awemeId: sampleAwemeUrl || id,
        creatorExternalId: externalId,
        creatorName: name || "抖音达人",
        creatorProfileUrl: profileUrl || null,
        title: sampleTitle,
        url: sampleAwemeUrl,
        publishedAt: now,
        likeCount: totalLikes,
        collectCount: numberValue(textValue(record, ["total_collects", "总收藏"])),
        commentCount: numberValue(textValue(record, ["total_comments", "总评论"])),
        shareCount: numberValue(textValue(record, ["total_shares", "总分享"])),
        sourceKeyword: sourceKeywords[0] || category || ""
      }
    ],
    accountType,
    rejectReason
  });
}

export function parseDouyinDiscoveryCandidates(
  input: string,
  category = "未分类",
  options: { requireRecentQualified?: boolean } = {}
): DouyinDiscoveryCandidate[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{")) return parseJsonlDiscovery(trimmed, category, options);

  return mergeDiscoveryCandidates(
    csvRowsToObjects(trimmed)
      .map((record) => parseCandidateCsv(record, category))
      .filter((candidate): candidate is DouyinDiscoveryCandidate => Boolean(candidate)),
    options
  );
}

export function toImportCandidate(candidate: DouyinDiscoveryCandidate): DouyinCandidate {
  return {
    externalId: candidate.externalId,
    name: candidate.name,
    platform: candidate.platform,
    profileUrl: candidate.profileUrl,
    category: candidate.category,
    fans: candidate.fans,
    plays: candidate.plays,
    quote: candidate.quote,
    outreachStatus: candidate.outreachStatus,
    cooperationStatus: candidate.cooperationStatus,
    contact: candidate.contact,
    poolStatus: candidate.poolStatus,
    accountType: candidate.accountType,
    rejectReason: candidate.rejectReason,
    screeningStatus: candidate.screeningStatus,
    screeningSummary: candidate.screeningSummary,
    lastPublishedAt: candidate.lastPublishedAt,
    avgLikes: candidate.avgLikes,
    maxLikes: candidate.maxLikes,
    recentWorkCount: candidate.recentWorkCount,
    viralWorkCount: candidate.viralWorkCount,
    notes: candidate.notes,
    works: candidate.works
  };
}

export function parseDouyinCandidates(input: string, category = "未分类"): DouyinCandidate[] {
  return parseDouyinDiscoveryCandidates(input, category).map(toImportCandidate);
}

async function getPrisma(): Promise<MiniPrismaClient> {
  const prismaModule = await new Function("specifier", "return import(specifier)")("@prisma/client");
  const PrismaClient = prismaModule.PrismaClient as new () => MiniPrismaClient;
  return new PrismaClient();
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

export async function importDouyinCandidates(candidates: DouyinCandidate[], sourceFile?: string): Promise<ImportSummary> {
  const prisma = await getPrisma();
  let imported = 0;
  let updated = 0;
  const errors: string[] = [];

  try {
    for (const candidate of candidates) {
      if (!candidate.name) {
        errors.push(`${candidate.externalId} 缺少达人昵称`);
        continue;
      }

      const existed = await prisma.creator.findUnique({ where: { externalId: candidate.externalId } });
      const { externalId, works, lastPublishedAt, ...creatorData } = candidate;
      const saved = await prisma.creator.upsert({
        where: { externalId },
        update: { ...creatorData, lastPublishedAt: toDate(lastPublishedAt) },
        create: { externalId, ...creatorData, lastPublishedAt: toDate(lastPublishedAt) }
      });

      for (const work of works) {
        const creatorExternalId = work.creatorExternalId || candidate.externalId;
        await prisma.creatorWork.upsert({
          where: { creatorExternalId_awemeId: { creatorExternalId, awemeId: work.awemeId } },
          update: { ...work, creatorId: saved.id, creatorExternalId, publishedAt: toDate(work.publishedAt) },
          create: { ...work, creatorId: saved.id, creatorExternalId, publishedAt: toDate(work.publishedAt) }
        });
      }

      if (existed) updated += 1;
      else imported += 1;
    }
  } finally {
    await prisma.$disconnect();
  }

  return { imported, updated, skipped: errors.length, total: candidates.length, errors, sourceFile };
}

export async function importDouyinWorksToPool(candidates: DouyinDiscoveryCandidate[]): Promise<ImportSummary> {
  const prisma = await getPrisma();
  let imported = 0;
  let updated = 0;
  const errors: string[] = [];

  try {
    for (const candidate of candidates) {
      for (const work of candidate.works) {
        const creatorExternalId = work.creatorExternalId || candidate.externalId;
        const existedRows = await prisma.creatorWork.findMany({
          where: { creatorExternalId, awemeId: work.awemeId },
          take: 1
        });

        await prisma.creatorWork.upsert({
          where: { creatorExternalId_awemeId: { creatorExternalId, awemeId: work.awemeId } },
          update: {
            ...work,
            creatorExternalId,
            creatorName: work.creatorName || candidate.name,
            creatorProfileUrl: work.creatorProfileUrl || candidate.profileUrl,
            publishedAt: toDate(work.publishedAt)
          },
          create: {
            ...work,
            creatorExternalId,
            creatorName: work.creatorName || candidate.name,
            creatorProfileUrl: work.creatorProfileUrl || candidate.profileUrl,
            publishedAt: toDate(work.publishedAt)
          }
        });

        if (existedRows.length) updated += 1;
        else imported += 1;
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  return { imported, updated, skipped: errors.length, total: imported + updated + errors.length, errors };
}

async function getDouyinJsonlDir(): Promise<string> {
  return path.join(process.cwd(), "..", "MediaCrawler-main", "data", "douyin", "jsonl");
}

export async function findLatestDouyinResultFile(): Promise<string | null> {
  const jsonlDir = await getDouyinJsonlDir();
  try {
    const names = await readdir(jsonlDir);
    const files = await Promise.all(
      names
        .filter((name) => name.endsWith(".jsonl") && name.includes("contents"))
        .map(async (name) => {
          const filePath = path.join(jsonlDir, name);
          const fileStat = await stat(filePath);
          return { filePath, mtimeMs: fileStat.mtimeMs };
        })
    );
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0]?.filePath ?? null;
  } catch {
    return null;
  }
}

export async function readLatestDouyinResult(): Promise<{ content: string; filePath: string } | null> {
  const filePath = await findLatestDouyinResultFile();
  if (!filePath) return null;
  return { content: await readFile(filePath, "utf8"), filePath };
}

export async function searchDouyinResultFiles(keyword: string): Promise<{ candidates: DouyinDiscoveryCandidate[]; sourceFiles: string[] }> {
  const jsonlDir = await getDouyinJsonlDir();
  const keywords = splitDiscoveryKeywords(keyword);
  const normalizedKeywords = keywords.map((item) => item.toLowerCase());

  try {
    const names = await readdir(jsonlDir);
    const sourceFiles = names.filter((name) => name.endsWith(".jsonl") && name.includes("contents")).map((name) => path.join(jsonlDir, name));
    const chunks = await Promise.all(sourceFiles.map((filePath) => readFile(filePath, "utf8")));
    const candidates = mergeDiscoveryCandidates(chunks.flatMap((content) => parseDouyinDiscoveryCandidates(content, keyword || "未分类")), { keyword }).filter(
      (candidate) => {
        if (!normalizedKeywords.length) return true;
        const haystack = [candidate.name, candidate.category || "", candidate.sampleTitle, candidate.notes || "", candidate.sourceKeywords.join(",")]
          .join(" ")
          .toLowerCase();
        return normalizedKeywords.some((item) => haystack.includes(item));
      }
    );

    const relevantCandidates = candidates.filter((candidate) => candidateMatchesDiscoveryIntent(candidate, keyword));
    return { candidates: relevantCandidates, sourceFiles };
  } catch {
    return { candidates: [], sourceFiles: [] };
  }
}

export async function searchDouyinResultFilesByTask(input: {
  keyword: string;
  startedAt?: string | null;
  activeKeywords?: string[];
}): Promise<{ candidates: DouyinDiscoveryCandidate[]; sourceFiles: string[] }> {
  const jsonlDir = await getDouyinJsonlDir();
  const allowedKeywords = (input.activeKeywords?.length ? input.activeKeywords : [input.keyword])
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const startedAtMs = input.startedAt ? new Date(input.startedAt).getTime() - 10_000 : 0;

  try {
    const names = await readdir(jsonlDir);
    const sourceFiles = names.filter((name) => name.endsWith(".jsonl") && name.includes("contents")).map((name) => path.join(jsonlDir, name));
    const filteredChunks = await Promise.all(
      sourceFiles.map(async (filePath) => {
        const content = await readFile(filePath, "utf8");
        const lines = content.split(/\r?\n/).filter((line) => {
          if (!line.trim()) return false;
          try {
            const item = JSON.parse(line) as Record<string, unknown>;
            const lastModifyTs = Number(item.last_modify_ts || 0);
            const sourceKeyword = String(item.source_keyword || "").trim().toLowerCase();
            if (startedAtMs && lastModifyTs && lastModifyTs < startedAtMs) return false;
            if (allowedKeywords.length && !sourceKeyword) return false;
            if (allowedKeywords.length && sourceKeyword && !allowedKeywords.includes(sourceKeyword)) return false;
            if (sourceKeyword && allowedKeywords.includes(sourceKeyword)) return true;
            if (!rawItemMatchesDiscoveryIntent(item, input.keyword)) return false;
            return true;
          } catch {
            return false;
          }
        });
        return lines.join("\n");
      })
    );

    const candidates = mergeDiscoveryCandidates(
      filteredChunks.flatMap((content) => parseDouyinDiscoveryCandidates(content, input.keyword || "未分类"))
    );

    return { candidates, sourceFiles };
  } catch {
    return { candidates: [], sourceFiles: [] };
  }
}

export async function searchDouyinCandidatesFromWorkPool(keyword: string): Promise<DouyinDiscoveryCandidate[]> {
  if (!process.env.DATABASE_URL) return [];

  const prisma = await getPrisma();
  const since = new Date(daysAgo(DISCOVERY_WINDOW_DAYS));
  const keywords = splitDiscoveryKeywords(keyword);

  try {
    const rows = await prisma.creatorWork.findMany({
      where: {
        publishedAt: { gte: since },
        likeCount: { gte: MIN_RECENT_LIKES },
        OR: keywords.length
          ? keywords.flatMap((item) => [
              { sourceKeyword: { contains: item } },
              { title: { contains: item } },
              { creatorName: { contains: item } }
            ])
          : undefined
      },
      orderBy: [{ likeCount: "desc" }],
      take: 500
    });

    const candidates = rows
      .map((row) => {
        const creatorExternalId = row.creatorExternalId || "";
        if (!creatorExternalId) return null;
        const work: DouyinWork = {
          awemeId: row.awemeId,
          creatorExternalId,
          creatorName: row.creatorName || "抖音达人",
          creatorProfileUrl: row.creatorProfileUrl || null,
          title: row.title || "",
          url: row.url || "",
          publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
          likeCount: row.likeCount || 0,
          collectCount: row.collectCount || 0,
          commentCount: row.commentCount || 0,
          shareCount: row.shareCount || 0,
          sourceKeyword: row.sourceKeyword || keyword || "",
          rawJson: typeof row.rawJson === "object" && row.rawJson ? row.rawJson : undefined
        };
        const name = row.creatorName || "抖音达人";
        const rawText = typeof row.rawJson === "object" && row.rawJson ? creatorVerifyText(row.rawJson) : "";
        const { accountType, rejectReason } = guessAccountType(name, rawText);
        const secUid = row.creatorProfileUrl?.includes("/user/") ? row.creatorProfileUrl.split("/user/")[1]?.split("?")[0] || "" : "";

        return finalizeCandidate({
          externalId: creatorExternalId,
          creatorId: secUid || creatorExternalId,
          secUid,
          name,
          platform: "抖音",
          profileUrl: row.creatorProfileUrl || null,
          category: row.sourceKeyword || keyword || "未分类",
          fans: 0,
          quote: null,
          outreachStatus: "未建联",
          cooperationStatus: null,
          contact: null,
          sourceKeywords: row.sourceKeyword ? [row.sourceKeyword] : [],
          works: [work],
          accountType,
          rejectReason
        });
      })
      .filter((candidate): candidate is DouyinDiscoveryCandidate => Boolean(candidate));

    return mergeDiscoveryCandidates(candidates, { keyword }).filter((candidate) => candidateMatchesDiscoveryIntent(candidate, keyword));
  } finally {
    await prisma.$disconnect();
  }
}

