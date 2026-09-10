import { NextRequest, NextResponse } from "next/server";
import { discoverXhsCandidates } from "@/lib/xhs-import";
import { prisma } from "@/lib/prisma";

const SHANGANDA_STRONG_TERMS = [
  "应届", "毕业生", "求职", "找工作", "校招", "秋招", "春招", "投简历", "面试",
  "offer", "入职", "职场新人", "考公", "考编", "答辩", "毕业论文", "毕业设计", "实习转正"
];

const POLICE_STUDENT_STRONG_TERMS = [
  "警校", "公安院校", "警察学院", "警院", "警校生", "藏蓝", "警务", "公安专业",
  "警体", "警务训练", "警校训练", "警校生活", "警校日常"
];

const POLICE_STUDENT_EXCLUDE_TERMS = [
  "警校考研", "公安考研", "考研辅导", "报考警校", "警校上岸", "培训", "招生",
  "备考", "课程", "咨询", "考公", "公考"
];

// 大V/媒体/搬运号硬排除信号（与 review/xhs/batch 保持一致）
const MEDIA_NAME_SIGNALS = ["栏目", "官方", "频道", "新闻", "日报", "搬运", "译制", "自翻", "媒体", "传媒", "电视台", "民生", "运营", "工作室", "mcn", "报业", "周刊", "晚报", "晨报", "都市报"];
const FOREIGN_CONTENT_SIGNALS = ["外网评论", "外网", "翻译", "译制", "转载", "搬运"];
// 新闻稿特征词（个人日常笔记极少同时使用）
const NEWS_SIGNALS = ["报道", "网友", "据悉", "据了解", "记者", "采访"];

