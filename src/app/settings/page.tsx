import { listSecretStatus } from '@/lib/secrets';
import { saveSecret, generateAndSaveSecret } from './actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const secrets = await listSecretStatus();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Settings</h1>
        <p className="text-sm text-navy/60">
          Credenciais e API keys. Cifrado em AES-256-GCM antes de ir pro banco. Nunca aparece em logs nem no chat.
        </p>
      </header>

      <ul className="space-y-3">
        {secrets.map((s) => (
          <li key={s.key} className="rounded-lg border border-navy/10 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="font-semibold text-navy">{s.label}</div>
                {s.hint && <div className="text-xs text-navy/50">{s.hint}</div>}
              </div>
              <StatusPill source={s.source} />
            </div>
            <div className="flex flex-wrap gap-2">
              <form action={saveSecret} className="flex flex-1 min-w-0 gap-2">
                <input type="hidden" name="key" value={s.key} />
                <input
                  type="password"
                  name="value"
                  placeholder={s.source === 'missing' ? 'cole o valor aqui' : 'substituir valor atual'}
                  className="flex-1 min-w-0 rounded border border-navy/20 px-3 py-2 text-base"
                  autoComplete="off"
                />
                <button type="submit" className="rounded bg-gold px-4 py-2 font-semibold text-navy-900">
                  Salvar
                </button>
              </form>
              {'generatable' in s && s.generatable && (
                <form action={generateAndSaveSecret.bind(null, s.key)}>
                  <button
                    type="submit"
                    title="Gera um token aleatório (32 bytes base64url) e salva direto"
                    className="rounded border border-navy/25 px-3 py-2 text-sm font-medium text-navy hover:bg-navy/5"
                  >
                    🔐 Gerar
                  </button>
                </form>
              )}
            </div>
            {s.updatedAt && (
              <div className="mt-2 text-xs text-navy/40">
                Atualizado em {new Date(s.updatedAt).toLocaleString('pt-BR')}
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

function StatusPill({ source }: { source: 'db' | 'env' | 'missing' }) {
  const config = {
    db: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'configurado' },
    env: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'via .env' },
    missing: { bg: 'bg-red-100', text: 'text-red-800', label: 'faltando' },
  }[source];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}
