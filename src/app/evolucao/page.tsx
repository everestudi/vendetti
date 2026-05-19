import Link from 'next/link';
import { SPRINTS, SprintProgress } from '@/components/SprintProgress';
import { IdeasBox } from '@/components/IdeasBox';

export const dynamic = 'force-dynamic';

export default function EvolucaoPage() {
  const totalItems = SPRINTS.reduce((s, sp) => s + sp.items.length, 0);
  const doneItems = SPRINTS.reduce((s, sp) => s + sp.items.filter((i) => i.done).length, 0);
  const pct = Math.round((doneItems / totalItems) * 100);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-10">
        <h1 className="text-4xl font-bold text-navy">Evolução do projeto</h1>
        <p className="mt-2 text-navy/65">
          {SPRINTS.length} sprints — {doneItems}/{totalItems} entregues ({pct}%). Atualizado conforme o
          código avança.
        </p>
        <div className="mt-3 h-2 max-w-xl overflow-hidden rounded-full bg-navy/10">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400"
            style={{ width: `${pct}%` }}
          />
        </div>
      </header>

      {/* Estado atual resumido */}
      <section className="mb-12 rounded-2xl border border-navy/10 bg-navy-50/30 p-6">
        <h2 className="text-xl font-bold text-navy">Estado atual · o que tá funcionando</h2>
        <ul className="mt-3 grid gap-2 text-sm text-navy/85 md:grid-cols-2">
          <li>
            ✅ <strong>Bruno · NF-e end-to-end</strong>: upload foto/PDF → parse Vision → match SKU →
            confirma na UI → scraper sincroniza Vendtef (cadastra produto + vincula Everest + entrada
            estoque) automaticamente.
          </li>
          <li>
            ✅ <strong>Rita · Reposição Weverton</strong>: WhatsApp grupo Op → parser → LLM review
            (Haiku) detecta slot-swap/alias/variantes → Decision PENDING com editor inline → scraper
            faz swap + abastecimento.
          </li>
          <li>
            ✅ <strong>Lúcia · SAC + Inquiries</strong>: state machine 4-msgs, classifier Haiku
            (SAC/locação/estacionamento), match com Transaction, escalation pro Luís com tudo
            organizado.
          </li>
          <li>
            ✅ <strong>Mara · Scrape diário</strong>: 1481+ transações + cancelamentos + snapshot
            inventário + estoque Everest. Cron 04h BRT. Pode forçar via botão na home.
          </li>
          <li>
            ✅ <strong>Augusto · Chat CEO</strong>: 10+ tools, decision log, history persistente,
            execução automática de Decisions APPROVED via GH Actions.
          </li>
          <li>
            ✅ <strong>Zelda · Auditoria autônoma</strong>: monitora correções de match do Luís, gera
            findings via Haiku com prompt pronto, manda WhatsApp quando há.
          </li>
          <li>
            ✅ <strong>Dashboard operacional</strong>: faturamento mês-a-mês + última sync +
            pendências por departamento na home.
          </li>
          <li>
            ✅ <strong>Observabilidade</strong>: /webhooks debug, AgentTerminal por agente,
            ScraperLiveStatus em /bruno.
          </li>
        </ul>
        <p className="mt-4 text-xs text-navy/55">
          Roadmap completo (P0–P5) em{' '}
          <code className="rounded bg-white px-1 py-0.5">ROADMAP.md</code> no repo. Cada agente IA tem README
          em <code className="rounded bg-white px-1 py-0.5">docs/agents/</code>.
        </p>
      </section>

      {/* Sprints */}
      <section className="mb-12">
        <header className="mb-4">
          <h2 className="text-2xl font-bold text-navy">Sprints</h2>
          <p className="text-sm text-navy/60">Trabalho organizado em fases — verde = entregue.</p>
        </header>
        <SprintProgress />
      </section>

      {/* Ideias */}
      <IdeasBox />

      <footer className="mt-12 text-center text-xs text-navy/40">
        Inspirado no{' '}
        <Link href="/sobre" className="underline hover:text-navy">
          Project Vend
        </Link>{' '}
        (Anthropic) · open source em{' '}
        <a
          href="https://github.com/everestudi/vendetti"
          className="underline hover:text-navy"
        >
          github.com/everestudi/vendetti
        </a>
      </footer>
    </main>
  );
}
