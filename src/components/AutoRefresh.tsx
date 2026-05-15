'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  intervalMs?: number;
}

/**
 * Refresh server data periodicamente — só enquanto o componente está montado.
 * Substitui `<meta http-equiv="refresh">` que ficava global e seguia o user.
 */
export function AutoRefresh({ intervalMs = 20_000 }: Props) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
