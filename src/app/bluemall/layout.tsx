import Link from 'next/link';
import type { ReactNode } from 'react';
import { logout } from '@/app/login/actions';

export const metadata = {
  title: 'Portal Bluemall Rondon',
};

/**
 * Layout do Portal Bluemall Rondon — branding e nav próprios, separados
 * do Vendetti (que opera só a vending machine).
 *
 * O portal cobre operação do shopping em si: leads de locação, atendimento
 * geral aos visitantes, lojistas, etc.
 */
export default function BluemallLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50/40 via-white to-cyan-50/30">
      <header className="border-b border-emerald-200/60 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/bluemall" className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-emerald-900">Bluemall Rondon</span>
            <span className="text-xs uppercase tracking-widest text-emerald-700/70">Portal</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link
              href="/bluemall"
              className="text-emerald-900/70 transition-colors hover:text-emerald-900"
            >
              Início
            </Link>
            <Link
              href="/bluemall/leads"
              className="text-emerald-900/70 transition-colors hover:text-emerald-900"
            >
              Leads de Locação
            </Link>
            <Link
              href="/bluemall/atendimento"
              className="text-emerald-900/70 transition-colors hover:text-emerald-900"
            >
              Atendimento
            </Link>
            <Link
              href="/"
              className="rounded border border-navy/15 px-2.5 py-1 text-xs text-navy/60 hover:bg-navy-50/40 hover:text-navy"
              title="Voltar ao Vendetti (operação vending)"
            >
              ← Vendetti
            </Link>
            <form action={logout}>
              <button
                type="submit"
                title="Sair"
                className="text-emerald-900/40 transition-colors hover:text-emerald-900"
              >
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </form>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
