'use client';

import Link from 'next/link';
import { useState } from 'react';
import { getProductMeta } from '@/lib/products/icons';

export interface SlotData {
  selecao: string;
  productName: string | null;
  productCode: string | null;
  price: number | null;
  marginEst: number | null;
  marginPct: number | null;
  capacity: number;
  qtdeAlerta: number | null;
  qtdeCritico: number | null;
}

interface Props {
  slots: SlotData[];
  capacityPct: number;
  slotsCritical: number;
  slotsTotal: number;
}

export function VendingMachineLive({ slots, capacityPct, slotsCritical, slotsTotal }: Props) {
  const [hovered, setHovered] = useState<SlotData | null>(null);
  const sorted = [...slots].sort((a, b) => Number(a.selecao) - Number(b.selecao));

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* --- CARTOON --- */}
      <div className="relative">
        <div className="rounded-2xl border-2 border-navy bg-navy p-3 shadow-xl">
            {/* Faixa Vendetti */}
            <div className="mb-2 rounded bg-gold py-1 text-center text-xs font-bold tracking-[0.2em] text-navy">
              VENDETTI
            </div>

            {/* "vidro" + grid 6 colunas */}
            <div className="rounded bg-[#F4F6FA] p-2">
              <div className="grid grid-cols-6 gap-1">
                {sorted.map((slot) => (
                  <SlotTile
                    key={slot.selecao}
                    slot={slot}
                    onEnter={() => setHovered(slot)}
                    onLeave={() => setHovered(null)}
                  />
                ))}
              </div>
            </div>

            {/* Display + teclado */}
            <div className="mt-2 flex gap-1.5">
              <div className="flex-1 rounded bg-navy-900 p-2 font-mono text-[10px] leading-tight text-gold">
                <div>▸ DIGITE</div>
                <div>▸ O CÓDIGO</div>
                <div className="text-emerald-400">● ONLINE</div>
              </div>
              <div className="grid grid-cols-3 gap-0.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((n) => (
                  <div
                    key={n}
                    className="flex h-4 w-4 items-center justify-center rounded-sm bg-white text-[8px] font-bold text-navy"
                  >
                    {n}
                  </div>
                ))}
              </div>
            </div>

            {/* output flap */}
            <div className="mt-2 rounded border border-gold/60 bg-navy-900 py-1.5 text-center text-[10px] font-bold tracking-wider text-gold">
              ↓ RETIRE AQUI ↓
            </div>

            {/* badges */}
            <div className="absolute right-1.5 top-12 rounded bg-navy-900/95 px-2 py-1 text-center text-white shadow">
              <div className="text-[7px] font-bold tracking-wide text-gold">CAPACITY</div>
              <div className="text-base font-bold leading-none">{capacityPct.toFixed(0)}%</div>
            </div>
            {slotsCritical > 0 && (
              <div className="absolute bottom-16 right-1.5 rounded bg-rose-600 px-2 py-1 text-center text-white shadow">
                <div className="text-[7px] font-bold tracking-wide">CRÍTICOS</div>
                <div className="text-base font-bold leading-none">
                  {slotsCritical}/{slotsTotal}
                </div>
              </div>
            )}
        </div>
      </div>

      {/* --- PAINEL DETALHE --- */}
      <ProductPanel slot={hovered} />
    </div>
  );
}

function SlotTile({
  slot,
  onEnter,
  onLeave,
}: {
  slot: SlotData;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const meta = getProductMeta(slot.productName);
  const critical = slot.marginPct !== null && slot.marginPct < 30;
  const bgClass = !slot.productName
    ? 'bg-white'
    : critical
      ? 'bg-rose-100 ring-rose-300'
      : meta.bgClass;

  return (
    <Link
      href={`/mara?slot=${slot.selecao}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={`group relative flex aspect-[3/4] flex-col items-center justify-center rounded ${bgClass} ring-1 ring-navy/10 transition hover:scale-110 hover:ring-2 hover:ring-navy/40 hover:z-10`}
    >
      <div className="text-lg leading-none">{meta.emoji}</div>
      <div className="mt-0.5 text-[7px] font-mono text-navy/55">{slot.selecao}</div>
      {critical && (
        <div className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-rose-500" />
      )}
    </Link>
  );
}

function ProductPanel({ slot }: { slot: SlotData | null }) {
  if (!slot) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-navy/20 bg-white/50 p-6 text-center text-sm text-navy/45">
        <div className="text-3xl">👋</div>
        <p className="mt-2">passe o mouse num slot pra ver detalhes</p>
        <p className="mt-1 text-xs">ou clique pra abrir no dashboard</p>
      </div>
    );
  }

  const meta = getProductMeta(slot.productName);
  const marginPctClass =
    slot.marginPct === null
      ? 'text-navy/40'
      : slot.marginPct >= 50
        ? 'text-emerald-700'
        : slot.marginPct >= 30
          ? 'text-amber-700'
          : 'text-rose-700';

  return (
    <div className="rounded-lg border border-navy/10 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-lg ${meta.bgClass} text-5xl`}>
          {meta.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono text-navy/40">SEL {slot.selecao} · {slot.productCode}</div>
          <h3 className="text-lg font-bold text-navy">{slot.productName ?? '(slot vazio)'}</h3>
          <div className="mt-0.5 text-xs uppercase tracking-wide text-navy/50">{meta.category}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <Metric label="Preço" value={slot.price !== null ? `R$ ${slot.price.toFixed(2)}` : '—'} />
        <Metric label="Lucro/un" value={slot.marginEst !== null ? `R$ ${slot.marginEst.toFixed(2)}` : '—'} />
        <Metric label="Margem" value={slot.marginPct !== null ? `${slot.marginPct.toFixed(0)}%` : '—'} valueClass={marginPctClass} />
        <Metric label="Capacidade" value={`${slot.capacity}`} />
        <Metric label="Alerta" value={slot.qtdeAlerta?.toString() ?? '—'} />
        <Metric label="Crítico" value={slot.qtdeCritico?.toString() ?? '—'} />
      </div>

      <Link
        href={`/mara?slot=${slot.selecao}`}
        className="mt-4 block rounded bg-navy py-2 text-center text-sm font-semibold text-white hover:bg-navy-900"
      >
        Abrir no dashboard →
      </Link>
    </div>
  );
}

function Metric({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded border border-navy/5 bg-navy-50/50 p-2">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-navy/40">{label}</div>
      <div className={`mt-0.5 text-base font-bold ${valueClass ?? 'text-navy'}`}>{value}</div>
    </div>
  );
}
