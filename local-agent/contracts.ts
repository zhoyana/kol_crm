import type { TopicCandidate, TopicRuleOptions } from "../lib/topic-extractor.ts";

export type LocalAgentCapability =
  | "douyin-discovery"
  | "douyin-homepage"
  | "douyin-video-revisit"
  | "xhs-video-revisit"
  | "douyin-outreach";

export type LocalAgentHealth = {
  ok: true;
  version: string;
  pid: number;
  capabilities: LocalAgentCapability[];
};

export type CrawlerTaskStatus = "idle" | "running" | "waiting_topics" | "succeeded" | "failed" | "stopped";
export type DiscoveryMode = "single" | "two_stage_auto" | "two_stage_manual";
export type { TopicCandidate, TopicRuleOptions };

export type CrawlerTaskSnapshot = {
  id: string;
  keyword: string;
  maxNotes: number;
  status: CrawlerTaskStatus;
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  logs: string[];
  command: string;
  error: string;
  discoveryMode: DiscoveryMode;
  stage: "idle" | "keyword" | "topic" | "done";
  topicCandidates: TopicCandidate[];
  selectedTopics: string[];
  topicLimit: number;
  activeKeywords: string[];
  collectedWorks: number;
};

export type CrawlerTaskResult = {
  task: CrawlerTaskSnapshot;
  content: string;
};

export type StartDouyinDiscoveryInput = {
  keyword: string;
  maxNotes: number;
  discoveryMode?: DiscoveryMode;
  topicLimit?: number;
  publishWindowDays?: number;
  sortBy?: string;
  topicRules?: TopicRuleOptions;
  restartCdpBeforeSpawn?: boolean;
};

export type DouyinHomepageCrawlInput = {
  secUids: string[];
  workLimit: number;
  maxAttempts?: number;
};

export type DouyinHomepageRows = {
  startedAt: number;
  rowsBySecUid: Record<string, string>;
};

export type DouyinHomepageCacheInput = {
  secUids: string[];
  minWorks: number;
};

export type LocalAgentError = {
  error: string;
};
