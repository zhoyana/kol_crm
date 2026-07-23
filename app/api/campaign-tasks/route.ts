import { NextRequest, NextResponse } from "next/server";
import {
  createCampaignTask,
  getCampaignTasks,
  normalizeCampaignTaskInput,
  validateCampaignTaskInput
} from "@/lib/campaign-tasks";

export async function GET() {
  const tasks = await getCampaignTasks();
  return NextResponse.json({ tasks });
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
