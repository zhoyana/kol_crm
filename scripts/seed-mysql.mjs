import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

function parseCsv(input) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function numberValue(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main() {
  const filePath = path.join(process.cwd(), "data", "creators.csv");
  const csv = await readFile(filePath, "utf8");
  const [headers, ...rows] = parseCsv(csv.replace(/^\uFEFF/, ""));

  for (const row of rows) {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    const externalId = record["达人ID"] || null;
    const plays = [1, 2, 3, 4, 5].map((item) => numberValue(record[`播放${item}`])).filter((value) => value > 0);

    await prisma.creator.upsert({
      where: {
        externalId: externalId ?? `csv-${record["达人昵称"]}`
      },
      update: {
        name: record["达人昵称"] || "未命名达人",
        platform: record["平台"] || "抖音",
        category: record["类目"] || record["备注"] || "未分类",
        fans: numberValue(record["粉丝数"]),
        plays,
        quote: numberValue(record["报价"]) || null,
        outreachStatus: record["建联状态"] || "未建联",
        cooperationStatus: record["确定合作"] || null,
        contact: record["微信联系方式"] || null,
        notes: record["沟通记录"] || record["备注"] || null
      },
      create: {
        externalId: externalId ?? `csv-${record["达人昵称"]}`,
        name: record["达人昵称"] || "未命名达人",
        platform: record["平台"] || "抖音",
        category: record["类目"] || record["备注"] || "未分类",
        fans: numberValue(record["粉丝数"]),
        plays,
        quote: numberValue(record["报价"]) || null,
        outreachStatus: record["建联状态"] || "未建联",
        cooperationStatus: record["确定合作"] || null,
        contact: record["微信联系方式"] || null,
        notes: record["沟通记录"] || record["备注"] || null
      }
    });
  }

  const count = await prisma.creator.count();
  console.log(`Seeded ${count} creators.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
