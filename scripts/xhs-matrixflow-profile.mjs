#!/usr/bin/env node
/**
 * MatrixFlow 小红书达人主页样本采集（替代 RedFox 作者作品接口）
 *
 * 打开达人主页（https://www.xiaohongshu.com/user/profile/<userid>），
 * 收集昵称、粉丝数、近期笔记标题与互动数据，供 AI 达人画像（evaluateXhsCreatorPortrait）使用。
 *
 * 用法:
 *   node scripts/xhs-matrixflow-profile.mjs --userid <小红书userid> --limit 10 --out C:\path\profile.json \
 *       [--window <profileId|名称>]
 *
 * 环境变量:
 *   MATRIXFLOW_SKILL_DIR / MATRIXFLOW_XHS_WINDOW / NODE_BINARY（同 xhs-matrixflow-crawl.mjs）
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SKILL_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || "C:\\Users\\EDY",
  ".codex", "skills", "matrixflow-browser-control"
);

function parseArgs(argv) {
  const args = { userid: "", limit: 10, out: "", window: "", scrolls: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--userid") args.userid = String(value || "").trim();
    else if (key === "--limit") args.limit = Math.max(1, Math.min(30, Number(value) || 10));
    else if (key === "--out") args.out = String(value || "").trim();
    else if (key === "--window") args.window = String(value || "").trim();
    else if (key === "--scrolls") args.scrolls = Math.max(0, Math.min(20, Number(value) || 3));
  }
  return args;
}

function resolveNode() {
  return process.env.NODE_BINARY || process.execPath;
}

function resolveSkillDir() {
  const dir = process.env.MATRIXFLOW_SKILL_DIR || DEFAULT_SKILL_DIR;
  const script = path.join(dir, "scripts", "mf-browser.mjs");
  if (!existsSync(script)) {
    throw new Error(`未找到 MatrixFlow 技能脚本：${script}`);
  }
  return dir;
}

function mf(node, skillDir, args, timeoutMs = 240_000) {
  const result = spawnSync(node, [path.join(skillDir, "scripts", "mf-browser.mjs"), ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) throw new Error(`mf-browser 执行失败：${result.error.message}`);
  if (result.status !== 0) {
    const tail = String(result.stderr || result.stdout || "").trim().split(/\r?\n/).slice(-8).join("\n");
    throw new Error(`mf-browser 返回码 ${result.status}：${tail}`);
  }
  return String(result.stdout || "").trim();
}

function parseCount(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  const match = t.match(/([\d.]+)\s*([万wW]?)/);
  if (!match) return 0;
  const n = Number.parseFloat(match[1]) || 0;
  return /万|w/i.test(match[2]) ? Math.round(n * 10_000) : Math.round(n);
}

function ensureWindow(node, skillDir, args) {
  let profileSpec = args.window || process.env.MATRIXFLOW_XHS_WINDOW || "xhs-crawler";
  try {
    const list = JSON.parse(mf(node, skillDir, ["list"]) || "[]");
    const found = Array.isArray(list) ? list.find((item) => item && (item.id === profileSpec || item.name === profileSpec)) : null;
    if (found) {
      profileSpec = found.id || found.name || profileSpec;
      return profileSpec;
    }
    try {
      mf(node, skillDir, ["open", profileSpec], 120_000);
      return profileSpec;
    } catch (openError) {
      const message = openError instanceof Error ? openError.message : String(openError);
      if (!/not found|不存在|未找到|unknown profile/i.test(message)) throw openError;
    }
    const created = JSON.parse(mf(node, skillDir, ["create", profileSpec]) || "[]");
    const first = Array.isArray(created) ? created[0] : null;
    if (first?.id) profileSpec = first.id;
    mf(node, skillDir, ["open", profileSpec], 120_000);
    return profileSpec;
  } catch (error) {
    throw new Error(`MatrixFlow 窗口准备失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function buildEvalJs(scrolls) {
  return `(async () => {
    const isVisible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    };
    const visibleLoginForm = Array.from(document.querySelectorAll('input'))
      .filter(isVisible)
      .some((el) => /手机号|验证码|phone number|verification code/i.test(el.placeholder || ""));
    if (visibleLoginForm) {
      return JSON.stringify({ loginRequired: true, url: location.href });
    }
    const profileRoot = document.querySelector(".user-detail, .user-info, .profile-info, .user-header") || document.body;
    const nickname =
      (document.querySelector(".user-name, .name, .user-nickname, .username") || {}).textContent || "";
    const infoText = (profileRoot.innerText || "").replace(/\\s+/g, " ");
    const fansMatch = infoText.match(/粉丝\\s*[:：]?\\s*([\\d.]+\\s*万?)/);
    const fans = fansMatch ? fansMatch[1] : "";
    const out = [];
    const seen = new Set();
    const scrolls = ${scrolls};
    const pick = (el, sel) => {
      if (!el) return "";
      const node = el.querySelector(sel);
      return node ? node.textContent.trim() : "";
    };
    for (let i = 0; i < scrolls; i += 1) {
      const cards = document.querySelectorAll("section.note-item");
      for (const card of cards) {
        const id = String(card.getAttribute("data-note-id") || "").trim();
        if (!/^[0-9a-f]{24}$/i.test(id) || seen.has(id)) continue;
        seen.add(id);
        const cover = card.querySelector('a[href*="/search_result/"], a.cover');
        const coverHref = cover && cover.getAttribute ? (cover.getAttribute("href") || "") : "";
        const tokenMatch = coverHref.match(/[?&]xsec_token=([^&]+)/);
        const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : "";
        out.push({
          id,
          href: "https://www.xiaohongshu.com/explore/" + id + (token ? "?xsec_token=" + encodeURIComponent(token) + "&xsec_source=pc_search" : ""),
          title: pick(card, ".title"),
          likeText: pick(card, ".like-wrapper .count")
        });
      }
      if (i < scrolls - 1) {
        window.scrollBy(0, 800);
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }
    return JSON.stringify({ loginRequired: false, nickname: nickname.trim(), fans, total: out.length, works: out });
  })()`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.userid) {
    console.error("用法：node xhs-matrixflow-profile.mjs --userid <小红书userid> --out <输出json> [--limit N] [--window <id|名称>]");
    process.exit(1);
  }
  const node = resolveNode();
  const skillDir = resolveSkillDir();
  const profileSpec = ensureWindow(node, skillDir, args);

  const steps = [
    { op: "navigate", url: `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(args.userid)}` },
    { op: "wait", ms: 2000 },
    { op: "eval", js: buildEvalJs(args.scrolls) }
  ];
  const runOutput = mf(node, skillDir, ["run", profileSpec, JSON.stringify(steps)], 300_000);
  let results;
  try {
    results = JSON.parse(runOutput);
  } catch {
    throw new Error(`mf-browser run 输出无法解析：${String(runOutput).slice(0, 500)}`);
  }
  const evalStep = Array.isArray(results) ? results.find((step) => step.op === "eval") : null;
  if (!evalStep || typeof evalStep.value !== "string") {
    throw new Error(`未取到主页数据：${JSON.stringify(results).slice(0, 500)}`);
  }
  const parsed = JSON.parse(evalStep.value);
  if (parsed.loginRequired) {
    console.error("XHS 登录墙：请先在 MatrixFlow 窗口登录小红书，然后重试。");
    process.exit(2);
  }
  const works = (Array.isArray(parsed.works) ? parsed.works : []).slice(0, args.limit).map((item) => ({
    awemeId: item.id,
    title: item.title,
    url: item.href,
    likeCount: parseCount(item.likeText),
    collectCount: parseCount(item.collectText),
    commentCount: parseCount(item.commentText),
    shareCount: 0
  }));
  const payload = {
    ok: true,
    window: profileSpec,
    nickname: String(parsed.nickname || ""),
    fans: parseCount(parsed.fans),
    works
  };
  if (!args.out) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  writeFileSync(path.resolve(args.out), JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify(payload));
}

try {
  main();
} catch (error) {
  console.error(`[xhs-matrixflow-profile] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
