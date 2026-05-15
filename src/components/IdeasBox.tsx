import { prisma } from '@/lib/db';
import { addIdea, resolveIdea, reopenIdea, deleteIdea } from './IdeasBox.actions';

export async function IdeasBox() {
  const [newIdeas, resolved] = await Promise.all([
    prisma.idea.findMany({ where: { status: 'NEW' }, orderBy: { createdAt: 'desc' } }),
    prisma.idea.findMany({ where: { status: 'RESOLVED' }, orderBy: { resolvedAt: 'desc' }, take: 10 }),
  ]);

  return (
    <section className="mt-12">
      <header className="mb-4">
        <h2 className="text-2xl font-bold text-navy">💡 Caixa de ideias</h2>
        <p className="text-sm text-navy/60">
          Jogue tudo aqui enquanto pensa. Discutimos depois sem interromper o que tá rolando.
        </p>
      </header>

      <form action={addIdea} className="mb-4 space-y-2 rounded-lg border border-gold/30 bg-white p-4 shadow-sm">
        <textarea
          name="content"
          rows={2}
          required
          placeholder="ex: e se o Bruno também monitorasse promoções relâmpago no Atacadão?"
          className="w-full resize-none rounded border border-navy/20 px-3 py-2 text-sm focus:border-navy focus:outline-none"
        />
        <div className="flex justify-end">
          <button type="submit" className="rounded bg-navy px-4 py-1.5 text-xs font-semibold text-white hover:bg-navy-900">
            + Adicionar
          </button>
        </div>
      </form>

      {newIdeas.length === 0 ? (
        <div className="rounded border border-dashed border-navy/15 bg-white/50 p-4 text-center text-xs text-navy/45">
          🌱 caixa vazia
        </div>
      ) : (
        <ul className="space-y-2">
          {newIdeas.map((i) => (
            <li key={i.id} className="rounded-lg border border-navy/10 bg-white p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[10px] text-navy/40">
                  {new Date(i.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="font-mono text-[10px] text-navy/30">{i.id.slice(0, 8)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-navy/85">{i.content}</p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <form action={resolveIdea} className="flex flex-1 items-center gap-2">
                  <input type="hidden" name="id" value={i.id} />
                  <input
                    type="text"
                    name="note"
                    placeholder="resolução (opcional)"
                    className="flex-1 min-w-0 rounded border border-navy/20 px-2 py-0.5 text-xs"
                  />
                  <button className="shrink-0 rounded bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-emerald-700">
                    ✓
                  </button>
                </form>
                <form action={deleteIdea.bind(null, i.id)}>
                  <button className="rounded border border-navy/15 px-1.5 py-0.5 text-xs text-navy/50 hover:bg-navy-50">
                    🗑️
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-navy/55 hover:text-navy">
            Resolvidas ({resolved.length}) ▾
          </summary>
          <ul className="mt-2 space-y-1">
            {resolved.map((i) => (
              <li key={i.id} className="rounded border border-navy/5 bg-navy-50/30 px-3 py-1.5 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="line-through decoration-navy/30">{i.content}</p>
                  <form action={reopenIdea.bind(null, i.id)}>
                    <button className="shrink-0 text-[10px] text-navy/40 hover:text-navy">↩</button>
                  </form>
                </div>
                {i.note && <p className="mt-1 text-emerald-700/70 text-[11px]">→ {i.note}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
