'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/login/actions';

export function Header() {
  const pathname = usePathname();
  if (pathname === '/login') return null;

  const NavLink = ({ href, label }: { href: string; label: string }) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className={`text-sm transition-colors ${active ? 'font-semibold text-navy' : 'text-navy/60 hover:text-navy'}`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="border-b border-navy/10 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-bold text-navy">
          Vendetti
        </Link>
        <nav className="flex items-center gap-6">
          <NavLink href="/" label="Home" />
          <NavLink href="/chat" label="Chat" />
          <NavLink href="/decisions" label="Decisões" />
          <NavLink href="/mara" label="Mara" />
          <NavLink href="/equipe" label="Equipe" />
          <NavLink href="/ideias" label="Ideias" />
          <NavLink href="/settings" label="Settings" />
          <form action={logout}>
            <button type="submit" className="text-sm text-navy/60 transition-colors hover:text-navy">
              Sair
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
