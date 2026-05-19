'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { logout } from '@/app/login/actions';

const GEAR_LINKS: { href: string; label: string; emoji: string }[] = [
  { href: '/sobre', label: 'Sobre', emoji: '👋' },
  { href: '/evolucao', label: 'Evolução do projeto', emoji: '📈' },
  { href: '/equipe', label: 'Equipe', emoji: '👥' },
  { href: '/settings', label: 'Configurações', emoji: '⚙️' },
];

export function Header() {
  const pathname = usePathname();
  const [gearOpen, setGearOpen] = useState(false);
  const gearRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!gearRef.current?.contains(e.target as Node)) setGearOpen(false);
    }
    if (gearOpen) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [gearOpen]);

  useEffect(() => setGearOpen(false), [pathname]);

  if (pathname === '/login') return null;

  const isCeoActive =
    pathname === '/vendetti' || pathname === '/chat' || pathname === '/decisions' || pathname === '/monitor';

  const navLinkClass = (active: boolean) =>
    `text-sm transition-colors ${active ? 'font-semibold text-navy' : 'text-navy/60 hover:text-navy'}`;

  return (
    <header className="border-b border-navy/10 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-bold text-navy">
          Vendetti
        </Link>

        <nav className="flex items-center gap-6">
          <Link href="/" className={navLinkClass(pathname === '/')}>
            Home
          </Link>

          <Link href="/vendetti" className={navLinkClass(isCeoActive)}>
            Augusto Vendetti
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          {/* Engrenagem · dropdown */}
          <div className="relative" ref={gearRef}>
            <button
              type="button"
              onClick={() => setGearOpen((o) => !o)}
              title="Menu"
              aria-label="Menu"
              aria-expanded={gearOpen}
              className="text-navy/50 hover:text-navy"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            {gearOpen && (
              <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-lg border border-navy/15 bg-white py-2 shadow-lg">
                {GEAR_LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`flex items-center gap-2 px-4 py-1.5 text-sm ${
                      pathname === l.href ? 'bg-navy/5 font-semibold text-navy' : 'text-navy hover:bg-navy/5'
                    }`}
                  >
                    <span>{l.emoji}</span>
                    <span>{l.label}</span>
                  </Link>
                ))}
                <div className="my-1 border-t border-navy/10" />
                <form action={logout} className="block">
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm text-rose-700 hover:bg-rose-50"
                  >
                    <span>🚪</span>
                    <span>Sair</span>
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
