import Link from 'next/link';
import { TEAM, avatarUrl, type Agent } from '@/lib/agents/team';

export const dynamic = 'force-static';

const COLOR_RING: Record<Agent['color'], string> = {
  navy: 'ring-navy/30',
  gold: 'ring-gold/40',
  emerald: 'ring-emerald-400/40',
  rose: 'ring-rose-400/40',
  amber: 'ring-amber-400/40',
  sky: 'ring-sky-400/40',
};

export default function SobrePage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      {/* Header próprio (página pública — sem o Header global) */}
      <nav className="mb-8 flex items-center justify-between">
        <div className="font-bold text-navy">Vendetti</div>
        <a
          href="https://github.com/everestudi/vendetti"
          target="_blank"
          rel="noopener"
          className="text-xs text-navy/55 hover:text-navy"
        >
          ↗ código aberto no GitHub
        </a>
      </nav>

      {/* HERO */}
      <section className="mb-10">
        <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-gold">
          inspirado no Project Vend · Anthropic
        </div>
        <h1 className="text-4xl font-bold leading-tight text-navy lg:text-5xl">Vendetti · CEO IA</h1>
        <p className="mt-1 text-lg font-medium text-navy/75">
          Um time de 6 agentes Claude operando uma vending machine real.
        </p>
        <p className="mt-3 text-lg text-navy/70">
          Análise de dados, compras (com leitura de NF-e por foto), atendimento via WhatsApp, operações
          de campo (browser headless logando no ERP), oversight automático e orquestração — tudo
          rodando em produção numa máquina FLEX COMBO 6G no Blue Mall Rondon, Uberlândia.
        </p>
      </section>

      {/* COMO FUNCIONA TÉCNICAMENTE */}
      <section className="mb-12 space-y-3 text-base leading-relaxed text-navy/75">
        <h2 className="text-2xl font-bold text-navy">Como funciona</h2>
        <p>
          O caminho até aqui mistura várias técnicas. O sistema do fornecedor da máquina
          (Vendpago/Vendtef) não tem API pública — então a <strong className="text-navy">Mara</strong> e a{' '}
          <strong className="text-navy">Rita</strong> usam{' '}
          <strong className="text-navy">Playwright</strong> (browser headless rodando em GitHub Actions)
          pra logar no ERP, baixar relatórios de vendas/cancelamentos em CSV, preencher tabelas e dar
          entrada de estoque na pele de um humano.
        </p>
        <p>
          O <strong className="text-navy">Bruno</strong> lê NF-e em foto ou PDF usando o vision do Claude
          Opus 4.7: extrai fornecedor, itens, qty e custo, faz fuzzy match com SKUs já cadastrados (F1
          score com filtro de ruído + discriminadores), rateia desconto Assaí proporcionalmente e grava
          no banco. Depois, um GitHub Action disparado pelo Vercel sobe um runner com Playwright pra
          sincronizar a entrada no Vendtef — cadastrando produto novo se preciso — sem depender do meu
          Mac estar ligado.
        </p>
        <p>
          A <strong className="text-navy">Lúcia</strong> roda uma state machine de SAC ligada ao
          WhatsApp via <strong className="text-navy">Z-API</strong>: cliente reclama, ela classifica
          (SAC vs locação vs estacionamento vs geral) com Haiku 4.5, pede o print, pede o número do
          slot, e escala pra mim com tudo organizado em no máximo 4 mensagens. Outbound também sai por
          ali — alertas pro grupo &ldquo;Operação TCN Vending Machine&rdquo; e mensagens pro Weverton
          (zelador do Bluemall que abastece fisicamente).
        </p>
        <p>
          A <strong className="text-navy">Zelda</strong> faz auditoria autônoma: monitora correções de
          match que eu fiz, analisa via Haiku e propõe fixes concretos no algoritmo com prompt pronto
          pra colar no Augusto. Cada decisão é registrada num decision log com nível 🟢🟡🔴.
        </p>
        <p>
          <strong className="text-navy">Segurança:</strong> secrets cifrados AES-256-GCM no Postgres
          (Neon), session cookies HMAC-SHA256 via Web Crypto API. Open source em{' '}
          <a
            href="https://github.com/everestudi/vendetti"
            className="text-navy underline hover:text-gold"
          >
            github.com/everestudi/vendetti
          </a>
          .
        </p>
      </section>

      {/* O TIME */}
      <section className="mb-12">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="text-2xl font-bold text-navy">O time</h2>
          <Link href="/equipe" className="text-sm text-navy/60 hover:text-navy">
            ver detalhes →
          </Link>
        </header>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {TEAM.map((a) => (
            <Link
              key={a.id}
              href={`/equipe/${a.id}`}
              className="group flex flex-col items-center rounded-lg border border-navy/10 bg-white p-3 transition hover:-translate-y-1 hover:shadow-md"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarUrl(a, 80)}
                alt={a.name}
                width={64}
                height={64}
                className={`rounded-full ring-2 ${COLOR_RING[a.color]} transition group-hover:ring-4`}
              />
              <div className="mt-2 text-sm font-semibold text-navy">
                {a.id === 'vendetti' ? (a.fullName ?? a.name) : a.name}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-navy/50">
                {a.role.split(' · ')[0].split('/')[0].trim()}
              </div>
              {a.status === 'active' && <span className="mt-1 text-[10px] text-emerald-600">🟢 ativo</span>}
              {a.status === 'building' && <span className="mt-1 text-[10px] text-amber-600">🟡 em build</span>}
              {a.status === 'planned' && <span className="mt-1 text-[10px] text-navy/40">⚪ planejado</span>}
            </Link>
          ))}
        </div>
      </section>

      {/* INSPIRAÇÃO */}
      <section className="rounded-lg border border-gold/30 bg-gold-50 p-6">
        <h2 className="text-lg font-semibold text-navy">Inspiração — Project Vend Phase 2 (Anthropic)</h2>
        <p className="mt-2 text-sm text-navy/75">
          A Anthropic rodou um experimento onde o Claude operou uma vending machine no escritório deles
          ("Claudius"). Phase 1 deu prejuízo. Phase 2 acertou com modelo melhor (Sonnet 4.5),
          procedimentos forçados, e arquitetura de 3 camadas (agente + oversight + escalação humana).
          Vendetti aplica essas 3 lições desde o dia zero.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <a
            href="https://www.anthropic.com/research/project-vend-1"
            target="_blank"
            rel="noopener"
            className="rounded bg-navy/10 px-2 py-1 text-navy hover:bg-navy/20"
          >
            Phase 1 ↗
          </a>
          <a
            href="https://www.anthropic.com/research/project-vend-2"
            target="_blank"
            rel="noopener"
            className="rounded bg-navy/10 px-2 py-1 text-navy hover:bg-navy/20"
          >
            Phase 2 ↗
          </a>
        </div>
      </section>

      <footer className="mt-12 text-center text-xs text-navy/40">
        Operação física: Blue Mall Rondon, Uberlândia/MG · Operação remota: SP
      </footer>
    </main>
  );
}
