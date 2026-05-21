import { prisma } from '@/lib/db';
import { approveDecision, rejectDecision, executeDecisionAction, confirmPhysical, updateDecisionItems } from './actions';
import { matchSku, type SkuLike } from '@/lib/sku-match';

export const dynamic = 'force-dynamic';

const LEVEL_BADGE = {
  GREEN: { cls: 'bg-emerald-100 text-emerald-800', label: '🟢 verde' },
  YELLOW: { cls: 'bg-amber-100 text-amber-800', label: '🟡 amarelo' },
  RED: { cls: 'bg-rose-100 text-rose-800', label: '🔴 vermelho' },
} as const;

const STATUS_BADGE = {
  PENDING: { cls: 'bg-amber-100 text-amber-800', label: 'pendente' },
  APPROVED: { cls: 'bg-blue-100 text-blue-800', label: 'aprovada' },
  REJECTED: { cls: 'bg-navy-50 text-navy/60', label: 'rejeitada' },
  AWAITING_PHYSICAL: { cls: 'bg-purple-100 text-purple-800', label: 'aguardando físico' },
  EXECUTED: { cls: 'bg-emerald-100 text-emerald-800', label: 'executada' },
  FAILED: { cls: 'bg-rose-100 text-rose-800', label: 'falhou' },
} as const;

