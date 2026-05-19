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
    title: 'Sprint 2 · Scrapers Vendtef',
    subtitle: 'Login + SSO + UI navegação',
    items: [
      { label: 'Login + SSO entre 3 portais (ERP, VendTEF, PayBlu)', done: true },
      { label: 'Modal Seleções (36 slots mapeados)', done: true },
      { label: 'update-slot em produção (preço + capacidade)', done: true },
      { label: 'GitHub Actions roda Playwright em CI', done: true },
      { label: 'Auto fresh-login se session ausente', done: true },
      { label: 'configurarProdutoNoEstoque (modal Bootstrap)', done: true },
    ],
  },
  {
    id: 'mara',
    title: 'Sprint 3 · Mara — Analista',
    subtitle: 'ETL + analytics + Everest',
    items: [
      { label: 'Extract slots + SKUs + snapshot diário', done: true },
      { label: 'Load Postgres com UPSERT', done: true },
      { label: 'Analytics (margem buckets, faturamento, cancelamentos)', done: true },
      { label: 'Página /mara dashboard', done: true },
      { label: '1481+ transações importadas (6 chunks de 30d)', done: true },
      { label: 'Cancelamentos (128 em 3 meses)', done: true },
      { label: 'Scrape Estoque Everest (limits + saldo via Acompanhamento)', done: true },
      { label: 'Cron diário 04h BRT (GH Action)', done: true },
    ],
  },
  {
    id: 'bruno',
    title: 'Sprint 4 · Bruno — Compras',
    subtitle: 'NF-e + sync Vendtef',
    items: [
      { label: 'Upload foto/PDF NF-e → parse Vision Opus 4.7', done: true },
      { label: 'Fuzzy match SKUs (F1 + noise filter + discriminators)', done: true },
      { label: '/bruno/nova UI com confirmação manual', done: true },
      { label: 'Rateio Assaí proporcional', done: true },
      { label: 'GH Action vendtef-sync (scraper)', done: true },
      { label: 'Cadastra produto novo no Vendtef se ausente', done: true },
      { label: 'Vincula no Estoque Everest (max/alerta/crítico)', done: true },
      { label: 'Painel ScraperLiveStatus em /bruno', done: true },
    ],
  },
  {
    id: 'comms',
    title: 'Sprint 5 · Comunicação',
    subtitle: 'Z-API in + out',
    items: [
      { label: 'Z-API outbound (sendText + grupo)', done: true },
      { label: 'Webhook inbound /api/webhook/zapi', done: true },
      { label: 'Allowlist 3 tiers (admin/SAC/silêncio)', done: true },
      { label: 'Audio transcribe via Whisper', done: true },
      { label: 'Roteamento por contexto (admin/SAC/inquiry/grupo Op)', done: true },
      { label: 'Página /webhooks debug com diag', done: true },
      { label: 'Resend deliverability (email)', done: false },
    ],
  },
  {
    id: 'vendetti',
    title: 'Sprint 6 · Augusto Vendetti — CEO',
    subtitle: 'Chat + tools + decisões',
    items: [
      { label: 'System prompt + 10+ tools registradas', done: true },
      { label: '/api/chat streaming (Vercel AI SDK)', done: true },
      { label: 'UI /chat com history persistente + tool calls visíveis', done: true },
      { label: 'Decision log gravando no DB com level 🟢🟡🔴', done: true },
      { label: 'Página /decisions (approve/reject/execute)', done: true },
      { label: 'Executor automático (Decision APPROVED → scraper GH Action)', done: true },
      { label: 'Tools de observabilidade: infra_health, mara_force_sync', done: true },
      { label: 'AgentTerminal por agente (log ao vivo)', done: true },
    ],
  },
  {
    id: 'lucia',
    title: 'Sprint 7 · Lúcia — Atendimento',
    subtitle: 'SAC + Inquiries via WhatsApp',
    items: [
      { label: 'State machine SAC (max 4 msgs antes de escalar)', done: true },
      { label: 'Classifier Haiku 4.5 (SAC vs locação vs estacionamento)', done: true },
      { label: 'Match com Transaction (cruza print do cliente com vendas)', done: true },
      { label: 'Cmds admin WhatsApp (/listar /assumir /aprovar /dispensar)', done: true },
      { label: 'UI /sac (status, decisão de reembolso 1-click)', done: true },
      { label: 'Inquiry pra não-SAC (locação, geral) com state separada', done: true },
      { label: 'API /api/inquiries pra Portal Bluemall futuro', done: true },
    ],
  },
  {
    id: 'rita',
    title: 'Sprint 8 · Rita — Operações',
    subtitle: 'Reposição Weverton + Vendtef sync',
    items: [
      { label: 'Webhook do grupo Op (parser msg Weverton multi-linha)', done: true },
      { label: 'Decision PENDING com items + match F1', done: true },
      { label: 'LLM review pós-F1 (Haiku, detecta slot-swap/alias/variantes)', done: true },
      { label: 'Editor inline em /decisions (qty, target, custo, categoria)', done: true },
      { label: 'Scraper abastecimento (cadastra + configura + swap + abastece)', done: true },
      { label: 'Slot swap with: troca pid dos DOIS slots quando inversão detectada', done: true },
      { label: 'Entrada Everest single-product (caso edge sem Bruno)', done: true },
      { label: 'Reposicao + Slot.currentQty no DB pós-execução', done: true },
    ],
  },
  {
    id: 'zelda',
    title: 'Sprint 9 · Zelda — Oversight',
    subtitle: 'Auditoria autônoma + auto-melhoria',
    items: [
      { label: 'Captura match_correction events (Bruno UI + scraper)', done: true },
      { label: 'Audit autônomo via Claude Haiku', done: true },
      { label: 'Findings com action + prompt-pronto-pra-Augusto', done: true },
      { label: 'Auto-trigger pós-confirm Bruno + fim do scraper', done: true },
      { label: 'WhatsApp pro Luís em qualquer finding nova', done: true },
      { label: 'Dedup findings (não notifica 2x mesmo fix)', done: true },
      { label: 'Página /equipe/zelda com findings + correções recentes', done: true },
      { label: 'Auditoria de scraper failures (próximo)', done: false },
      { label: 'Auditoria de decisions rejected (próximo)', done: false },
    ],
  },
  {
    id: 'dashboard',
    title: 'Sprint 10 · Observabilidade + Dashboard',
    subtitle: 'Visibilidade total',
    items: [
      { label: 'Home dashboard (faturamento + última sync + pendências)', done: true },
      { label: 'Botão "Sincronizar agora" force mara-sync', done: true },
      { label: 'Pendências por departamento coloridas por urgência', done: true },
      { label: 'Badge Everest no quadro da máquina (qty saldo)', done: true },
      { label: 'AgentTerminal poll 5s por agente', done: true },
      { label: '/webhooks debug com match-diag por hit Z-API', done: true },
      { label: 'Página /estoque analítica (próximo)', done: false },
      { label: 'Timeline unificada de eventos cross-agent (próximo)', done: false },
    ],
  },
  {
    id: 'future',
    title: 'Próximos passos',
    subtitle: 'roadmap aberto',
    items: [
      { label: '📷 Câmera ESP32-CAM (audit visual + foto de reclamação)', done: false },
      { label: 'Tools Augusto: everest_stock + restock_proposal', done: false },
      { label: 'Augusto proativo: avisar quando comprar (estoque crítico + vendas)', done: false },
      { label: 'Cron daily safety net pra Zelda audit', done: false },
      { label: 'Resumo semanal automático pro Luís (WhatsApp domingo)', done: false },
      { label: 'Multi-máquina (escalar pra outras vending)', done: false },
      { label: 'Reorganização src/domains/ (P0 ROADMAP)', done: false },
      { label: 'READMEs por agente (template + rita exemplo OK)', done: false },
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
