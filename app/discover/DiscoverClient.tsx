"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { BrandLibraryItem, CampaignTaskItem } from "@/lib/campaign-tasks";
import { BrandTaskPicker } from "@/app/components/BrandTaskPicker";
import type { DiscoveryFilterOptions, DiscoverySortBy, DouyinDiscoveryCandidate } from "@/lib/douyin-import";
import type { DiscoveryMode, TopicCandidate } from "@/lib/crawler-tasks";

type DiscoverResult = {
  keyword: string;
  candidates: DouyinDiscoveryCandidate[];
  sourceFiles: string[];
  total: number;
  stats?: {
    rawCandidateCount: number;
    hiddenExistingCount: number;
    newCandidateCount: number;
  };
};

type ImportResult = {
  imported: number;
  updated: number;
  skipped: number;
  total: number;
  errors: string[];
  campaignTaskId?: number | null;
  campaignTaskLinked?: number;
};

type CandidateViewFilter = "all" | "strong" | "watch";

type AiTopicRules = {
  keep: string[];
  maybe: string[];
  drop: string[];
  primaryTerms: string[];
  supportTerms: string[];
  excludeTerms: string[];
  note: string;
};

type AiCandidateDecision = {
  id: string;
  decision: "keep" | "maybe" | "drop";
  reason: string;
};

type RuleProfile = {
  id: number;
  name: string;
  category: string;
  targetDescription: string;
  primaryTerms: string[];
  supportTerms: string[];
  excludeTerms: string[];
  minLikeCount: number;
  publishWindowDays: number;
  sortType: string;
  notes: string;
};

type CrawlerTask = {
  id: string;
  keyword: string;
  maxNotes: number;
  status: "idle" | "running" | "waiting_topics" | "succeeded" | "failed" | "stopped";
  pid: number | null;
  logs: string[];
  error: string;
  discoveryMode: DiscoveryMode;
  stage: "idle" | "keyword" | "topic" | "done";
  topicCandidates: TopicCandidate[];
  selectedTopics: string[];
  topicLimit: number;
  activeKeywords: string[];
};

type DiscoverClientProps = {
  initialBrandLibraries: BrandLibraryItem[];
  initialCampaignTasks: CampaignTaskItem[];
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

async function parseResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 300) };
  }
}

