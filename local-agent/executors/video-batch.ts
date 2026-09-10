import { fetchDouyinVideoDetail } from "./douyin-video.ts";
import { fetchXhsVideoDetail } from "./xhs-video.ts";

type InputItem = { rowKey?: string; videoUrl?: string };

function platformOf(url: string): "douyin" | "xhs" | null {
  if (/douyin\.com/i.test(url)) return "douyin";
  if (/xiaohongshu\.com|xhslink\.(?:com|cn)/i.test(url)) return "xhs";
  return null;
}

export async function fetchVideoDetailsBatch(input: { items?: InputItem[] }) {
  const items = Array.isArray(input?.items) ? input.items.slice(0, 30) : [];
  const results = [];
  for (const item of items) {
    const rowKey = String(item.rowKey || "");
    const videoUrl = String(item.videoUrl || "").trim();
    const platform = platformOf(videoUrl);
    if (!platform) {
      results.push({ rowKey, ok: false, error: "不支持的发布链接" });
      continue;
    }
    try {
      if (platform === "xhs") {
        results.push({ rowKey, ok: true, ...(await fetchXhsVideoDetail(videoUrl)) });
      } else {
        const detail = await fetchDouyinVideoDetail(videoUrl);
        results.push({
          rowKey,
          ok: true,
          platform: "douyin",
          contentId: detail.awemeId,
          videoUrl: detail.videoUrl,
          title: detail.title,
          creatorName: detail.creatorName,
          publishedAt: detail.publishedAt,
          revisitedAt: new Date(),
          likeCount: detail.likeCount,
          collectCount: detail.collectCount,
          commentCount: detail.commentCount,
          shareCount: detail.shareCount
        });
      }
    } catch (error) {
      results.push({ rowKey, ok: false, platform, error: error instanceof Error ? error.message : "抓取失败" });
    }
  }
  return { results };
}
