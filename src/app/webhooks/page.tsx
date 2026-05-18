/**
 * /webhooks — debug view dos últimos hits recebidos pelo /api/webhook/zapi.
 *
 * Mostra a rota tomada (weverton-restock, ignored:fromMe, etc), o phone/grupo
 * envolvido, snippet do texto, e diagnóstico de match quando o handler ignorou
 * uma mensagem de grupo (compara tails de IDs pra ver onde travou).
 *
 * Refresh automático a cada 5s pra ver hits chegando em tempo real.
 */

import Link from 'next/link';
import { prisma } from '@/lib/db';
import { AutoRefresh } from '@/components/AutoRefresh';

export const dynamic = 'force-dynamic';

const ROUTE_BADGE: Record<string, { cls: string; emoji: string }> = {
  'weverton-restock': { cls: 'bg-emerald-100 text-emerald-800', emoji: '📦' },
  'admin-cmd': { cls: 'bg-purple-100 text-purple-800', emoji: '⚙️' },
  'admin-nfe': { cls: 'bg-purple-100 text-purple-800', emoji: '🧾' },
  'admin-text': { cls: 'bg-purple-50 text-purple-700', emoji: '💬' },
  'admin-empty': { cls: 'bg-navy/10 text-navy/60', emoji: '·' },
  'ignored:fromMe': { cls: 'bg-navy/10 text-navy/50', emoji: '🪞' },
  'ignored:cooldown': { cls: 'bg-amber-100 text-amber-800', emoji: '⏳' },
  'rejected:unauthorized': { cls: 'bg-rose-100 text-rose-800', emoji: '🚫' },
  'rejected:no-phone': { cls: 'bg-rose-100 text-rose-800', emoji: '❓' },
};

function routeBadge(route: string) {
  if (ROUTE_BADGE[route]) return ROUTE_BADGE[route];
  if (route.startsWith('ignored:group')) return { cls: 'bg-amber-100 text-amber-800', emoji: '👥' };
  if (route.startsWith('ignored:type')) return { cls: 'bg-navy/10 text-navy/50', emoji: '⤵️' };
  if (route.startsWith('ignored')) return { cls: 'bg-navy/10 text-navy/60', emoji: '·' };
  if (route.startsWith('rejected')) return { cls: 'bg-rose-100 text-rose-800', emoji: '✗' };
  return { cls: 'bg-navy/10 text-navy/70', emoji: '?' };
}

interface Meta {
  route?: string;
  phone?: string | null;
  participantPhone?: string | null;
  isGroup?: boolean;
  fromMe?: boolean;
  type?: string | null;
  text?: string;
  hasImage?: boolean;
  hasAudio?: boolean;
  payloadKeys?: string[];
  result?: unknown;
}

export default async function WebhooksPage() {
  const hits = await prisma.workerRun.findMany({
    where: { name: 'webhook_zapi' },
    orderBy: { startedAt: 'desc' },
    take: 50,
  });

  const stats = {
    total: hits.length,
    weverton: hits.filter((h) => ((h.meta ?? {}) as Meta).route === 'weverton-restock').length,
    ignored: hits.filter((h) => ((h.meta ?? {}) as Meta).route?.startsWith('ignored')).length,
    rejected: hits.filter((h) => ((h.meta ?? {}) as Meta).route?.startsWith('rejected')).length,
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <AutoRefresh intervalMs={5000} />
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Webhooks Z-API</h1>
          <p className="mt-1 text-sm text-navy/60">
            Hits recebidos em <code className="text-xs">/api/webhook/zapi</code>. Auto-refresh 5s. Últimos 50.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Stat label="total" value={stats.total} />
          <Stat label="weverton" value={stats.weverton} cls="bg-emerald-50 text-emerald-800" />
          <Stat label="ignored" value={stats.ignored} cls="bg-navy/10 text-navy/60" />
          <Stat label="rejected" value={stats.rejected} cls="bg-rose-50 text-rose-700" />
        </div>
      </header>

      {hits.length === 0 ? (
        <div className="rounded-lg border border-navy/10 bg-white p-8 text-center">
          <p className="text-sm text-navy/60">
            Nenhum hit ainda. Z-API talvez não esteja chamando esse endpoint, ou o secret tá errado.
          </p>
          <p className="mt-2 text-xs text-navy/40">
            URL configurada: <code>https://vendetti.everest.udi.br/api/webhook/zapi</code>
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {hits.map((h) => (
            <HitCard key={h.id} hit={h} />
          ))}
        </div>
      )}

      <p className="mt-8 text-center text-xs text-navy/40">
        <Link href="/monitor" className="hover:underline">← monitor</Link>
        {' · '}
        <Link href="/decisions" className="hover:underline">decisions →</Link>
      </p>
    </main>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls?: string }) {
  return (
    <span className={`rounded-full px-3 py-1 font-medium ${cls ?? 'bg-navy/10 text-navy/70'}`}>
      {value} {label}
    </span>
  );
}

