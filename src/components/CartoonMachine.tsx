/**
 * Cartoon da vending machine TCN Pro 6G — SVG inline, ~240x400.
 * Aceita props pra mostrar status (capacity, críticos, online).
 */

interface CartoonMachineProps {
  capacityPct: number;
  slotsCritical: number;
  slotsTotal: number;
  online?: boolean;
  className?: string;
}

export function CartoonMachine({ capacityPct, slotsCritical, slotsTotal, online = true, className }: CartoonMachineProps) {
  const slots = Array.from({ length: 30 }, (_, i) => i);
  const criticalSet = new Set(
    Array.from({ length: slotsCritical }, (_, i) => (i * 7 + 3) % 30),
  );

  return (
    <div className={className}>
      <svg
        viewBox="0 0 260 420"
        className="h-auto w-full max-w-[260px]"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Vending machine TCN Pro 6G"
      >
        {/* corpo */}
        <rect x="10" y="10" width="240" height="400" rx="16" fill="#1F3864" />
        <rect x="10" y="10" width="240" height="400" rx="16" fill="none" stroke="#0F1C32" strokeWidth="3" />

        {/* faixa "VENDETTI" gold no topo */}
        <rect x="18" y="20" width="224" height="22" rx="4" fill="#C9A84C" />
        <text x="130" y="35" fontSize="13" fontWeight="700" fontFamily="ui-sans-serif" fill="#1F3864" textAnchor="middle" letterSpacing="2">
          VENDETTI
        </text>

        {/* janela de produtos (vidro) */}
        <rect x="22" y="52" width="216" height="232" rx="6" fill="#0F1C32" />
        <rect x="26" y="56" width="208" height="224" rx="4" fill="#F4F6FA" />

        {/* grid de slots 5 cols × 6 rows */}
        {slots.map((i) => {
          const col = i % 5;
          const row = Math.floor(i / 5);
          const x = 30 + col * 40;
          const y = 60 + row * 36;
          const critical = criticalSet.has(i);
          return (
            <g key={i}>
              <rect x={x} y={y} width="36" height="32" rx="3" fill={critical ? '#FECACA' : '#E8ECF4'} stroke="#1F3864" strokeWidth="0.5" />
              {critical && (
                <text x={x + 18} y={y + 21} fontSize="14" fill="#B91C1C" textAnchor="middle">⚠</text>
              )}
            </g>
          );
        })}

        {/* painel digital + slot moeda */}
        <rect x="22" y="294" width="120" height="56" rx="4" fill="#0F1C32" />
        <text x="32" y="312" fontSize="9" fontFamily="ui-monospace" fill="#C9A84C">
          ▸ DIGITE
        </text>
        <text x="32" y="326" fontSize="9" fontFamily="ui-monospace" fill="#C9A84C">
          ▸ O CÓDIGO
        </text>
        <text x="32" y="340" fontSize="9" fontFamily="ui-monospace" fill={online ? '#10b981' : '#f43f5e'}>
          ● {online ? 'ONLINE' : 'OFFLINE'}
        </text>

        {/* teclado numérico */}
        <g fill="#1F3864" stroke="#0F1C32" strokeWidth="0.5">
          {[0, 1, 2, 3].map((row) =>
            [0, 1, 2].map((col) => (
              <rect key={`${row}-${col}`} x={154 + col * 28} y={294 + row * 14} width="22" height="10" rx="1" fill="#E8ECF4" />
            )),
          )}
        </g>

        {/* moeda + pix sticker */}
        <circle cx="40" cy="370" r="8" fill="#C9A84C" stroke="#0F1C32" strokeWidth="1" />
        <text x="40" y="374" fontSize="8" fontWeight="700" fill="#1F3864" textAnchor="middle">$</text>

        {/* output flap */}
        <rect x="100" y="358" width="140" height="40" rx="3" fill="#0F1C32" />
        <rect x="104" y="362" width="132" height="32" rx="2" fill="#1F3864" stroke="#C9A84C" strokeWidth="1" />
        <text x="170" y="382" fontSize="9" fill="#C9A84C" textAnchor="middle">RETIRE AQUI</text>

        {/* badge capacity sobreposto */}
        <g>
          <rect x="178" y="62" width="58" height="40" rx="4" fill="#1F3864" />
          <text x="207" y="76" fontSize="8" fill="#C9A84C" textAnchor="middle" fontWeight="700">CAPACITY</text>
          <text x="207" y="93" fontSize="14" fill="white" textAnchor="middle" fontWeight="700">
            {capacityPct.toFixed(0)}%
          </text>
        </g>

        {/* badge críticos */}
        {slotsCritical > 0 && (
          <g>
            <rect x="178" y="244" width="58" height="34" rx="4" fill="#B91C1C" />
            <text x="207" y="257" fontSize="8" fill="white" textAnchor="middle" fontWeight="700">CRÍTICOS</text>
            <text x="207" y="272" fontSize="14" fill="white" textAnchor="middle" fontWeight="700">
              {slotsCritical}/{slotsTotal}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
