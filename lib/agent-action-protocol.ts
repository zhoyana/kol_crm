export const AGENT_ACTION_PROTOCOL = [
  { id: "collect_keyword", label: "采集关键词", guard: "仅使用任务内关键词；剩余作品预算 > 0", input: "keyword, maxWorks", effect: "新增作品样本，不直接改变达人库", verify: "采集记录可读，作品数不超过预算" },
  { id: "build_candidate", label: "建立候选", guard: "作品已采集且账号未命中硬排除", input: "workIds", effect: "写入待画像队列", verify: "候选可追溯到原始作品" },
  { id: "profile_creator", label: "生成画像", guard: "样本达到最低数量且 AI 预算 > 0", input: "creatorId, sampleIds", effect: "写入画像结论与证据", verify: "结论、证据、模型与调用次数齐全" },
  { id: "apply_metric_gate", label: "执行数据门槛", guard: "画像已通过；指标字段完整", input: "creatorId, ruleSnapshot", effect: "晋级精选或留在待选", verify: "结果可由规则快照复算" },
  { id: "prepare_outreach", label: "生成建联话术", guard: "仅限精选且未建联达人", input: "creatorId, brandStyle", effect: "生成草稿，不自动发送", verify: "敏感词检查通过且有人工作最终确认" },
  { id: "request_human_review", label: "请求人工复核", guard: "置信度不足、证据冲突或越权风险", input: "reason, evidence", effect: "暂停当前对象", verify: "复核结果已记录" },
  { id: "stop_run", label: "停止运行", guard: "达到目标、预算、时限或连续低产出", input: "reason, usage", effect: "停止后续动作", verify: "停止原因和最终用量已固化" }
] as const;

export type AgentActionId = typeof AGENT_ACTION_PROTOCOL[number]["id"];

export const AGENT_LOOP = ["观察", "决策", "执行", "验证"] as const;
