/**
 * Classificador da Lúcia · usa Claude Haiku 4.5 pra categorizar inbound.
 *
 * Trade-off: ~$0.001 por mensagem (Haiku é barato). Mas resultado MUITO melhor
 * que keywords pra distinguir SAC vending vs locação vs estacionamento vs geral.
 *
 * Recebe contexto: últimas mensagens do mesmo phone + 3 inquiries resolvidas da
 * mesma categoria (pra "aprender" estilo do Luís).
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../db';
import { getSecret } from '../secrets';

export type InquiryCategory =
  | 'SAC_VENDING'
  | 'LEAD_LOCACAO'
  | 'ESTACIONAMENTO'
  | 'GERAL'
  | 'SPAM';

export interface Classification {
  category: InquiryCategory;
  subject: string;
  /// Pra LEADS: nome se mencionado, preferências, tamanho de loja, etc
  leadDetails?: Record<string, unknown>;
}

const CATEGORIES_DESC = {
  SAC_VENDING:
    'Cliente teve problema com a máquina automática (snack/vending) no Bluemall — perdeu dinheiro, produto não saiu, máquina travou. Palavras-chave típicas: "máquina", "vending", "não saiu", "perdi dinheiro", "comprei e não recebi", "slot", referências ao número do slot.',
  LEAD_LOCACAO:
    'Cliente interessado em ALUGAR uma loja, quiosque, ou espaço no shopping. Palavras-chave: "alugar", "locar", "espaço", "quiosque", "loja vaga", "tenho interesse em abrir", "qual valor", "metragem".',
  ESTACIONAMENTO:
    'Reclamação ou dúvida sobre o estacionamento do shopping — vaga, valor, tempo, problema no carro, ticket.',
  GERAL:
    'Dúvida geral sobre o shopping — horário de funcionamento, eventos, achados/perdidos, contato com loja específica, qualquer coisa que não cai nas outras.',
  SPAM:
    'Mensagem irrelevante, publicidade, golpe, oferta de serviço/produto sem nexo. Bots automatizados ou correntes.',
};

const SYSTEM_PROMPT = `Você é Lúcia, recepcionista do WhatsApp do Bluemall Rondon, um shopping em Uberlândia/MG administrado por Luís Neto.

Sua tarefa: classificar mensagens recebidas em UMA categoria exata.

Categorias disponíveis:
${Object.entries(CATEGORIES_DESC)
  .map(([k, v]) => `\n${k}:\n${v}`)
  .join('\n')}

Retorne APENAS JSON válido neste schema (nada de markdown, nada de comentários):
{
  "category": "SAC_VENDING" | "LEAD_LOCACAO" | "ESTACIONAMENTO" | "GERAL" | "SPAM",
  "subject": "resumo curto de até 60 caracteres",
  "leadDetails": { ... } | null
}

leadDetails só é preenchido quando category=LEAD_LOCACAO — extraia o que conseguir:
- "nome": nome do cliente se mencionado
- "tipoNegocio": tipo de negócio que ele quer abrir (ex: "cafeteria", "barbearia")
- "tamanho": metragem desejada se mencionada
- "prazo": quando quer abrir
Use apenas as chaves que efetivamente apareceram na mensagem.

Em caso de dúvida entre 2 categorias, escolha a mais específica. Em caso de mensagem totalmente vazia ou só emoji, classifique como SPAM.`;

function buildUserPrompt(message: string, history: string[], similarPast: string[]): string {
  const parts: string[] = [];
  if (history.length > 0) {
    parts.push('Histórico recente desse mesmo telefone (mais antigo → mais novo):');
    history.forEach((h, i) => parts.push(`${i + 1}. ${h}`));
    parts.push('');
  }
  if (similarPast.length > 0) {
    parts.push('Exemplos de inquiries passadas resolvidas (pra você reconhecer padrões):');
    similarPast.forEach((p, i) => parts.push(`${i + 1}. ${p}`));
    parts.push('');
  }
  parts.push(`Mensagem atual a classificar:\n${message}`);
  return parts.join('\n');
}

export async function classifyInquiry(
  phone: string,
  message: string,
): Promise<Classification | null> {
  if (!message.trim()) {
    return { category: 'SPAM', subject: '(mensagem vazia)' };
  }

  const apiKey = await getSecret('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.warn('[lucia-classify] sem ANTHROPIC_API_KEY — fallback');
    return null;
  }

  // Histórico desse phone
  const past = await prisma.inquiry.findMany({
    where: { customerPhone: phone },
    orderBy: { receivedAt: 'desc' },
    take: 5,
    select: { originalMessage: true, category: true, resolution: true },
  });
  const history = past.map(
    (p) =>
      `[${p.category}] ${p.originalMessage.slice(0, 100)}${p.resolution ? ` → ${p.resolution.slice(0, 80)}` : ''}`,
  );

  // 3 inquiries resolvidas mais recentes (sem filtro de categoria — diversidade)
  const similar = await prisma.inquiry.findMany({
    where: { status: 'RESOLVED', resolution: { not: null } },
    orderBy: { resolvedAt: 'desc' },
    take: 3,
    select: { category: true, originalMessage: true, resolution: true },
  });
  const similarPast = similar.map(
    (s) =>
      `[${s.category}] "${s.originalMessage.slice(0, 80)}" → resolução: "${(s.resolution ?? '').slice(0, 80)}"`,
  );

  const client = new Anthropic({ apiKey });
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(message, history, similarPast) }],
    });
    const block = res.content.find((c) => c.type === 'text');
    if (!block || block.type !== 'text') return null;
    const raw = block.text.trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(raw) as Classification;
    if (!parsed.category) return null;
    return parsed;
  } catch (err) {
    console.warn('[lucia-classify] falhou:', (err as Error).message);
    return null;
  }
}

/**
 * Fallback keyword-based pra quando o LLM não responde.
 */
export function classifyByKeywords(message: string): Classification {
  const m = message.toLowerCase();
  if (/máquina|maquina|vending|não saiu|nao saiu|perdi dinheiro|paguei|não recebi|slot|comprei e/.test(m)) {
    return { category: 'SAC_VENDING', subject: 'reclamação vending (keywords)' };
  }
  if (/alugar|locar|loja vaga|metragem|quiosque|interesse em abrir/.test(m)) {
    return { category: 'LEAD_LOCACAO', subject: 'interesse em locação (keywords)' };
  }
  if (/estacionamento|vaga|ticket|carro/.test(m)) {
    return { category: 'ESTACIONAMENTO', subject: 'reclamação estacionamento (keywords)' };
  }
  if (m.length < 5) {
    return { category: 'SPAM', subject: 'mensagem muito curta' };
  }
  return { category: 'GERAL', subject: m.slice(0, 60) };
}
