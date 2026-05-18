/**
 * Cron · marca complaints abandonadas (cliente sem resposta há > 2h).
 *
 * Roda via Vercel Cron (vercel.json), schedule: 0 * * * * (a cada hora).
 * Auth via Bearer CRON_SECRET no header Authorization (Vercel adiciona automático).
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSecret } from '@/lib/secrets';
import { sendText } from '@/lib/zapi/send';
import { runWithWorkerLog } from '@/lib/infra/health';

export const runtime = 'nodejs';

const ABANDON_AFTER_HOURS = 2;

export async function GET(req: Request) {
  // Vercel cron envia o header `x-vercel-cron`. Pra chamadas manuais, aceita Bearer CRON_SECRET.
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron) {
    const cronSecret = await getSecret('CRON_SECRET');
    const auth = req.headers.get('authorization');
    if (cronSecret && auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const result = await runWithWorkerLog('sac_cleanup', async () => {
    const cutoff = new Date(Date.now() - ABANDON_AFTER_HOURS * 3600 * 1000);

    const candidates = await prisma.complaint.findMany({
      where: {
        status: { in: ['AWAITING_INFO', 'AWAITING_PROOF', 'AWAITING_SLOT', 'ESCALATED'] },
        lastClientMessageAt: { lt: cutoff },
      },
      select: {
        id: true,
        customerPhone: true,
        status: true,
        slotPosition: true,
        lastClientMessageAt: true,
      },
    });

    if (candidates.length === 0) {
      return { abandoned: 0, ids: [] as string[] };
    }

    await prisma.complaint.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { status: 'ABANDONED' },
    });

    const luisPhone = await getSecret('LUIS_PHONE');
    if (luisPhone) {
      const lines = candidates.map(
        (c) =>
          `· ${c.customerPhone ?? '?'} (slot ${c.slotPosition ?? '?'}) · era ${c.status} desde ${c.lastClientMessageAt?.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) ?? '?'}`,
      );
      const msg = [
        `🚪 ${candidates.length} reclamação(ões) marcada(s) como ABANDONED (cliente sem resposta há ${ABANDON_AFTER_HOURS}h+):`,
        '',
        ...lines,
      ].join('\n');
      await sendText(luisPhone, msg).catch((e) => console.warn('[sac-cleanup] notify Luís:', e));
    }

    return { abandoned: candidates.length, ids: candidates.map((c) => c.id) };
  });

  return NextResponse.json({ ok: true, ...result });
}
