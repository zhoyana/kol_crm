import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { normalizedDecision, normalizedOutreachReview } from "@/lib/real-agent-evaluation";

export const runtime = "nodejs";

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String(value.text || "").trim();
  if (typeof value === "object" && "result" in value) return String(value.result || "").trim();
  return String(value).trim();
}

function confidence(value: string): number | null {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number) : null;
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  const campaignTaskId = Number(form.get("campaignTaskId"));
  if (!(file instanceof File) || !Number.isInteger(campaignTaskId) || campaignTaskId <= 0) {
    return NextResponse.json({ error: "请选择盲标表并指定推广任务。" }, { status: 400 });
  }
  const workbook = new ExcelJS.Workbook();
  const contents = Buffer.from(await file.arrayBuffer()) as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(contents);
  const sheet = workbook.getWorksheet("人工盲标") || workbook.worksheets[0];
  if (!sheet) return NextResponse.json({ error: "没有找到“人工盲标”工作表。" }, { status: 400 });

  let updated = 0;
  const errors: string[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const caseKey = cellText(row.getCell(1).value);
    if (!caseKey) continue;
    const humanADecision = normalizedDecision(cellText(row.getCell(9).value));
    const humanBDecision = normalizedDecision(cellText(row.getCell(12).value));
    const adjudicatedDecision = normalizedDecision(cellText(row.getCell(15).value));
    const outreachReview = normalizedOutreachReview(cellText(row.getCell(17).value));
    if (!humanADecision) {
      errors.push(`${caseKey}：人工A结论必须填写 pass、reject 或 review`);
      continue;
    }
    const existing = await prisma.agentEvaluationCase.findFirst({ where: { caseKey, campaignTaskId } });
    if (!existing) {
      errors.push(`${caseKey}：当前任务中不存在此样本`);
      continue;
    }
    await prisma.agentEvaluationCase.update({
      where: { id: existing.id },
      data: {
        humanADecision,
        humanAReason: cellText(row.getCell(10).value) || null,
        humanAConfidence: confidence(cellText(row.getCell(11).value)),
        humanBDecision,
        humanBReason: cellText(row.getCell(13).value) || null,
        humanBConfidence: confidence(cellText(row.getCell(14).value)),
        adjudicatedDecision,
        adjudicationReason: cellText(row.getCell(16).value) || null,
        outreachReview,
        outreachReviewReason: cellText(row.getCell(18).value) || null
      }
    });
    updated += 1;
  }
  return NextResponse.json({ ok: true, updated, errors: errors.slice(0, 30) });
}
