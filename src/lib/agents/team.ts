/**
 * Time Vendetti — definição dos 5 agentes que vão operar a vending.
 *
 * Atualmente só Vendetti tem código rodando (scrapers + system prompt).
 * Os outros 4 são "personas" das tools especializadas que vou destacar
 * conforme implementar.
 */

export type AgentStatus = 'active' | 'building' | 'planned';

export interface Agent {
  id: string;
  name: string;
  fullName?: string;
  role: string;
  tagline: string;
  description: string;
  responsibilities: string[];
  tools: string[];
  status: AgentStatus;
  reportsTo?: string;
  /** Tailwind color name pra acentos. */
  color: 'navy' | 'gold' | 'emerald' | 'rose' | 'amber' | 'sky';
  /** Hex sem # pra usar no DiceBear backgroundColor. */
  bgHex: string;
  /** Seed estável pro avatar. */
  avatarSeed: string;
}

export const TEAM: Agent[] = [
  {
    id: 'vendetti',
    name: 'Vendetti',
    fullName: 'Augusto Vendetti',
    role: 'CEO / Orquestrador',
    tagline: 'O cara que decide.',
    description:
      'Orquestra a operação inteira. Define a agenda diária, distribui tarefas pros outros agentes e reporta direto ao Luís. É a interface única com o humano.',
    responsibilities: [
      'Coordena os outros agentes',
      'Define agenda diária',
      'Reporta ao Luís (email + chat)',
      'Loga toda decisão no decision log',
    ],
    tools: ['email.send (Resend)', 'chat (Vercel AI SDK)', 'obsidian R/W', 'decision_log'],
    status: 'active',
    color: 'navy',
    bgHex: '1F3864',
    avatarSeed: 'Vendetti-CEO',
  },
  {
    id: 'mara',
    name: 'Mara',
    role: 'Analista de Dados',
    tagline: 'Vê padrão onde tem só planilha.',
    description:
      'Lê os relatórios do Vendtef/Vendpago. Calcula margem real, giro de SKU, sazonalidade por hora. Aponta produtos pra promover, esfriar ou tirar.',
    responsibilities: [
      'Análise diária de vendas',
      'Detecta SKU com margem ruim',
      'Identifica baixo giro',
      'Sugere remix de slots',
    ],
    tools: ['vendtef_get_sales', 'vendtef_get_inventory', 'db.transaction', 'obsidian'],
    status: 'planned',
    reportsTo: 'vendetti',
    color: 'gold',
    bgHex: 'C9A84C',
    avatarSeed: 'Mara-Analytics',
  },
  {
    id: 'bruno',
    name: 'Bruno',
    role: 'Comprador',
    tagline: 'Acha o melhor preço, fecha o pedido.',
    description:
      'Pesquisa preço no Atacadão online. Mantém tabela de custo Vittal (barrinhas). Compara fornecedores e dispara pedidos quando estoque cai.',
    responsibilities: [
      'Pesquisa Atacadão online',
      'Comparativo Vittal vs Atacadão',
      'Dispara pedido de reposição',
      'Acompanha entrega',
    ],
    tools: ['atacadao_lookup', 'vittal_price_table', 'email', 'decision_log'],
    status: 'planned',
    reportsTo: 'vendetti',
    color: 'emerald',
    bgHex: '10b981',
    avatarSeed: 'Bruno-Procurement',
  },
  {
    id: 'rita',
    name: 'Rita',
    role: 'Operações de Campo',
    tagline: 'Fala com o Weverton e fecha o loop.',
    description:
      'Único canal com o Weverton via WhatsApp (Z-API outbound). Envia lista de reposição, processa fotos de conferência via visão computacional, alimenta o Vendtef após reposição.',
    responsibilities: [
      'Lista de reposição → Weverton',
      'Processa foto de conferência (visão)',
      'Alimenta Vendtef pós-abastecimento',
      'Detecta divergência de inventário',
    ],
    tools: ['whatsapp_send (Z-API outbound)', 'vendtef_update_slot', 'claude_vision'],
    status: 'planned',
    reportsTo: 'vendetti',
    color: 'rose',
    bgHex: 'f43f5e',
    avatarSeed: 'Rita-FieldOps',
  },
  {
    id: 'lucia',
    name: 'Lúcia',
    role: 'SAC · Atendimento ao Cliente',
    tagline: 'Recebe o print, mastiga, escala.',
    description:
      'Recebe mensagens de clientes da máquina via WhatsApp (Z-API). Identifica se é reclamação válida da vending, exige print do pagamento + qual slot deu problema, e escala direto pro Luís com tudo mastigado. NÃO tenta cruzar com Vendpago — transação às vezes nem aparece e tem delay; Luís verifica manualmente no momento de decidir.',
    responsibilities: [
      'Triagem de inbound do Z-API',
      'Solicita print + slot ao cliente',
      'Escala pro Luís decidir reembolso',
      'Acompanha resolução até fechar',
    ],
    tools: ['zapi_inbound_parser', 'zapi_send_scripted', 'complaint_create', 'email_escalation'],
    status: 'planned',
    reportsTo: 'vendetti',
    color: 'sky',
    bgHex: '0ea5e9',
    avatarSeed: 'Lucia-SAC',
  },
  {
    id: 'zelda',
    name: 'Zelda',
    role: 'Auditoria & Oversight',
    tagline: 'Diz "não" quando precisa.',
    description:
      'Aplica policies duras antes de qualquer ação executar. Margem mínima, banda de preço, teto de compra. Escala pro Luís quando saem do envelope. É a Seymour Cash do nosso time (Project Vend Phase 2).',
    responsibilities: [
      'Valida margem ≥ 35%',
      'Bloqueia preço fora da banda',
      'Define nível 🟢🟡🔴 de aprovação',
      'Audita decision log',
    ],
    tools: ['policies.ts', 'decision_log', 'email (escalação)'],
    status: 'planned',
    reportsTo: 'vendetti',
    color: 'amber',
    bgHex: 'f59e0b',
    avatarSeed: 'Zelda-Risk',
  },
];

export const CEO = TEAM[0]!;
export const SUB_AGENTS = TEAM.slice(1);

export function avatarUrl(agent: Agent, size = 128): string {
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(agent.avatarSeed)}&backgroundColor=${agent.bgHex}&backgroundType=solid&radius=50&size=${size}`;
}
