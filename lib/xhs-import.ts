import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";
import type { DouyinDiscoveryCandidate, DouyinWork } from "./douyin-import";
import { xhsRedfoxCacheFile, type RedfoxXhsWork } from "./xhs-crawler-tasks";

function mediaCrawlerDir() {
  return path.resolve(process.cwd(), "..", "MediaCrawler-main", "data", "xhs", "jsonl");
}

function n(value: unknown): number {
  const text = String(value ?? "").trim().replace(/,/g, "");
  const base = Number.parseFloat(text) || 0;
  return Math.round(base * (/万/.test(text) ? 10_000 : /千/.test(text) ? 1_000 : 1));
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string" && /\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const raw = Number(value || 0);
  if (!raw) return null;
  const date = new Date(raw > 10_000_000_000 ? raw : raw * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function allowedKeywords(keyword: string): Set<string> {
  return new Set(keyword.split(/[,，\r\n]+/).map((x) => x.trim()).filter(Boolean));
}

async function readRedfoxRows(): Promise<Record<string, unknown>[]> {
  try {
    const rows = JSON.parse(await readFile(xhsRedfoxCacheFile(), "utf8"));
    if (!Array.isArray(rows)) return [];
    return rows.map((work: RedfoxXhsWork) => ({
      user_id: work.authorId,
      nickname: work.authorNickname,
      fans: work.authorFans,
      profile_url: work.authorId ? `https://www.xiaohongshu.com/user/profile/${work.authorId}` : "",
      note_id: work.id,
      note_url: work.shareInfoLink,
      title: work.title,
      desc: work.desc,
      time: work.createTime,
      liked_count: work.likedCount,
      collected_count: work.collectedCount,
      comment_count: work.commentsCount,
      share_count: work.sharedCount,
      source_keyword: work.sourceKeyword,
      crawl_task_id: work.crawlTaskId,
      provider: "redfox",
      ...work
    }));
  } catch {
    return [];
  }
}

async function readMediaCrawlerRows(): Promise<Record<string, unknown>[]> {
  const files = (await readdir(mediaCrawlerDir()).catch(() => []))
    .filter((x) => x.endsWith(".jsonl") && x.includes("contents"));
  const rows: Record<string, unknown>[] = [];
  for (const name of files) {
    const text = await readFile(path.join(mediaCrawlerDir(), name), "utf8").catch(() => "");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* ignore partial rows */ }
    }
  }
  return rows;
}

export async function discoverXhsCandidates(keyword: string, crawlTaskId?: string): Promise<DouyinDiscoveryCandidate[]> {
  const allowed = allowedKeywords(keyword);
  const redfoxRows = await readRedfoxRows();
  const rows = redfoxRows.length ? redfoxRows : await readMediaCrawlerRows();
  const grouped = new Map<string, { name: string; profileUrl: string; fans: number; works: DouyinWork[]; keywords: Set<string> }>();

  for (const row of rows) {
    const sourceKeyword = String(row.source_keyword || "").trim();
    const rowCrawlTaskId = String(row.crawl_task_id || "").trim();
    if (crawlTaskId && rowCrawlTaskId !== crawlTaskId) continue;
    if (allowed.size && !allowed.has(sourceKeyword)) continue;
    const userId = String(row.user_id || "").trim();
    if (!userId) continue;
    const externalId = `xhs-${userId}`;
    const item = grouped.get(externalId) || {
      name: String(row.nickname || "小红书达人"),
      profileUrl: String(row.profile_url || `https://www.xiaohongshu.com/user/profile/${userId}`),
      fans: n(row.fans), works: [], keywords: new Set<string>()
    };
    const noteId = String(row.note_id || "").trim();
    if (noteId && !item.works.some((x) => x.awemeId === noteId)) {
      item.works.push({
        awemeId: noteId,
        creatorExternalId: externalId,
        creatorName: item.name,
        creatorProfileUrl: item.profileUrl,
        title: [row.title, row.desc].map((x) => String(x || "").trim()).filter(Boolean).join("\n"),
        url: String(row.note_url || ""),
        publishedAt: iso(row.time),
        likeCount: n(row.liked_count),
        collectCount: n(row.collected_count),
        commentCount: n(row.comment_count),
        shareCount: n(row.share_count),
        sourceKeyword,
        rawJson: row
      });
    }
    if (sourceKeyword) item.keywords.add(sourceKeyword);
    grouped.set(externalId, item);
  }

  return Array.from(grouped, ([externalId, item]) => {
    item.works.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
    const likes = item.works.map((x) => x.likeCount);
    const last = item.works[0]?.publishedAt || null;
    const totalLikes = likes.reduce((a, b) => a + b, 0);
    const maxLikes = Math.max(0, ...likes);
    return {
      externalId, creatorId: externalId, secUid: externalId.slice(4), name: item.name,
      platform: "小红书", profileUrl: item.profileUrl, category: null, fans: item.fans,
      plays: likes, quote: null, outreachStatus: "未建联", cooperationStatus: null,
      contact: null, poolStatus: "pending_review", accountType: "unknown", rejectReason: null,
      screeningStatus: "pending", screeningSummary: "来源：红狐 API 小红书关键词发现",
      lastPublishedAt: last, avgLikes: item.works.length ? Math.round(totalLikes / item.works.length) : 0,
      maxLikes, recentWorkCount: item.works.length,
      viralWorkCount: item.works.filter((x) => x.likeCount >= 2000).length,
      notes: null, works: item.works, sourceKeywords: Array.from(item.keywords),
      workCount: item.works.length, totalLikes,
      totalCollects: item.works.reduce((a, x) => a + x.collectCount, 0),
      totalComments: item.works.reduce((a, x) => a + x.commentCount, 0),
      totalShares: item.works.reduce((a, x) => a + x.shareCount, 0),
      sampleAwemeUrl: item.works[0]?.url || "", sampleTitle: item.works[0]?.title || "",
      hasRecentQualifiedWork: likes.some((x) => x >= 500),
      hasRecentUpdate: Boolean(last && Date.now() - new Date(last).getTime() <= 30 * 86400_000),
      hasViralWork: likes.some((x) => x >= 2000)
    };
  });
}

