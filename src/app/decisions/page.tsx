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
}

const LLM_ACTION_BADGE: Record<string, { cls: string; emoji: string; label: string }> = {
  abastecer_only: { cls: 'bg-emerald-100 text-emerald-800', emoji: '✓', label: 'só abastecer' },
  product_swap: { cls: 'bg-amber-100 text-amber-800', emoji: '🔄', label: 'trocar produto' },
  slot_swap_with: { cls: 'bg-purple-100 text-purple-800', emoji: '↔️', label: 'slot invertido' },
  create_new: { cls: 'bg-blue-100 text-blue-800', emoji: '🆕', label: 'cadastrar novo' },
  human_review: { cls: 'bg-rose-100 text-rose-800', emoji: '🙋', label: 'precisa decisão' },
};

function PendingCard({ d, skus, categories }: { d: Decision; skus: SkuLike[]; categories: string[] }) {
  const data = (d.data ?? {}) as { source?: string; items?: WevertonItem[] };
  const isWeverton = d.kind === 'SYSTEM_INVENTORY_SYNC' && data.source === 'weverton-group';
  const items = isWeverton && Array.isArray(data.items) ? data.items : [];

  return (
    <article className="rounded-lg border border-amber-200 bg-amber-50/30 p-4">
      <DecisionHeader d={d} />
      <h3 className="mt-2 font-semibold text-navy">{d.summary}</h3>
      <p className="mt-1 whitespace-pre-wrap text-xs text-navy/70">{d.rationale}</p>

      {/* Editor de items (só pra Decisions Weverton) */}
      {isWeverton && items.length > 0 && (
        <form action={updateDecisionItems.bind(null, d.id)} className="mt-4 rounded border border-amber-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-navy/60">
              Revisar items ({items.length} slots)
            </h4>
            <button
              type="submit"
              className="rounded border border-navy/20 px-2 py-0.5 text-[11px] font-medium text-navy hover:bg-navy/5"
            >
              💾 Atualizar
            </button>
          </div>
          <p className="mb-3 text-[10px] text-navy/55">
            ⚠️ Para slots onde o Weverton trocou de produto: preencha "produto alvo" com o nome novo. O sistema te avisa se o produto já existe (vai usar) ou se é novo (precisa preencher custo + categoria pra cadastrar no Vendtef).
            Marque "skip" pra pular um slot sem cancelar a Decision inteira.
          </p>
          <div className="space-y-2">
            {items.map((it, i) => {
              const confidence = it.matchConfidence ?? 'no-slot';
              const confCls =
                confidence === 'high' ? 'bg-emerald-50 text-emerald-700' :
                confidence === 'mid' ? 'bg-amber-50 text-amber-700' :
                'bg-rose-50 text-rose-700';
              const defaultTarget = it.targetProduct ?? (confidence === 'low' ? (it.productGuess ?? '') : '');
              const skuMatch = defaultTarget ? matchSku(defaultTarget, skus) : null;
              const isNew = defaultTarget && (!skuMatch || skuMatch.confidence === 'none' || skuMatch.confidence === 'low');
              const willSwap = defaultTarget && !it.skip;
              const llm = it.llmReview;
              const llmBadge = llm ? LLM_ACTION_BADGE[llm.recommendedAction] : null;
              return (
                <div key={i} className={`rounded border ${it.skip ? 'border-navy/10 bg-navy/5 opacity-50' : willSwap ? 'border-amber-300 bg-amber-50/40' : 'border-navy/15 bg-white'} p-2`}>
                  {/* 🤖 LLM review banner (quando houve análise da Haiku) */}
                  {llm && llmBadge && (
                    <div className={`mb-2 rounded px-2 py-1 text-[11px] ${llmBadge.cls}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <strong>
                          {llmBadge.emoji} 🤖 {llmBadge.label}
                          {' '}
                          <span className="font-mono text-[10px] opacity-70">({llm.confidence}%)</span>
                        </strong>
                        {llm.swapWithSlot && (
                          <span className="font-mono text-[10px]">com slot {llm.swapWithSlot}</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10px] opacity-90">{llm.reasoning}</div>
                      {llm.targetSkuName && (
                        <div className="mt-0.5 text-[10px]">
                          → sugere: <strong>{llm.targetSkuName}</strong>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-12 items-center gap-2 text-[11px]">
                    <div className="col-span-1 font-mono text-base font-semibold text-navy">{it.slotPosition?.padStart(2, '0')}</div>
                    <div className="col-span-3 text-navy/70">
                      <div className="text-[10px] text-navy/45">no Vendtef hoje:</div>
                      <div className="truncate" title={it.slotProduct ?? ''}>{it.slotProduct ?? '—'}</div>
                    </div>
                    <div className="col-span-3 text-navy/70">
                      <div className="text-[10px] text-navy/45">Weverton mandou:</div>
                      <div className="truncate" title={it.productGuess ?? ''}>{it.productGuess ?? '?'}</div>
                    </div>
                    <div className="col-span-1">
                      <label className="block text-[10px] text-navy/45">qty</label>
                      <input
                        type="number"
                        name={`qty_${i}`}
                        defaultValue={it.qty}
                        min={0}
                        className="w-full rounded border border-navy/20 px-1 py-0.5 text-right font-mono"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-[10px] text-navy/45">produto alvo (digite ou escolha do catálogo)</label>
                      <input
                        type="text"
                        name={`target_${i}`}
                        defaultValue={defaultTarget}
                        list={`skus-${d.id}`}
                        placeholder={confidence === 'high' ? 'sem troca · ou escolha do catálogo' : it.productGuess ?? ''}
                        className="w-full rounded border border-navy/20 px-1 py-0.5"
                      />
                    </div>
                    <div className="col-span-1 flex flex-col items-end gap-1">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${confCls}`}>{confidence}</span>
                      <label className="flex items-center gap-1 text-[10px] text-navy/55">
                        <input type="checkbox" name={`skip_${i}`} defaultChecked={it.skip} /> skip
                      </label>
                    </div>
                  </div>

                  {/* Status do produto-alvo: existe ou é novo? */}
                  {willSwap && (
                    <div className="mt-2 rounded border border-navy/10 bg-white/80 p-2 text-[11px]">
                      {skuMatch?.match && skuMatch.confidence !== 'low' && skuMatch.confidence !== 'none' ? (
                        <div className="text-emerald-700">
                          ✓ Vai usar produto existente:{' '}
                          <strong>{skuMatch.match.name}</strong>{' '}
                          <span className="text-emerald-700/60">(match {skuMatch.score}%, categoria: {skuMatch.match.category})</span>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="text-amber-800">
                            🆕 <strong>"{defaultTarget}"</strong> não tá no catálogo. Vai ser cadastrado no Vendtef.
                            {skuMatch?.match && (
                              <span className="ml-1 text-navy/55">
                                (mais próximo: "{skuMatch.match.name}" {skuMatch.score}% — se for esse, ajuste o nome acima)
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            <div>
                              <label className="block text-[10px] text-navy/55">custo unit (R$)</label>
                              <input
                                type="number"
                                step="0.01"
                                name={`new_cost_${i}`}
                                defaultValue={it.newProductData?.cost?.toString() ?? ''}
                                placeholder="0,00"
                                className="w-full rounded border border-amber-300 px-1 py-0.5"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-navy/55">categoria</label>
                              <input
                                type="text"
                                name={`new_category_${i}`}
                                defaultValue={it.newProductData?.category ?? ''}
                                list={`cats-${d.id}`}
                                placeholder="ex: bebida, barrinha"
                                className="w-full rounded border border-amber-300 px-1 py-0.5"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-navy/55">fornecedor</label>
                              <select
                                name={`new_supplier_${i}`}
                                defaultValue={it.newProductData?.supplier ?? 'ATACADAO'}
                                className="w-full rounded border border-amber-300 px-1 py-0.5"
                              >
                                <option value="ATACADAO">Atacadão</option>
                                <option value="VITTAL">Vittal</option>
                                <option value="OUTRO">Outro</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] text-navy/55" title="Pula se Bruno já lançou NF-e desse produto. Caso contrário scraper lança entrada de estoque no Everest com a qty informada (=qty da reposição é o default)">
                                entrada Everest (qty)
                              </label>
                              <input
                                type="number"
                                name={`new_entrada_qty_${i}`}
                                defaultValue={it.newProductData?.entradaEstoqueQty?.toString() ?? ''}
                                placeholder={`vazio = pula · ${it.qty ?? 1} sugerido`}
                                min={0}
                                className="w-full rounded border border-amber-300 px-1 py-0.5"
                              />
                            </div>
                          </div>
                          <p className="mt-1 text-[10px] text-navy/55">
                            ℹ️ <strong>entrada Everest:</strong> deixa vazio se Bruno já cadastrou esse produto via NF-e. Senão preenche com a qty que tá disponível pra abastecer (scraper cria entrada de estoque no Everest antes de tentar abastecer a máquina, evita "produto sem estoque").
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <datalist id={`cats-${d.id}`}>
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
          {/* Datalist global de SKUs do catálogo — usado nos inputs target_${i} */}
          <datalist id={`skus-${d.id}`}>
            {skus.map((s) => <option key={s.id} value={s.name} />)}
          </datalist>
        </form>
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

function HistoryCard({ d }: { d: Decision }) {
  return (
    <article className="rounded border border-navy/10 bg-white p-3 text-xs">
      <DecisionHeader d={d} />
      <div className="mt-1 text-navy/85">{d.summary}</div>
      {d.rejectReason && <div className="mt-1 text-rose-700/70">motivo: {d.rejectReason}</div>}
    </article>
  );
}
