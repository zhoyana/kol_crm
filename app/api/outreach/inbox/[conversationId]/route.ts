import { NextRequest, NextResponse, after } from "next/server";
import { getOutreachConversationDetail, refreshOutreachConversationFromBrowser } from "@/lib/outreach-inbox";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const { conversationId } = await params;
    const id = Number(conversationId);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });

    // Return the conversation from the database immediately so the chat window
    // renders without waiting for the Douyin browser sync.
    const conversation = await getOutreachConversationDetail(id);

    // Refresh messages in the background. If it fails (e.g. creator not found
    // in Douyin inbox), the conversation is still usable and syncError is
    // persisted for display.
    after(async () => { await refreshOutreachConversationFromBrowser(id); });

    return NextResponse.json({ ok: true, conversation });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取会话详情失败。" }, { status: 502 });
  }
}