export async function importXhsCandidates(candidates: DouyinDiscoveryCandidate[], campaignTaskId: number) {
  let imported = 0, updated = 0;
  for (const candidate of candidates) {
    const summary = `小红书关键词样本画像通过；已记录 ${candidate.works.length} 篇笔记`;
    const existing = await prisma.creator.findUnique({ where: { externalId: candidate.externalId } });
    const creator = await prisma.creator.upsert({
      where: { externalId: candidate.externalId },
      create: {
        externalId: candidate.externalId, name: candidate.name, platform: "小红书",
        profileUrl: candidate.profileUrl, category: candidate.category, fans: candidate.fans,
        plays: candidate.plays, poolStatus: "pending_review", screeningStatus: "pending",
        screeningSummary: `等待验证达人身份；${summary}`,
        lastPublishedAt: candidate.lastPublishedAt ? new Date(candidate.lastPublishedAt) : null,
        avgLikes: candidate.avgLikes, maxLikes: candidate.maxLikes,
        recentWorkCount: candidate.recentWorkCount, viralWorkCount: candidate.viralWorkCount
      },
      update: {
        name: candidate.name, platform: "小红书", profileUrl: candidate.profileUrl,
        fans: candidate.fans, plays: candidate.plays,
        lastPublishedAt: candidate.lastPublishedAt ? new Date(candidate.lastPublishedAt) : null,
        avgLikes: candidate.avgLikes, maxLikes: candidate.maxLikes,
        recentWorkCount: candidate.recentWorkCount, viralWorkCount: candidate.viralWorkCount,
        poolStatus: "pending_review", screeningStatus: "pending", screeningSummary: `等待验证达人身份；${summary}`
      }
    });
    existing ? updated++ : imported++;
    await prisma.creatorCampaignTask.upsert({
      where: { creatorId_campaignTaskId: { creatorId: creator.id, campaignTaskId } },
      create: { creatorId: creator.id, campaignTaskId, poolStatus: "pending_review", screeningStatus: "pending", screeningSummary: `等待验证达人身份；${summary}` },
      update: { poolStatus: "pending_review", screeningStatus: "pending", screeningSummary: `等待验证达人身份；${summary}` }
    });
    for (const work of candidate.works) {
      await prisma.creatorWork.upsert({
        where: { creatorExternalId_awemeId: { creatorExternalId: candidate.externalId, awemeId: work.awemeId } },
        create: {
          creatorId: creator.id, creatorExternalId: candidate.externalId,
          creatorName: candidate.name, creatorProfileUrl: candidate.profileUrl,
          awemeId: work.awemeId, title: work.title, url: work.url,
          publishedAt: work.publishedAt ? new Date(work.publishedAt) : null,
          likeCount: work.likeCount, collectCount: work.collectCount,
          commentCount: work.commentCount, shareCount: work.shareCount,
          sourceKeyword: work.sourceKeyword, rawJson: work.rawJson as any
        },
        update: {
          creatorId: creator.id, creatorName: candidate.name,
          creatorProfileUrl: candidate.profileUrl, title: work.title, url: work.url,
          publishedAt: work.publishedAt ? new Date(work.publishedAt) : null,
          likeCount: work.likeCount, collectCount: work.collectCount,
          commentCount: work.commentCount, shareCount: work.shareCount,
          sourceKeyword: work.sourceKeyword, rawJson: work.rawJson as any
        }
      });
    }
  }
  return { imported, updated, total: candidates.length, campaignTaskLinked: candidates.length };
}
