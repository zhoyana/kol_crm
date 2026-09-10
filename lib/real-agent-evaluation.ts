export const HUMAN_DECISIONS = ["pass", "reject", "review"] as const;
export const OUTREACH_REVIEWS = ["approved", "modified", "rejected"] as const;

export function normalizedDecision(value: unknown): string | null {
  const text = String(value || "").trim().toLowerCase();
  const map: Record<string, string> = {
    pass: "pass", "通过": "pass",
    reject: "reject", "拒绝": "reject",
    review: "review", "待复核": "review", "复核": "review"
  };
  return map[text] || null;
}

export function normalizedOutreachReview(value: unknown): string | null {
  const text = String(value || "").trim().toLowerCase();
  const map: Record<string, string> = {
    approved: "approved", "直接通过": "approved", "通过": "approved",
    modified: "modified", "修改后通过": "modified", "修改": "modified",
    rejected: "rejected", "拒绝": "rejected"
  };
  return map[text] || null;
}

export function agentDecisionFromStatus(poolStatus: string, screeningStatus: string): string {
  if (poolStatus === "featured" || screeningStatus === "portrait_passed") return "pass";
  if (poolStatus === "rejected" || screeningStatus.includes("rejected")) return "reject";
  return "review";
}

export function calculateRealEvaluation(cases: Array<{
  agentDecision: string;
  humanADecision: string | null;
  humanBDecision: string | null;
  adjudicatedDecision: string | null;
  outreachReview: string | null;
  aiCalls: number;
  aiCostYuan: number;
}>) {
  const labeled = cases.flatMap((item) => {
    const gold = item.adjudicatedDecision || item.humanADecision;
    return gold ? [{ ...item, gold }] : [];
  });
  const agreed = cases.filter((item) => item.humanADecision && item.humanBDecision);
  const correct = labeled.filter((item) => item.agentDecision === item.gold).length;
  const predictedPositive = labeled.filter((item) => item.agentDecision === "pass");
  const actualPositive = labeled.filter((item) => item.gold === "pass");
  const truePositive = predictedPositive.filter((item) => item.gold === "pass").length;
  const outreachReviewed = cases.filter((item) => item.outreachReview);
  const totalCost = cases.reduce((sum, item) => sum + Number(item.aiCostYuan || 0), 0);
  const aiCalls = cases.reduce((sum, item) => sum + Number(item.aiCalls || 0), 0);
  const ratio = (a: number, b: number) => b ? a / b : null;
  return {
    sampleSize: cases.length,
    labeledSize: labeled.length,
    doubleLabeledSize: agreed.length,
    accuracy: ratio(correct, labeled.length),
    precision: ratio(truePositive, predictedPositive.length),
    recall: ratio(truePositive, actualPositive.length),
    humanAgreement: ratio(agreed.filter((item) => item.humanADecision === item.humanBDecision).length, agreed.length),
    outreachPassRate: ratio(outreachReviewed.filter((item) => ["approved", "modified"].includes(String(item.outreachReview))).length, outreachReviewed.length),
    outreachDirectPassRate: ratio(outreachReviewed.filter((item) => item.outreachReview === "approved").length, outreachReviewed.length),
    aiCalls,
    totalCost,
    costPerCreator: ratio(totalCost, cases.length)
  };
}
