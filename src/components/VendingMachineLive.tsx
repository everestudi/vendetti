'use client';

import { useState } from 'react';
import { getProductMeta } from '@/lib/products/icons';

export interface SlotData {
  selecao: string;
  productName: string | null;
  productCode: string | null;
  /** URL da imagem do produto (Atacadão VTEX CDN). Renderizada como cartoon real
   *  ao invés do emoji genérico quando presente. */
  productImageUrl?: string | null;
  price: number | null;
  marginEst: number | null;
  marginPct: number | null;
  capacity: number;
  currentQty?: number;
  qtdeAlerta: number | null;
  qtdeCritico: number | null;
  /** Qty no Estoque Everest do mesmo produto (warehouse). null = produto não rastreado lá. */
  everestQty?: number | null;
  everestStatus?: string | null;
  everestUpdatedAt?: Date | null;
  /** Vendas no mês corrente — pra mini-chart no painel detalhes */
  salesMonthQty?: number;
  salesMonthRevenue?: number;
  salesMonthCount?: number;
}

interface Props {
  slots: SlotData[];
  capacityPct: number;
  slotsCritical: number;
  slotsTotal: number;
}

export function VendingMachineLive({ slots, capacityPct, slotsCritical, slotsTotal }: Props) {
  const sorted = [...slots].sort((a, b) => Number(a.selecao) - Number(b.selecao));
  // Default selected: primeiro slot com produto cadastrado
  const defaultSlot = sorted.find((s) => s.productName) ?? sorted[0] ?? null;
  const [selected, setSelected] = useState<SlotData | null>(defaultSlot);
  const [hovered, setHovered] = useState<SlotData | null>(null);
  // O que mostrar no painel: hover > selected. Sempre tem algo.
  const displayed = hovered ?? selected;

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
                    isSelected={selected?.selecao === slot.selecao}
                    onEnter={() => setHovered(slot)}
                    onLeave={() => setHovered(null)}
                    onClick={() => setSelected(slot)}
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

      {/* --- PAINEL DETALHE --- mostra hover, fallback pra selected (nunca vazio) */}
      <ProductPanel slot={displayed} />
    </div>
  );
}

function SlotTile({
  slot,
  isSelected,
  onEnter,
  onLeave,
  onClick,
}: {
  slot: SlotData;
  isSelected: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  const meta = getProductMeta(slot.productName);
  const critical = slot.marginPct !== null && slot.marginPct < 30;
  const bgClass = !slot.productName
    ? 'bg-navy-50/40'
    : 'bg-white';

  // Barrinha de qty na mola (mini bateria vertical). currentQty/capacity.
  const cap = slot.capacity > 0 ? slot.capacity : 1;
  const qty = slot.currentQty ?? 0;
  const qtyPct = Math.max(0, Math.min(1, qty / cap));
  const qtyColor = qty === 0
    ? 'bg-rose-500'
    : qty <= (slot.qtdeCritico ?? 1)
      ? 'bg-rose-400'
      : qty <= (slot.qtdeAlerta ?? 2)
        ? 'bg-amber-400'
        : 'bg-emerald-500';

  // Formato compacto sem "R$ " — só "14,50" — pra caber em tile pequeno.
  // R$ vira label de coluna implícito pelo contexto da vending.
  const priceBR = slot.price !== null
    ? slot.price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  return (
    <button
      type="button"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
      className={`group relative flex aspect-[3/4] flex-col overflow-hidden rounded border ${bgClass} transition ${
        isSelected
          ? 'border-gold border-2 scale-105 z-10 shadow-md'
          : 'border-navy/15 hover:scale-110 hover:border-navy/40 hover:z-10 hover:shadow'
      }`}
    >
      {/* Número do slot no canto superior esquerdo (mono, discreto) */}
      <div className="absolute left-0.5 top-0 z-10 rounded-br bg-white/80 px-1 py-px font-mono text-[8px] font-bold text-navy/65">{slot.selecao}</div>

      {/* IMAGEM ocupa o espaço restante (flex-1) — encolhe se faltar lugar */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-1 pt-2.5">
        {slot.productImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slot.productImageUrl}
            alt={slot.productName ?? ''}
            className="max-h-full max-w-full object-contain"
            loading="lazy"
          />
        ) : (
          <div className="text-2xl leading-none">{meta.emoji}</div>
        )}
      </div>

      {/* Footer fixo: bateria + preço, com altura garantida */}
      <div className="flex shrink-0 flex-col gap-0.5 px-1 pb-1 pt-0.5">
        <div className="flex w-full items-center gap-px">
          {Array.from({ length: Math.min(cap, 8) }).map((_, i) => {
            const filled = i < Math.floor(qtyPct * Math.min(cap, 8));
            return (
              <div
                key={i}
                className={`h-1 flex-1 rounded-sm ${filled ? qtyColor : 'bg-navy/15'}`}
              />
            );
          })}
        </div>
        <div className="flex w-full items-baseline justify-center gap-0.5 leading-none">
          {priceBR && (
            <>
              <span className="font-mono text-[7px] font-semibold text-navy/45">R$</span>
              <span className="font-mono text-[10px] font-bold tabular-nums text-navy/90">{priceBR}</span>
            </>
          )}
        </div>
      </div>

      {critical && (
        <div className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-rose-500" />
      )}
    </button>
  );
}

