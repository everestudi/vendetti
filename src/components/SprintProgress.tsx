/**
 * Lista de sprints com barra de progresso + checklist de itens.
 * Estado vem hardcoded — atualizar conforme o roadmap evolui.
 */

export interface SprintItem {
  label: string;
  done: boolean;
}

export interface Sprint {
  id: string;
  title: string;
  subtitle?: string;
  items: SprintItem[];
}

export const SPRINTS: Sprint[] = [
  {
    id: 'foundation',
    title: 'Sprint 1 · Foundation',
    subtitle: 'repo, infra, auth, secrets',
    items: [
      { label: 'Repo Next 16 + TS + Tailwind v4', done: true },
      { label: 'Prisma 7 + Neon serverless', done: true },
      { label: 'Auth bootstrap (HMAC + cookie)', done: true },
      { label: '/settings cifrado AES-256-GCM', done: true },
      { label: 'Setup script (npm run setup)', done: true },
    ],
  },
  {
    id: 'scrapers',
    title: 'Sprint 2 · Scrapers',
    subtitle: 'Vendpago + Vendtef + PayBlu',
    items: [
      { label: 'Login + SSO entre os 3 portais', done: true },
      { label: 'Crawl 20 URLs (mapa do site)', done: true },
      { label: 'Modal Seleções (36 slots mapeados)', done: true },
      { label: 'update-slot em produção (5 capacidades ✓)', done: true },
      { label: 'Pipeline cron diário (worker dedicado)', done: false },
    ],
  },
  {
    id: 'mara',
    title: 'Sprint 3 · Mara — Analista',
    subtitle: 'ETL extract → load → analytics',
    items: [
      { label: 'Extract Vendtef (slots + SKUs + snapshot)', done: true },
      { label: 'Load Postgres com UPSERT', done: true },
      { label: 'Analytics (margem buckets, snapshot, faturamento)', done: true },
      { label: 'Página /mara dashboard', done: true },
      { label: 'Ingestão de vendas históricas (1417 trx em 6 chunks)', done: true },
      { label: 'Ingestão de cancelamentos (128 em 3 meses)', done: true },
      { label: 'Cron diário 7h automatizado', done: false },
    ],
  },
  {
    id: 'comms',
    title: 'Sprint 4 · Comunicação',
    subtitle: 'Z-API + Email',
    items: [
      { label: 'Z-API outbound (sendText + grupo)', done: true },
      { label: 'Allowlist 3 tiers (admin/SAC/silêncio)', done: true },
      { label: 'Primeira msg pro Luís entregue ✓', done: true },
      { label: 'Z-API webhook inbound (Weverton confirma físico)', done: false },
      { label: 'Resend deliverability test (verificar domínio)', done: false },
      { label: 'Templates SAC scripted (Lúcia)', done: false },
    ],
  },
  {
    id: 'vendetti',
    title: 'Sprint 5 · Acordar o Vendetti',
    subtitle: 'Claude Agent SDK + chat + decisões',
    items: [
      { label: 'System prompt + 8 tools registradas', done: true },
      { label: '/api/chat streaming (Vercel AI SDK)', done: true },
      { label: 'UI /chat mobile-first com tool calls visíveis', done: true },
      { label: 'Decision log gravando no DB', done: true },
      { label: 'Tool vendetti_propose_slot_change → Decision', done: true },
      { label: 'Página /decisions (approve/reject/execute)', done: true },
      { label: 'Executor automático (Decision APPROVED → scraper)', done: true },
      { label: 'Vendetti executa preço com fluxo 2-pernas (sistema + grupo TCN)', done: true },
    ],
  },
  {
    id: 'team',
    title: 'Sprint 6 · Time completo',
    subtitle: 'Rita, Lúcia, Bruno, Zelda',
    items: [
      { label: 'Rita — visão da máquina em /equipe/rita', done: true },
      { label: 'Rita — tools de cadastro/swap/abastecimento Vendtef', done: false },
      { label: 'Lúcia — webhook SAC + state machine reclamação', done: false },
      { label: 'Bruno — pesquisa Atacadão online + comparativo Vittal', done: false },
      { label: 'Zelda — oversight integrado (policies.ts no agent loop)', done: false },
    ],
  },
  {
    id: 'future',
    title: 'Sprint 7 · Ideias futuras',
    subtitle: 'hardware + AI extra',
    items: [
      { label: '📷 Câmera ESP32-CAM dentro da máquina (audit visual + foto de reclamação + detecta produto preso)', done: false },
      { label: 'Filtro de data no extract de faturamento diário (hoje pega só mês corrente)', done: false },
      { label: 'Impressora térmica Brother QL pra etiquetas físicas (se elasticidade exigir)', done: false },
      { label: 'Multi-máquina (escalar pra outras vending)', done: false },
      { label: 'Análise semanal estratégica (sazonalidade, mix, A/B price)', done: false },
      { label: 'Dashboard público (mostrar pra parceiros sem login)', done: false },
    ],
  },
];

export function SprintProgress() {
  return (
    <div className="space-y-4">
      {SPRINTS.map((s) => {
        const done = s.items.filter((i) => i.done).length;
        const total = s.items.length;
        const pct = (done / total) * 100;
        const fullyDone = done === total;
        const fresh = done === 0;
        return (
          <article key={s.id} className="rounded-lg border border-navy/10 bg-white p-4">
            <header className="mb-2 flex items-baseline justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-navy">
                  {s.title} {fullyDone && '✓'}
                </h3>
                {s.subtitle && <p className="text-xs text-navy/50">{s.subtitle}</p>}
              </div>
              <span className={`text-sm font-bold ${fullyDone ? 'text-emerald-700' : fresh ? 'text-navy/40' : 'text-navy/70'}`}>
                {done}/{total}
              </span>
            </header>

            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-navy-50">
              <div
                className={`h-full transition-all ${fullyDone ? 'bg-emerald-500' : pct > 0 ? 'bg-gold' : 'bg-navy/15'}`}
                style={{ width: `${pct}%` }}
              />
            </div>

            <ul className="space-y-1">
              {s.items.map((item) => (
                <li
                  key={item.label}
                  className={`flex items-start gap-2 text-xs ${item.done ? 'text-navy/70' : 'text-navy/45'}`}
                >
                  <span className={`mt-0.5 inline-block h-3 w-3 shrink-0 rounded-sm border ${item.done ? 'border-emerald-500 bg-emerald-500' : 'border-navy/20 bg-white'}`}>
                    {item.done && (
                      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="white" strokeWidth="2">
                        <path d="M2 6l3 3 5-6" />
                      </svg>
                    )}
                  </span>
                  <span className={item.done ? 'line-through decoration-navy/20' : ''}>{item.label}</span>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}
