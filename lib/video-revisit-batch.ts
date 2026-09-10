import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { localAgentRequest } from "./local-agent-client";

type BatchStatus = "running" | "completed" | "failed";
type BatchJob = {
  id: string;
  fileName: string;
  outputName: string;
  status: BatchStatus;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  failureSamples: string[];
  message: string;
  error: string;
  output?: Buffer;
  updatedAt: string;
  expiresAt: number;
};

type AgentResult = {
  rowKey: string;
  ok: boolean;
  platform?: "douyin" | "xhs";
  publishedAt?: string | null;
  revisitedAt?: string;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  collectCount?: number;
  error?: string;
};

const globalJobs = globalThis as typeof globalThis & { __videoRevisitBatchJobs?: Map<string, BatchJob> };
const jobs = globalJobs.__videoRevisitBatchJobs || new Map<string, BatchJob>();
globalJobs.__videoRevisitBatchJobs = jobs;

function cleanupExpired() {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.expiresAt < now) jobs.delete(id);
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value as any;
  if (value == null) return "";
  if (typeof value === "object") return String(value.hyperlink || value.text || value.result || "").trim();
  return String(value).trim();
}

function platformOfUrl(value: string): "douyin" | "xhs" | "unknown" {
  if (/(^|\.)douyin\.com/i.test(value)) return "douyin";
  if (/(^|\.)(xiaohongshu\.com|xhslink\.(?:com|cn))/i.test(value)) return "xhs";
  return "unknown";
}

function outputName(input: string): string {
  const base = input.replace(/\.xlsx$/i, "") || "视频回访";
  return `${base}_回访结果.xlsx`;
}

function publicJob(job: BatchJob) {
  return {
    id: job.id,
    fileName: job.fileName,
    outputName: job.outputName,
    status: job.status,
    total: job.total,
    completed: job.completed,
    succeeded: job.succeeded,
    failed: job.failed,
    failureSamples: job.failureSamples,
    message: job.message,
    error: job.error,
    downloadable: job.status === "completed" && Boolean(job.output),
    updatedAt: job.updatedAt
  };
}

