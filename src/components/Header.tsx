'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { logout } from '@/app/login/actions';

const TEAM_LINKS: { href: string; label: string; agent: string }[] = [
  { href: '/mara', label: 'Análise · Mara', agent: 'mara' },
  { href: '/bruno', label: 'Compras · Bruno', agent: 'bruno' },
  { href: '/sac', label: 'SAC vending · Lúcia', agent: 'lucia' },
  { href: '/atendimento', label: 'Atendimento Bluemall · Lúcia', agent: 'lucia' },
  { href: '/leads', label: 'Leads locação · Lúcia', agent: 'lucia' },
  { href: '/equipe/rita', label: 'Operações · Rita', agent: 'rita' },
  { href: '/equipe/zelda', label: 'Oversight · Zelda', agent: 'zelda' },
];

export function Header() {
  const pathname = usePathname();
  const [teamOpen, setTeamOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) setTeamOpen(false);
    }
    if (teamOpen) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [teamOpen]);

  // Fecha dropdown ao trocar de rota
  useEffect(() => setTeamOpen(false), [pathname]);

  if (pathname === '/login') return null;

  const isTeamActive =
    pathname.startsWith('/equipe') ||
    TEAM_LINKS.some((l) => pathname === l.href || pathname.startsWith(`${l.href}/`));
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

          {/* Equipe (dropdown) */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setTeamOpen((o) => !o)}
              className={`flex items-center gap-1 ${navLinkClass(isTeamActive)}`}
              aria-expanded={teamOpen}
            >
              Equipe
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
                <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </button>
            {teamOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-lg border border-navy/15 bg-white py-2 shadow-lg">
                {TEAM_LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="block px-4 py-1.5 text-sm text-navy hover:bg-navy/5"
                  >
                    {l.label}
                  </Link>
                ))}
                <div className="my-1 border-t border-navy/10" />
                <Link href="/equipe" className="block px-4 py-1.5 text-sm text-navy/70 hover:bg-navy/5">
                  Ver todos →
                </Link>
              </div>
            )}
          </div>

          <Link href="/vendetti" className={navLinkClass(isCeoActive)}>
            Augusto Vendetti
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            title="Settings"
            aria-label="Settings"
            className="text-navy/50 hover:text-navy"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
          <form action={logout}>
            <button
              type="submit"
              title="Sair"
              aria-label="Sair"
              className="text-navy/40 transition-colors hover:text-navy"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
