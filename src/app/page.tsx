import Link from 'next/link';
import { listSecretStatus } from '@/lib/secrets';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const secrets = await listSecretStatus();
  const filled = secrets.filter((s) => s.filled).length;
  const total = secrets.length;
  const missing = secrets.filter((s) => !s.filled);
  const anthropicMissing = missing.some((s) => s.key === 'ANTHROPIC_API_KEY');

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold text-navy">Augusto Vendetti</h1>
      <p className="mt-1 text-navy/60">CEO autônomo · Blue Mall Rondon</p>

      {/* Card configuração */}
      <section className="mt-8 rounded-lg border border-gold/30 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-navy">Configuração</h2>
          <span className="text-sm text-navy/60">
            {filled} de {total} preenchidos
          </span>
        </div>

        {missing.length > 0 ? (
          <>
            <p className="mt-3 text-sm text-navy/70">
              {anthropicMissing ? (
                <>
                  <strong>Anthropic API key</strong> ainda não está configurada. Sem ela, o Augusto não consegue
                  raciocinar — comece por aí.
                </>
              ) : (
                <>Faltam preencher: {missing.map((s) => s.label).join(', ')}.</>
              )}
            </p>
            <Link
              href="/settings"
              className="mt-4 inline-block rounded bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-900"
            >
              Configurar →
            </Link>
          </>
        ) : (
          <p className="mt-3 text-sm text-emerald-700">Todos os secrets configurados ✓</p>
        )}
      </section>

      {/* Card próximos passos */}
      <section className="mt-6 rounded-lg border border-navy/10 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-navy">Próximos passos do MVP</h2>
        <ol className="mt-3 space-y-2 text-sm text-navy/80">
          <li>
            <span className="font-semibold">1.</span> Configurar Anthropic API key em{' '}
            <Link href="/settings" className="text-navy underline">/settings</Link>
          </li>
          <li>
            <span className="font-semibold">2.</span> Scraper Vendtef — login, inventário, vendas
          </li>
          <li>
            <span className="font-semibold">3.</span> Catálogo de SKUs seedado no banco
          </li>
          <li>
            <span className="font-semibold">4.</span> Primeiro tick diário do Augusto + email
          </li>
        </ol>
      </section>

      {/* Card decision log preview */}
      <section className="mt-6 rounded-lg border border-navy/10 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-navy">Decision log</h2>
        <p className="mt-2 text-sm text-navy/60">
          Augusto registra cada decisão (preço, reposição, slot) com nível 🟢🟡🔴, racional e status. Vai aparecer
          aqui assim que ele começar a operar.
        </p>
      </section>
    </main>
  );
}
