import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams?: Promise<{ campaignTaskId?: string }> }) {
  const params = await searchParams;
  const campaignTaskId = Number(params?.campaignTaskId || 0) || null;
  redirect(campaignTaskId ? `/creators?campaignTaskId=${campaignTaskId}` : "/creators");
}
