export type TopicSource = "hashtag" | "phrase";

export type TopicInputItem = {
  title?: string;
  desc?: string;
  liked_count?: string | number;
  source_keyword?: string;
};

export type TopicCandidate = {
  topic: string;
  count: number;
  score: number;
  source: TopicSource;
};

export type TopicRuleOptions = {
  primaryTerms?: string[];
  supportTerms?: string[];
  excludeTerms?: string[];
};

const GENERAL_STOP_WORDS = [
  "一个",
  "一些",
  "这个",
  "那个",
  "怎么",
  "什么",
  "真的",
  "可以",
  "没有",
  "自己",
  "我们",
  "你们",
  "他们",
  "今天",
  "日常",
  "分享",
  "推荐",
  "热门",
  "同款",
  "好物"
];

const DOMAIN_HINTS: Record<string, string[]> = {
  警校生: ["警校生", "警校", "警校日常", "警校生活", "警校训练", "公安联考", "中国人民公安大学", "警察学院", "训练", "校园"],
  警校: ["警校", "警校生", "警校日常", "警校生活", "警校训练", "公安联考", "警察学院", "训练", "校园"],
  服饰: ["服饰", "穿搭", "ootd", "通勤穿搭", "夏季穿搭", "学生党穿搭", "平价穿搭", "穿搭分享"],
  美妆: ["美妆", "护肤", "化妆", "妆容", "口红", "粉底", "种草", "测评"],
  母婴: ["母婴", "育儿", "宝宝", "宝妈", "婴儿", "亲子", "带娃"]
};

function normalizeTopic(value: string): string {
  return value
    .replace(/^#+/, "")
    .replace(/[，。！？、,.!?\s]+$/g, "")
    .trim();
}

function likeWeight(value: string | number | undefined): number {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(12, Math.log10(parsed + 1) * 2);
}

function compactText(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function cleanTerms(terms?: string[]): string[] {
  return Array.from(new Set((terms || []).map((term) => compactText(normalizeTopic(term))).filter(Boolean)));
}

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => term && text.includes(term));
}

function termHitCount(text: string, terms: string[]): number {
  return terms.filter((term) => term && text.includes(term)).length;
}

const POLICE_STUDENT_BOOST_TERMS = [
  "警校生",
  "警校生日常",
  "警校生活",
  "警校日常",
  "警校穿搭",
  "警校生vlog",
  "藏蓝青春",
  "警校训练",
  "警校宿舍",
  "警校校园",
  "校园生活",
  "宿舍日常",
  "训练日常"
].map(compactText);

const POLICE_BROAD_TOPIC_TERMS = [
  "警校",
  "警察",
  "公安",
  "公安院校",
  "警察学院",
  "中国人民公安大学",
  "江西警察学院",
  "山东警察学院",
  "山西警察学院",
  "刑事警察学院"
].map(compactText);

const POLICE_OFF_TARGET_TOPIC_TERMS = [
  "报考",
  "招生",
  "培训",
  "升学",
  "高考",
  "志愿",
  "公安联考",
  "联考",
  "考公",
  "考试",
  "招聘",
  "警察宣传",
  "警察工作",
  "警察执法",
  "警察巡逻",
  "警察办案",
  "警察执勤",
  "警察装备",
  "警察新闻",
  "警察报道",
  "警察直播",
  "警察讲座",
  "警察讲解",
  "警察政策",
  "警察法规",
  "民警",
  "特警",
  "交警",
  "辅警",
  "派出所",
  "公安局",
  "执法现场",
  "案件",
  "事故",
  "普法",
  "反诈"
].map(compactText);

function isPoliceStudentRule(rules?: TopicRuleOptions): boolean {
  const text = cleanTerms([...(rules?.primaryTerms || []), ...(rules?.supportTerms || [])]).join(" ");
  return ["警校生", "警校", "公安", "警察", "藏蓝"].some((term) => text.includes(compactText(term)));
}

function policeTopicQualityScore(topic: string, text: string, rules?: TopicRuleOptions): number | null {
  if (!isPoliceStudentRule(rules)) return 0;

  const normalizedTopic = compactText(topic);
  const normalizedText = compactText(text);

  if (hasAnyTerm(normalizedTopic, POLICE_OFF_TARGET_TOPIC_TERMS) || hasAnyTerm(normalizedText, POLICE_OFF_TARGET_TOPIC_TERMS)) return null;

  let score = 0;
  if (hasAnyTerm(normalizedTopic, POLICE_STUDENT_BOOST_TERMS)) score += 260;
  if (hasAnyTerm(normalizedText, POLICE_STUDENT_BOOST_TERMS)) score += 40;

  const isBroadOnly = POLICE_BROAD_TOPIC_TERMS.some((term) => normalizedTopic === term);
  const looksLikeSchoolName = /大学|学院|学校/.test(topic) && !normalizedTopic.includes(compactText("日常")) && !normalizedTopic.includes(compactText("生活"));
  if (isBroadOnly || looksLikeSchoolName) score -= 180;

  return score;
}