function ProductPanel({ slot }: { slot: SlotData | null }) {
  if (!slot) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-navy/20 bg-white/50 p-6 text-center text-sm text-navy/45">
        <div className="text-3xl">📦</div>
        <p className="mt-2">sem produtos cadastrados ainda</p>
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
        <div className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-lg ${meta.bgClass} overflow-hidden`}>
          {slot.productImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={slot.productImageUrl}
              alt={slot.productName ?? ''}
              className="max-h-full max-w-full object-contain"
              loading="lazy"
            />
          ) : (
            <span className="text-5xl">{meta.emoji}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono text-navy/40">SEL {slot.selecao} · {slot.productCode}</div>
          <h3 className="text-lg font-bold text-navy">{slot.productName ?? '(slot vazio)'}</h3>
          <div className="mt-0.5 text-xs uppercase tracking-wide text-navy/50">{meta.category}</div>
        </div>
      </div>

      {/* Mola visual: barrinha bateria horizontal mostrando qty / capacidade */}
      <MolaBattery
        qty={slot.currentQty ?? 0}
        capacity={slot.capacity}
        alerta={slot.qtdeAlerta}
        critico={slot.qtdeCritico}
      />

      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <Metric label="Preço" value={slot.price !== null ? `R$ ${slot.price.toFixed(2)}` : '—'} />
        <Metric label="Lucro/un" value={slot.marginEst !== null ? `R$ ${slot.marginEst.toFixed(2)}` : '—'} />
        <Metric label="Margem" value={slot.marginPct !== null ? `${slot.marginPct.toFixed(0)}%` : '—'} valueClass={marginPctClass} />
        <Metric
          label="Estoque Everest"
          value={slot.everestQty !== null && slot.everestQty !== undefined ? `${slot.everestQty}` : '—'}
          valueClass={
            slot.everestQty === 0
              ? 'text-rose-700'
              : slot.everestStatus === 'crítico'
                ? 'text-rose-700'
                : slot.everestStatus === 'alerta'
                  ? 'text-amber-700'
                  : 'text-navy'
          }
        />
        <Metric label="Vendas mês" value={`${slot.salesMonthQty ?? 0} un`} />
        <Metric label="Receita mês" value={slot.salesMonthRevenue !== undefined ? `R$ ${slot.salesMonthRevenue.toFixed(0)}` : '—'} />
      </div>

      {/* Sales mini-chart do produto (vendas por dia no mês) */}
      <SalesMiniChart slot={slot} />
    </div>
  );
}

/** Bateria horizontal mostrando qty na mola. Verde→amarelo→vermelho conforme níveis. */
function MolaBattery({
  qty,
  capacity,
  alerta,
  critico,
}: {
  qty: number;
  capacity: number;
  alerta: number | null;
  critico: number | null;
}) {
  const cap = Math.max(1, capacity);
  const cells = Math.min(cap, 12);
  const cellSize = cap > 0 ? cap / cells : 1;
  const status = qty === 0
    ? 'vazio'
    : qty <= (critico ?? 1)
      ? 'crítico'
      : qty <= (alerta ?? 2)
        ? 'alerta'
        : 'ok';
  const cls = {
    vazio: 'bg-rose-500',
    crítico: 'bg-rose-400',
    alerta: 'bg-amber-400',
    ok: 'bg-emerald-500',
  }[status];

  const filledCells = qty === 0 ? 0 : Math.max(1, Math.round(qty / cellSize));

  return (
    <div className="mt-4 rounded border border-navy/10 bg-navy-50/50 p-2">
      <div className="mb-1 flex items-baseline justify-between text-[10px]">
        <span className="font-semibold uppercase tracking-wide text-navy/55">Mola na máquina</span>
        <span className="font-mono text-navy/80">
          {qty}/{capacity}{' '}
          <span className={`ml-1 rounded px-1 py-0.5 text-[9px] uppercase ${
            status === 'ok'
              ? 'bg-emerald-100 text-emerald-700'
              : status === 'alerta'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-rose-100 text-rose-700'
          }`}>{status}</span>
        </span>
      </div>
      <div className="flex h-5 items-stretch gap-px overflow-hidden rounded">
        {Array.from({ length: cells }).map((_, i) => (
          <div
            key={i}
            className={`flex-1 transition ${i < filledCells ? cls : 'bg-navy/10'}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[8px] text-navy/40">
        <span>vazio</span>
        <span>crítico: {critico ?? '—'}</span>
        <span>alerta: {alerta ?? '—'}</span>
        <span>cheio</span>
      </div>
    </div>
  );
}

/** Mini chart de vendas do produto no mês — usa salesMonthQty agregado. */
function SalesMiniChart({ slot }: { slot: SlotData }) {
  const qty = slot.salesMonthQty ?? 0;
  const count = slot.salesMonthCount ?? 0;
  const revenue = slot.salesMonthRevenue ?? 0;

  if (qty === 0 && count === 0) {
    return (
      <div className="mt-3 rounded border border-navy/10 bg-navy-50/30 p-3 text-center text-xs text-navy/50">
        Sem vendas registradas no mês.
      </div>
    );
  }

  // Heurística simples de "performance" — qty unitário no mês relativo à capacidade
  // Pode evoluir pra puxar serie diária real depois
  return (
    <div className="mt-3 rounded border border-navy/10 bg-emerald-50/30 p-3">
      <div className="mb-1 flex items-baseline justify-between text-[10px]">
        <span className="font-semibold uppercase tracking-wide text-navy/55">Vendas no mês</span>
        <span className="font-mono text-navy/80">{count} transações</span>
      </div>
      <div className="flex items-baseline gap-3 text-sm">
        <div>
          <span className="text-2xl font-bold text-emerald-700">{qty}</span>
          <span className="ml-1 text-xs text-navy/60">unidades</span>
        </div>
        <div className="text-xs text-navy/65">
          R$ {revenue.toFixed(2)}{' '}
          <span className="text-navy/40">total</span>
        </div>
        {slot.price !== null && qty > 0 && (
          <div className="ml-auto text-[10px] text-navy/55">
            ticket médio R$ {(revenue / qty).toFixed(2)}
          </div>
        )}
      </div>
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
