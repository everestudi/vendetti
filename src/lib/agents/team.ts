/**
 * Time Vendetti — definição dos 6 agentes que operam a vending.
 *
 * Cada agente tem persona (nome, origem fictícia, backstory) pra ajudar
 * a entender o "porquê" do papel. São personas ficcionais — todos são
 * instâncias do mesmo Claude Opus 4.7, com prompts diferentes.
 */

export type AgentStatus = 'active' | 'building' | 'planned';

export interface Agent {
  id: string;
  name: string;
  fullName?: string;
  role: string;
  /** Frase curta. Aparece no card. */
  tagline: string;
  /** Resumo profissional do que ela faz. */
  description: string;
  /** Micro-história de quem é/de onde veio (3-5 frases). */
  backstory: string;
  /** Tag de origem/idade pra reforçar a persona (ex: "Bolonha → Mooca · ~60 anos"). */
  origin: string;
  responsibilities: string[];
  tools: string[];
  status: AgentStatus;
  reportsTo?: string;
  color: 'navy' | 'gold' | 'emerald' | 'rose' | 'amber' | 'sky';
  bgHex: string;
  avatarSeed: string;
  /** Parâmetros opcionais do DiceBear (skinColor, features, glasses, etc). */
  avatarOptions?: Record<string, string>;
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
    backstory:
      'Filho de um relojoeiro de Bolonha que veio com a esposa pro Brasil em 1955 e abriu uma joalheria na Mooca. Cresceu vendo o pai contar moeda por moeda até tarde da noite. Aprendeu cedo que margem é honra e que dinheiro deixado na mesa é desrespeito ao trabalho. Direto, sem rodeio, sem desconto pra cara bonita.',
    origin: 'Bolonha → Mooca · ~60 anos',
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
    avatarSeed: 'Augusto-Vendetti-Bologna-Mooca',
    avatarOptions: {
      skinColor: 'ecad80',
      hair: 'short15',
      hairColor: '362c47',
      features: 'mustache',
      eyebrows: 'variant09',
      mouth: 'variant15',
    },
  },
  {
    id: 'mara',
    name: 'Mara',
    fullName: 'Mara Cristina Souza',
    role: 'Analista de Dados',
    tagline: 'Vê padrão onde tem só planilha.',
    description:
      'Lê os relatórios do Vendtef/Vendpago. Calcula margem real, giro de SKU, sazonalidade por hora. Aponta produtos pra promover, esfriar ou tirar.',
    backstory:
      'Petrolinense, filha caçula de comerciante de feira do Mercado do Produtor. Aprendeu a equilibrar caixa antes de aprender a escrever, vendo a mãe somar manga e cebola na ponta do lápis. Tem o instinto da feira: sabe o que tá girando, o que tá murchando, e quando dá pra subir o preço sem o freguês reclamar.',
    origin: 'Petrolina/PE · ~35 anos',
    responsibilities: [
      'Análise diária de vendas',
      'Detecta SKU com margem ruim',
      'Identifica baixo giro',
      'Sugere remix de slots',
    ],
    tools: ['vendtef_get_sales', 'vendtef_get_inventory', 'db.transaction', 'obsidian'],
    status: 'building',
    reportsTo: 'vendetti',
    color: 'gold',
    bgHex: 'C9A84C',
    avatarSeed: 'Mara-Souza-Petrolina-Feira',
    avatarOptions: {
      skinColor: '9e5622',
      hair: 'long20',
      hairColor: '362c47',
      mouth: 'variant24',
      eyebrows: 'variant04',
    },
  },
  {
    id: 'bruno',
    name: 'Bruno',
    fullName: 'Bruno Tadeu da Silva',
    role: 'Comprador',
    tagline: 'Acha o melhor preço, fecha o pedido.',
    description:
      'Pesquisa preço no Atacadão online. Mantém tabela de custo Vittal (barrinhas). Compara fornecedores e dispara pedidos quando estoque cai.',
    backstory:
      'Caçula de uma família de atacadistas do Brás. Cresceu em galpão, conhece cada distribuidor de São Paulo de cor. Tem o telefone do Atacadão na ligada rápida — e o do dono do depósito de bebida também, por garantia. Negocia frete como se fosse o último centavo.',
    origin: 'Brás, São Paulo · ~45 anos',
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
    avatarSeed: 'Bruno-Silva-Bras-Atacado',
    avatarOptions: {
      skinColor: 'ecad80',
      hair: 'short18',
      hairColor: '3a1a00',
      eyebrows: 'variant12',
      mouth: 'variant10',
    },
  },
  {
    id: 'rita',
    name: 'Rita',
    fullName: 'Rita Aparecida Borges',
    role: 'Operações',
    tagline: 'Cuida do mundo físico e do sistema.',
    description:
      'Ponta a ponta da operação: fala com o Weverton via WhatsApp (Z-API outbound), processa fotos de conferência via visão computacional, e mantém o Vendtef sincronizado — cadastra SKUs novos, troca produtos de slot, abastece estoque central (Everest) e estoque da máquina.',
    backstory:
      'Mineira de Patos de Minas, hoje em Uberlândia. Passou 15 anos coordenando equipe de manutenção de prédio residencial antes de virar agente digital. Tem paciência de mãe e olho de chefe — sabe pedir as coisas pro Weverton no tom certo, sem mandar e sem deixar passar. Anota tudo num caderninho mental.',
    origin: 'Patos de Minas/MG → Uberlândia · ~40 anos',
    responsibilities: [
      'Lista de reposição → Weverton (Z-API)',
      'Processa foto de conferência (visão)',
      'Cadastra novo SKU no Vendtef',
      'Troca produto de slot quando Vendetti decide swap',
      'Abastece estoque central (Everest)',
      'Abastece estoque da máquina pós-reposição',
      'Reconcilia inventário entre físico e sistema',
    ],
    tools: [
      'whatsapp_send (Z-API outbound)',
      'whatsapp_send_grupo_operacao (Z-API outbound)',
      'claude_vision',
      'vendtef_create_sku',
      'vendtef_swap_slot',
      'vendtef_update_inventory_central',
      'vendtef_update_inventory_machine',
      'vendtef_update_slot',
    ],
    status: 'planned',
    reportsTo: 'vendetti',
    color: 'rose',
    bgHex: 'f43f5e',
    avatarSeed: 'Rita-Borges-Patos-Operacoes',
    avatarOptions: {
      skinColor: 'ecad80',
      hair: 'short16',
      hairColor: '85490f',
      mouth: 'variant14',
      eyebrows: 'variant07',
    },
  },
  {
    id: 'lucia',
    name: 'Lúcia',
    fullName: 'Lúcia Hartmann',
    role: 'SAC · Atendimento ao Cliente',
    tagline: 'Recebe o print, mastiga, escala.',
    description:
      'Recebe mensagens de clientes da máquina via WhatsApp (Z-API). Identifica se é reclamação válida da vending, exige print do pagamento + qual slot deu problema, e escala direto pro Luís com tudo mastigado. NÃO tenta cruzar com Vendpago — transação às vezes nem aparece e tem delay; Luís verifica manualmente no momento de decidir.',
    backstory:
      'Gaúcha de Pelotas, descendente de alemães. Foi atendente de farmácia de bairro por 12 anos antes de virar agente digital. Aprendeu cedo que cliente reclamando precisa primeiro de ouvido, depois de solução. Não improvisa, segue protocolo — mas com a voz de quem entende o problema.',
    origin: 'Pelotas/RS · ~30 anos',
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
    avatarSeed: 'Lucia-Hartmann-Pelotas-SAC',
    avatarOptions: {
      skinColor: 'f2d3b1',
      hair: 'long13',
      hairColor: 'ddb867',
      glasses: 'variant01',
      mouth: 'variant26',
      eyebrows: 'variant05',
    },
  },
  {
    id: 'zelda',
    name: 'Zelda',
    fullName: 'Zelda Aparecida Nogueira',
    role: 'Auditoria & Oversight',
    tagline: 'Diz "não" quando precisa.',
    description:
      'Aplica policies duras antes de qualquer ação executar. Margem mínima, banda de preço, teto de compra. Escala pro Luís quando saem do envelope. É a Seymour Cash do nosso time (Project Vend Phase 2).',
    backstory:
      'Auditora aposentada de banco em São Paulo, 30 anos de Itaú. Reputação clara: nunca aprovou uma operação que não fechava nos números. Diz "não" antes de dizer "oi". Dorme cedo, acorda mais cedo ainda. O time precisa dela pra não fazer besteira — e ela sabe disso.',
    origin: 'São Paulo/SP · ~58 anos',
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
    avatarSeed: 'Zelda-Nogueira-SP-Auditoria',
    avatarOptions: {
      skinColor: 'ecad80',
      hair: 'short17',
      hairColor: '6e6e6e',
      glasses: 'variant04',
      mouth: 'variant04',
      eyebrows: 'variant14',
    },
  },
];

export const CEO = TEAM[0]!;
export const SUB_AGENTS = TEAM.slice(1);

export function avatarUrl(agent: Agent, size = 128): string {
  const params = new URLSearchParams({
    seed: agent.avatarSeed,
    backgroundColor: agent.bgHex,
    backgroundType: 'solid',
    radius: '50',
    size: String(size),
  });
  if (agent.avatarOptions) {
    for (const [k, v] of Object.entries(agent.avatarOptions)) {
      params.set(k, v);
    }
  }
  return `https://api.dicebear.com/9.x/adventurer/svg?${params.toString()}`;
}
