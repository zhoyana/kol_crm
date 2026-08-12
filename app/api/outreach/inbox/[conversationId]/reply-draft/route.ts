import { NextRequest, NextResponse } from "next/server";
import { analyzeAndDraftReply } from "@/lib/outreach-reply";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const id = Number(conversationId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "会话标识无效。" }, { status: 400 });
  }

  // prisma singleton from import

  try {
    const conversation = await prisma.outreachConversation.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            profileUrl: true,
            category: true,
            outreachStatus: true,
            quote: true,
            campaignTasks: {
              where: { campaignTask: { status: "active" } },
              take: 1,
              orderBy: { updatedAt: "desc" },
              include: {
                campaignTask: {
                  select: {
                    productName: true,
                    targetAudience: true,
                    productSellingPoints: true,
                    outreachTone: true
                  }
                }
              }
            }
          }
        },
        messages: {
          orderBy: { createdAt: "asc" },
          take: 80,
          select: { direction: true, content: true, sentAt: true }
        }
      }
    });

    if (!conversation) {
      return NextResponse.json({ error: "未找到该会话记录。" }, { status: 404 });
    }

    const campaignLink = conversation.creator?.campaignTasks?.[0]?.campaignTask;
    const analysis = await analyzeAndDraftReply({
      messages: conversation.messages.map((m: any) => ({
        direction: m.direction === "outbound" ? "outbound" : "inbound",
        content: m.content,
        sentAt: m.sentAt
      })),
      creator: {
        id: conversation.creator.id,
        name: conversation.creator.name,
        profileUrl: conversation.creator.profileUrl,
        category: conversation.creator.category,
        outreachStatus: conversation.creator.outreachStatus,
        quote: conversation.creator.quote
      },
      campaign: campaignLink
        ? {
            productName: campaignLink.productName,
            targetAudience: campaignLink.targetAudience,
            productSellingPoints: Array.isArray(campaignLink.productSellingPoints)
              ? campaignLink.productSellingPoints.filter((item): item is string => typeof item === "string")
              : [],
            outreachTone: campaignLink.outreachTone
          }
        : null
    });

    // Persist the AI suggestion so it can be linked to the feedback when the
    // operator confirms (or modifies) the draft and sends it.
    const suggestion = await prisma.outreachAiSuggestion.create({
      data: {
        conversationId: id,
        intent: analysis.intent,
        intentLabel: analysis.intentLabel,
        sentiment: analysis.sentiment,
        sentimentLabel: analysis.sentimentLabel,
        summary: analysis.summary,
        suggestedAction: analysis.suggestedAction,
        draft: analysis.draft,
        draftReason: analysis.draftReason,
        riskLevel: analysis.riskLevel,
        source: analysis.source,
        adopted: false
      }
    });

    return NextResponse.json({ ok: true, analysis, suggestionId: suggestion.id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI 回复分析失败。" },
      { status: 502 }
    );
  } finally {
    // prisma singleton — do not disconnect
  }
}
