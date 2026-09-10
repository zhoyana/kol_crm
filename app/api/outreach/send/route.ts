import { NextRequest, NextResponse } from "next/server";
import { sendDouyinOutreach } from "@/lib/douyin-outreach-agent";
import { prisma } from "@/lib/prisma";
import { agentIdFromRequest } from "@/lib/central-agent-auth";
import { withLocalAgentDevice } from "@/lib/local-agent-client";

export const runtime = "nodejs";

type Body = {
  creatorId?: string;
  profileUrl?: string;
  message?: string;
  taskKind?: "initial" | "followup" | "negotiate";
  campaignTaskId?: number | string | null;
};

function canStartInitialOutreach(status: string): boolean {
  return status === "未建联";
}

function isAllowedProfileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && url.hostname.endsWith("douyin.com");
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  return withLocalAgentDevice(agentIdFromRequest(request), () => handlePost(request));
}

async function handlePost(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Body | null;
  const creatorId = String(body?.creatorId || "").trim();
  const profileUrl = String(body?.profileUrl || "").trim();
  const message = String(body?.message || "").trim();
  const taskKind = body?.taskKind || "initial";
  const campaignTaskId = Number(body?.campaignTaskId || 0) || null;

  if (!creatorId) {
    return NextResponse.json({ error: "缺少达人标识，已停止发送以避免重复建联。" }, { status: 400 });
  }
  if (!isAllowedProfileUrl(profileUrl)) {
    return NextResponse.json({ error: "只允许向抖音达人主页发起自动建联。" }, { status: 400 });
  }
  if (!message || message.length > 500) {
    return NextResponse.json({ error: "话术不能为空且不能超过500字。" }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "数据库未配置，无法校验建联状态，已停止发送。" }, { status: 503 });
  }

  let creator: any;
  let reservedStatus = "";
  try {
    // prisma singleton from import
    const numericId = Number(creatorId);
    creator = await prisma.creator.findFirst({
      where: {
        OR: [{ externalId: creatorId }, ...(Number.isInteger(numericId) ? [{ id: numericId }] : [])]
      }
    });
    if (!creator) {
      return NextResponse.json({ error: "没有找到达人，已停止发送。" }, { status: 404 });
    }
    const taskLink = campaignTaskId
      ? await prisma.creatorCampaignTask.findUnique({
          where: { creatorId_campaignTaskId: { creatorId: creator.id, campaignTaskId } }
        })
      : null;
    if (campaignTaskId && !taskLink) {
      return NextResponse.json({ error: "这个达人不在所选品类任务中，已停止发送。" }, { status: 404 });
    }

    const currentStatus = taskLink?.outreachStatus || creator.outreachStatus || "未建联";
    if (taskKind === "initial" && !canStartInitialOutreach(currentStatus)) {
      return NextResponse.json(
        { error: `该达人在当前任务中的状态为“${currentStatus}”，已阻止重复初次建联。`, alreadyContacted: true },
        { status: 409 }
      );
    }

    reservedStatus = currentStatus;

    const sendResult = await sendDouyinOutreach({ profileUrl, message, taskId: String(creator.id) });
    const finalStatus = taskKind === "initial" ? "已建联" : reservedStatus;
    const statusUpdate = taskLink
      ? prisma.creatorCampaignTask.update({ where: { id: taskLink.id }, data: { outreachStatus: finalStatus } })
      : prisma.creator.update({ where: { id: creator.id }, data: { outreachStatus: finalStatus } });
    await prisma.$transaction([
      statusUpdate,
      prisma.outreachLog.create({
        data: {
          creatorId: creator.id,
          campaignTaskId,
          action: taskKind === "initial" ? "auto_send_initial" : `auto_send_${taskKind}`,
          content: `已通过本地浏览器自动发送建联私信。\n\n话术：${message}`,
          oldStatus: reservedStatus,
          newStatus: finalStatus
        }
      })
    ]);
    return NextResponse.json({
      ok: true,
      message: `${sendResult.retriedAfterRestart ? "专用 Chrome 已自动恢复并重试。" : ""}${sendResult.message}`
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: String(error?.message || "自动建联失败").trim() },
      { status: 502 }
    );
  } finally {
    // prisma singleton — do not disconnect
  }
}
