import { NextRequest, NextResponse } from "next/server";
import type { DouyinDiscoveryCandidate } from "@/lib/douyin-import";
import { resolveDiscoveryRuleTemplate, type DiscoveryRuleTemplate } from "@/lib/discovery-rule-templates";
import { prisma } from "@/lib/prisma";

type CampaignTask = {
  name: string;
  productName: string;
  category: string | null;
  targetAudience: string;
  targetDescription: string;
  seedKeywords: string[];
  excludeKeywords: string[];
  productSellingPoints: string[];
};

type CandidateScreenRequest = {
  keyword?: string;
  campaignTaskId?: number | string | null;
  candidates?: DouyinDiscoveryCandidate[];
};

type CandidateDecision = {
  id: string;
  decision: "keep" | "maybe" | "drop";
  reason: string;
};

function normalizeTaskId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function loadCampaignTask(id: number | null): Promise<CampaignTask | null> {
  if (!id || !process.env.DATABASE_URL) return null;
  // prisma singleton from import
  try {
    const task = await prisma.campaignTask.findUnique({ where: { id } });
    if (!task) return null;
    const strings = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
    return {
      name: task.name,
      productName: task.productName,
      category: task.category,
      targetAudience: task.targetAudience,
      targetDescription: task.targetDescription,
      seedKeywords: strings(task.seedKeywords),
      excludeKeywords: strings(task.excludeKeywords),
      productSellingPoints: strings(task.productSellingPoints)
    };
  } catch {
    return null;
  }
}

function safeJsonParse(text: string): { decisions?: CandidateDecision[] } {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    return JSON.parse(jsonText);
  } catch {
    return {};
  }
}

function normalizeDecision(value: unknown): CandidateDecision["decision"] {
  return value === "keep" || value === "drop" ? value : "maybe";
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalizeText(term)));
}

function compactCandidate(candidate: DouyinDiscoveryCandidate) {
  return {
    id: candidate.externalId,
    name: candidate.name,
    accountType: candidate.accountType,
    metrics: {
      workCount: candidate.workCount,
      avgLikes: candidate.avgLikes,
      maxLikes: candidate.maxLikes,
      viralWorkCount: candidate.viralWorkCount
    },
    sampleTitle: candidate.sampleTitle,
    screeningSummary: candidate.screeningSummary,
    works: candidate.works.slice(0, 10).map((work) => ({
      title: work.title,
      likeCount: work.likeCount,
      sourceKeyword: work.sourceKeyword
    }))
  };
}

function localHardDecision(candidate: DouyinDiscoveryCandidate, template: DiscoveryRuleTemplate): CandidateDecision | null {
  const text = normalizeText([
    candidate.name,
    candidate.category || "",
    candidate.accountType || "",
    candidate.rejectReason || "",
    candidate.sampleTitle || "",
    candidate.screeningSummary || "",
    ...candidate.works.slice(0, 10).map((work) => `${work.title} ${work.sourceKeyword || ""}`)
  ].join(" "));

  const hardAccountTypes = [
    "official",
    "brand",
    "shop",
    "media",
    "government",
    "school",
    "verified",
    "professional_verified",
    "marketing_agency"
  ];
  if (candidate.rejectReason || hardAccountTypes.includes(String(candidate.accountType || "").toLowerCase())) {
    return {
      id: candidate.externalId,
      decision: "drop",
      reason: candidate.rejectReason === "verified_account"
        ? "黄V、职业认证或权威认证账号不进入待选"
        : "官方、机构、运营服务或其他非个人账号不进入待选"
    };
  }

  if (candidate.fans >= 100_000) {
    return { id: candidate.externalId, decision: "drop", reason: `粉丝 ${candidate.fans}，属于大V，不进入待选` };
  }

  if (includesAny(text, ["账号封禁", "用户封禁", "已封禁"])) {
    return { id: candidate.externalId, decision: "drop", reason: "账号已封禁或状态异常" };
  }

  if (includesAny(text, ["官方账号", "官方客服", "政务号", "媒体号", "培训机构", "招生办", "教育咨询", "品牌官方"])) {
    return { id: candidate.externalId, decision: "drop", reason: "明显为官方、机构或培训账号" };
  }

  if (includesAny(text, template.candidateScreen.hardDropTerms)) {
    return { id: candidate.externalId, decision: "drop", reason: `命中${template.name}硬排除规则` };
  }

  if (
    !includesAny(text, template.candidateScreen.identityTerms) &&
    includesAny(text, template.candidateScreen.obviousMismatchTerms)
  ) {
    return { id: candidate.externalId, decision: "drop", reason: `明显属于其他垂类，未发现${template.name}目标身份或场景` };
  }

  const isXhs = candidate.platform === "小红书" || String(candidate.externalId || "").startsWith("xhs-");
  // 小红书互动量级低于抖音，按平台放宽点赞门槛（抖音保持模板阈值）。
  // 初筛只负责排除明显死号/搬运号，身份精判交给画像阶段 AI——门槛过低会误杀真实素人。
  const minSampleLikes = isXhs ? Math.min(template.candidateScreen.minSampleLikes, 30) : template.candidateScreen.minSampleLikes;
  if (!candidate.works.some((work) => work.likeCount > minSampleLikes)) {
    return {
      id: candidate.externalId,
      decision: "drop",
      reason: `当前样本没有点赞超过${minSampleLikes}的作品`
    };
  }
  return null;
}

