import Link from 'next/link';
import { TEAM, avatarUrl, type Agent } from '@/lib/agents/team';
import { VendingMachineLive, type SlotData } from '@/components/VendingMachineLive';

export const dynamic = 'force-static';

const COLOR_RING: Record<Agent['color'], string> = {
  navy: 'ring-navy/30',
  gold: 'ring-gold/40',
  emerald: 'ring-emerald-400/40',
  rose: 'ring-rose-400/40',
  amber: 'ring-amber-400/40',
  sky: 'ring-sky-400/40',
};

/** Slots mockados pra demo interativa — dados estáticos plausíveis, sem DB. */
const DEMO_SLOTS: SlotData[] = [
  { selecao: '11', productName: 'Mentos Kiss 35g Mint', productCode: '23456', price: 4.5, marginEst: 2.1, marginPct: 47, capacity: 5, currentQty: 3, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 75, everestStatus: 'ok', salesMonthQty: 14, salesMonthRevenue: 63, salesMonthCount: 14 },
  { selecao: '12', productName: 'Halls Verde Menta', productCode: '23457', price: 3.0, marginEst: 1.5, marginPct: 50, capacity: 5, currentQty: 5, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 100, everestStatus: 'ok', salesMonthQty: 9, salesMonthRevenue: 27, salesMonthCount: 9 },
  { selecao: '13', productName: 'Bala Fini Minhoca 80g', productCode: '23458', price: 5.0, marginEst: 1.8, marginPct: 36, capacity: 4, currentQty: 2, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 67, everestStatus: 'ok', salesMonthQty: 6, salesMonthRevenue: 30, salesMonthCount: 6 },
  { selecao: '14', productName: 'Barra Protein Crisp Ovomaltine', productCode: '23459', price: 7.5, marginEst: 3.0, marginPct: 40, capacity: 5, currentQty: 5, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 38, everestStatus: 'ok', salesMonthQty: 11, salesMonthRevenue: 82.5, salesMonthCount: 11 },
  { selecao: '15', productName: 'Barra FTW Delicious Leite', productCode: '23460', price: 6.5, marginEst: 2.5, marginPct: 38, capacity: 5, currentQty: 4, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 22, everestStatus: 'ok', salesMonthQty: 8, salesMonthRevenue: 52, salesMonthCount: 8 },
  { selecao: '16', productName: 'Barra Buenissimo Pistache', productCode: '23461', price: 7.0, marginEst: 2.8, marginPct: 40, capacity: 4, currentQty: 0, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 0, everestStatus: 'crítico', salesMonthQty: 5, salesMonthRevenue: 35, salesMonthCount: 5 },
  { selecao: '21', productName: 'Club Social Original 144g', productCode: '23462', price: 6.0, marginEst: 2.4, marginPct: 40, capacity: 5, currentQty: 5, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 67, everestStatus: 'ok', salesMonthQty: 12, salesMonthRevenue: 72, salesMonthCount: 12 },
  { selecao: '22', productName: 'Choc Bis Wafer Branco', productCode: '23463', price: 4.5, marginEst: 1.6, marginPct: 36, capacity: 5, currentQty: 3, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 24, everestStatus: 'ok', salesMonthQty: 7, salesMonthRevenue: 31.5, salesMonthCount: 7 },
  { selecao: '23', productName: 'Choc Bis Wafer Leite', productCode: '23464', price: 4.5, marginEst: 1.6, marginPct: 36, capacity: 5, currentQty: 1, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 0, everestStatus: 'crítico', salesMonthQty: 9, salesMonthRevenue: 40.5, salesMonthCount: 9 },
  { selecao: '24', productName: 'Bisc Marilan Teens 30g Choc', productCode: '23465', price: 3.5, marginEst: 1.2, marginPct: 34, capacity: 5, currentQty: 2, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 0, everestStatus: 'crítico', salesMonthQty: 4, salesMonthRevenue: 14, salesMonthCount: 4 },
  { selecao: '25', productName: 'Bear Mate Chá Mate 269ml', productCode: '23466', price: 5.5, marginEst: 2.0, marginPct: 36, capacity: 5, currentQty: 5, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 26, everestStatus: 'ok', salesMonthQty: 6, salesMonthRevenue: 33, salesMonthCount: 6 },
  { selecao: '26', productName: 'Castanha Caju Crocks 50g', productCode: '23467', price: 8.0, marginEst: 3.5, marginPct: 44, capacity: 4, currentQty: 4, qtdeAlerta: 1, qtdeCritico: 1, everestQty: 12, everestStatus: 'ok', salesMonthQty: 3, salesMonthRevenue: 24, salesMonthCount: 3 },
  { selecao: '33', productName: 'Água Crystal 500ml C Gás', productCode: '23468', price: 4.0, marginEst: 1.8, marginPct: 45, capacity: 6, currentQty: 4, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 48, everestStatus: 'ok', salesMonthQty: 18, salesMonthRevenue: 72, salesMonthCount: 18 },
  { selecao: '34', productName: 'Água Crystal 500ml C Gás', productCode: '23468', price: 4.0, marginEst: 1.8, marginPct: 45, capacity: 6, currentQty: 6, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 48, everestStatus: 'ok', salesMonthQty: 16, salesMonthRevenue: 64, salesMonthCount: 16 },
  { selecao: '35', productName: 'Água Crystal 500ml S Gás', productCode: '23469', price: 4.0, marginEst: 1.8, marginPct: 45, capacity: 6, currentQty: 5, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 36, everestStatus: 'ok', salesMonthQty: 22, salesMonthRevenue: 88, salesMonthCount: 22 },
  { selecao: '36', productName: 'Água Crystal 500ml S Gás', productCode: '23469', price: 4.0, marginEst: 1.8, marginPct: 45, capacity: 6, currentQty: 4, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 36, everestStatus: 'ok', salesMonthQty: 24, salesMonthRevenue: 96, salesMonthCount: 24 },
  { selecao: '41', productName: 'Powerade Mountain Blast', productCode: '23470', price: 7.0, marginEst: 2.8, marginPct: 40, capacity: 5, currentQty: 5, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 60, everestStatus: 'ok', salesMonthQty: 12, salesMonthRevenue: 84, salesMonthCount: 12 },
  { selecao: '42', productName: 'Powerade Frutas Tropicais', productCode: '23471', price: 7.0, marginEst: 2.8, marginPct: 40, capacity: 5, currentQty: 3, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 60, everestStatus: 'ok', salesMonthQty: 10, salesMonthRevenue: 70, salesMonthCount: 10 },
  { selecao: '43', productName: 'Red Bull Frutas Vermelhas', productCode: '23472', price: 12.0, marginEst: 4.5, marginPct: 37, capacity: 5, currentQty: 4, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 24, everestStatus: 'ok', salesMonthQty: 8, salesMonthRevenue: 96, salesMonthCount: 8 },
  { selecao: '44', productName: 'Red Bull Sugar Free 250ml', productCode: '23473', price: 12.0, marginEst: 4.8, marginPct: 40, capacity: 6, currentQty: 6, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 440, everestStatus: 'ok', salesMonthQty: 15, salesMonthRevenue: 180, salesMonthCount: 15 },
  { selecao: '45', productName: 'Red Bull 250ml', productCode: '23474', price: 12.0, marginEst: 4.5, marginPct: 37, capacity: 6, currentQty: 5, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 30, everestStatus: 'ok', salesMonthQty: 19, salesMonthRevenue: 228, salesMonthCount: 19 },
  { selecao: '46', productName: 'Red Bull Tropical 250ml', productCode: '23475', price: 12.0, marginEst: 4.5, marginPct: 37, capacity: 5, currentQty: 2, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 18, everestStatus: 'alerta', salesMonthQty: 6, salesMonthRevenue: 72, salesMonthCount: 6 },
  { selecao: '51', productName: 'Coca Cola 310ml', productCode: '23476', price: 5.5, marginEst: 2.3, marginPct: 42, capacity: 5, currentQty: 5, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 327, everestStatus: 'ok', salesMonthQty: 28, salesMonthRevenue: 154, salesMonthCount: 28 },
  { selecao: '52', productName: 'Coca Cola Zero 310ml', productCode: '23477', price: 5.5, marginEst: 2.3, marginPct: 42, capacity: 5, currentQty: 4, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 408, everestStatus: 'ok', salesMonthQty: 32, salesMonthRevenue: 176, salesMonthCount: 32 },
  { selecao: '53', productName: 'Coca Cola Zero 310ml', productCode: '23477', price: 5.5, marginEst: 2.3, marginPct: 42, capacity: 5, currentQty: 5, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 408, everestStatus: 'ok', salesMonthQty: 30, salesMonthRevenue: 165, salesMonthCount: 30 },
  { selecao: '54', productName: 'Coca Cola Lata 350ml', productCode: '23478', price: 6.0, marginEst: 2.5, marginPct: 42, capacity: 5, currentQty: 3, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 0, everestStatus: 'crítico', salesMonthQty: 14, salesMonthRevenue: 84, salesMonthCount: 14 },
  { selecao: '55', productName: 'Monster Pipeline Punch', productCode: '23479', price: 13.0, marginEst: 5.0, marginPct: 38, capacity: 4, currentQty: 0, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 0, everestStatus: 'crítico', salesMonthQty: 7, salesMonthRevenue: 91, salesMonthCount: 7 },
  { selecao: '56', productName: 'Monster Energy Watermelon 473ml', productCode: '23480', price: 13.0, marginEst: 5.2, marginPct: 40, capacity: 4, currentQty: 4, qtdeAlerta: 2, qtdeCritico: 1, everestQty: 8, everestStatus: 'ok', salesMonthQty: 3, salesMonthRevenue: 39, salesMonthCount: 3 },
];