function normalize(value: unknown) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function stripTags(text: string) {
  return text.replace(/#[^\s#]+/g, " ").trim();
}

function matchesTerms(candidate: any, terms: string[]) {
  const content = normalize((candidate.works || []).map((work: any) => work.title || "").join(" "));
  return terms.some((term) => content.includes(term));
}

function isXhsMediaOrCommercialAccount(candidate: any) {
  const name = String(candidate.name || "");
  const cleanName = normalize(name);
  const mediaMatch = MEDIA_NAME_SIGNALS.find((s) => cleanName.includes(s));
  if (mediaMatch) return { rejected: true, reason: `名称命中媒体/搬运/官方号信号"${mediaMatch}"` };
  const allRawText = normalize([name, ...candidate.works.map((w: any) => w.title || "")].join(" "));
  const foreignMatch = FOREIGN_CONTENT_SIGNALS.find((s) => allRawText.includes(s));
  if (foreignMatch) return { rejected: true, reason: `内容命中搬运/外网信号"${foreignMatch}"` };
  const fans = Number(candidate.fans || 0);
  if (fans > 100_000) return { rejected: true, reason: `粉丝数 ${fans.toLocaleString()} > 10万，极大概率不是个人警校生` };
  // 新闻稿检测
  const newsHits = candidate.works.filter((work: any) => {
    const text = normalize(stripTags(work.title || ""));
    return NEWS_SIGNALS.filter((s) => text.includes(s)).length >= 2;
  });
  if (newsHits.length >= 1) return { rejected: true, reason: `作品呈现新闻稿特征，疑似新闻媒体账号` };
  return { rejected: false };
}

function matchesPoliceStudentIdentity(candidate: any) {
  const works = Array.isArray(candidate.works) ? candidate.works : [];
  // 大V/媒体/搬运号硬排除（优先，避免浪费后续 AI 调用）
  const mediaCheck = isXhsMediaOrCommercialAccount(candidate);
  if (mediaCheck.rejected) return false;
  // 排除培训机构/营销号
  const allText = normalize([candidate.name, ...works.map((work: any) => stripTags(work.title || ""))].join(" "));
  if (POLICE_STUDENT_EXCLUDE_TERMS.some((term) => allText.includes(term))) return false;
  // 排除明显商家号（卖装备、做科普图鉴的账号不是目标个人账号）
  const merchantTerms = ["防身", "防割", "刺服", "文创礼品", "文创", "礼品店", "科普", "图鉴", "商家", "店铺", "旗舰店", "工厂", "批发", "定制", "装备", "用品店"];
  if (merchantTerms.some((term) => allText.includes(term))) return false;
  // 小红书标题多为话题标签，但标签本身就是搜索关键词匹配的结果，应视为身份信号。
  // discover 只做粗过滤（排除明显无关/商业号），身份精判交给画像阶段 AI。
  // 保留标签的原始文本也参与 strong term 匹配：
  const rawWorkText = normalize(works.map((work: any) => work.title || "").join(" "));
  const strippedWorkText = normalize(works.map((work: any) => stripTags(work.title || "")).join(" "));
  return POLICE_STUDENT_STRONG_TERMS.some((term) => rawWorkText.includes(term) || strippedWorkText.includes(term));
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const keyword = String(body?.keyword || "");
    const crawlTaskId = String(body?.crawlTaskId || "").trim();
    const all = await discoverXhsCandidates(keyword, crawlTaskId || undefined);
    const taskId = Number(body?.campaignTaskId || 0);
    const campaignTask = taskId
      ? await prisma.campaignTask.findUnique({ where: { id: taskId }, select: { name: true, targetAudience: true, targetDescription: true } })
      : null;
    const linked = taskId ? await prisma.creatorCampaignTask.findMany({
      where: { campaignTaskId: taskId },
      select: { poolStatus: true, creator: { select: { externalId: true, _count: { select: { works: true } } } } }
    }) : [];
    // 待画像作者允许再次进入：新关键词若采到同一作者，会合并作品并重新画像。
    // 已待选、精选或明确排除的作者不重复处理。
    const existing = new Set(linked
      .filter((x) => x.poolStatus !== "pending_review")
      .map((x) => x.creator.externalId)
      .filter(Boolean));
    const pendingWorkCounts = new Map(linked
      .filter((x) => x.poolStatus === "pending_review" && x.creator.externalId)
      .map((x) => [String(x.creator.externalId), x.creator._count.works]));
    const hasNewEvidence = (candidate: any) => {
      const previousCount = pendingWorkCounts.get(String(candidate.externalId));
      return previousCount === undefined || Number(candidate.works?.length || 0) > previousCount;
    };
    let candidates = all.filter((x) => !existing.has(x.externalId) && hasNewEvidence(x));
    const discoveryCandidates = candidates;
    const useShangandaGate = /上岸达/.test(String(campaignTask?.name || ""));
    const usePoliceStudentGate = /警察小熊|警校生/.test(String(campaignTask?.name || ""));
    const beforeIntentGate = candidates.length;
    if (useShangandaGate) candidates = candidates.filter((candidate) => matchesTerms(candidate, SHANGANDA_STRONG_TERMS));
    if (usePoliceStudentGate) candidates = candidates.filter(matchesPoliceStudentIdentity);
    if (false && body?.filters?.useAiWorkFilter && candidates.length) {
      try {
        const response = await fetch(new URL("/api/ai/candidate-screen", request.nextUrl.origin), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword, campaignTaskId: taskId, candidates })
        });
        const screened = await response.json();
        if (response.ok && Array.isArray(screened.decisions)) {
          const decisions = new Map(screened.decisions.map((x: any) => [String(x.id), String(x.decision)]));
          candidates = candidates.filter((x) => decisions.get(x.externalId) !== "drop");
        }
      } catch { /* AI failure does not discard collected test data */ }
    }
    // 发现阶段只排除明确的媒体、机构、搬运及超大账号；身份匹配留到主页补齐后的画像阶段。
    candidates = discoveryCandidates.filter((candidate) => !isXhsMediaOrCommercialAccount(candidate).rejected);
    return NextResponse.json({
      candidates,
      stats: {
        rawCandidateCount: all.length,
        hiddenExistingCount: all.filter((x) => existing.has(x.externalId) || !hasNewEvidence(x)).length,
        intentFilteredCount: beforeIntentGate - candidates.length
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "小红书达人聚合失败" }, { status: 500 });
  }
}
