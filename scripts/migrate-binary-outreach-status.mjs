import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const contactedStatuses = ["已建联", "需跟进", "已回复", "报价中", "确定合作", "已拒绝", "已放弃", "发送中"];
  const contacted = await prisma.creator.updateMany({
    where: { outreachStatus: { in: contactedStatuses } },
    data: { outreachStatus: "已建联" }
  });
  const uncontacted = await prisma.creator.updateMany({
    where: { outreachStatus: { not: "已建联" } },
    data: { outreachStatus: "未建联" }
  });
  console.log(`Normalized outreach statuses: ${contacted.count} contacted, ${uncontacted.count} uncontacted.`);
} finally {
  await prisma.$disconnect();
}
