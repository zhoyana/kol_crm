export const AGENT_STRATEGY_ACTIONS = [
  "continue_next_keyword",
  "retry_current_keyword",
  "supplement_incomplete",
  "optimize_keywords",
  "review_rules",
  "request_human_review",
  "stop_target_reached",
  "stop_budget_reached",
  "stop_low_yield"
] as const;

export type AgentStrategyAction = typeof AGENT_STRATEGY_ACTIONS[number];

export type AgentStrategyContext = {
  brandName?: string;
  campaignTaskName: string;
  productName: string;
  targetAudience: string;
  targetDescription: string;
  excludeKeywords: string[];
  seedKeywords: string[];
  targetFeaturedCount: number;
  maxAiCalls: number;
  maxDurationMinutes: number;
  maxNoGrowthRounds: number;
  maxRounds: number;
  currentRound: number;
  cumulativeFeatured: number;
  cumulativeAiCalls: number;
  elapsedMinutes: number;
  noGrowthRounds: number;
  keyword: string;
  collectedWorks: number;
  candidatesFound: number;
  importedCount: number;
  portraitProcessed: number;
  roundAiCalls: number;
  portraitPassed: number;
  portraitInsufficient: number;
  portraitIncomplete: number;
  portraitRejected: number;
  featuredAdded: number;
  usedKeywords: string[];
  unusedKeywords: string[];
  deterministicDecision: string;
  deterministicStopReason?: string | null;
};

export type AgentStrategyDecision = {
  technical_status: "healthy" | "degraded" | "failed";
  strategy_status: "effective" | "uncertain" | "low_yield" | "blocked";
  primary_problem: string;
  action: AgentStrategyAction;
  confidence: number;
  reason: string;
  expected_benefit: string;
  risk: string;
  execution_scope: { keyword: string | null; max_creators: number | null; max_ai_calls: number | null };
  stop_condition: string;
  human_message: string;
};

const SYSTEM_PROMPT = `你是达人筛选策略 Agent。你只分析每轮结果并生成建议，不执行动作，也不能修改数据库、关键词或筛选规则。

必须区分：技术执行是否健康、采集策略是否有效、达人画像是否符合。流程成功不等于策略有效，技术失败也不能算作画像排除。
优先考虑成本低、信息增益高、风险可控的下一步。不得为了凑人数放宽核心身份和内容门槛。每次只选择一个动作。

允许动作：${AGENT_STRATEGY_ACTIONS.join(", ")}。
达到程序硬停止条件时，只能建议 stop_target_reached 或 stop_budget_reached；不得要求继续。
第一版建议仅展示给人工，程序不会执行你的动作。
只返回符合给定 JSON Schema 的 JSON，不要输出 Markdown。`;

const strategySchema = {
  name: "agent_strategy_decision",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["technical_status", "strategy_status", "primary_problem", "action", "confidence", "reason", "expected_benefit", "risk", "execution_scope", "stop_condition", "human_message"],
    properties: {
      technical_status: { type: "string", enum: ["healthy", "degraded", "failed"] },
      strategy_status: { type: "string", enum: ["effective", "uncertain", "low_yield", "blocked"] },
      primary_problem: { type: "string" },
      action: { type: "string", enum: [...AGENT_STRATEGY_ACTIONS] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" },
      expected_benefit: { type: "string" },
      risk: { type: "string" },
      execution_scope: {
        type: "object",
        additionalProperties: false,
        required: ["keyword", "max_creators", "max_ai_calls"],
        properties: {
          keyword: { type: ["string", "null"] },
          max_creators: { type: ["integer", "null"], minimum: 1 },
          max_ai_calls: { type: ["integer", "null"], minimum: 1 }
        }
      },
      stop_condition: { type: "string" },
      human_message: { type: "string" }
    }
  }
};