function buildPrompt(keyword: string, task: CampaignTask | null, candidates: DouyinDiscoveryCandidate[]): string {
  const template = resolveDiscoveryRuleTemplate(task);
  const rules = template.candidateScreen.instructions;

  return [
    "你是达人发现阶段的候选账号初筛助手。只能根据提供的搜索样本判断，不得脑补主页内容。",
    `当前规则模板：${template.name} v${template.version}`,
    `搜索关键词：${keyword}`,
    `任务名称：${task?.name || "未指定"}`,
    `推广产品：${task?.productName || "未指定"}`,
    `目标人群：${task?.targetAudience || "结合搜索关键词判断"}`,
    `筛选目标：${task?.targetDescription || "结合搜索关键词判断"}`,
    `排除方向：${(task?.excludeKeywords || []).join("、") || "无"}`,
    `模板强相关词：${template.discovery.primaryTerms.join("、") || "无"}`,
    `模板辅助词：${template.discovery.supportTerms.join("、") || "无"}`,
    `模板排除词：${template.discovery.excludeTerms.join("、") || "无"}`,
    ...rules,
    "每个候选必须返回一条结果。输出纯 JSON，不要 Markdown。",
    '格式：{"decisions":[{"id":"","decision":"keep|maybe|drop","reason":""}],"note":""}',
    `候选账号：${JSON.stringify(candidates.map(compactCandidate), null, 2)}`
  ].join("\n");
}

async function requestBatch(
  apiKey: string,
  baseUrl: string,
  model: string,
  keyword: string,
  task: CampaignTask | null,
  candidates: DouyinDiscoveryCandidate[]
): Promise<CandidateDecision[]> {
  let lastError = "AI候选过滤失败";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "你只输出可解析 JSON。" },
            { role: "user", content: buildPrompt(keyword, task, candidates) }
          ]
        }),
        signal: AbortSignal.timeout(90_000)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        lastError = data?.error?.message || `AI候选过滤失败（HTTP ${response.status}）`;
        if (response.status < 500 && response.status !== 429) throw new Error(lastError);
      } else {
        const parsed = safeJsonParse(String(data?.choices?.[0]?.message?.content || ""));
        return Array.isArray(parsed.decisions)
          ? parsed.decisions.map((item) => ({
              id: String(item.id || "").trim(),
              decision: normalizeDecision(item.decision),
              reason: String(item.reason || "").trim()
            })).filter((item) => item.id)
          : [];
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
  throw new Error(lastError);
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CandidateScreenRequest | null;
  const apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "还没有配置 OPENAI_API_KEY。" }, { status: 400 });

  const keyword = body?.keyword?.trim() || "";
  const candidates = (body?.candidates || []).slice(0, 600);
  if (!keyword || !candidates.length) {
    return NextResponse.json({ error: "缺少关键词或候选达人。" }, { status: 400 });
  }

  try {
    const task = await loadCampaignTask(normalizeTaskId(body?.campaignTaskId));
    const template = resolveDiscoveryRuleTemplate(task);
    const localDecisions = candidates
      .map((candidate) => localHardDecision(candidate, template))
      .filter((item): item is CandidateDecision => Boolean(item));
    const locallyHandled = new Set(localDecisions.map((item) => item.id));
    const modelCandidates = candidates.filter((candidate) => !locallyHandled.has(candidate.externalId));
    const baseUrl = (process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
    const model = process.env.OPENAI_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-chat";
    const batches: DouyinDiscoveryCandidate[][] = [];
    for (let index = 0; index < modelCandidates.length; index += 30) {
      batches.push(modelCandidates.slice(index, index + 30));
    }

    const modelDecisions: CandidateDecision[] = [];
    let failedBatchCount = 0;
    for (let index = 0; index < batches.length; index += 2) {
      const currentBatches = batches.slice(index, index + 2);
      const results = await Promise.allSettled(
        currentBatches.map((batch) => requestBatch(apiKey, baseUrl, model, keyword, task, batch))
      );
      results.forEach((result, resultIndex) => {
        if (result.status === "fulfilled") {
          modelDecisions.push(...result.value);
          return;
        }
        failedBatchCount += 1;
        modelDecisions.push(...currentBatches[resultIndex].map((candidate) => ({
          id: candidate.externalId,
          decision: "maybe" as const,
          reason: "本批AI请求失败，已保留为待观察，稍后可重新筛选"
        })));
      });
    }

    return NextResponse.json({
      decisions: [...localDecisions, ...modelDecisions],
      template: { id: template.id, name: template.name, version: template.version },
      note: failedBatchCount
        ? `已按${template.name}初筛 ${candidates.length} 人；${failedBatchCount}批请求失败并保留为待观察`
        : `已按${template.name}初筛 ${candidates.length} 人`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI候选过滤接口没有响应";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
