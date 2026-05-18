import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import type { Prisma } from '@prisma/client';
import { getVendettiModel, SYSTEM_PROMPT, VENDETTI_TOOLS } from '@/lib/vendetti/agent';
import { prisma } from '@/lib/db';

export const maxDuration = 60;
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Persiste o último user message (recém-chegado) antes de iniciar o stream.
  const last = messages[messages.length - 1];
  if (last && last.role === 'user') {
    await prisma.chatMessage
      .create({
        data: {
          role: 'user',
          parts: (last.parts ?? []) as unknown as Prisma.InputJsonValue,
        },
      })
      .catch((e) => console.warn('[chat persist user]', e));
  }

  const model = await getVendettiModel();

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    tools: VENDETTI_TOOLS,
    stopWhen: ({ steps }) => steps.length >= 12,
    onFinish: async ({ text, response }) => {
      try {
        const lastAssistant = response.messages[response.messages.length - 1];
        const parts =
          lastAssistant && Array.isArray(lastAssistant.content)
            ? lastAssistant.content
            : [{ type: 'text', text }];
        await prisma.chatMessage.create({
          data: {
            role: 'assistant',
            parts: parts as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        console.warn('[chat persist assistant]', e);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