export default function SobrePage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      {/* Header próprio */}
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
      <section className="mb-12">
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

      {/* ARQUITETURA · 3 CAMADAS */}
      <section className="mb-12 rounded-2xl border-2 border-navy/15 bg-white p-6">
        <h2 className="text-2xl font-bold text-navy">Arquitetura · 3 camadas</h2>
        <p className="mt-2 text-sm text-navy/65">
          Lição do Project Vend Phase 2 (Anthropic): agente sozinho falha. Vendetti aplica desde o dia
          zero a separação <strong>agente · oversight · escalação humana</strong>.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <ArchCard
            color="emerald"
            label="1 · Agentes (executores)"
            desc="Cada um com prompt, ferramentas e domínio limitados. Augusto orquestra. Mara analisa. Bruno compra. Lúcia atende. Rita opera. Não tomam decisão grande sozinhos — propõem."
            tech={['Claude Opus 4.7', 'Vercel AI SDK', '10+ tools por agente']}
          />
          <ArchCard
            color="amber"
            label="2 · Oversight (Zelda)"
            desc="Audita o que os outros agentes fazem. Detecta padrões de erro (matcher errado, slot-swap não visto). Propõe fixes concretos com prompt-pronto. Roda autonomamente após cada confirm."
            tech={['Claude Haiku 4.5', 'event-driven', 'WhatsApp notify']}
          />
          <ArchCard
            color="rose"
            label="3 · Escalação humana"
            desc="Toda decisão de impacto vira Decision PENDING com level 🟢🟡🔴. Luís aprova/rejeita em /decisions. WhatsApp privado avisa sempre que precisa de atenção."
            tech={['Decision log Postgres', 'Z-API outbound', 'GitHub Actions executor']}
          />
        </div>
      </section>

      {/* STACK TÉCNICA */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold text-navy">Stack</h2>
        <p className="mt-2 text-sm text-navy/65">
          Tudo open-source, deploy em Vercel + Neon Postgres + GitHub Actions pra Playwright (Vercel
          serverless não roda browser).
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StackCard category="Frontend" items={['Next.js 16 (App Router)', 'TypeScript 6', 'Tailwind CSS v4', 'React 19']} />
          <StackCard category="Backend" items={['Prisma 7 + Neon serverless', 'Server Actions', 'AES-256-GCM secrets', 'HMAC-SHA256 cookies']} />
          <StackCard category="AI" items={['Claude Opus 4.7 (agentes)', 'Claude Haiku 4.5 (classifiers + audit)', 'Vision (NF-e parse)', 'Vercel AI SDK streaming']} />
          <StackCard category="Integrações" items={['Playwright (CI via GitHub Actions)', 'Z-API (WhatsApp in+out)', 'Whisper (audio transcribe)', 'Vendpago/Vendtef ERP scrape']} />
        </div>
      </section>

      {/* FLUXOS REAIS · 4 cenários */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold text-navy">Fluxos reais · do mundo físico ao banco</h2>
        <p className="mt-2 text-sm text-navy/65">
          Cada cenário aqui é um caminho end-to-end que o sistema processa em produção. Tudo
          rastreado em /decisions com level 🟢🟡🔴.
        </p>
        <div className="mt-6 space-y-4">
          <FlowCard
            agent="Lúcia"
            agentColor="sky"
            title="Cliente reclama no WhatsApp"
            steps={[
              { label: 'inbound', text: 'Cliente manda "minha coca não saiu" no WhatsApp da máquina' },
              { label: 'classify', text: 'Haiku 4.5 classifica: SAC_VENDING (não locação, não geral)' },
              { label: 'state machine', text: 'Lúcia pede print + slot. Max 4 mensagens. Tom formal' },
              { label: 'cross-check', text: 'Cruza print com banco de Transactions (mesmo slot+horário)' },
              { label: 'escalation', text: 'Se transação confirmada, escala pro Luís com tudo organizado' },
              { label: 'decision', text: 'Luís aprova reembolso em 1 clique em /sac' },
            ]}
          />
          <FlowCard
            agent="Bruno"
            agentColor="emerald"
            title="Compra no Atacadão (NF-e via foto)"
            steps={[
              { label: 'upload', text: 'Luís fotografa a NF-e no celular e sobe em /bruno/nova' },
              { label: 'vision', text: 'Claude Opus 4.7 com Vision lê: fornecedor, itens, qty, custo' },
              { label: 'fuzzy match', text: 'Pra cada item, F1 score contra catálogo SKU. Filtros: ruído (REF/LATA/SLEEK) + discriminadores (zero/diet/watermelon)' },
              { label: 'confirmação', text: 'UI mostra matches. Luís confirma ou corrige cada item' },
              { label: 'sync ERP', text: 'GitHub Action dispara Playwright que entra no Vendtef, cadastra produto novo (se preciso), vincula ao Estoque Everest, lança entrada de estoque' },
              { label: 'audit', text: 'Se Luís corrigiu algum match, Zelda recebe o sinal e analisa o padrão' },
            ]}
          />
          <FlowCard
            agent="Rita"
            agentColor="rose"
            title="Weverton repõe produtos (mensagem no grupo WhatsApp)"
            steps={[
              { label: 'mensagem', text: 'Weverton manda no grupo Op: "(14) Protein Crisp · 12 unidades" — formato livre, multi-linha' },
              { label: 'parser', text: 'Regex multi-linha extrai slot + produto + qty pra cada item' },
              { label: 'LLM review', text: 'Haiku 4.5 olha o MAPA COMPLETO da máquina. Detecta slot-swap (Vendtef invertido vs físico), alias de produto, variantes de família' },
              { label: 'decision', text: 'Cria Decision PENDING com items + análise LLM. Luís revisa em /decisions, ajusta o que quiser, aprova' },
              { label: 'execução', text: 'Scraper Playwright entra no Vendtef, troca o pid do slot (e do slot invertido se for o caso), abastece a máquina, atualiza Reposicao no DB, manda confirmação no grupo' },
            ]}
          />
          <FlowCard
            agent="Zelda"
            agentColor="gold"
            title="Auto-melhoria contínua"
            steps={[
              { label: 'observação', text: 'Luís corrige um match que o sistema sugeriu. Evento gravado.' },
              { label: 'trigger', text: 'Após cada confirm, /api/zelda dispara via Next 16 after()' },
              { label: 'análise', text: 'Haiku 4.5 lê correções recentes (incremental, só novas), padrão identificado' },
              { label: 'proposta', text: 'Gera finding com hipótese + fix específico + prompt-pronto-pra-Augusto' },
              { label: 'notify', text: 'WhatsApp pro Luís: pattern X detectado, sugestão Y, prompt Z pra colar no Augusto' },
              { label: 'aplicação', text: 'Luís cola prompt no chat do Augusto. Augusto faz a mudança no código. Próximo flow já roda melhor.' },
            ]}
          />
        </div>
      </section>

      {/* DASHBOARD INTERATIVA FAKE */}
      <section className="mb-12 rounded-2xl border-2 border-navy/15 bg-gradient-to-br from-navy-50 to-white p-6">
        <h2 className="text-2xl font-bold text-navy">Demonstração interativa</h2>
        <p className="mt-2 text-sm text-navy/65">
          Visualização da máquina com dados <strong>fictícios</strong> (não puxa do banco). Passe o
          mouse num slot pra ver os dados que o agente vê. Clique pra fixar e analisar detalhe — mola
          na máquina, estoque Everest disponível pra reabastecer, vendas no mês.
        </p>
        <div className="mt-6">
          <VendingMachineLive
            slots={DEMO_SLOTS}
            capacityPct={78}
            slotsCritical={4}
            slotsTotal={DEMO_SLOTS.length}
          />
        </div>
        <p className="mt-3 text-[11px] text-navy/45">
          ℹ️ Dados acima são exemplos plausíveis pra demo. Os números reais ficam atrás de auth.
        </p>
      </section>

      {/* EVOLUÇÃO RESUMIDA */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold text-navy">Evolução em 6 marcos</h2>
        <p className="mt-2 text-sm text-navy/65">
          Marcos importantes da construção, do Sprint 1 até hoje.
        </p>
        <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <MilestoneCard
            num={1}
            title="Foundation + auth"
            desc="Next 16 + Prisma 7 + Neon. Secrets cifrados AES-256-GCM. HMAC cookies via Web Crypto."
            done
          />
          <MilestoneCard
            num={2}
            title="Mara · scraper Vendtef"
            desc="Playwright loga no ERP, baixa 1481+ transações, calcula margem por slot, snapshot diário."
            done
          />
          <MilestoneCard
            num={3}
            title="Bruno · NF-e end-to-end"
            desc="Vision lê foto da NF-e. Fuzzy match com discriminadores. Sync automático no Vendtef via GitHub Action."
            done
          />
          <MilestoneCard
            num={4}
            title="Lúcia · SAC inteligente"
            desc="State machine 4 mensagens, classifier Haiku, cruzamento com Transaction, escalation organizada."
            done
          />
          <MilestoneCard
            num={5}
            title="Rita · LLM review"
            desc="Reposição via WhatsApp → Haiku detecta slot-swap olhando mapa completo da máquina. Execução automática."
            done
          />
          <MilestoneCard
            num={6}
            title="Zelda · auto-melhoria"
            desc="Audita correções, propõe fixes, notifica via WhatsApp. Sistema fica melhor sozinho a cada uso."
            done
          />
        </div>
      </section>

      {/* O TIME */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold text-navy">O time</h2>
        <p className="mt-2 text-sm text-navy/65">
          6 agentes Claude com personas, backstories e ferramentas próprias. Cada um tem uma página
          completa atrás de auth com terminal ao vivo do que tá fazendo.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {TEAM.map((a) => (
            <div
              key={a.id}
              className="group flex flex-col items-center rounded-lg border border-navy/10 bg-white p-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarUrl(a, 80)}
                alt={a.name}
                width={64}
                height={64}
                className={`rounded-full ring-2 ${COLOR_RING[a.color]}`}
              />
              <div className="mt-2 text-sm font-semibold text-navy">
                {a.id === 'vendetti' ? (a.fullName ?? a.name) : a.name}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-navy/50">
                {a.role.split(' · ')[0].split('/')[0].trim()}
              </div>
              <div className="mt-1 text-center text-[10px] italic text-navy/55 leading-tight">
                "{a.tagline}"
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* INSPIRAÇÃO */}
      <section className="mb-12 rounded-lg border border-gold/30 bg-gold-50 p-6">
        <h2 className="text-lg font-semibold text-navy">Inspiração — Project Vend Phase 2 (Anthropic)</h2>
        <p className="mt-2 text-sm text-navy/75">
          A Anthropic rodou um experimento onde Claude operou uma vending machine no escritório deles
          ("Claudius"). Phase 1 deu prejuízo. Phase 2 acertou com modelo melhor (Sonnet 4.5),
          procedimentos forçados, e arquitetura de 3 camadas. Vendetti aplica essas lições desde o
          dia zero — mas numa máquina real, em produção, com cliente real, fornecedor real e
          zelador real abastecendo.
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
          <a
            href="https://github.com/everestudi/vendetti"
            target="_blank"
            rel="noopener"
            className="rounded bg-navy/10 px-2 py-1 text-navy hover:bg-navy/20"
          >
            Código fonte ↗
          </a>
        </div>
      </section>

      <footer className="mt-12 text-center text-xs text-navy/40">
        Operação física: Blue Mall Rondon, Uberlândia/MG · Operação remota: SP · contato via{' '}
        <a href="https://github.com/everestudi/vendetti" className="underline hover:text-navy/70">
          GitHub
        </a>
      </footer>
    </main>
  );
}

interface ArchCardProps {
  color: 'emerald' | 'amber' | 'rose';
  label: string;
  desc: string;
  tech: string[];
}
function ArchCard({ color, label, desc, tech }: ArchCardProps) {
  const cls = {
    emerald: 'border-emerald-200 bg-emerald-50/40',
    amber: 'border-amber-200 bg-amber-50/40',
    rose: 'border-rose-200 bg-rose-50/40',
  }[color];
  return (
    <div className={`rounded-lg border-2 p-4 ${cls}`}>
      <div className="text-xs font-bold uppercase tracking-wider text-navy/70">{label}</div>
      <p className="mt-2 text-sm leading-relaxed text-navy/80">{desc}</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {tech.map((t) => (
          <span key={t} className="rounded bg-white px-1.5 py-0.5 text-[10px] font-mono text-navy/65">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function StackCard({ category, items }: { category: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-navy/10 bg-white p-3">
      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-navy/70">{category}</div>
      <ul className="space-y-1 text-xs text-navy/75">
        {items.map((i) => (
          <li key={i} className="flex gap-1">
            <span className="text-navy/30">·</span>
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface FlowStep {
  label: string;
  text: string;
}
interface FlowCardProps {
  agent: string;
  agentColor: 'sky' | 'emerald' | 'rose' | 'gold';
  title: string;
  steps: FlowStep[];
}
function FlowCard({ agent, agentColor, title, steps }: FlowCardProps) {
  const cls = {
    sky: 'border-sky-300 bg-sky-50/30',
    emerald: 'border-emerald-300 bg-emerald-50/30',
    rose: 'border-rose-300 bg-rose-50/30',
    gold: 'border-gold/50 bg-gold-50/30',
  }[agentColor];
  const badgeCls = {
    sky: 'bg-sky-500 text-white',
    emerald: 'bg-emerald-600 text-white',
    rose: 'bg-rose-500 text-white',
    gold: 'bg-gold text-navy-900',
  }[agentColor];
  return (
    <div className={`rounded-xl border-2 p-5 ${cls}`}>
      <header className="mb-3 flex items-baseline gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${badgeCls}`}>{agent}</span>
        <h3 className="text-lg font-bold text-navy">{title}</h3>
      </header>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="grid grid-cols-[110px_1fr] gap-3 text-sm">
            <div className="text-right text-[10px] font-mono font-semibold uppercase tracking-wider text-navy/55">
              {i + 1}. {s.label}
            </div>
            <div className="text-navy/85">{s.text}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

interface MilestoneCardProps {
  num: number;
  title: string;
  desc: string;
  done?: boolean;
}
function MilestoneCard({ num, title, desc, done }: MilestoneCardProps) {
  return (
    <div className={`rounded-lg border p-4 ${done ? 'border-emerald-200 bg-emerald-50/30' : 'border-navy/15 bg-white'}`}>
      <div className="flex items-baseline gap-2">
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-emerald-600 text-white' : 'bg-navy/10 text-navy'}`}>
          {done ? '✓' : num}
        </span>
        <h3 className="text-sm font-bold text-navy">{title}</h3>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-navy/70">{desc}</p>
    </div>
  );
}
