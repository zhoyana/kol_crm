export type AgentGoal = {
  targetFeaturedCount: number;
  maxCollectedWorks: number;
  maxAiCalls: number;
  maxDurationMinutes: number;
  maxNoGrowthRounds: number;
  maxRounds: number;
};

export const DEFAULT_AGENT_GOAL: AgentGoal = {
  targetFeaturedCount: 20,
  maxCollectedWorks: 50,
  maxAiCalls: 100,
  maxDurationMinutes: 120,
  maxNoGrowthRounds: 2,
  maxRounds: 3
};

const limits: Record<keyof AgentGoal, [number, number]> = {
  targetFeaturedCount: [1, 1000],
  maxCollectedWorks: [1, 300],
  maxAiCalls: [1, 10000],
  maxDurationMinutes: [5, 10080],
  maxNoGrowthRounds: [1, 20],
  maxRounds: [1, 20]
};

export function normalizeAgentGoal(value: any, fallback: AgentGoal = DEFAULT_AGENT_GOAL): AgentGoal {
  return Object.fromEntries(Object.entries(limits).map(([key, [min, max]]) => {
    const goalKey = key as keyof AgentGoal;
    const parsed = Math.round(Number(value?.[goalKey]));
    const resolved = Number.isFinite(parsed) ? parsed : fallback[goalKey];
    return [goalKey, Math.min(max, Math.max(min, resolved))];
  })) as AgentGoal;
}
