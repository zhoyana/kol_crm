type RedfoxAccountWork = {
  workId?: string;
  workTitle?: string;
  workDesc?: string;
  workUrl?: string;
  workPublishTime?: string | number;
  accountNickname?: string;
  accountUserid?: string;
  workLikedCount?: string | number;
  workCommentsCount?: string | number;
  workCollectedCount?: string | number;
  workSharedCount?: string | number;
};

function asCount(value: unknown): number {
  const parsed = Number(String(value ?? 0).replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function queryRedfoxXhsAccountWorks(userid: string, limit = 10) {
  const apiKey = String(process.env.REDFOX_API_KEY || "").trim();
  if (!apiKey) throw new Error("未配置 REDFOX_API_KEY");

  let lastError = "RedFox 作者作品接口请求失败";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch("https://redfox.hk/story/api/xhsUser/queryWorkList", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "User-Agent": "KOL-CRM/1.0"
        },
        body: JSON.stringify({ userid, offset: 0, sortType: "_2" }),
        signal: AbortSignal.timeout(45_000)
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.code === 2000) {
        const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
        return (list as RedfoxAccountWork[]).slice(0, Math.max(1, Math.min(limit, 20))).map((work) => ({
          awemeId: String(work.workId || "").trim(),
          title: [work.workTitle, work.workDesc].map((item) => String(item || "").trim()).filter(Boolean).join("\n"),
          url: String(work.workUrl || "").trim() || null,
          publishedAt: asDate(work.workPublishTime),
          likeCount: asCount(work.workLikedCount),
          commentCount: asCount(work.workCommentsCount),
          collectCount: asCount(work.workCollectedCount),
          shareCount: asCount(work.workSharedCount),
          rawJson: work
        })).filter((work) => work.awemeId);
      }
      lastError = String(payload?.message || payload?.msg || `HTTP ${response.status}`);
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
  }
  throw new Error(lastError);
}
