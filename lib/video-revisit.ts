import { localAgentRequest } from "./local-agent-client";

type DetailRow = Record<string, unknown>;

export type VideoDetail = {
  awemeId: string;
  videoUrl: string;
  title: string;
  creatorName: string;
  publishedAt: Date | null;
  likeCount: number;
  collectCount: number;
  commentCount: number;
  rawJson: DetailRow;
};

type SerializedVideoDetail = Omit<VideoDetail, "publishedAt"> & { publishedAt: string | null };

export async function fetchDouyinVideoDetail(inputUrl: string): Promise<VideoDetail> {
  const detail = await localAgentRequest<SerializedVideoDetail>("/v1/douyin/video/detail", {
    method: "POST",
    body: { videoUrl: inputUrl },
    timeoutMs: 180_000
  });
  return {
    ...detail,
    publishedAt: detail.publishedAt ? new Date(detail.publishedAt) : null
  };
}
