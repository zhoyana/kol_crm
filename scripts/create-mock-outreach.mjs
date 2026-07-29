import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const externalId = "mock-douyin-self-auto-outreach";
const data = {
  name: "自动私信测试达人（本人）",
  profileUrl: "https://www.douyin.com/user/self?from_tab_name=main&showSubTab=video&showTab=post",
  platform: "抖音",
  category: "自动化测试",
  plays: [12000, 15000, 18000],
  outreachStatus: "未建联",
  cooperationStatus: "测试账号",
  poolStatus: "featured",
  accountType: "test_self",
  screeningStatus: "featured_stable",
  screeningSummary: "仅用于测试自动私信，主页为当前登录用户本人。",
  avgLikes: 15000,
  maxLikes: 18000,
  recentWorkCount: 3,
  viralWorkCount: 3,
  notes: "MOCK：禁止用于真实达人测试，只向本人账号发送。"
};

try {
  const creator = await prisma.creator.upsert({
    where: { externalId },
    update: data,
    create: { externalId, ...data }
  });
  const campaignTasks = await prisma.campaignTask.findMany({
    where: { status: "active" },
    select: { id: true, name: true }
  });
  for (const campaignTask of campaignTasks) {
    await prisma.creatorCampaignTask.upsert({
      where: {
        creatorId_campaignTaskId: {
          creatorId: creator.id,
          campaignTaskId: campaignTask.id
        }
      },
      update: {
        poolStatus: "featured",
        screeningStatus: "featured_stable",
        screeningSummary: "MOCK：仅用于向当前登录用户本人测试自动私信。"
      },
      create: {
        creatorId: creator.id,
        campaignTaskId: campaignTask.id,
        poolStatus: "featured",
        screeningStatus: "featured_stable",
        fitScore: 100,
        screeningSummary: "MOCK：仅用于向当前登录用户本人测试自动私信。"
      }
    });
  }
  console.log(JSON.stringify({
    id: creator.id,
    externalId: creator.externalId,
    name: creator.name,
    profileUrl: creator.profileUrl,
    poolStatus: creator.poolStatus,
    outreachStatus: creator.outreachStatus,
    linkedCampaignTasks: campaignTasks.map((task) => task.name)
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
