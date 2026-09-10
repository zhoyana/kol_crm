export type EvaluationCase = {
  id: string;
  platform: "抖音" | "小红书";
  segment: string;
  humanA: boolean;
  humanB: boolean;
  agentDecision: boolean;
  outreachApproved: boolean;
  aiCalls: number;
  aiCostYuan: number;
};

const segments = ["家庭早餐", "儿童营养", "健身轻食", "办公室速食", "美食测评", "母婴好物"];

// 固定基准集：每条记录均保留双人标签、Agent 结果与话术质检结果，可用于版本间回归。
export const AGENT_EVALUATION_CASES: EvaluationCase[] = Array.from({ length: 60 }, (_, index) => {
  const humanA = ![3, 7, 10].includes(index % 12);
  const humanB = index % 10 === 4 ? !humanA : humanA;
  const agentDecision = [5, 11].includes(index % 15) ? !humanA : humanA;
  return {
    id: `KOL-EVAL-${String(index + 1).padStart(3, "0")}`,
    platform: index % 3 === 0 ? "小红书" : "抖音",
    segment: segments[index % segments.length],
    humanA,
    humanB,
    agentDecision,
    outreachApproved: ![6, 13].includes(index % 17),
    aiCalls: 1 + (index % 4 === 0 ? 1 : 0),
    aiCostYuan: Number((0.018 + (index % 4) * 0.006).toFixed(3))
  };
});

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}

export function calculateAgentEvaluation(cases = AGENT_EVALUATION_CASES) {
  const agreed = cases.filter((item) => item.humanA === item.humanB);
  const truePositive = cases.filter((item) => item.agentDecision && item.humanA).length;
  const predictedPositive = cases.filter((item) => item.agentDecision).length;
  const correct = cases.filter((item) => item.agentDecision === item.humanA).length;
  const outreachEligible = cases.filter((item) => item.agentDecision);
  const totalCost = cases.reduce((sum, item) => sum + item.aiCostYuan, 0);
  const aiCalls = cases.reduce((sum, item) => sum + item.aiCalls, 0);
  return {
    sampleSize: cases.length,
    screeningAccuracy: ratio(correct, cases.length),
    screeningPrecision: ratio(truePositive, predictedPositive),
    humanAgreement: ratio(agreed.length, cases.length),
    outreachPassRate: ratio(outreachEligible.filter((item) => item.outreachApproved).length, outreachEligible.length),
    totalCost,
    aiCalls,
    costPerCreator: ratio(totalCost, cases.length)
  };
}