export default async function DecisionsPage() {
  const [pending, approved, awaitingPhysical, recent, allSkus] = await Promise.all([
    prisma.decision.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' } }),
    prisma.decision.findMany({ where: { status: 'APPROVED' }, orderBy: { createdAt: 'desc' } }),
    prisma.decision.findMany({ where: { status: 'AWAITING_PHYSICAL' }, orderBy: { createdAt: 'desc' } }),
    prisma.decision.findMany({
      where: { status: { in: ['EXECUTED', 'REJECTED', 'FAILED'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.sku.findMany({
      where: { active: true },
      select: { id: true, name: true, category: true },
    }),
  ]);

  const skus: SkuLike[] = allSkus;
  // Lista única de categorias do catálogo, pra dropdown de produto novo
  const categories = Array.from(new Set(allSkus.map((s) => s.category))).sort();

  const totalAction = pending.length + approved.length + awaitingPhysical.length;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-navy">Decisões</h1>
        <p className="mt-1 text-sm text-navy/60">
          Toda ação proposta pelo Vendetti vira uma Decision. Aprovações, execução e confirmação física passam por aqui.
          {totalAction > 0 && <strong className="ml-2 text-navy">{totalAction} esperando ação.</strong>}
        </p>
      </header>

      {pending.length > 0 && (
        <Section title="🟡 Pendentes — sua aprovação" count={pending.length}>
          {pending.map((d) => (
            <PendingCard key={d.id} d={d} skus={skus} categories={categories} />
          ))}
        </Section>
      )}

      {approved.length > 0 && (
        <Section title="🚀 Aprovadas — prontas pra executar" count={approved.length}>
          {approved.map((d) => (
            <ApprovedCard key={d.id} d={d} />
          ))}
        </Section>
      )}

      {awaitingPhysical.length > 0 && (
        <Section title="⏳ Aguardando físico (Weverton)" count={awaitingPhysical.length}>
          {awaitingPhysical.map((d) => (
            <PhysicalCard key={d.id} d={d} />
          ))}
        </Section>
      )}

      {pending.length + approved.length + awaitingPhysical.length === 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-6 text-center">
          <div className="text-3xl">✓</div>
          <p className="mt-2 text-sm text-emerald-900">Nenhuma decisão esperando ação.</p>
        </div>
      )}

      <Section title="Histórico recente" count={recent.length} muted>
        {recent.length === 0 && <p className="text-sm text-navy/45">Sem registros ainda.</p>}
        {recent.map((d) => (
          <HistoryCard key={d.id} d={d} />
        ))}
      </Section>
    </main>
  );
}

type Decision = Awaited<ReturnType<typeof prisma.decision.findMany>>[number];

function Section({ title, count, children, muted }: { title: string; count: number; children: React.ReactNode; muted?: boolean }) {
  return (
    <section className={`mb-8 ${muted ? 'opacity-90' : ''}`}>
      <h2 className="mb-3 text-lg font-semibold text-navy">
        {title} <span className="text-navy/45">· {count}</span>
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function DecisionHeader({ d }: { d: Decision }) {
  const level = LEVEL_BADGE[d.level as keyof typeof LEVEL_BADGE];
  const status = STATUS_BADGE[d.status as keyof typeof STATUS_BADGE];
  return (
    <header className="flex flex-wrap items-baseline gap-2">
      <span className="font-mono text-[10px] text-navy/40">{d.id.slice(0, 10)}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${level.cls}`}>{level.label}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.cls}`}>{status.label}</span>
      <span className="text-[10px] text-navy/40">{d.kind}</span>
      <span className="ml-auto text-[10px] text-navy/40">
        {new Date(d.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
      </span>
    </header>
  );
}

interface NewProductData {
  cost?: number;
  category?: string;
  supplier?: 'ATACADAO' | 'VITTAL' | 'OUTRO';
  /** Quando >0, scraper lança entrada de estoque no Everest com essa qty
   *  antes de tentar abastecer a máquina. Usado quando produto é novo E
   *  Bruno ainda não cadastrou via NF-e. */
  entradaEstoqueQty?: number;
}

interface LLMReview {
  slotPosition: string;
  recommendedAction: 'abastecer_only' | 'product_swap' | 'slot_swap_with' | 'create_new' | 'human_review';
  confidence: number;
  reasoning: string;
  targetSkuId?: string;
  targetSkuName?: string;
  swapWithSlot?: string;
  newProductName?: string;
}

interface WevertonItem {
  slotPosition?: string;
  qty?: number;
  productGuess?: string;
  slotProduct?: string | null;
  matchConfidence?: 'high' | 'mid' | 'low' | 'no-slot';
  targetProduct?: string;
  skip?: boolean;
  newProductData?: NewProductData;
  llmReview?: LLMReview | null;
  /** Match determinístico via SkuAlias — Luís já corrigiu antes, sem custo de LLM */
  aliasMatch?: { skuId: string; skuName: string; aliasId: string } | null;
}

const LLM_ACTION_BADGE: Record<string, { cls: string; emoji: string; label: string }> = {
  abastecer_only: { cls: 'bg-emerald-100 text-emerald-800', emoji: '✓', label: 'só abastecer' },
  product_swap: { cls: 'bg-amber-100 text-amber-800', emoji: '🔄', label: 'trocar produto' },
  slot_swap_with: { cls: 'bg-purple-100 text-purple-800', emoji: '↔️', label: 'slot invertido' },
  create_new: { cls: 'bg-blue-100 text-blue-800', emoji: '🆕', label: 'cadastrar novo' },
  human_review: { cls: 'bg-rose-100 text-rose-800', emoji: '🙋', label: 'precisa decisão' },
};

function PendingCard({ d, skus, categories }: { d: Decision; skus: SkuLike[]; categories: string[] }) {
  const data = (d.data ?? {}) as { source?: string; items?: WevertonItem[]; mode?: 'inventory' | 'restock' };
  const isWeverton = d.kind === 'SYSTEM_INVENTORY_SYNC' && data.source === 'weverton-group';
  const items = isWeverton && Array.isArray(data.items) ? data.items : [];
  const mode = data.mode ?? 'restock'; // legado sem campo = restock

  return (
    <article className="rounded-lg border border-amber-200 bg-amber-50/30 p-4">
      <DecisionHeader d={d} />
      <div className="mt-2 flex items-baseline gap-2">
        <h3 className="font-semibold text-navy">{d.summary}</h3>
        {isWeverton && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${mode === 'inventory' ? 'bg-cyan-100 text-cyan-800' : 'bg-orange-100 text-orange-800'}`}>
            {mode === 'inventory' ? '📋 contagem' : '📦 abastecimento'}
          </span>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-xs text-navy/70">{d.rationale}</p>

      {/* Tabela simples (Weverton) — slot · vendtef · weverton · qty-slot · qty-mandada · sugestão · skip */}
      {isWeverton && items.length > 0 && (
        <WevertonTable
          d={d}
          items={items}
          skus={skus}
          categories={categories}
          mode={mode}
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <form action={approveDecision.bind(null, d.id)}>
          <button className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">
            ✓ Aprovar
          </button>
        </form>

        {/* Rejeitar com motivo OBRIGATÓRIO (categoria + texto livre).
            Evento gravado pra Zelda auditar padrões de rejeição. */}
        <details className="flex-1 min-w-[300px] rounded border border-rose-200 bg-rose-50/40">
          <summary className="cursor-pointer px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-50/80">
            ✗ Rejeitar (precisa motivo)
          </summary>
          <form action={rejectDecision} className="space-y-2 border-t border-rose-200 p-3">
            <input type="hidden" name="id" value={d.id} />
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-rose-900/65">
                Por quê? <span className="text-rose-600">*</span>
              </label>
              <select
                name="reasonCategory"
                required
                defaultValue=""
                className="mt-0.5 w-full rounded border border-rose-300 px-2 py-1 text-xs"
              >
                <option value="" disabled>
                  selecione...
                </option>
                <option value="match-errado">Match com produto errado</option>
                <option value="produto-inexistente">Produto não existe (ou erro de leitura)</option>
                <option value="qty-errada">Quantidade errada</option>
                <option value="slot-errado">Slot reportado errado</option>
                <option value="duplicada">Decision duplicada</option>
                <option value="dados-insuficientes">Faltam dados pra decidir</option>
                <option value="momento-errado">Não é o momento (vai fazer depois)</option>
                <option value="outro">Outro motivo</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-rose-900/65">
                Detalhes (opcional, ajuda a Zelda)
              </label>
              <input
                type="text"
                name="reasonText"
                placeholder="ex: matcher confundiu Crisp com Delicious"
                className="mt-0.5 w-full rounded border border-rose-300 px-2 py-1 text-xs"
              />
            </div>
            <p className="text-[10px] text-rose-900/65">
              ℹ️ O motivo vai pra Zelda investigar padrões. Se você rejeita muitas decisions do mesmo
              tipo, Zelda detecta e propõe fix.
            </p>
            <button
              type="submit"
              className="w-full rounded bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-700"
            >
              ✗ Rejeitar Decision
            </button>
          </form>
        </details>
      </div>
    </article>
  );
}

/**
 * Tabela simplificada pra Decisions do Weverton.
 *
 * UX: Luís bate o olho em cada linha — dropdown vem PRÉ-SELECIONADO com a
 * sugestão do alias/LLM/F1 (nesta ordem). Se errado, ele só troca.
 *
 * Modo inventory: divergência QTY-BD vs QTY-W exibida neutra (snapshot).
 * Modo restock: divergência destacada (se BD tinha 4 e Weverton diz +5 = vendeu).
 */
function WevertonTable({
  d,
  items,
  skus,
  mode,
}: {
  d: Decision;
  items: WevertonItem[];
  skus: SkuLike[];
  categories: string[];
  mode: 'inventory' | 'restock';
}) {
  // SKUs em ordem alfabética pra dropdown
  const skusSorted = [...skus].sort((a, b) => a.name.localeCompare(b.name));

  // Pré-seleção: alias > LLM > F1 (slotSkuId) > vazio
  function pickSuggestion(it: WevertonItem): { skuId: string; label: string; source: 'alias' | 'llm-abast' | 'llm-swap' | 'llm-slotswap' | 'f1' | 'human' } {
    if (it.aliasMatch) {
      return { skuId: it.aliasMatch.skuId, label: it.aliasMatch.skuName, source: 'alias' };
    }
    const llm = it.llmReview;
    if (llm?.recommendedAction === 'abastecer_only') {
      const skuId = llm.targetSkuId ?? (it as { slotSkuId?: string }).slotSkuId ?? '';
      return { skuId, label: llm.targetSkuName ?? it.slotProduct ?? '', source: 'llm-abast' };
    }
    if (llm?.recommendedAction === 'product_swap' && llm.targetSkuId) {
      return { skuId: llm.targetSkuId, label: llm.targetSkuName ?? '', source: 'llm-swap' };
    }
    if (llm?.recommendedAction === 'slot_swap_with' && llm.targetSkuId) {
      return { skuId: llm.targetSkuId, label: `${llm.targetSkuName} (↔ slot ${llm.swapWithSlot})`, source: 'llm-slotswap' };
    }
    if (it.matchConfidence === 'high' && it.slotProduct) {
      const sku = skus.find((s) => s.name === it.slotProduct);
      return { skuId: sku?.id ?? '', label: it.slotProduct, source: 'f1' };
    }
    return { skuId: '', label: '', source: 'human' };
  }

  const SOURCE_BADGE: Record<string, { cls: string; emoji: string; label: string }> = {
    alias: { cls: 'bg-emerald-100 text-emerald-800', emoji: '🎯', label: 'alias' },
    'llm-abast': { cls: 'bg-blue-50 text-blue-800', emoji: '🤖', label: 'LLM' },
    'llm-swap': { cls: 'bg-amber-100 text-amber-800', emoji: '🔄', label: 'troca' },
    'llm-slotswap': { cls: 'bg-purple-100 text-purple-800', emoji: '↔️', label: 'inversão' },
    f1: { cls: 'bg-emerald-50 text-emerald-700', emoji: '✓', label: 'OK' },
    human: { cls: 'bg-rose-100 text-rose-800', emoji: '🙋', label: 'você decide' },
  };

  const totalUnits = items.reduce((s, i) => s + (i.qty ?? 0), 0);

  return (
    <form action={updateDecisionItems.bind(null, d.id)} className="mt-4">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-navy/65">
          {mode === 'inventory'
            ? <>📋 <strong>Contagem</strong>: {items.length} slots reportados. Bata o olho — dropdown já vem pré-preenchido com a sugestão. Mude se estiver errado.</>
            : <>📦 <strong>Reposição</strong>: {items.length} slots, +{totalUnits} unidades. Sugestão de SKU pré-preenchida — confirme o produto certo.</>}
        </span>
        <button
          type="submit"
          className="rounded border border-navy/20 px-2 py-0.5 text-[11px] font-medium text-navy hover:bg-navy/5"
        >
          💾 Salvar mudanças
        </button>
      </div>
      <div className="overflow-x-auto rounded border border-navy/15 bg-white">
        <table className="w-full text-[11px]">
          <thead className="bg-navy/5 text-[10px] uppercase text-navy/55">
            <tr>
              <th className="px-2 py-1.5 text-left">slot</th>
              <th className="px-2 py-1.5 text-left">no vendtef</th>
              <th className="px-2 py-1.5 text-left">weverton mandou</th>
              <th className="px-2 py-1.5 text-center" title="quantidade atual no banco">qty BD</th>
              <th className="px-2 py-1.5 text-center" title="quantidade reportada pelo Weverton">qty W</th>
              <th className="px-2 py-1.5 text-left">produto certo (escolha do catálogo)</th>
              <th className="px-2 py-1.5 text-center">pular</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const suggestion = pickSuggestion(it);
              const badge = SOURCE_BADGE[suggestion.source];
              const slotSkuId = (it as { slotSkuId?: string | null }).slotSkuId ?? null;
              const currentQty = (it as { currentQty?: number | null }).currentQty ?? null;
              // Pra restock: destaca divergência (qty mandada significa "abasteci +N")
              // Pra inventory: snapshot, sem destaque
              const showQtyDiff = mode === 'restock' && currentQty != null && it.qty != null;
              const projected = showQtyDiff ? (currentQty ?? 0) + (it.qty ?? 0) : null;
              const sold = mode === 'inventory' && currentQty != null && it.qty != null && it.qty < currentQty
                ? currentQty - it.qty
                : null;

              return (
                <tr key={i} className={`${it.skip ? 'opacity-40' : ''} border-t border-navy/10 align-top`}>
                  <td className="px-2 py-1.5 font-mono text-base font-bold text-navy">
                    {it.slotPosition?.padStart(2, '0')}
                  </td>
                  <td className="px-2 py-1.5 text-navy/75" title={it.slotProduct ?? ''}>
                    <div className="max-w-[180px] truncate">{it.slotProduct ?? <em className="text-navy/40">vazio</em>}</div>
                  </td>
                  <td className="px-2 py-1.5 text-navy/75" title={it.productGuess ?? ''}>
                    <div className="max-w-[160px] truncate">{it.productGuess ?? '?'}</div>
                  </td>
                  <td className="px-2 py-1.5 text-center font-mono text-navy/60">
                    {currentQty ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="number"
                      name={`qty_${i}`}
                      defaultValue={it.qty}
                      min={0}
                      className="w-14 rounded border border-navy/20 px-1 py-0.5 text-right font-mono"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <select
                        name={`target_${i}`}
                        defaultValue={suggestion.skuId}
                        className="w-full max-w-[260px] rounded border border-navy/20 px-1 py-0.5 text-[11px]"
                      >
                        <option value="">— sem troca (mantém atual) —</option>
                        {skusSorted.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      {badge && (
                        <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${badge.cls}`} title={suggestion.label || badge.label}>
                          {badge.emoji}
                        </span>
                      )}
                    </div>
                    {/* Anotações secundárias */}
                    {mode === 'restock' && projected != null && (
                      <div className="mt-0.5 text-[9px] text-navy/45">
                        BD: {currentQty} + {it.qty} = {projected} após abastecer
                      </div>
                    )}
                    {sold != null && sold > 0 && (
                      <div className="mt-0.5 text-[9px] text-navy/45 italic">
                        {sold} vendido(s) desde último sync (ou ajuste físico)
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" name={`skip_${i}`} defaultChecked={it.skip} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-navy/55">
        ℹ️ <strong>Legenda</strong>: 🎯 alias salvo · 🤖 LLM sugere · ↔️ inversão de slot detectada · ✓ match direto · 🙋 você decide.
        {' '}Quando você troca o produto e aprova, o sistema <strong>aprende</strong> esse mapeamento (alias) — próxima vez já reconhece sem perguntar.
        {' '}Pra cadastrar produto novo, use o /settings ou me peça.
      </p>
    </form>
  );
}

function ApprovedCard({ d }: { d: Decision }) {
  const data = (d.data ?? {}) as { source?: string; dispatchedAt?: string };
  const isAsync = d.kind === 'SYSTEM_INVENTORY_SYNC' && data.source === 'weverton-group';
  const dispatched = isAsync && Boolean(data.dispatchedAt);
  const dispatchedAge = dispatched
    ? Math.round((Date.now() - new Date(data.dispatchedAt!).getTime()) / 1000)
    : null;

  return (
    <article className="rounded-lg border border-blue-200 bg-blue-50/30 p-4">
      <DecisionHeader d={d} />
      <h3 className="mt-2 font-semibold text-navy">{d.summary}</h3>
      <p className="mt-1 whitespace-pre-wrap text-xs text-navy/70">{d.rationale}</p>
      {dispatched ? (
        <p className="mt-2 text-[11px] text-blue-900/80">
          🤖 Scraper rodando em GitHub Actions há {dispatchedAge}s. Quando terminar, status muda pra EXECUTED e o
          grupo Operação é notificado (~3-5min). Pode fechar essa aba.
        </p>
      ) : isAsync ? (
        <p className="mt-2 text-[11px] text-blue-900/70">
          ℹ Clicar "Executar" dispara o scraper em GitHub Actions (~3-5min). Você recebe notificação no WhatsApp
          quando terminar.
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-blue-900/70">
          ℹ Clicar "Executar" dispara o scraper agora (browser headless, ~30-60s). Aguarde o load completar.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!dispatched && (
          <form action={executeDecisionAction.bind(null, d.id)}>
            <button className="rounded bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-navy-900">
              🚀 Executar
            </button>
          </form>
        )}
        <form action={rejectDecision} className="flex items-center gap-2">
          <input type="hidden" name="id" value={d.id} />
          <input type="hidden" name="reason" value="rejeitada após aprovação" />
          <button className="rounded border border-rose-300 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-50">
            cancelar
          </button>
        </form>
      </div>
    </article>
  );
}

function PhysicalCard({ d }: { d: Decision }) {
  return (
    <article className="rounded-lg border border-purple-200 bg-purple-50/30 p-4">
      <DecisionHeader d={d} />
      <h3 className="mt-2 font-semibold text-navy">{d.summary}</h3>
      <p className="mt-1 whitespace-pre-wrap text-xs text-navy/70">{d.rationale}</p>
      <p className="mt-2 text-[11px] text-purple-900/80">
        ℹ️ Sistema atualizado. Aguardando Weverton ajustar fisicamente. Quando ele confirmar no grupo, clique "Confirmar físico" — webhook automático vem depois.
      </p>
      <div className="mt-3">
        <form action={confirmPhysical.bind(null, d.id)}>
          <button className="rounded bg-purple-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-purple-800">
            ✓ Confirmar físico
          </button>
        </form>
      </div>
    </article>
  );
}

interface SwapResult { slotPosition: string; ok: boolean; newPid?: string; error?: string }

function VendtefSwapsAlert({
  swaps,
  dispatchedAt,
  completedAt,
  results,
}: {
  swaps: Array<{ slotPosition: string; fromSkuName: string | null; toSkuName: string }>;
  dispatchedAt?: string | null;
  completedAt?: string | null;
  results?: SwapResult[] | null;
}) {
  if (!swaps?.length && !results?.length) return null;
  const dispatched = Boolean(dispatchedAt);
  const completed = Boolean(completedAt);
  const dispatchedAge = dispatched && !completed && dispatchedAt
    ? Math.round((Date.now() - new Date(dispatchedAt).getTime()) / 1000)
    : null;
  const failedResults = results?.filter((r) => !r.ok) ?? [];

  // Estado: completou tudo (sem falhas, sem pendentes)
  if (completed && swaps.length === 0 && failedResults.length === 0) {
    return (
      <div className="my-2 rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3">
        <strong className="text-sm text-emerald-900">✅ Vendtef sincronizado</strong>
        <p className="mt-1 text-[11px] text-emerald-800/85">
          Scraper aplicou todos os swaps no Vendtef. Banco e Vendtef batem.
          {results && ` (${results.length} slot${results.length > 1 ? 's' : ''})`}
        </p>
      </div>
    );
  }

  // Estado: rodando (dispatched mas não completou)
  if (dispatched && !completed) {
    return (
      <div className="my-2 rounded-lg border-2 border-blue-300 bg-blue-50 p-3">
        <div className="flex items-baseline gap-2">
          <strong className="text-sm text-blue-900">🤖 Sincronizando Vendtef…</strong>
          <span className="text-[10px] text-blue-800/70">há {dispatchedAge}s</span>
        </div>
        <p className="mt-1 text-[11px] text-blue-800/85">
          Scraper rodando em GitHub Actions. {swaps.length} slot{swaps.length > 1 ? 's' : ''} a ajustar (~30-60s cada).
          Recarrega a página em 1-2 minutos pra ver o status final.
        </p>
        <ul className="mt-1 space-y-0.5 text-[10px] text-blue-700/75">
          {swaps.map((s) => (
            <li key={s.slotPosition}>· slot {s.slotPosition.padStart(2, '0')}: {s.fromSkuName ?? '—'} → {s.toSkuName}</li>
          ))}
        </ul>
      </div>
    );
  }

  // Estado: pendente (sem dispatch ainda — caso legado ou falha do dispatch)
  return (
    <div className="my-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
      <div className="mb-1.5 flex items-baseline gap-2">
        <strong className="text-sm text-amber-900">🔧 Ajuste no Vendtef pendente</strong>
        <span className="text-[10px] text-amber-800/70">({swaps.length} slot{swaps.length > 1 ? 's' : ''})</span>
      </div>
      <p className="mb-2 text-[11px] text-amber-900/80">
        O banco tá atualizado, mas o Vendtef ainda tem o produto antigo cadastrado.
        {failedResults.length > 0 && (
          <span className="ml-1 font-semibold text-rose-700">⚠️ Scraper anterior falhou — ajuste manual ou re-dispare.</span>
        )}
      </p>
      <ul className="space-y-1 text-[11px] text-amber-900/90">
        {swaps.map((s) => {
          const failed = failedResults.find((r) => r.slotPosition === s.slotPosition);
          return (
            <li key={s.slotPosition} className="flex items-baseline gap-2 rounded bg-white/60 px-2 py-1">
              <span className="font-mono font-bold text-amber-900">slot {s.slotPosition.padStart(2, '0')}</span>
              <span className="text-amber-700/70">de</span>
              <span className="italic">{s.fromSkuName ?? '—'}</span>
              <span className="text-amber-700/70">→</span>
              <span className="font-semibold">{s.toSkuName}</span>
              {failed && <span className="ml-2 text-[9px] text-rose-700">✗ {failed.error?.slice(0, 60)}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HistoryCard({ d }: { d: Decision }) {
  const data = (d.data ?? {}) as {
    pendingVendtefSwaps?: Array<{ slotPosition: string; fromSkuName: string | null; toSkuName: string }>;
    slotSwapDispatchedAt?: string;
    slotSwapCompletedAt?: string;
    slotSwapResults?: SwapResult[];
  };
  const hasSwapInfo =
    (data.pendingVendtefSwaps && data.pendingVendtefSwaps.length > 0) ||
    data.slotSwapDispatchedAt ||
    data.slotSwapResults;
  return (
    <article className="rounded border border-navy/10 bg-white p-3 text-xs">
      <DecisionHeader d={d} />
      <div className="mt-1 text-navy/85">{d.summary}</div>
      {d.rejectReason && <div className="mt-1 text-rose-700/70">motivo: {d.rejectReason}</div>}
      {d.status === 'EXECUTED' && hasSwapInfo && (
        <VendtefSwapsAlert
          swaps={data.pendingVendtefSwaps ?? []}
          dispatchedAt={data.slotSwapDispatchedAt}
          completedAt={data.slotSwapCompletedAt}
          results={data.slotSwapResults}
        />
      )}
    </article>
  );
}
