import { NextRequest, NextResponse } from "next/server";
import {
  createCampaignTask,
  getBrandLibraries,
  getCampaignTasks,
  normalizeCampaignTaskInput,
  updateCampaignTaskAgentGoal,
  validateCampaignTaskInput
} from "@/lib/campaign-tasks";

export async function GET() {
  const [tasks, brandLibraries] = await Promise.all([getCampaignTasks(), getBrandLibraries()]);
  return NextResponse.json({ tasks, brandLibraries });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const id = Number(body?.id || 0);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "无效的品类任务。" }, { status: 400 });
  try {
    const task = await updateCampaignTaskAgentGoal(id, body?.agentGoalDefaults);
    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存默认目标失败。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const input = normalizeCampaignTaskInput(body);
  const error = validateCampaignTaskInput(input);

  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  try {
    const task = await createCampaignTask(input);
    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建品类任务失败。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
