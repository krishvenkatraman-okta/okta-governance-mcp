import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/get-token';
import { VIEW_CONFIG_SCHEMA } from '@/lib/view-schema';
import type { Campaign } from '@/lib/types';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const AWS_REGION = process.env.AWS_REGION || 'us-east-2';
const BEDROCK_MODEL = process.env.BEDROCK_MODEL || 'us.anthropic.claude-sonnet-4-6';

const bedrock = new BedrockRuntimeClient({ region: AWS_REGION });

export async function POST(request: NextRequest) {
  const token = await getAccessToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { message, campaigns, history } = await request.json();

  // Build context for the agent
  const campaignContext = (campaigns as Campaign[])?.map(c => ({
    id: c.id,
    name: c.template?.name,
    status: c.status,
    pending: c.campaignSummary?.pending,
    approved: c.campaignSummary?.approved,
    total: c.campaignSummary?.total,
    dueDate: c.endDateForReviewerLevel,
    reviewerLevel: c.reviewerLevelOfReviewer,
  })) || [];

  const systemPrompt = `You are an AI assistant helping a reviewer work through access certification reviews in Okta Identity Governance.

${VIEW_CONFIG_SCHEMA}

Current campaigns assigned to this reviewer:
${JSON.stringify(campaignContext, null, 2)}

Rules:
- Always respond with valid JSON containing "message" and optionally "view"
- The "message" field is shown to the user as natural language
- The "view" field controls the UI layout and data display
- When the user first asks about reviews, show campaign-overview first so they can pick a campaign
- When they mention a specific app/user/campaign, set the appropriate filter
- For the first drill-in to a campaign, use flat-table layout by default
- Never fabricate review data — the UI fetches real data from Okta based on your view config
- If the user asks to approve/revoke, explain they can use the action buttons in the UI
- Keep messages concise and actionable`;

  const bedrockMessages = [
    ...(history || []).map((h: any) => ({
      role: h.role as 'user' | 'assistant',
      content: [{ text: h.role === 'assistant' ? JSON.stringify({ message: h.content, view: h.view }) : h.content }],
    })),
    { role: 'user' as const, content: [{ text: message }] },
  ];

  try {
    const command = new ConverseCommand({
      modelId: BEDROCK_MODEL,
      system: [{ text: systemPrompt }],
      messages: bedrockMessages,
      inferenceConfig: {
        maxTokens: 1024,
        temperature: 0.3,
      },
    });

    const response = await bedrock.send(command);
    const content = response.output?.message?.content?.[0]?.text || '';

    // Parse the structured JSON response
    try {
      const parsed = JSON.parse(content);
      return NextResponse.json(parsed);
    } catch {
      return NextResponse.json({ message: content, view: null });
    }
  } catch (error: any) {
    console.error('Bedrock error:', error);
    return NextResponse.json(
      { message: `AI error: ${error.message}`, view: null },
      { status: 200 }
    );
  }
}
