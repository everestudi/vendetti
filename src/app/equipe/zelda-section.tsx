/**
 * Seção dedicada da Zelda (oversight) em /equipe/zelda. Renderiza:
 *  - Stats últimas 7d (correções, audits, findings pendentes)
 *  - Correções de match recentes (entrada do ciclo de auditoria)
 *  - Findings da Zelda (Ideas geradas) com botão de copiar prompt
 *  - Botão "Analisar agora" (server action que chama Claude)
 */

import { prisma } from '@/lib/db';
import { runZeldaAudit } from './zelda-actions';

interface Correction {
  id: string;
  startedAt: Date;
  meta: Record<string, unknown> | null;
}

interface ZeldaFindingMeta {
  pattern: string;
  severity: 'sugestão' | 'importante' | 'crítico';
  hypothesis: string;
  suggestedFix: string;
  augustoPrompt: string;
}

const SEVERITY_CLS: Record<string, string> = {
  sugestão: 'bg-blue-50 text-blue-700 border-blue-200',
  importante: 'bg-amber-50 text-amber-700 border-amber-200',
  crítico: 'bg-rose-50 text-rose-700 border-rose-300',
};

export async function ZeldaSection() {
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const [corrections, audits, ideas, allFindings7d] = await Promise.all([
    prisma.workerRun.findMany({
      where: { name: 'match_correction', startedAt: { gte: since30d } },
      orderBy: { startedAt: 'desc' },
      take: 20,
    }) as Promise<Correction[]>,
    prisma.workerRun.findMany({
      where: { name: 'zelda_audit_matcher', startedAt: { gte: since30d } },
      orderBy: { startedAt: 'desc' },
      take: 5,
    }),
    // Ideas geradas pela Zelda — content começa com "[Zelda"
    prisma.idea.findMany({
      where: { content: { startsWith: '[Zelda' } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
    prisma.workerRun.count({
      where: { name: 'match_correction', startedAt: { gte: since7d } },
    }),
  ]);

  const findingsPending = ideas.filter((i) => i.status === 'NEW').length;

  return (
    <section className="mt-8 rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-white p-6">
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-xl font-bold text-navy">🔍 Sala da Zelda · Auditoria</h2>
          <p className="text-sm text-navy/60">
            Zelda observa todas as correções que você faz, identifica padrões com IA (Haiku) e propõe fixes.
            Você revisa e cola o prompt no chat do Augusto pra aplicar.
          </p>
        </div>
        <form action={runZeldaAudit}>
          <button
            type="submit"
            className="rounded-lg border border-amber-400 bg-amber-100 px-3 py-1.5 text-sm font-semibold text-amber-900 hover:bg-amber-200"
          >
            🔍 Analisar agora
          </button>
        </form>
      </header>

      <div className="mb-6 grid grid-cols-3 gap-3 text-center">
        <Stat label="correções (7d)" value={allFindings7d} cls="bg-white border-navy/15" />
        <Stat label="audits (30d)" value={audits.length} cls="bg-white border-navy/15" />
        <Stat label="findings pendentes" value={findingsPending} cls={findingsPending > 0 ? 'bg-amber-100 border-amber-300' : 'bg-white border-navy/15'} />
      </div>

      {/* Findings (Ideas geradas pela Zelda) */}
      <div className="mb-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy/55">
          Findings · propostas pra Augusto
        </h3>
        {ideas.length === 0 ? (
          <p className="rounded border border-navy/10 bg-white p-3 text-xs text-navy/55">
            Nenhuma análise ainda. Quando você corrigir matches, Zelda terá dados pra trabalhar — clica "Analisar agora".
          </p>
        ) : (
          <div className="space-y-2">
            {ideas.slice(0, 10).map((idea) => {
              let f: ZeldaFindingMeta | null = null;
              try {
                f = idea.note ? JSON.parse(idea.note) : null;
              } catch {
                f = null;
              }
              return (
                <FindingCard key={idea.id} idea={idea} finding={f} />
              );
            })}
          </div>
        )}
      </div>

      {/* Correções recentes */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy/55">
          Correções recentes · entrada do ciclo
        </h3>
        {corrections.length === 0 ? (
          <p className="rounded border border-navy/10 bg-white p-3 text-xs text-navy/55">
            Nenhuma correção registrada nos últimos 30 dias. Bom sinal — matcher tá acertando.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-navy/10 text-left text-navy/50">
                  <th className="py-1 pr-2">quando</th>
                  <th className="py-1 pr-2">contexto</th>
                  <th className="py-1 pr-2">input (NF-e/Weverton)</th>
                  <th className="py-1 pr-2">matcher sugeriu</th>
                  <th className="py-1 pr-2">Luís escolheu</th>
                  <th className="py-1 pr-2">tipo</th>
                </tr>
              </thead>
              <tbody>
                {corrections.map((c) => {
                  const m = (c.meta ?? {}) as Record<string, unknown>;
                  const ageMin = Math.round((Date.now() - c.startedAt.getTime()) / 60000);
                  const age = ageMin < 60 ? `${ageMin}min` : ageMin < 1440 ? `${Math.round(ageMin / 60)}h` : `${Math.round(ageMin / 1440)}d`;
                  return (
                    <tr key={c.id} className="border-b border-navy/5">
                      <td className="py-1 pr-2 text-navy/55">{age}</td>
                      <td className="py-1 pr-2 text-navy/65">{String(m.context ?? '?')}</td>
                      <td className="py-1 pr-2 max-w-[200px] truncate text-navy/85" title={String(m.inputText ?? '')}>
                        {String(m.inputText ?? '?').slice(0, 50)}
                      </td>
                      <td className="py-1 pr-2 text-navy/70">
                        {m.suggestedSkuName ? (
                          <span>
                            <span className="font-mono text-[10px] text-navy/45">{String(m.suggestedScore ?? '?')}%</span>{' '}
                            {String(m.suggestedSkuName).slice(0, 30)}
                          </span>
                        ) : (
                          <span className="text-navy/35 italic">nenhum</span>
                        )}
                      </td>
                      <td className="py-1 pr-2 text-navy/85">
                        {m.finalAction === 'new' ? (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">🆕 novo</span>
                        ) : m.actualSkuId ? (
                          <span className="font-mono text-[10px] text-navy/55">{String(m.actualSkuId).slice(-8)}</span>
                        ) : (
                          '?'
                        )}
                      </td>
                      <td className="py-1 pr-2 text-[10px] text-navy/45">
                        {String(m.correctionType ?? '?').replace(/_/g, ' ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-2xl font-bold text-navy">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-navy/50">{label}</div>
    </div>
  );
}

type IdeaRow = Awaited<ReturnType<typeof prisma.idea.findMany>>[number];

function FindingCard({ idea, finding }: { idea: IdeaRow; finding: ZeldaFindingMeta | null }) {
  if (!finding) {
    return (
      <article className="rounded-lg border border-navy/15 bg-white p-3 text-xs">
        <div className="whitespace-pre-wrap text-navy/75">{idea.content}</div>
      </article>
    );
  }
  const sevCls = SEVERITY_CLS[finding.severity] ?? SEVERITY_CLS.sugestão;
  const ageHr = Math.round((Date.now() - idea.createdAt.getTime()) / 3600000);
  return (
    <article className={`rounded-lg border p-3 text-xs ${sevCls}`}>
      <header className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold">{finding.severity}</span>
        <span className="text-navy/85 font-semibold">{finding.pattern}</span>
        <span className="ml-auto text-[10px] text-navy/45">{ageHr}h atrás · {idea.status}</span>
      </header>
      <div className="grid gap-2 text-[11px] text-navy/75">
        <div>
          <strong className="text-navy/55">hipótese:</strong> {finding.hypothesis}
        </div>
        <div>
          <strong className="text-navy/55">fix sugerido:</strong> {finding.suggestedFix}
        </div>
        <details className="mt-1">
          <summary className="cursor-pointer text-navy/65 hover:text-navy">
            prompt pro Augusto (clica e copia)
          </summary>
          <pre className="mt-1 select-all whitespace-pre-wrap rounded bg-navy/5 p-2 font-mono text-[10px] text-navy/85">
{finding.augustoPrompt}
          </pre>
        </details>
      </div>
    </article>
  );
}
