'use client';

import { useState } from 'react';
import type { MonthlyRevenuePoint, DailyComparisonPoint } from '@/lib/dashboard';

interface Props {
  series: MonthlyRevenuePoint[]; // últimos N meses
  dailyPoints: DailyComparisonPoint[]; // 31 pontos com weekday
  monthLabels: { thisMonth: string; lastMonth: string };
}

const brl = (n: number) =>
  Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });

type View = 'monthly' | 'daily';

export function RevenueCharts({ series, dailyPoints, monthLabels }: Props) {
  const [view, setView] = useState<View>('daily');

  return (
    <div className="mt-6 rounded-lg border border-navy/10 bg-navy-50/30 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-navy">
          {view === 'monthly' ? `Faturamento últimos ${series.length} meses` : 'Diário · mês atual vs anterior'}
        </h3>
        <div className="flex gap-1 rounded-md border border-navy/15 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setView('daily')}
            className={`rounded px-2 py-0.5 text-[11px] font-medium ${
              view === 'daily' ? 'bg-navy text-white' : 'text-navy/65 hover:bg-navy/5'
            }`}
          >
            Diário
          </button>
          <button
            type="button"
            onClick={() => setView('monthly')}
            className={`rounded px-2 py-0.5 text-[11px] font-medium ${
              view === 'monthly' ? 'bg-navy text-white' : 'text-navy/65 hover:bg-navy/5'
            }`}
          >
            Mês a mês
          </button>
        </div>
      </div>

      {view === 'monthly' ? <MonthlyBars series={series} /> : <DailyLines points={dailyPoints} labels={monthLabels} />}
    </div>
  );
}

function MonthlyBars({ series }: { series: MonthlyRevenuePoint[] }) {
  const max = Math.max(1, ...series.map((p) => p.revenue));
  return (
    <div className="flex h-32 items-end gap-1 sm:gap-2">
      {series.map((p, idx) => {
        const heightPct = (p.revenue / max) * 100;
        const isCurrent = idx === series.length - 1;
        return (
          <div key={`${p.year}-${p.month}`} className="group flex flex-1 flex-col items-center">
            <div className="relative flex w-full flex-col-reverse">
              <div
                className={`w-full rounded-t transition-all hover:opacity-80 ${isCurrent ? 'bg-navy' : 'bg-navy/40'}`}
                style={{ height: `${Math.max(4, heightPct)}%`, minHeight: '4px' }}
                title={`${p.label}: ${brl(p.revenue)} (${p.txCount} vendas)`}
              />
            </div>
            <div className={`mt-1 text-[10px] ${isCurrent ? 'font-bold text-navy' : 'text-navy/50'}`}>
              {p.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DailyLines({ points, labels }: { points: DailyComparisonPoint[]; labels: { thisMonth: string; lastMonth: string } }) {
  // Calcula range — usa só dias que tem algum dado num dos meses
  const relevant = points.filter((p) => p.thisMonth !== null || p.lastMonth !== null);
  if (relevant.length === 0) {
    return <div className="py-8 text-center text-xs text-navy/40">Sem dados ainda — Mara precisa rodar.</div>;
  }
  const allValues = relevant.flatMap((p) => [p.thisMonth ?? 0, p.lastMonth ?? 0]);
  const max = Math.max(1, ...allValues);
  const width = 800;
  const height = 200;
  const padLeft = 30;
  const padBottom = 40;
  const chartW = width - padLeft - 10;
  const chartH = height - padBottom - 10;
  const xStep = chartW / Math.max(1, relevant.length - 1);

  const pointToCoord = (val: number | null, idx: number): [number, number] | null => {
    if (val === null) return null;
    const x = padLeft + idx * xStep;
    const y = chartH - (val / max) * chartH + 10;
    return [x, y];
  };

  const pathFor = (key: 'thisMonth' | 'lastMonth'): string => {
    const coords: Array<[number, number]> = [];
    relevant.forEach((p, i) => {
      const c = pointToCoord(p[key], i);
      if (c) coords.push(c);
    });
    if (coords.length === 0) return '';
    return coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c[0]} ${c[1]}`).join(' ');
  };

  // Eixo Y · 4 níveis
  const yTicks = [0, 0.33, 0.66, 1];

  return (
    <div className="space-y-2">
      {/* Legenda */}
      <div className="flex items-center justify-between text-[10px] text-navy/55">
        <div className="flex gap-4">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1 w-4 rounded bg-navy"></span> {labels.thisMonth}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1 w-4 rounded bg-navy/35"></span> {labels.lastMonth}
          </span>
        </div>
        <span>R$ pico · {brl(max)}</span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-48 w-full">
        {/* Grid Y */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={padLeft}
              y1={chartH - t * chartH + 10}
              x2={width - 10}
              y2={chartH - t * chartH + 10}
              stroke="#1F3864"
              strokeOpacity="0.08"
              strokeDasharray="2 2"
            />
            <text
              x={padLeft - 5}
              y={chartH - t * chartH + 14}
              fontSize="9"
              textAnchor="end"
              fill="#1F3864"
              fillOpacity="0.45"
            >
              {brl(max * t)}
            </text>
          </g>
        ))}

        {/* Mês anterior — linha tracejada cinza */}
        <path d={pathFor('lastMonth')} fill="none" stroke="#1F3864" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="4 4" />

        {/* Mês atual — linha sólida navy */}
        <path d={pathFor('thisMonth')} fill="none" stroke="#1F3864" strokeWidth="2.5" />

        {/* Pontos do mês atual */}
        {relevant.map((p, i) => {
          if (p.thisMonth === null) return null;
          const c = pointToCoord(p.thisMonth, i);
          if (!c) return null;
          return (
            <g key={`pt-${i}`}>
              <circle cx={c[0]} cy={c[1]} r="3" fill="#1F3864" />
              <title>
                Dia {p.day} ({p.weekday}): {brl(p.thisMonth)}
              </title>
            </g>
          );
        })}

        {/* Eixo X · dia + weekday */}
        {relevant.map((p, i) => {
          if (i % Math.ceil(relevant.length / 12) !== 0 && i !== relevant.length - 1) return null;
          const x = padLeft + i * xStep;
          const isWeekend = p.weekday === 'sab' || p.weekday === 'dom';
          return (
            <g key={`xax-${i}`}>
              <text
                x={x}
                y={chartH + 24}
                fontSize="10"
                textAnchor="middle"
                fill="#1F3864"
                fillOpacity={isWeekend ? '0.85' : '0.55'}
                fontWeight={isWeekend ? 'bold' : 'normal'}
              >
                {p.day}
              </text>
              <text
                x={x}
                y={chartH + 36}
                fontSize="8"
                textAnchor="middle"
                fill="#1F3864"
                fillOpacity={isWeekend ? '0.85' : '0.4'}
                fontWeight={isWeekend ? 'bold' : 'normal'}
              >
                {p.weekday}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Resumo embaixo */}
      <div className="flex items-baseline justify-between text-[11px] text-navy/65">
        <div>
          <strong className="text-navy">Mês atual:</strong> {brl(relevant.reduce((s, p) => s + (p.thisMonth ?? 0), 0))}
        </div>
        <div>
          <strong className="text-navy/70">Mês anterior:</strong>{' '}
          {brl(relevant.reduce((s, p) => s + (p.lastMonth ?? 0), 0))}
        </div>
      </div>
    </div>
  );
}