async function processWorkbook(job: BatchJob, input: Buffer, agentDeviceId?: string) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(input as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("Excel 中没有工作表。");
    let headerRowNumber = 0;
    let linkColumn = 0;
    for (let rowNumber = 1; rowNumber <= Math.min(20, worksheet.rowCount); rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      row.eachCell((cell, columnNumber) => {
        if (/^(发布链接|作品链接|视频链接|笔记链接|链接)$/i.test(cellText(cell).replace(/\s+/g, ""))) {
          headerRowNumber = rowNumber;
          linkColumn = columnNumber;
        }
      });
      if (linkColumn) break;
    }
    if (!headerRowNumber || !linkColumn) throw new Error("没有找到“发布链接”列，请保持示例文件的表头名称。");

    const originalColumnCount = Math.max(worksheet.columnCount, linkColumn);
    const outputHeaders = ["平台", "发布时间", "回访时间", "点赞数", "评论数", "转发数", "收藏数", "处理状态"];
    const headerRow = worksheet.getRow(headerRowNumber);
    outputHeaders.forEach((label, index) => {
      const cell = headerRow.getCell(originalColumnCount + index + 1);
      cell.value = label;
      const sourceStyle = headerRow.getCell(Math.max(1, originalColumnCount)).style;
      cell.style = JSON.parse(JSON.stringify(sourceStyle || {}));
      cell.font = { ...cell.font, bold: true };
    });
    const rows: Array<{ rowNumber: number; videoUrl: string; platform: "douyin" | "xhs" | "unknown" }> = [];
    for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const videoUrl = cellText(worksheet.getRow(rowNumber).getCell(linkColumn));
      if (videoUrl) rows.push({ rowNumber, videoUrl, platform: platformOfUrl(videoUrl) });
    }
    job.total = rows.length;
    job.message = `已识别 ${rows.length} 条发布链接，正在抓取。`;
    job.updatedAt = new Date().toISOString();
    const resultByRow = new Map<string, AgentResult>();
    // Mixed business sheets often begin with many Xiaohongshu rows. Process Douyin
    // first so its visible CDP Chrome opens immediately; rowKey keeps Excel output
    // in the original order.
    const processingRows = [...rows].sort((left, right) => {
      const priority = { douyin: 0, xhs: 1, unknown: 2 } as const;
      return priority[left.platform] - priority[right.platform] || left.rowNumber - right.rowNumber;
    });
    // Report progress after every work. A MediaCrawler detail request can take
    // tens of seconds; waiting for eight sequential requests made the UI stay
    // at 0/26 for several minutes even though the Agent was working.
    const chunkSize = 1;
    for (let offset = 0; offset < processingRows.length; offset += chunkSize) {
      const chunk = processingRows.slice(offset, offset + chunkSize);
      const currentPlatform = chunk[0]?.platform === "douyin" ? "抖音" : chunk[0]?.platform === "xhs" ? "小红书" : "其他链接";
      job.message = `正在处理${currentPlatform}：${job.completed}/${job.total}`;
      job.updatedAt = new Date().toISOString();
      const response = await localAgentRequest<{ results: AgentResult[] }>("/v1/video/batch", {
        method: "POST",
        body: { items: chunk.map((row) => ({ rowKey: String(row.rowNumber), videoUrl: row.videoUrl })) },
        timeoutMs: 30 * 60_000,
        agentDeviceId
      });
      for (const result of response.results || []) {
        resultByRow.set(result.rowKey, result);
        job.completed += 1;
        if (result.ok) job.succeeded += 1;
        else {
          job.failed += 1;
          if (job.failureSamples.length < 5) {
            job.failureSamples.push(`第 ${result.rowKey} 行：${result.error || "抓取失败"}`);
          }
        }
      }
      job.message = `正在处理：${job.completed}/${job.total}，成功 ${job.succeeded}，失败 ${job.failed}`;
      job.updatedAt = new Date().toISOString();
    }

    const startColumn = originalColumnCount + 1;
    for (const row of rows) {
      const result = resultByRow.get(String(row.rowNumber));
      const values: Array<string | number | Date | null> = result?.ok
        ? [
            result.platform === "xhs" ? "小红书" : "抖音",
            result.publishedAt ? new Date(result.publishedAt) : null,
            result.revisitedAt ? new Date(result.revisitedAt) : new Date(),
            Number(result.likeCount || 0),
            Number(result.commentCount || 0),
            Number(result.shareCount || 0),
            Number(result.collectCount || 0),
            "成功"
          ]
        : ["", null, new Date(), 0, 0, 0, 0, result?.error || "未返回结果"];
      values.forEach((value, index) => { worksheet.getRow(row.rowNumber).getCell(startColumn + index).value = value as any; });
    }
    worksheet.getColumn(startColumn).width = 10;
    worksheet.getColumn(startColumn + 1).width = 20;
    worksheet.getColumn(startColumn + 2).width = 20;
    for (let index = 3; index <= 6; index += 1) worksheet.getColumn(startColumn + index).width = 12;
    worksheet.getColumn(startColumn + 7).width = 42;
    worksheet.getColumn(startColumn + 1).numFmt = "yyyy-mm-dd hh:mm";
    worksheet.getColumn(startColumn + 2).numFmt = "yyyy-mm-dd hh:mm";
    for (let index = 3; index <= 6; index += 1) worksheet.getColumn(startColumn + index).numFmt = "#,##0";
    const output = await workbook.xlsx.writeBuffer();
    job.output = Buffer.from(output);
    job.status = "completed";
    job.message = `处理完成：成功 ${job.succeeded} 条，失败 ${job.failed} 条。请下载结果文件。`;
    job.updatedAt = new Date().toISOString();
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "批量回访失败";
    job.message = "处理失败。";
    job.updatedAt = new Date().toISOString();
  }
}

export function startVideoRevisitBatch(input: Buffer, fileName: string, agentDeviceId?: string) {
  cleanupExpired();
  const id = randomUUID();
  const job: BatchJob = {
    id,
    fileName,
    outputName: outputName(fileName),
    status: "running",
    total: 0,
    completed: 0,
    succeeded: 0,
    failed: 0,
    failureSamples: [],
    message: "正在读取 Excel。",
    error: "",
    updatedAt: new Date().toISOString(),
    expiresAt: Date.now() + 2 * 60 * 60_000
  };
  jobs.set(id, job);
  void processWorkbook(job, input, agentDeviceId);
  return publicJob(job);
}

export function getVideoRevisitBatch(id: string) {
  cleanupExpired();
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}

export function downloadVideoRevisitBatch(id: string) {
  cleanupExpired();
  const job = jobs.get(id);
  return job?.status === "completed" && job.output ? { fileName: job.outputName, data: job.output } : null;
}
