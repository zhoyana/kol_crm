import { timingSafeEqual } from "node:crypto";

export function isCentralAgentAuthorized(request: Request): boolean {
  const expected = process.env.CENTRAL_AGENT_TOKEN || "";
  if (!expected) return false;
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function agentIdFromRequest(request: Request): string | undefined {
  const value = request.headers.get("x-kol-agent-id")?.trim();
  return value && value.length <= 128 ? value : undefined;
}
