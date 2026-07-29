import { getCreators } from "./creators";

export type CampaignTaskSummary = {
  campaignTaskId: number;
  counts: {
    total: number;
    pendingReview: number;
    candidate: number;
    featured: number;
    skipped: number;
    featuredUncontacted: number;
    contacted: number;
  };
  recommendation: {
    title: string;
    reason: string;
    primaryAction: string;
    primaryHref: string;
  };
  links: {
    discover: string;
    review: string;
    creators: string;
    tasks: string;
  };
};

function taskLinks(campaignTaskId: number) {
  const query = `campaignTaskId=${campaignTaskId}`;
  return {
    discover: `/discover?${query}`,
    review: `/review?${query}`,
    creators: `/creators?${query}`,
    tasks: `/tasks?${query}`
  };
}

function isUncontacted(status: unknown) {
  const text = String(status || "").trim();
  if (!text) return true;
  return text.includes("未建联") || text.includes("待发送") || text.includes("暂无") || text.includes("未联系");
}

function buildRecommendation(campaignTaskId: number, counts: CampaignTaskSummary["counts"]) {
  const links = taskLinks(campaignTaskId);

  if (counts.total === 0) {
    return {
      title: "先补达人池",
      reason: "这个品类任务下面还没有达人数据，先去达人发现采一批候选。",
      primaryAction: "去达人发现",
      primaryHref: links.discover
    };
  }

  if (counts.pendingReview >= 5) {
    return {
      title: "先处理待复筛",
      reason: `还有 ${counts.pendingReview} 个达人等着主页复筛，先把不合适的过滤掉，再推进建联。`,
      primaryAction: "去达人复筛",
      primaryHref: links.review
    };
  }

  if (counts.featuredUncontacted >= 1) {
    return {
      title: "可以开始建联",
      reason: `精选库已有 ${counts.featured} 个达人，其中 ${counts.featuredUncontacted} 个还没建联，可以优先生成话术并打开达人主页。`,
      primaryAction: "去建联任务",
      primaryHref: links.tasks
    };
  }

  if (counts.featured < 5) {
    return {
      title: "精选库偏少，继续找人",
      reason: "精选达人少于 5 个，当前可建联对象不多，优先扩大这个品类的达人池。",
      primaryAction: "去达人发现",
      primaryHref: links.discover
    };
  }

  if (counts.candidate >= 10) {
    return {
      title: "整理待选库",
      reason: "待选库里有一批可观察达人，可以人工降噪、删除、重新复筛或移入精选。",
      primaryAction: "去达人库",
      primaryHref: links.creators
    };
  }

  return {
    title: "继续补充样本",
    reason: "当前任务已经比较干净，但新增可建联对象不多，建议继续按关键词补充新达人。",
    primaryAction: "去达人发现",
    primaryHref: links.discover
  };
}

function emptySummary(campaignTaskId: number): CampaignTaskSummary {
  const counts = {
    total: 0,
    pendingReview: 0,
    candidate: 0,
    featured: 0,
    skipped: 0,
    featuredUncontacted: 0,
    contacted: 0
  };

  return {
    campaignTaskId,
    counts,
    recommendation: buildRecommendation(campaignTaskId, counts),
    links: taskLinks(campaignTaskId)
  };
}

export function createEmptyCampaignTaskSummary(campaignTaskId: number): CampaignTaskSummary {
  return emptySummary(campaignTaskId);
}

export async function getCampaignTaskSummaries(campaignTaskIds: number[]): Promise<CampaignTaskSummary[]> {
  const uniqueIds = Array.from(new Set(campaignTaskIds.filter((id) => Number.isFinite(id))));
  if (uniqueIds.length === 0) return [];

  return Promise.all(
    uniqueIds.map(async (campaignTaskId) => {
      try {
        const creators = await getCreators(campaignTaskId);
        const counts = {
          total: creators.length,
          pendingReview: creators.filter((creator) => creator.poolStatus === "pending_review").length,
          candidate: creators.filter((creator) => creator.poolStatus === "candidate").length,
          featured: creators.filter((creator) => creator.poolStatus === "featured").length,
          skipped: creators.filter((creator) => creator.poolStatus === "skipped").length,
          featuredUncontacted: creators.filter(
            (creator) => creator.poolStatus === "featured" && isUncontacted(creator.outreachStatus)
          ).length,
          contacted: creators.filter((creator) => creator.poolStatus === "featured" && !isUncontacted(creator.outreachStatus)).length
        };

        return {
          campaignTaskId,
          counts,
          recommendation: buildRecommendation(campaignTaskId, counts),
          links: taskLinks(campaignTaskId)
        };
      } catch {
        return emptySummary(campaignTaskId);
      }
    })
  );
}
