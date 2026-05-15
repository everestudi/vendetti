import { prisma } from '@/lib/db';
import { addIdea, resolveIdea, reopenIdea, deleteIdea } from './actions';

export const dynamic = 'force-dynamic';

export default async function IdeasPage() {
  const [newIdeas, resolved] = await Promise.all([
    prisma.idea.findMany({ where: { status: 'NEW' }, orderBy: { createdAt: 'desc' } }),
    prisma.idea.findMany({ where: { status: 'RESOLVED' }, orderBy: { resolvedAt: 'desc' }, take: 20 }),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-navy">Ideias</h1>
        <p className="mt-1 text-sm text-navy/60">
          Jogue tudo aqui enquanto pensa. Discutimos depois sem interromper o que tá rolando.
        </p>
      </header>

      {/* Form rápido */}
      <form action={addIdea} className="mb-6 space-y-2 rounded-lg border border-gold/30 bg-white p-4 shadow-sm">
        <label className="text-xs font-semibold uppercase tracking-wide text-navy/60">Nova ideia</label>
        <textarea
          name="content"
          rows={3}
          required
          placeholder="ex: e se o Bruno também monitorasse promoções relâmpago no Atacadão?"
          className="w-full rounded border border-navy/20 px-3 py-2 text-base focus:border-navy focus:outline-none"
          autoFocus
        />
        <div className="flex justify-end">
          <button type="submit" className="rounded bg-navy px-5 py-2 text-sm font-semibold text-white hover:bg-navy-900">
            Adicionar
          </button>
        </div>
      </form>

      {/* Pendentes */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-navy">
          Pendentes <span className="text-navy/45">· {newIdeas.length}</span>
        </h2>
        {newIdeas.length === 0 ? (
          <div className="rounded border border-dashed border-navy/15 bg-white/50 p-6 text-center text-sm text-navy/45">
            🌱 caixa vazia — joga uma ideia aí em cima
          </div>
        ) : (
          <ul className="space-y-2">
            {newIdeas.map((i) => (
              <li key={i.id} className="rounded-lg border border-navy/10 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[10px] text-navy/40">
                    {new Date(i.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="font-mono text-[10px] text-navy/30">{i.id.slice(0, 8)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-navy/85">{i.content}</p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <form action={resolveIdea} className="flex flex-1 items-center gap-2">
                    <input type="hidden" name="id" value={i.id} />
                    <input
                      type="text"
                      name="note"
                      placeholder="resolução (opcional)"
                      className="flex-1 min-w-0 rounded border border-navy/20 px-2 py-1 text-xs"
                    />
                    <button className="shrink-0 rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700">
                      ✓ Resolver
                    </button>
                  </form>
                  <form action={deleteIdea.bind(null, i.id)}>
                    <button className="rounded border border-navy/15 px-2 py-1 text-xs text-navy/50 hover:bg-navy-50">
                      🗑️
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Resolvidas */}
      {resolved.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-navy/55">
            Resolvidas recentes <span className="text-navy/35">· {resolved.length}</span>
          </h2>
          <ul className="space-y-1.5">
            {resolved.map((i) => (
              <li key={i.id} className="rounded border border-navy/5 bg-navy-50/30 px-3 py-2 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="line-through decoration-navy/30">{i.content}</p>
                  <form action={reopenIdea.bind(null, i.id)}>
                    <button className="shrink-0 text-[10px] text-navy/40 hover:text-navy">↩</button>
                  </form>
                </div>
                {i.note && <p className="mt-1 text-emerald-700/70 text-[11px]">→ {i.note}</p>}
                <p className="mt-0.5 text-[10px] text-navy/30">
                  resolvida {i.resolvedAt && new Date(i.resolvedAt).toLocaleDateString('pt-BR')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
