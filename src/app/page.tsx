export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold text-navy">Augusto Vendetti</h1>
      <p className="mt-2 text-lg text-navy/70">CEO autônomo · Blue Mall Rondon</p>

      <section className="mt-12 rounded-lg border border-gold/30 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-gold-900">Status</h2>
        <p className="mt-2 text-sm text-navy/80">
          Esqueleto inicial — sprints 1-4 do MVP em construção. Ver{' '}
          <code className="rounded bg-navy-50 px-1.5 py-0.5">Projects/Vending CEO/</code> no vault.
        </p>
      </section>
    </main>
  );
}
