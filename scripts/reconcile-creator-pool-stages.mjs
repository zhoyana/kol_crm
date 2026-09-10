import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const featuredStatuses = ["featured_stable", "featured_trending"];

try {
  const creatorInvalidFeatured = await prisma.creator.updateMany({
    where: { poolStatus: "featured", screeningStatus: { notIn: featuredStatuses } },
    data: { poolStatus: "candidate" }
  });
  const creatorPortraitPassed = await prisma.creator.updateMany({
    where: { screeningStatus: "portrait_passed", poolStatus: { not: "candidate" } },
    data: { poolStatus: "candidate" }
  });
  const creatorMetricPassed = await prisma.creator.updateMany({
    where: { screeningStatus: { in: featuredStatuses }, poolStatus: { not: "featured" } },
    data: { poolStatus: "featured" }
  });
  const taskInvalidFeatured = await prisma.creatorCampaignTask.updateMany({
    where: { poolStatus: "featured", screeningStatus: { notIn: featuredStatuses } },
    data: { poolStatus: "candidate" }
  });
  const taskPortraitPassed = await prisma.creatorCampaignTask.updateMany({
    where: { screeningStatus: "portrait_passed", poolStatus: { not: "candidate" } },
    data: { poolStatus: "candidate" }
  });
  const taskMetricPassed = await prisma.creatorCampaignTask.updateMany({
    where: { screeningStatus: { in: featuredStatuses }, poolStatus: { not: "featured" } },
    data: { poolStatus: "featured" }
  });

  console.log(JSON.stringify({
    creators: {
      invalidFeaturedMovedToCandidate: creatorInvalidFeatured.count,
      portraitPassedMovedToCandidate: creatorPortraitPassed.count,
      metricPassedMovedToFeatured: creatorMetricPassed.count
    },
    campaignTasks: {
      invalidFeaturedMovedToCandidate: taskInvalidFeatured.count,
      portraitPassedMovedToCandidate: taskPortraitPassed.count,
      metricPassedMovedToFeatured: taskMetricPassed.count
    }
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
