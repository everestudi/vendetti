'use client';

import dynamic from 'next/dynamic';

const ChatVendetti = dynamic(() => import('./ChatVendetti').then((m) => m.ChatVendetti), {
  ssr: false,
  loading: () => (
    <div className="flex h-[560px] items-center justify-center rounded-lg border border-navy/10 bg-navy-50/30 text-sm text-navy/45">
      Carregando chat...
    </div>
  ),
});

export function ChatVendettiDynamic({ heightClass, hideHeader }: { heightClass?: string; hideHeader?: boolean }) {
  return <ChatVendetti heightClass={heightClass} hideHeader={hideHeader} />;
}