type Hit = Awaited<ReturnType<typeof prisma.workerRun.findMany>>[number];

function HitCard({ hit }: { hit: Hit }) {
  const meta = (hit.meta ?? {}) as Meta & { result?: Record<string, unknown> };
  const route = meta.route ?? 'unknown';
  const badge = routeBadge(route);
  const ageS = Math.round((Date.now() - hit.startedAt.getTime()) / 1000);
  const age =
    ageS < 60 ? `${ageS}s` : ageS < 3600 ? `${Math.round(ageS / 60)}min` : `${Math.round(ageS / 3600)}h`;

  return (
    <article className="rounded-lg border border-navy/10 bg-white p-3">
      <header className="flex flex-wrap items-baseline gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-medium ${badge.cls}`}>
          {badge.emoji} {route}
        </span>
        {meta.isGroup && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-800">grupo</span>}
        {meta.fromMe && <span className="rounded-full bg-navy/10 px-2 py-0.5 text-navy/60">fromMe</span>}
        {meta.hasImage && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">🖼️</span>}
        {meta.hasAudio && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">🎙️</span>}
        <span className="ml-auto text-navy/40">{age} atrás · {hit.startedAt.toLocaleTimeString('pt-BR')}</span>
      </header>

      <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-navy/70 sm:grid-cols-2">
        {meta.phone && (
          <div>
            <span className="text-navy/40">phone:</span>{' '}
            <code className="font-mono">{meta.phone}</code>
          </div>
        )}
        {meta.participantPhone && (
          <div>
            <span className="text-navy/40">participant:</span>{' '}
            <code className="font-mono">{meta.participantPhone}</code>
          </div>
        )}
      </div>

      {meta.text && (
        <p className="mt-2 rounded bg-navy/[0.03] p-2 text-xs text-navy/85 whitespace-pre-wrap">
          {meta.text.length > 200 ? `${meta.text.slice(0, 200)}…` : meta.text}
        </p>
      )}

      {/* Diagnóstico extra do result (mostra match-tails quando ignorou grupo) */}
      {meta.result && typeof meta.result === 'object' && 'diag' in meta.result ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-navy/50 hover:text-navy/80">
            diag (match dos IDs)
          </summary>
          <pre className="mt-1 overflow-x-auto rounded bg-navy/[0.03] p-2 text-[10px] text-navy/70">
{JSON.stringify((meta.result as { diag: unknown }).diag, null, 2)}
          </pre>
        </details>
      ) : null}

      {/* Result raw em colapsável */}
      {meta.result ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-navy/40 hover:text-navy/70">result</summary>
          <pre className="mt-1 overflow-x-auto rounded bg-navy/[0.03] p-2 text-[10px] text-navy/60">
{JSON.stringify(meta.result, null, 2)}
          </pre>
        </details>
      ) : null}
    </article>
  );
}
