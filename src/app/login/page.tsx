import { login } from './actions';

export default function LoginPage({ searchParams }: { searchParams: { error?: string; next?: string } }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-50 px-6">
      <form action={login} className="w-full max-w-sm space-y-4 rounded-lg border border-gold/30 bg-white p-6 shadow">
        <div>
          <h1 className="text-2xl font-bold text-navy">Augusto Vendetti</h1>
          <p className="text-sm text-navy/60">Entre para configurar.</p>
        </div>
        <input type="hidden" name="next" value={searchParams.next ?? '/'} />
        <input
          type="password"
          name="password"
          placeholder="Senha de bootstrap"
          required
          autoFocus
          className="w-full rounded border border-navy/20 px-3 py-2 text-base"
        />
        {searchParams.error && <p className="text-sm text-red-600">{searchParams.error}</p>}
        <button type="submit" className="w-full rounded bg-navy py-2 font-semibold text-white">
          Entrar
        </button>
      </form>
    </main>
  );
}
