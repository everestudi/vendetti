/**
 * Pedido SUPER assertivo pra Gabi mandar SPEC #2.
 * max_tokens agora é 8192 no runtime — não deve truncar.
 */

import { prisma } from '../src/lib/db';
import { runAgent } from '../src/lib/agents/runtime';

const ASSERTIVE_REQUEST = `🛑 GABI, LEIA COM ATENÇÃO:

Você truncou 3 vezes. Custou $5.92 sem entregar UMA SPEC.

⛔ PROIBIDO nesta run:
- gabi_read_repo_file (você JÁ leu tudo necessário)
- gabi_recent_runs (você JÁ viu)
- Análise prosa antes de mandar tool
- "Vou ler X primeiro"

✅ PERMITIDO apenas:
- UMA chamada de agent_send_message({to:"claude-code", kind:"REQUEST", body:SPEC})

PRIMEIRO ato da sua run: CHAMAR agent_send_message. Não escreva texto antes.
Análise opcional vem DEPOIS da tool call, no texto livre.

🎯 SPEC #2: triggers automáticos pós-eventos

Você já articulou o problema nas runs anteriores:
- 6 agentes mortos (0 runs)
- Augusto chama tools direto via tool-bridge em vez de delegar via handoff
- mara_sync→Mara já implementado (run.ts [5/5])
- Decision→Zelda implementado AGORA (commit ad8ad38)

Falta:
1. Triggers que ainda não existem
2. Modelo por trigger type (Haiku pra summary, Sonnet pra análise)
3. Como Augusto deve delegar via agent_handoff em vez de chamar tool direto

Formato OBRIGATÓRIO do body:

# SPEC #2: Triggers automáticos completos

## Status atual
[2 linhas: o que já existe (mara_sync→Mara, Decision→Zelda) e o que falta]

## O que falta implementar
1. **Trigger X**: [arquivo:linha] [snippet de código]
2. **Trigger Y**: ...

## Refactor Augusto pra delegar
[snippet do prompt Augusto: quando Z, chame agent_handoff em vez de mara_summary direto]

## Ordem de implementação
1. ...
2. ...

## Edge cases
- ...

## Esforço: ~Xh

Vai. agent_send_message AGORA. NADA antes.`;

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
      body: ASSERTIVE_REQUEST,
      status: 'DELIVERED',
    },
  });
  console.log('Msg', msg.id.slice(0, 12), 'enviada, rodando Gabi (max_tokens 8192)...');

  const t0 = Date.now();
  const { runId, result } = await runAgent({
    agentSlug: 'gabi',
    trigger: 'MAILBOX',
    triggerRef: msg.id,
    payload: { messageId: msg.id, threadId: 'claude-code-gabi', focusedRequest: 'spec-2-final' },
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n✓ Run ${runId.slice(0, 8)} em ${elapsed}s · $${result.costUsd.toFixed(4)}`);
  console.log(`tokens: ${result.tokensIn} in / ${result.tokensOut} out`);
  console.log(`tools: ${result.toolCalls.map((t) => t.name).join(', ') || '(nenhuma)'}`);
  console.log(`msgs novas: ${result.newMessages.length}`);
  for (const m of result.newMessages) {
    console.log(`  → ${m.toSlug ?? 'broadcast'} · ${m.kind} · ${m.body.length} chars`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
