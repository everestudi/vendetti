/**
 * Dispara workflows do GitHub Actions via `repository_dispatch`.
 * Usado pelo Augusto (tools) e pelo Vercel (após /api/bruno-nfe/confirm).
 *
 * Requer GITHUB_PAT no DB (mesmo já usado em outros lugares).
 */

import { getSecret } from '../secrets';

const DEFAULT_REPO = 'everestudi/vendetti';

export type WorkflowEventType =
  | 'mara-sync'
  | 'vendtef-sync'
  | 'vendtef-abastecimento'
  | 'sac-cleanup'
  // Testes Vendtef via Augusto/Rita (mapeamento solicitado pelo Luís)
  | 'vendtef-test-login'
  | 'vendtef-test-inventory'
  | 'vendtef-test-sales'
  | 'vendtef-test-explore'
  | 'vendtef-test-slot-update';

export interface DispatchResult {
  ok: boolean;
  error?: string;
}

export async function dispatchWorkflow(
  eventType: WorkflowEventType,
  payload: Record<string, unknown> = {},
): Promise<DispatchResult> {
  const pat = await getSecret('GITHUB_PAT');
  if (!pat) return { ok: false, error: 'GITHUB_PAT ausente' };
  const repo = (await getSecret('GITHUB_REPO')) || DEFAULT_REPO;

  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        event_type: eventType,
        client_payload: payload,
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { ok: false, error: `GH dispatch HTTP ${r.status}: ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