function parseRuleTerms(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseKeywordInput(value: string): string[] {
  return value
    .split(/[,，、\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatKeywordInput(value: string): string {
  const keywords = parseKeywordInput(value);
  return keywords.length ? keywords.join(",") : value.trim();
}

function displayKeywords(value: string, activeKeywords?: string[]): string {
  const keywords = activeKeywords?.length ? activeKeywords : parseKeywordInput(value);
  if (!keywords.length) return "-";
  if (keywords.length <= 4) return keywords.join("、");
  return `${keywords.slice(0, 4).join("、")} 等 ${keywords.length} 个`;
}

function recommendedRules(keyword: string): { primary: string; support: string; exclude: string } {
  const normalized = keyword.replace(/\s+/g, "").toLowerCase();

  if (normalized.includes("警校") || normalized.includes("公安") || normalized.includes("警察")) {
    return {
      primary: "警校生，警校，警校日常，警校生活，公安联考，警察学院，中国人民公安大学，藏蓝青春",
      support: "警察，公安，训练，校园，学生，联考，体能，毕业季",
      exclude: "美国警察，短剧，影视，剧情，搞笑，游戏，小说，AI生成"
    };
  }

  if (normalized.includes("服饰") || normalized.includes("穿搭") || normalized.includes("ootd")) {
    return {
      primary: "服饰，穿搭，ootd，搭配，女装，男装，通勤穿搭",
      support: "显瘦，春夏，秋冬，日常，测评，种草，分享",
      exclude: "批发，工厂，招聘，影视，短剧，搞笑，游戏"
    };
  }

  if (normalized.includes("美妆") || normalized.includes("护肤")) {
    return {
      primary: "美妆，护肤，化妆，妆容，彩妆，底妆",
      support: "测评，教程，种草，平价，好物，分享",
      exclude: "代购，批发，招商，招聘，影视，短剧"
    };
  }

  return {
    primary: keyword,
    support: "",
    exclude: "短剧，影视，剧情，搞笑，游戏，广告，招聘"
  };
}

function statusText(task: CrawlerTask): string {
  if (task.status === "running" && task.stage === "keyword") return "第一轮关键词采集中";
  if (task.status === "waiting_topics") return "等待选择话题";
  if (task.status === "running" && task.stage === "topic") return "第二轮话题采集中";
  if (task.status === "succeeded") return "已完成";
  if (task.status === "failed") return "失败";
  if (task.status === "stopped") return "已停止";
  return "未启动";
}

function modeText(mode: DiscoveryMode): string {
  if (mode === "two_stage_manual") return "手动选话题";
  if (mode === "two_stage_auto") return "自动二段式";
  return "单轮";
}

function screeningBadge(candidate: DouyinDiscoveryCandidate): string {
  if (candidate.rejectReason) return "不入池";
  if (candidate.screeningStatus === "candidate_strong") return "强候选";
  return "待观察";
}

function candidateRank(candidate: DouyinDiscoveryCandidate): number {
  if (candidate.screeningStatus === "candidate_strong") return 2;
  if (candidate.rejectReason) return 0;
  return 1;
}

function preferredTopics(topics: TopicCandidate[], limit: number): string[] {
  const preferredTerms = ["警校生", "警校生日常", "警校生活", "警校日常", "警校穿搭", "警校生vlog", "藏蓝青春", "警校训练", "警校宿舍"];
  const broadTerms = ["警校", "警察", "公安", "公安院校", "警察学院", "中国人民公安大学", "江西警察学院", "山东警察学院", "山西警察学院"];
  const offTargetTerms = ["报考", "招生", "培训", "升学", "高考", "志愿", "公安联考", "联考", "考试", "招聘", "执法", "巡逻", "办案", "执勤", "新闻", "报道", "普法"];
  const normalize = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  const preferred = preferredTerms.map(normalize);
  const broad = broadTerms.map(normalize);
  const offTarget = offTargetTerms.map(normalize);

  const scored = topics
    .filter((item) => !offTarget.some((term) => normalize(item.topic).includes(term)))
    .map((item) => {
      const topic = normalize(item.topic);
      const preference = preferred.some((term) => topic.includes(term)) ? 1000 : broad.some((term) => topic === term || topic.includes(term)) ? -500 : 0;
      return { item, score: preference + item.score };
    })
    .sort((a, b) => b.score - a.score || b.item.count - a.item.count)
    .map((entry) => entry.item.topic);

  return (scored.length ? scored : topics.map((item) => item.topic)).slice(0, limit);
}

export function DiscoverClient({ initialBrandLibraries, initialCampaignTasks }: DiscoverClientProps) {
  const [keyword, setKeyword] = useState("警校生");
  const [maxNotes, setMaxNotes] = useState(20);
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>("single");
  const [topicLimit, setTopicLimit] = useState(3);
  const [publishWindowDays, setPublishWindowDays] = useState(180);
  const [sortBy, setSortBy] = useState<DiscoverySortBy>("relevance");
  const [useAiWorkFilter, setUseAiWorkFilter] = useState(true);
  const [autoQueriedTaskId, setAutoQueriedTaskId] = useState("");
  const [primaryTerms, setPrimaryTerms] = useState("");
  const [supportTerms, setSupportTerms] = useState("");
  const [excludeTerms, setExcludeTerms] = useState("");
  const [ruleProfiles, setRuleProfiles] = useState<RuleProfile[]>([]);
  const [selectedRuleProfileId, setSelectedRuleProfileId] = useState("");
  const [campaignTasks] = useState(initialCampaignTasks);
  const [selectedCampaignTaskId, setSelectedCampaignTaskId] = useState("");
  const [task, setTask] = useState<CrawlerTask | null>(null);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [candidateFilter, setCandidateFilter] = useState<CandidateViewFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [clearResult, setClearResult] = useState("");
  const [aiTopicRules, setAiTopicRules] = useState<AiTopicRules | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState<"crawl" | "topic" | "search" | "import" | "stop" | "clear" | "ai-topic" | "ai-rules" | "ai-candidate" | "">("");

  useEffect(() => {
    async function loadRuleProfiles() {
      try {
        const response = await fetch("/api/agent/profiles");
        const data = await parseResponse(response);
        if (response.ok && Array.isArray(data.profiles)) {
          setRuleProfiles(data.profiles);
        }
      } catch {
        // Rule templates are optional; discovery can still run without them.
      }
    }

    loadRuleProfiles();
  }, []);

  const selectedCandidates = useMemo(() => {
    const selected = new Set(selectedIds);
    return result?.candidates.filter((candidate) => selected.has(candidate.externalId)) || [];
  }, [result?.candidates, selectedIds]);

  const visibleCandidates = useMemo(() => {
    const candidates = result?.candidates || [];
    return candidates
      .filter((candidate) => {
        if (candidateFilter === "strong") return candidate.screeningStatus === "candidate_strong";
        if (candidateFilter === "watch") return candidate.screeningStatus !== "candidate_strong" && !candidate.rejectReason;
        return true;
      })
      .sort((a, b) => candidateRank(b) - candidateRank(a) || b.viralWorkCount - a.viralWorkCount || b.maxLikes - a.maxLikes || b.avgLikes - a.avgLikes);
  }, [candidateFilter, result?.candidates]);

  const selectedCampaignTask = useMemo(
    () => campaignTasks.find((item) => String(item.id) === selectedCampaignTaskId) || null,
    [campaignTasks, selectedCampaignTaskId]
  );

  useEffect(() => {
    if (task?.status !== "running") return;

    const timer = window.setInterval(async () => {
      const response = await fetch("/api/crawler/douyin/status");
      const data = (await response.json()) as CrawlerTask;
      setTask(data);

      if (data.status === "waiting_topics") {
        setSelectedTopics(preferredTopics(data.topicCandidates, data.topicLimit));
        setLoading("");
      }

      if (data.status !== "running") setLoading("");
    }, 2500);

    return () => window.clearInterval(timer);
  }, [task?.status]);

  useEffect(() => {
    if (!task?.id || task.status !== "succeeded" || autoQueriedTaskId === task.id) return;
    setAutoQueriedTaskId(task.id);
    searchCandidates();
  }, [task?.id, task?.status, autoQueriedTaskId]);

  async function startCrawler() {
    setLoading("crawl");
    setError("");
    setClearResult("");
    setImportResult(null);
    setSelectedTopics([]);
    setDiscoveryMode("single");

    try {
      const response = await fetch("/api/crawler/douyin/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: formatKeywordInput(keyword),
          campaignTaskId: selectedCampaignTaskId || null,
          maxNotes,
          discoveryMode: "single",
          topicLimit,
          publishWindowDays,
          sortBy,
          topicRules: buildDiscoveryFilters()
        })
      });
      const data = await parseResponse(response);

      if (!response.ok) {
        setError(data.error || "启动采集任务失败。");
        setLoading("");
        return;
      }

      setTask(data);
    } catch {
      setError("启动接口没有响应，请确认本地服务还在运行。");
      setLoading("");
    }
  }

  async function stopCrawler() {
    setLoading("stop");
    setError("");

    try {
      const response = await fetch("/api/crawler/douyin/stop", { method: "POST" });
      const data = await parseResponse(response);

      if (!response.ok) {
        setError(data.error || "停止采集失败。");
        return;
      }

      setTask(data);
    } catch {
      setError("停止接口没有响应，请确认本地服务还在运行。");
    } finally {
      setLoading("");
    }
  }

  async function continueWithTopics() {
    setLoading("topic");
    setError("");

    try {
      const response = await fetch("/api/crawler/douyin/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: selectedTopics })
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "继续采集失败。");
        setLoading("");
        return;
      }

      setTask(data);
    } catch {
      setError("继续采集接口没有响应。");
      setLoading("");
    }
  }

  async function classifyTopicsWithAi() {
    if (!task?.topicCandidates.length) return;

    setLoading("ai-topic");
    setError("");

    try {
      const response = await fetch("/api/ai/topic-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword,
          campaignTaskId: selectedCampaignTaskId || null,
          topics: task.topicCandidates,
          primaryTerms: parseRuleTerms(primaryTerms),
          supportTerms: parseRuleTerms(supportTerms),
          excludeTerms: parseRuleTerms(excludeTerms)
        })
      });
      const data = await parseResponse(response);

      if (!response.ok) {
        setError(data.error || "AI 筛话题失败，请检查 OPENAI_API_KEY / OPENAI_BASE_URL。");
        return;
      }

      setAiTopicRules(data);
      setSelectedTopics((data.keep?.length ? data.keep : data.maybe || []).filter((topic: string) => task.topicCandidates.some((item) => item.topic === topic)));
      if (data.primaryTerms?.length) setPrimaryTerms(data.primaryTerms.join("，"));
      if (data.supportTerms?.length) setSupportTerms(data.supportTerms.join("，"));
      if (data.excludeTerms?.length) setExcludeTerms(data.excludeTerms.join("，"));
    } catch {
      setError("AI 筛话题接口没有响应，请确认本地服务和 API 配置。");
    } finally {
      setLoading("");
    }
  }

  function buildDiscoveryFilters(): DiscoveryFilterOptions {
    return {
      publishWindowDays,
      sortBy,
      primaryTerms: parseRuleTerms(primaryTerms),
      supportTerms: parseRuleTerms(supportTerms),
      excludeTerms: parseRuleTerms(excludeTerms),
      useAiWorkFilter
    };
  }

  function applyRuleProfile(profileId: string) {
    setSelectedRuleProfileId(profileId);
    const profile = ruleProfiles.find((item) => String(item.id) === profileId);
    if (!profile) return;

    setPrimaryTerms(profile.primaryTerms.join(","));
    setSupportTerms(profile.supportTerms.join(","));
    setExcludeTerms(profile.excludeTerms.join(","));
    setPublishWindowDays(profile.publishWindowDays || 180);
    setSortBy(profile.sortType === "latest" ? "latest" : profile.sortType === "most_liked" ? "likes" : "relevance");
    setClearResult(`已应用规则模板：${profile.name}`);
  }

  function applyCampaignTask(taskId: string) {
    setSelectedCampaignTaskId(taskId);
    const campaignTask = campaignTasks.find((item) => String(item.id) === taskId);
    if (!campaignTask) return;

    if (campaignTask.seedKeywords.length) setKeyword(campaignTask.seedKeywords.join(","));
    setPrimaryTerms([campaignTask.targetAudience, campaignTask.targetDescription].filter(Boolean).join(","));
    setSupportTerms(campaignTask.productSellingPoints.join(","));
    setExcludeTerms(campaignTask.excludeKeywords.join(","));
    setClearResult(`已应用品类任务：${campaignTask.name}`);
  }

  async function fillRecommendedRules() {
    setLoading("ai-rules");
    setError("");

    try {
      const response = await fetch("/api/ai/topic-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword,
          campaignTaskId: selectedCampaignTaskId || null,
          primaryTerms: parseRuleTerms(primaryTerms),
          supportTerms: parseRuleTerms(supportTerms),
          excludeTerms: parseRuleTerms(excludeTerms)
        })
      });
      const data = await parseResponse(response);

      if (!response.ok) {
        const rules = recommendedRules(keyword);
        setPrimaryTerms(rules.primary);
        setSupportTerms(rules.support);
        setExcludeTerms(rules.exclude);
        setError(data.error || "AI 生成规则失败，已先填入本地推荐规则。");
        return;
      }

      setAiTopicRules(data);
      if (data.primaryTerms?.length) setPrimaryTerms(data.primaryTerms.join("，"));
      if (data.supportTerms?.length) setSupportTerms(data.supportTerms.join("，"));
      if (data.excludeTerms?.length) setExcludeTerms(data.excludeTerms.join("，"));
    } catch {
      const rules = recommendedRules(keyword);
      setPrimaryTerms(rules.primary);
      setSupportTerms(rules.support);
      setExcludeTerms(rules.exclude);
      setError("AI 生成规则接口没有响应，已先填入本地推荐规则。");
    } finally {
      setLoading("");
    }
  }

  async function screenCandidatesWithAi() {
    if (!result?.candidates.length) return;

    setLoading("ai-candidate");
    setError("");
    setClearResult("");

    try {
      const response = await fetch("/api/ai/candidate-screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword,
          campaignTaskId: selectedCampaignTaskId || null,
          candidates: result.candidates
        })
      });
      const data = await parseResponse(response);

      if (!response.ok) {
        setError(data.error || "AI 候选过滤失败，请检查 OPENAI_API_KEY / OPENAI_BASE_URL。");
        return;
      }

      const decisions = Array.isArray(data.decisions) ? (data.decisions as AiCandidateDecision[]) : [];
      const decisionMap = new Map(decisions.map((item) => [item.id, item]));
      const nextCandidates = result.candidates
        .map((candidate) => {
          const ai = decisionMap.get(candidate.externalId);
          if (!ai) return candidate;

          const aiLabel = ai.decision === "keep" ? "AI保留" : ai.decision === "maybe" ? "AI待观察" : "AI排除";
          return {
            ...candidate,
            screeningStatus: ai.decision === "keep" ? "candidate_strong" : "candidate_observe",
            screeningSummary: `${candidate.screeningSummary || ""}；${aiLabel}：${ai.reason || "未给出原因"}`
          };
        })
        .filter((candidate) => decisionMap.get(candidate.externalId)?.decision !== "drop");

      setResult({
        ...result,
        candidates: nextCandidates,
        total: nextCandidates.length,
        stats: result.stats ? { ...result.stats, newCandidateCount: nextCandidates.length } : undefined
      });
      setSelectedIds((ids) => ids.filter((id) => nextCandidates.some((candidate) => candidate.externalId === id)));

      const kept = decisions.filter((item) => item.decision === "keep").length;
      const maybe = decisions.filter((item) => item.decision === "maybe").length;
      const dropped = decisions.filter((item) => item.decision === "drop").length;
      setClearResult(`AI过滤完成：强候选 ${kept} 个，待观察 ${maybe} 个，排除 ${dropped} 个。`);
    } catch {
      setError("AI 候选过滤接口没有响应，请确认本地服务和 API 配置。");
    } finally {
      setLoading("");
    }
  }

  async function clearWorkPool() {
    const confirmed = window.confirm("确定清空作品池吗？会删除 MySQL 作品缓存和 MediaCrawler 本地 jsonl，达人库不会被删除。");
    if (!confirmed) return;

    setLoading("clear");
    setError("");
    setClearResult("");

    try {
      const response = await fetch("/api/discover/douyin/clear", { method: "POST" });
      const data = await parseResponse(response);

      if (!response.ok) {
        setError(data.error || "清空作品池失败。");
        return;
      }

      setResult(null);
      setSelectedIds([]);
      setImportResult(null);
      setClearResult(`已清空作品池：删除 ${data.deletedWorks || 0} 条作品缓存，删除 ${data.deletedJsonlFiles || 0} 个 jsonl 文件。`);
    } catch {
      setError("清空接口没有响应，请确认本地服务还在运行。");
    } finally {
      setLoading("");
    }
  }

  async function searchCandidates() {
    setLoading("search");
    setError("");
    setClearResult("");
    setImportResult(null);
    setSelectedIds([]);

    try {
      const response = await fetch("/api/discover/douyin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: formatKeywordInput(keyword), campaignTaskId: selectedCampaignTaskId || null, filters: buildDiscoveryFilters() })
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "查询失败。");
        return;
      }

      setResult(data);
      setCandidateFilter("all");
    } catch {
      setError("查询接口没有响应，请确认本地服务还在运行。");
    } finally {
      setLoading("");
    }
  }

  async function importSelected() {
    setLoading("import");
    setError("");
    setImportResult(null);

    try {
      const response = await fetch("/api/discover/douyin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidates: selectedCandidates, campaignTaskId: selectedCampaignTaskId || null })
      });
      const data = await parseResponse(response);

      if (!response.ok) {
        setError(data.error || "加入主页样本与画像队列失败。");
        return;
      }

      setImportResult(data);
    } catch {
      setError("加入接口没有响应，请确认 MySQL 和本地服务还在运行。");
    } finally {
      setLoading("");
    }
  }

  function toggleTopic(topic: string) {
    setSelectedTopics((current) => (current.includes(topic) ? current.filter((item) => item !== topic) : [...current, topic]));
  }

  function toggleCandidate(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function selectAll() {
    setSelectedIds(visibleCandidates.map((candidate) => candidate.externalId));
  }

  const isTaskActive = task?.status === "running" || task?.status === "waiting_topics";

  return (
    <div className="discover-stack">
      <section className="panel campaign-task-picker workflow-section workflow-primary-section">
        <div>
          <span className="workflow-kicker">01 · 当前品类</span>
          <h2>品类任务</h2>
          <p>先选择一个品类任务，系统会自动带入采集关键词、筛选目标、排除方向和产品卖点。</p>
        </div>
        <div className="campaign-task-picker-controls">
          <BrandTaskPicker brandLibraries={initialBrandLibraries} campaignTasks={campaignTasks} onTaskChange={applyCampaignTask} selectedTaskId={selectedCampaignTaskId} storageKey="discover-brand-library" />
          <select hidden onChange={(event) => applyCampaignTask(event.target.value)} value={selectedCampaignTaskId}>
            <option value="">选择已保存任务</option>
            {campaignTasks.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <Link className="secondary-link" href="/agent">
            管理品类任务
          </Link>
        </div>
        {selectedCampaignTask ? (
          <div className="campaign-task-summary">
            <div>
              <span>推广产品</span>
              <strong>{selectedCampaignTask.productName}</strong>
            </div>
            <div>
              <span>目标人群</span>
              <strong>{selectedCampaignTask.targetAudience}</strong>
            </div>
            <div>
              <span>采集关键词</span>
              <strong>{selectedCampaignTask.seedKeywords.join("，") || "-"}</strong>
            </div>
            <p>{selectedCampaignTask.targetDescription}</p>
          </div>
        ) : null}
      </section>

      <section className="panel discover-search-panel workflow-section workflow-action-section">
        <div>
          <span className="workflow-kicker">02 · 开始发现</span>
          <h2>抖音关键词发现</h2>
          <p>先用关键词和话题采集作品，再筛出近6个月点赞500+作品对应的作者。</p>
        </div>
        <div className="discover-search">
          <textarea onChange={(event) => setKeyword(event.target.value)} placeholder={"例如：警校生\n警校生日常\n藏蓝青春"} rows={2} value={keyword} />
          <input min={10} max={300} onChange={(event) => setMaxNotes(Number(event.target.value))} title="每个关键词采集数量" type="number" value={maxNotes} />
          <select disabled value={discoveryMode}>
            <option value="single">关键词作品采集 + 聚合</option>
          </select>
          <button disabled={loading !== "" || isTaskActive} onClick={startCrawler} type="button">
            {loading === "crawl" || task?.status === "running" ? "采集中..." : "启动采集"}
          </button>
          <button className="secondary-button" disabled={loading !== ""} onClick={searchCandidates} type="button">
            {loading === "search" ? "查询中..." : "查询待选候选"}
          </button>
          <button className="secondary-button" disabled={loading !== "" || isTaskActive} onClick={clearWorkPool} type="button">
            {loading === "clear" ? "清空中..." : "清空作品池"}
          </button>
        </div>
      </section>

      <section className="panel discovery-rule-panel workflow-section workflow-settings-section">
        <div className="panel-header">
          <div>
            <span className="workflow-kicker">03 · 筛选设置</span>
            <h2>筛选规则</h2>
            <p>查询候选时生效：先按发布时间过滤，再交给 AI 判断标题是否值得进入候选。</p>
          </div>
        </div>
        <div className="discover-actions rule-actions">
          <button disabled={loading !== "" || isTaskActive} onClick={searchCandidates} type="button">
            {loading === "search" ? "筛选中..." : "重新筛选"}
          </button>
          <label className="inline-check">
            <input checked={useAiWorkFilter} onChange={(event) => setUseAiWorkFilter(event.target.checked)} type="checkbox" />
            <span>AI过滤作品标题</span>
          </label>
        </div>
        <div className="rule-grid compact-rule-grid">
          <label>
            <span>发布时间</span>
            <select onChange={(event) => setPublishWindowDays(Number(event.target.value))} value={publishWindowDays}>
              <option value={1}>一天内</option>
              <option value={7}>一周内</option>
              <option value={30}>一个月内</option>
              <option value={90}>三个月内</option>
              <option value={180}>半年内</option>
              <option value={0}>不限</option>
            </select>
          </label>
          <label>
            <span>排序依据</span>
            <select onChange={(event) => setSortBy(event.target.value as DiscoverySortBy)} value={sortBy}>
              <option value="relevance">综合相关</option>
              <option value="latest">最新发布</option>
              <option value="likes">最多点赞</option>
              <option value="avgLikes">样本热度</option>
            </select>
          </label>
        </div>
      </section>

      {task ? (
        <section className="panel crawler-status workflow-section workflow-status-section">
          <div className="crawler-status-head">
            <div>
              <strong>采集任务：{statusText(task)}</strong>
              <span>
                关键词 {displayKeywords(task.keyword, task.activeKeywords)}，每个关键词 {task.maxNotes || "-"} 条，总量约{" "}
                {(task.activeKeywords?.length || 1) * (task.maxNotes || 0)} 条，模式 {modeText(task.discoveryMode)}，PID {task.pid || "-"}
              </span>
              {task.selectedTopics.length ? <span>已选话题：{task.selectedTopics.join("、")}</span> : null}
            </div>
            <div className="discover-actions">
              {task.status === "succeeded" ? (
                <button className="secondary-button" disabled={loading !== ""} onClick={searchCandidates} type="button">
                  查看新候选
                </button>
              ) : null}
              {isTaskActive ? (
                <button className="secondary-button" disabled={loading === "stop"} onClick={stopCrawler} type="button">
                  {loading === "stop" ? "停止中..." : "停止采集"}
                </button>
              ) : null}
            </div>
          </div>

          {task.status === "waiting_topics" && task.topicCandidates.length ? (
            <div className="topic-pool">
              <div className="topic-pool-head">
                <strong>话题候选池</strong>
                <button className="secondary-button" disabled={loading !== ""} onClick={classifyTopicsWithAi} type="button">
                  {loading === "ai-topic" ? "AI筛选中..." : "AI筛话题"}
                </button>
                <button disabled={!selectedTopics.length || loading !== ""} onClick={continueWithTopics} type="button">
                  {loading === "topic" ? "继续采集中..." : "用选中话题继续采集"}
                </button>
              </div>
              <div className="topic-list">
                {task.topicCandidates.map((item) => (
                  <label className={selectedTopics.includes(item.topic) ? "selected" : ""} key={item.topic}>
                    <input checked={selectedTopics.includes(item.topic)} onChange={() => toggleTopic(item.topic)} type="checkbox" />
                    <span>#{item.topic}</span>
                    <strong>{item.count}</strong>
                    <em>{item.source === "hashtag" ? "话题" : "短语"}</em>
                  </label>
                ))}
              </div>
              {aiTopicRules ? (
                <div className="ai-topic-result">
                  <strong>AI 话题建议</strong>
                  <p>保留：{aiTopicRules.keep.join("，") || "-"}</p>
                  <p>待确认：{aiTopicRules.maybe.join("，") || "-"}</p>
                  <p>排除：{aiTopicRules.drop.join("，") || "-"}</p>
                  {aiTopicRules.note ? <p>{aiTopicRules.note}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {task.error ? <p className="form-error">{task.error}</p> : null}
          <pre className="crawler-log">{task.logs.length ? task.logs.join("\n") : "等待日志..."}</pre>
        </section>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
      {clearResult ? <p className="result-box">{clearResult}</p> : null}

      {result ? (
        <section className="panel workflow-section workflow-results-section">
          <div className="panel-header">
            <div>
              <span className="workflow-kicker">04 · 候选结果</span>
              <h2>达人待选候选</h2>
              <p>
                找到 {result.total} 个新候选，已选择 {selectedIds.length} 个。当前会自动隐藏已经进入样本/画像队列、待选、精选、跳过和已排除的达人。
              </p>
              {result.stats ? (
                <p>
                  聚合后 {result.stats.rawCandidateCount} 个作者，隐藏已处理 {result.stats.hiddenExistingCount} 个，新候选 {result.stats.newCandidateCount} 个。
                </p>
              ) : null}
            </div>
            <div className="discover-actions">
              <button className="secondary-button" disabled={!result.candidates.length || loading !== ""} onClick={screenCandidatesWithAi} type="button">
                {loading === "ai-candidate" ? "AI过滤中..." : "AI过滤候选"}
              </button>
              <button className="secondary-button" disabled={!result.candidates.length || loading !== ""} onClick={selectAll} type="button">
                全选
              </button>
              <button disabled={!selectedCandidates.length || loading !== ""} onClick={importSelected} type="button">
                {loading === "import" ? "加入中..." : "加入主页样本与画像队列"}
              </button>
            </div>
          </div>

          <div className="candidate-filter-bar">
            <button className={candidateFilter === "all" ? "active" : ""} onClick={() => setCandidateFilter("all")} type="button">
              全部
            </button>
            <button className={candidateFilter === "strong" ? "active" : ""} onClick={() => setCandidateFilter("strong")} type="button">
              强候选
            </button>
            <button className={candidateFilter === "watch" ? "active" : ""} onClick={() => setCandidateFilter("watch")} type="button">
              待观察
            </button>
          </div>

          {importResult ? (
            <div className="result-box discover-result">
              <strong>已加入主页样本与画像队列</strong>
              <p>
                新增 {importResult.imported} 条，更新 {importResult.updated} 条，跳过 {importResult.skipped} 条。
              </p>
              {importResult.errors.length ? <p>{importResult.errors.slice(0, 3).join("；")}</p> : null}
              <Link href="/review">去补齐样本与数据筛选</Link>
            </div>
          ) : null}

          {visibleCandidates.length ? (
            <div className="candidate-grid">
              {visibleCandidates.map((candidate) => (
                <article className={`candidate-card ${selectedIds.includes(candidate.externalId) ? "selected" : ""}`} key={candidate.externalId}>
                  <div className="candidate-head">
                    <label>
                      <input checked={selectedIds.includes(candidate.externalId)} onChange={() => toggleCandidate(candidate.externalId)} type="checkbox" />
                      <span>{candidate.name}</span>
                    </label>
                    <strong>{screeningBadge(candidate)}</strong>
                  </div>

                  <div className="candidate-metrics">
                    <div>
                      <span>命中视频</span>
                      <strong>{candidate.workCount}</strong>
                    </div>
                    <div>
                      <span>最高样本赞</span>
                      <strong>{formatNumber(candidate.maxLikes)}</strong>
                    </div>
                    <div>
                      <span>最新样本</span>
                      <strong>{formatDate(candidate.lastPublishedAt)}</strong>
                    </div>
                    <div>
                      <span>来源词</span>
                      <strong>{candidate.sourceKeywords.slice(0, 2).join("，") || "-"}</strong>
                    </div>
                  </div>

                  <p className="candidate-title">{candidate.sampleTitle || "暂无样本标题"}</p>
                  <p className="candidate-title">{candidate.screeningSummary}</p>

                  <div className="candidate-links">
                    {candidate.profileUrl ? (
                      <a href={candidate.profileUrl} rel="noreferrer" target="_blank">
                        达人主页
                      </a>
                    ) : (
                      <span>暂无主页链接</span>
                    )}
                    {candidate.sampleAwemeUrl ? (
                      <a href={candidate.sampleAwemeUrl} rel="noreferrer" target="_blank">
                        样本作品
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">没有找到符合当前规则的待选达人。可以先提高采集数量，或换一个更宽的关键词。</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

