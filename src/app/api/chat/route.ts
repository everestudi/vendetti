import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { getVendettiModel, SYSTEM_PROMPT, VENDETTI_TOOLS } from '@/lib/vendetti/agent';

export const maxDuration = 60;
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const model = await getVendettiModel();

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    tools: VENDETTI_TOOLS,
    stopWhen: ({ steps }) => steps.length >= 12,
  });

  return result.toUIMessageStreamResponse();
}
