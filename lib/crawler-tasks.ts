import { localAgentRequest } from "./local-agent-client";
import type {
  CrawlerTaskSnapshot,
  CrawlerTaskResult,
  DiscoveryMode,
  StartDouyinDiscoveryInput,
  TopicCandidate,
  TopicRuleOptions
} from "../local-agent/contracts";

export type {
  CrawlerTaskSnapshot,
  CrawlerTaskResult,
  DiscoveryMode,
  StartDouyinDiscoveryInput,
  TopicCandidate,
  TopicRuleOptions
};

export function getDouyinCrawlerTask(): Promise<CrawlerTaskSnapshot> {
  return localAgentRequest<CrawlerTaskSnapshot>("/v1/douyin/discovery/status", { timeoutMs: 3_000 });
}

export function getDouyinCrawlerTaskResult(): Promise<CrawlerTaskResult> {
  return localAgentRequest<CrawlerTaskResult>("/v1/douyin/discovery/results", { timeoutMs: 10_000 });
}

export function startDouyinCrawlerTask(input: StartDouyinDiscoveryInput): Promise<CrawlerTaskSnapshot> {
  return localAgentRequest<CrawlerTaskSnapshot>("/v1/douyin/discovery/start", {
    method: "POST",
    body: input,
    timeoutMs: 10_000
  });
}

export function continueDouyinCrawlerWithTopics(topics: string[]): Promise<CrawlerTaskSnapshot> {
  return localAgentRequest<CrawlerTaskSnapshot>("/v1/douyin/discovery/continue", {
    method: "POST",
    body: { topics },
    timeoutMs: 5_000
  });
}

export function stopDouyinCrawlerTask(): Promise<CrawlerTaskSnapshot> {
  return localAgentRequest<CrawlerTaskSnapshot>("/v1/douyin/discovery/stop", {
    method: "POST",
    timeoutMs: 5_000
  });
}
