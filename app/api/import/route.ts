import { NextRequest, NextResponse } from "next/server";
import { csvRowsToObjects, numberValue } from "@/lib/csv";

type ImportCreatorInput = {
  externalId: string;
  name: string;
  platform: string;
  profileUrl: string | null;
  category: string | null;
  fans: number;
  plays: number[];
  quote: number | null;
  outreachStatus: string;
  cooperationStatus: string | null;
  contact: string | null;
  notes: string | null;
};

type MiniPrismaClient = {
  creator: {
    findUnique: (args: { where: { externalId: string } }) => Promise<{ id: number } | null>;
    upsert: (args: {
      where: { externalId: string };
      update: Omit<ImportCreatorInput, "externalId">;
      create: ImportCreatorInput;
    }) => Promise<{ id: number; name: string }>;
  };
  $disconnect: () => Promise<void>;
};

function textValue(record: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]?.trim();
    if (value) return value;
  }
  return "";
}

function makeExternalId(platform: string, name: string): string {
  return `manual-${platform}-${name}`.replace(/\s+/g, "-").toLowerCase();
}

function recordToCreator(record: Record<string, string>, index: number): ImportCreatorInput | { error: string } {
  const name = textValue(record, ["达人昵称", "昵称", "name", "creator_name"]);
  if (!name) return { error: `第 ${index + 2} 行缺少达人昵称` };

  const platform = textValue(record, ["平台", "platform"]) || "抖音";
  const externalId = textValue(record, ["达人ID", "达人 id", "externalId", "external_id", "id"]) || makeExternalId(platform, name);
  const plays = [1, 2, 3, 4, 5]
    .map((item) => numberValue(textValue(record, [`播放${item}`, `播放量${item}`, `play${item}`])))
    .filter((value) => value > 0);

  return {
    externalId,
    name,
    platform,
    profileUrl: textValue(record, ["主页链接", "主页", "profileUrl", "profile_url"]) || null,
    category: textValue(record, ["类目", "分类", "category"]) || null,
    fans: numberValue(textValue(record, ["粉丝数", "粉丝", "fans"])),
    plays,
    quote: numberValue(textValue(record, ["报价", "quote", "price"])) || null,
    outreachStatus: textValue(record, ["建联状态", "状态", "outreachStatus", "outreach_status"]) || "未建联",
    cooperationStatus: textValue(record, ["合作状态", "确定合作", "cooperationStatus", "cooperation_status"]) || null,
    contact: textValue(record, ["联系方式", "微信联系方式", "微信", "contact"]) || null,
    notes: textValue(record, ["备注", "沟通记录", "notes"]) || null
  };
}

async function getPrisma(): Promise<MiniPrismaClient> {
  const prismaModule = await new Function("specifier", "return import(specifier)")("@prisma/client");
  const PrismaClient = prismaModule.PrismaClient as new () => MiniPrismaClient;
  return new PrismaClient();
}

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "还没有配置 DATABASE_URL，请先把 MySQL 连接串放到 .env。" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { csvText?: string } | null;
  const csvText = body?.csvText?.trim();

  if (!csvText) {
    return NextResponse.json({ error: "没有收到 CSV 内容。" }, { status: 400 });
  }

  const records = csvRowsToObjects(csvText);
  if (records.length === 0) {
    return NextResponse.json({ error: "CSV 里没有可导入的数据行。" }, { status: 400 });
  }

  const prisma = await getPrisma();
  const errors: string[] = [];
  let imported = 0;
  let updated = 0;

  try {
    for (const [index, record] of records.entries()) {
      const creator = recordToCreator(record, index);
      if ("error" in creator) {
        errors.push(creator.error);
        continue;
      }

      const existed = await prisma.creator.findUnique({ where: { externalId: creator.externalId } });
      const { externalId, ...updateData } = creator;

      await prisma.creator.upsert({
        where: { externalId },
        update: updateData,
        create: creator
      });

      if (existed) updated += 1;
      else imported += 1;
    }
  } finally {
    await prisma.$disconnect();
  }

  return NextResponse.json({
    imported,
    updated,
    skipped: errors.length,
    errors,
    total: records.length
  });
}
