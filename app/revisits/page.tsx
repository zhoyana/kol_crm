import { prisma } from "@/lib/prisma";
import { VideoRevisitClient } from "./VideoRevisitClient";

export const dynamic = "force-dynamic";

export default async function VideoRevisitsPage() {
  const tasks = await prisma.campaignTask.findMany({
    where: { status: "active" },
    select: { id: true, name: true, productName: true, category: true },
    orderBy: { updatedAt: "desc" }
  });
  return <VideoRevisitClient tasks={tasks} />;
}