function parseJsonContent(content: string): unknown {
  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function validateDecision(value: any): AgentStrategyDecision {
  if (!value || typeof value !== "object") throw new Error("策略模型没有返回对象");
  if (!AGENT_STRATEGY_ACTIONS.includes(value.action)) throw new Error(`策略动作不在允许列表：${String(value.action)}`);
  const confidence = Math.max(0, Math.min(1, Number(value.confidence)));
  if (!Number.isFinite(confidence)) throw new Error("策略置信度无效");
  const technical = ["healthy", "degraded", "failed"].includes(value.technical_status) ? value.technical_status : "degraded";
  const strategy = ["effective", "uncertain", "low_yield", "blocked"].includes(value.strategy_status) ? value.strategy_status : "uncertain";
  return {
    technical_status: technical,
    strategy_status: strategy,
    primary_problem: String(value.primary_problem || "信息不足").slice(0, 1000),
    action: value.action,
    confidence,
    reason: String(value.reason || "").slice(0, 3000),
    expected_benefit: String(value.expected_benefit || "").slice(0, 2000),
    risk: String(value.risk || "").slice(0, 2000),
    execution_scope: {
      keyword: value.execution_scope?.keyword ? String(value.execution_scope.keyword).slice(0, 100) : null,
      max_creators: Number.isInteger(value.execution_scope?.max_creators) ? value.execution_scope.max_creators : null,
      max_ai_calls: Number.isInteger(value.execution_scope?.max_ai_calls) ? value.execution_scope.max_ai_calls : null
    },
    stop_condition: String(value.stop_condition || "").slice(0, 2000),
    human_message: String(value.human_message || "").slice(0, 2000)
  } as AgentStrategyDecision;
}

function enforceHardStops(decision: AgentStrategyDecision, context: AgentStrategyContext): AgentStrategyDecision {
  if (context.cumulativeFeatured >= context.targetFeaturedCount) {
    return { ...decision, action: "stop_target_reached", human_message: "已达到新增精选目标，程序硬停止条件优先。" };
  }
  if (context.deterministicStopReason && ["max_rounds_reached", "ai_budget_reached", "time_limit_reached"].includes(context.deterministicStopReason)) {
    return { ...decision, action: "stop_budget_reached", human_message: `已触发硬停止条件：${context.deterministicDecision}` };
  }
  if (decision.execution_scope.keyword && !context.seedKeywords.includes(decision.execution_scope.keyword)) {
    return { ...decision, execution_scope: { ...decision.execution_scope, keyword: null }, risk: `${decision.risk}；模型建议了任务外关键词，已由程序移除。` };
  }
  return decision;
}

export async function generateAgentStrategy(context: AgentStrategyContext): Promise<{ decision: AgentStrategyDecision; model: string; raw: unknown }> {
  if (String(process.env.AGENT_STRATEGY_ENABLED || "true").toLowerCase() === "false") throw new Error("策略模型已关闭");
  const apiKey = process.env.DEEPSEEK_API_KEY || "";
  if (!apiKey) throw new Error("未配置 DEEPSEEK_API_KEY，Agent 策略建议未生成");
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const model = process.env.AGENT_STRATEGY_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const timeoutMs = Math.max(5_000, Number(process.env.AGENT_STRATEGY_TIMEOUT_MS || 20_000));
  const userPrompt = `分析以下一轮运行数据并给出唯一建议：\n${JSON.stringify(context, null, 2)}`;
  const body: Record<string, unknown> = {
    model,
    temperature: 0.2,
    max_tokens: 600,
    thinking: { type: "disabled" },
    messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userPrompt }],
    response_format: { type: "json_schema", json_schema: strategySchema }
  };

  let response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok && [400, 404, 422].includes(response.status)) {
    body.response_format = { type: "json_object" };
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  }
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(payload?.error?.message || `策略模型请求失败（${response.status}）`);
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("策略模型返回内容为空");
  const raw = parseJsonContent(content);
  return { decision: enforceHardStops(validateDecision(raw), context), model, raw };
}
