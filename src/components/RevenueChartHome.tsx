'use client';

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import type { DailyComparisonPoint } from '@/lib/dashboard';

interface Props {
  points: DailyComparisonPoint[];
  labels: { thisMonth: string; lastMonth: string };
  todayOfMonth: number;
}

const brl = (n: number) =>
  Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });

const brlFull = (n: number) =>
  Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

interface TooltipPayloadEntry {
  payload: DailyComparisonPoint;
}

/** Tooltip customizado: mostra dia + dia da semana + faturamento diário + acumulado MTD vs LMTD com delta. */
function RichTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadEntry[]; label?: number }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  const thisCum = p.thisMonthCumulative;
  const lastCum = p.lastMonthCumulative;
  const delta = thisCum !== null && lastCum !== null && lastCum > 0
    ? Math.round(((thisCum - lastCum) / lastCum) * 100)
    : null;
  const deltaColor = delta === null ? 'text-navy/55' : delta >= 0 ? 'text-emerald-700' : 'text-rose-700';
  const deltaSign = delta === null ? '' : delta >= 0 ? '+' : '';

  return (
    <div className="rounded-lg border border-navy/15 bg-white p-3 text-xs shadow-lg">
      <div className="mb-2 font-bold text-navy">
        Dia {label} <span className="font-normal text-navy/55">({p.weekday})</span>
      </div>
      {/* Faturamento do dia */}
      <div className="mb-2 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-navy/45">Mês atual</div>
          <div className="font-mono font-bold text-navy">{p.thisMonth !== null ? brlFull(p.thisMonth) : '—'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-navy/45">Mês anterior</div>
          <div className="font-mono font-bold text-gold-700">{p.lastMonth !== null ? brlFull(p.lastMonth) : '—'}</div>
        </div>
      </div>
      {/* Acumulado MTD vs LMTD — a comparação JUSTA */}
      <div className="border-t border-navy/10 pt-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-navy/55">Acumulado até dia {label}</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-navy/45">atual</div>
            <div className="font-mono text-sm font-bold text-navy">{thisCum !== null ? brl(thisCum) : '—'}</div>
          </div>
          <div>
            <div className="text-[10px] text-navy/45">anterior (mesmo período)</div>
            <div className="font-mono text-sm font-bold text-gold-700">{lastCum !== null ? brl(lastCum) : '—'}</div>
          </div>
        </div>
        {delta !== null && (
          <div className={`mt-1 text-[11px] font-semibold ${deltaColor}`}>
            {deltaSign}{delta}% vs mesmo período do mês anterior
          </div>
        )}
      </div>
    </div>
  );
}

export function RevenueChartHome({ points, labels, todayOfMonth }: Props) {
  // Filtra dias relevantes: só dias com dado em algum dos meses (ou todos até 31 se preferir).
  const relevant = points.filter((p) => p.thisMonth !== null || p.lastMonth !== null);
  if (relevant.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-navy/45">
        Sem dados ainda — Mara precisa rodar.
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={relevant} margin={{ top: 16, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1F386415" />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11, fill: '#1F3864' }}
            tickFormatter={(d) => `${d}`}
            label={{ value: 'dia do mês', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#1F386480' }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#1F3864' }}
            tickFormatter={(v: number) => `R$ ${v.toFixed(0)}`}
          />
          <Tooltip content={<RichTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {/* Linha vertical no dia atual — pra deixar claro até onde o mês atual "existe" */}
          <ReferenceLine
            x={todayOfMonth}
            stroke="#1F3864"
            strokeOpacity={0.25}
            strokeDasharray="3 3"
            label={{ value: 'hoje', position: 'top', fontSize: 9, fill: '#1F386480' }}
          />
          <Line
            type="monotone"
            dataKey="thisMonth"
            stroke="#1F3864"
            strokeWidth={2.5}
            dot={{ r: 3, fill: '#1F3864' }}
            activeDot={{ r: 6 }}
            name={labels.thisMonth}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="lastMonth"
            stroke="#C9A84C"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={{ r: 2.5, fill: '#C9A84C' }}
            name={labels.lastMonth}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
