import { prisma } from '../src/lib/db';
async function main() {
  const opens = await prisma.complaint.findMany({
    where: { status: { in: ['RECEIVED', 'AWAITING_PROOF', 'AWAITING_SLOT'] } },
    select: { id: true, customerPhone: true, status: true, receivedAt: true, customerNote: true }
  });
  console.log('Complaints abertas:', opens.length);
  for (const c of opens) {
    console.log(`  ${c.id} | ${c.customerPhone} | ${c.status} | ${c.receivedAt.toISOString()}`);
    console.log(`    note: ${(c.customerNote ?? '').slice(0, 80)}`);
  }
  if (process.argv.includes('--purge')) {
    const r = await prisma.complaint.updateMany({
      where: { status: { in: ['RECEIVED', 'AWAITING_PROOF', 'AWAITING_SLOT'] } },
      data: { status: 'DISMISSED' },
    });
    console.log('Marcadas DISMISSED:', r.count);
  } else {
    console.log('\n(run com --purge pra marcar como DISMISSED)');
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
