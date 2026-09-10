import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const campaignTaskId = Number(request.nextUrl.searchParams.get("campaignTaskId"));
  if (!Number.isInteger(campaignTaskId) || campaignTaskId <= 0) {
    return NextResponse.json({ error: "缺少推广任务 ID。" }, { status: 400 });
  }
  const task = await prisma.campaignTask.findUnique({ where: { id: campaignTaskId } });
  const cases = await prisma.agentEvaluationCase.findMany({ where: { campaignTaskId }, orderBy: { caseKey: "asc" } });
  if (!task || !cases.length) return NextResponse.json({ error: "请先建立真实评测集。" }, { status: 400 });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KOL CRM";
  const sheet = workbook.addWorksheet("人工盲标", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "样本编号", key: "caseKey", width: 23 },
    { header: "推广任务", key: "campaign", width: 24 },
    { header: "达人昵称", key: "name", width: 18 },
    { header: "平台", key: "platform", width: 10 },
    { header: "主页链接", key: "profileUrl", width: 45 },
    { header: "粉丝数", key: "fans", width: 12 },
    { header: "来源关键词", key: "keywords", width: 22 },
    { header: "作品证据（最多10条）", key: "works", width: 72 },
    { header: "人工A结论", key: "humanADecision", width: 15 },
    { header: "人工A理由", key: "humanAReason", width: 36 },
    { header: "人工A信心(0-100)", key: "humanAConfidence", width: 18 },
    { header: "人工B结论", key: "humanBDecision", width: 15 },
    { header: "人工B理由", key: "humanBReason", width: 36 },
    { header: "人工B信心(0-100)", key: "humanBConfidence", width: 18 },
    { header: "最终裁决", key: "adjudicatedDecision", width: 15 },
    { header: "裁决理由", key: "adjudicationReason", width: 36 },
    { header: "话术审核", key: "outreachReview", width: 18 },
    { header: "话术审核原因", key: "outreachReviewReason", width: 36 }
  ];

  for (const item of cases) {
    const snapshot = item.evidenceSnapshot as any;
    const works = Array.isArray(snapshot?.works) ? snapshot.works : [];
    sheet.addRow({
      caseKey: item.caseKey,
      campaign: task.name,
      name: snapshot?.creator?.name || "",
      platform: snapshot?.creator?.platform || "",
      profileUrl: snapshot?.creator?.profileUrl || "",
      fans: Number(snapshot?.creator?.fans || 0),
      keywords: Array.from(new Set(works.map((work: any) => String(work.sourceKeyword || "")).filter(Boolean))).join("、"),
      works: works.map((work: any, index: number) => `${index + 1}. ${work.title || "无标题"}（赞 ${Number(work.likeCount || 0)}）`).join("\n"),
      humanADecision: item.humanADecision || "",
      humanAReason: item.humanAReason || "",
      humanAConfidence: item.humanAConfidence ?? "",
      humanBDecision: item.humanBDecision || "",
      humanBReason: item.humanBReason || "",
      humanBConfidence: item.humanBConfidence ?? "",
      adjudicatedDecision: item.adjudicatedDecision || "",
      adjudicationReason: item.adjudicationReason || "",
      outreachReview: item.outreachReview || "",
      outreachReviewReason: item.outreachReviewReason || ""
    });
  }
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  sheet.autoFilter = { from: "A1", to: "R1" };
  for (let row = 2; row <= sheet.rowCount; row += 1) {
    sheet.getRow(row).alignment = { vertical: "top", wrapText: true };
    sheet.getRow(row).height = 84;
    for (const column of [9, 12, 15]) {
      sheet.getCell(row, column).dataValidation = { type: "list", allowBlank: true, formulae: ['"pass,reject,review"'] };
    }
    sheet.getCell(row, 17).dataValidation = { type: "list", allowBlank: true, formulae: ['"approved,modified,rejected"'] };
  }

  const guide = workbook.addWorksheet("标注说明");
  guide.columns = [{ width: 22 }, { width: 90 }];
  [
    ["字段", "填写说明"],
    ["人工结论", "pass=适合推广；reject=不适合；review=证据不足，需要复核"],
    ["独立标注", "人工A和人工B不要查看彼此答案，也不要查看Agent结论"],
    ["最终裁决", "A/B不一致时，由第三人填写；一致时可留空，系统默认使用人工A"],
    ["话术审核", "approved=直接通过；modified=修改后通过；rejected=拒绝"],
    ["重要", "不要修改样本编号。导入时使用样本编号匹配数据库记录。"]
  ].forEach((values) => guide.addRow(values));
  guide.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  guide.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  guide.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = encodeURIComponent(`KOL人工盲标-${task.name}.xlsx`);
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`
    }
  });
}
