import { localAgentRequest } from "./local-agent-client";

export type DouyinOutreachResult = {
  ok: true;
  message: string;
  retriedAfterRestart: boolean;
};

export function sendDouyinOutreach(input: {
  profileUrl: string;
  message: string;
  taskId?: string;
}): Promise<DouyinOutreachResult> {
  return localAgentRequest<DouyinOutreachResult>("/v1/douyin/outreach/send", {
    method: "POST",
    body: input,
    timeoutMs: 150_000
  });
}