function topicRuleScore(topic: string, text: string, rules?: TopicRuleOptions): number | null {
  const normalizedTopic = compactText(topic);
  const normalizedText = compactText(text);
  const primaryTerms = cleanTerms(rules?.primaryTerms);
  const supportTerms = cleanTerms(rules?.supportTerms);
  const excludeTerms = cleanTerms(rules?.excludeTerms);

  if (hasAnyTerm(normalizedTopic, excludeTerms) || hasAnyTerm(normalizedText, excludeTerms)) return null;
  const qualityScore = policeTopicQualityScore(topic, text, rules);
  if (qualityScore === null) return null;
  if (!primaryTerms.length && !supportTerms.length) return 0;

  const topicPrimaryHits = termHitCount(normalizedTopic, primaryTerms);
  const topicSupportHits = termHitCount(normalizedTopic, supportTerms);
  const textPrimaryHits = termHitCount(normalizedText, primaryTerms);
  const textSupportHits = termHitCount(normalizedText, supportTerms);

  if (!textPrimaryHits && textSupportHits < Math.min(2, supportTerms.length || 2)) return -10 + qualityScore;
  return qualityScore + topicPrimaryHits * 140 + topicSupportHits * 35 + textPrimaryHits * 18 + textSupportHits * 4;
}

function addCandidate(map: Map<string, TopicCandidate>, topic: string, source: TopicSource, baseScore: number, weight = 0) {
  const normalized = normalizeTopic(topic);
  if (!normalized || normalized.length < 2) return;
  if (GENERAL_STOP_WORDS.includes(normalized)) return;

  const current = map.get(normalized) || {
    topic: normalized,
    count: 0,
    score: 0,
    source
  };

  current.count += 1;
  current.score += baseScore + weight;
  if (current.source !== "hashtag" && source === "hashtag") current.source = "hashtag";
  map.set(normalized, current);
}

function keywordHints(keyword: string): string[] {
  const normalized = normalizeTopic(keyword);
  const hints = new Set<string>([normalized]);

  for (const [key, values] of Object.entries(DOMAIN_HINTS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      values.forEach((value) => hints.add(value));
    }
  }

  if (normalized.length >= 2) {
    hints.add(`${normalized}日常`);
    hints.add(`${normalized}生活`);
    hints.add(`${normalized}训练`);
  }

  return Array.from(hints).filter(Boolean);
}

function extractHashtags(text: string): string[] {
  return text.match(/#[\p{L}\p{N}_-]+/gu)?.map(normalizeTopic).filter(Boolean) || [];
}

function extractWindowPhrases(text: string, keyword: string): string[] {
  const normalizedKeyword = normalizeTopic(keyword);
  if (!normalizedKeyword) return [];

  const compactText = text.replace(/\s+/g, "");
  const phrases = new Set<string>();
  const keywordIndex = compactText.indexOf(normalizedKeyword);

  if (keywordIndex >= 0) {
    const start = Math.max(0, keywordIndex - 4);
    const end = Math.min(compactText.length, keywordIndex + normalizedKeyword.length + 6);
    const window = compactText.slice(start, end);

    for (let size = 2; size <= Math.min(6, window.length); size += 1) {
      for (let index = 0; index + size <= window.length; index += 1) {
        const phrase = window.slice(index, index + size);
        if (phrase.includes(normalizedKeyword) || normalizedKeyword.includes(phrase)) {
          phrases.add(phrase);
        }
      }
    }
  }

  return Array.from(phrases);
}

export function extractTopicCandidates(input: {
  keyword: string;
  items: TopicInputItem[];
  limit?: number;
  minHashtagCount?: number;
  rules?: TopicRuleOptions;
}): TopicCandidate[] {
  const limit = input.limit ?? 12;
  const minHashtagCount = input.minHashtagCount ?? 4;
  const map = new Map<string, TopicCandidate>();
  const keyword = normalizeTopic(input.keyword);

  if (keyword) {
    addCandidate(map, keyword, "hashtag", 100, input.items.length);
  }

  let hashtagTotal = 0;

  for (const item of input.items) {
    const text = `${item.title || ""} ${item.desc || ""}`;
    const itemRuleScore = topicRuleScore(input.keyword, text, input.rules);
    if (itemRuleScore === null) continue;
    const weight = likeWeight(item.liked_count);
    const hashtags = extractHashtags(text);
    hashtagTotal += hashtags.length;

    for (const hashtag of hashtags) {
      const ruleScore = topicRuleScore(hashtag, text, input.rules);
      if (ruleScore === null) continue;
      addCandidate(map, hashtag, "hashtag", Math.max(6, 16 + ruleScore), weight);
    }
  }

  if (hashtagTotal < minHashtagCount) {
    const hints = keywordHints(input.keyword);

    for (const item of input.items) {
      const text = `${item.title || ""} ${item.desc || ""}`;
      const itemRuleScore = topicRuleScore(input.keyword, text, input.rules);
      if (itemRuleScore === null) continue;
      const weight = likeWeight(item.liked_count);

      for (const hint of hints) {
        if (hint && text.includes(hint)) {
          const ruleScore = topicRuleScore(hint, text, input.rules);
          if (ruleScore === null) continue;
          addCandidate(map, hint, "phrase", Math.max(4, 8 + ruleScore), weight);
        }
      }

      for (const phrase of extractWindowPhrases(text, input.keyword)) {
        const ruleScore = topicRuleScore(phrase, text, input.rules);
        if (ruleScore === null) continue;
        addCandidate(map, phrase, "phrase", Math.max(2, 4 + ruleScore), weight / 2);
      }
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, limit);
}
