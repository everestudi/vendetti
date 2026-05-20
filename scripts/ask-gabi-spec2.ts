/**
 * Pede pra Gabi mandar UMA SPEC focada (#2) sem ficar lendo arquivos de novo.
 */

import { prisma } from '../src/lib/db';
import { runAgent } from '../src/lib/agents/runtime';

const FOCUSED_REQUEST = `Gabi, pedido FOCADO — você esgotou tokens 2x lendo arquivos demais.

REGRA: NÃO leia mais arquivos. Você JÁ leu runtime.ts, schema.prisma, seed.ts, tool-bridge.ts. Contexto suficiente.

Faça UMA coisa só: chame agent_send_message UMA vez com kind=REQUEST pro claude-code com SPEC #2 (triggers automáticos pós-eventos) no body.

Estrutura obrigatória do body:

# SPEC #2: Triggers automáticos pós-eventos

## Contexto
[2 linhas: hoje só Augusto roda; outros agentes ficam idle até Luís perguntar]

## Arquivos a tocar
- arquivo:linha — descrição

## Mudanças
1. **[Arquivo X]**: snippet de código exato
2. ...

## Ordem de implementação
1. ...

## Edge cases
- ...

## Esforço: ~Xh

UMA CHAMADA SÓ de agent_send_message. NADA MAIS. NÃO chame gabi_read_repo_file de novo.`;

async function main() {
  const cc = await prisma.agent.findUnique({ where: { slug: 'claude-code' } });
  const gabi = await prisma.agent.findUnique({ where: { slug: 'gabi' } });
  if (!cc || !gabi) throw new Error('agentes faltando');

  const msg = await prisma.agentMessage.create({
    data: {
      fromAgentId: cc.id,
      toAgentId: gabi.id,
      threadId: 'claude-code-gabi',
      kind: 'REQUEST',
      body: FOCUSED_REQUEST,
      status: 'DELIVERED',
    },
  });
  console.log('Msg enviada, rodando Gabi...');

  const { runId, result } = await runAgent({
    agentSlug: 'gabi',
    trigger: 'MAILBOX',
    triggerRef: msg.id,
    payload: { messageId: msg.id, threadId: 'claude-code-gabi', focusedRequest: 'spec-2-only' },
  });

  console.log('Run', runId.slice(0, 8), 'cost $' + result.costUsd.toFixed(4));
  console.log('tools:', result.toolCalls.map((t) => t.name).join(', '));
  console.log('msgs novas:', result.newMessages.length);
  for (const m of result.newMessages) {
    console.log(' →', m.toSlug ?? 'broadcast', m.kind, 'body len:', m.body.length);
    console.log('   ', m.body.slice(0, 150) + '...');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
