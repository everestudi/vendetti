'use client';

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyPoint } from '@/lib/vendetti/mara/analytics';

interface Props {
  points: DailyPoint[];
  labels: { thisMonth: string; lastMonth: string };
}

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

export function RevenueChart({ points, labels }: Props) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 16, right: 16, left: 0, bottom: 4 }}>
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
          <Tooltip
            contentStyle={{ background: 'white', border: '1px solid #1F386420', borderRadius: 8, fontSize: 12 }}
            labelFormatter={(d) => `Dia ${d}`}
            formatter={(value: number | null, name) => [value !== null ? brl(value) : '—', name]}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Line
            type="monotone"
            dataKey="thisMonth"
            stroke="#1F3864"
            strokeWidth={2.5}
            dot={{ r: 3, fill: '#1F3864' }}
            activeDot={{ r: 5 }}
            name={labels.thisMonth}
            connectNulls={false}
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
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
