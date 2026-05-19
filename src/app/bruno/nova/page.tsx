'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface SkuMatch {
  id: string;
  code: string;
  name: string;
  score: number;
}
interface ParsedItem {
  productName: string;
  productCode?: string | null;
  qty: number;
  unitCost: number;
  totalCost: number;
  originalUnitCost?: number;
  skuMatch?: SkuMatch;
}
interface ParsedDoc {
  supplier: 'ATACADAO' | 'VITTAL' | 'OUTRO';
  supplierName: string | null;
  invoiceRef: string | null;
  occurredAt: string | null;
  subtotalAmount?: number | null;
  discountAmount?: number;
  totalAmount: number;
  items: ParsedItem[];
}

interface SkuOption {
  id: string;
  code: string;
  name: string;
  category: string;
  cost: number;
  price: number;
}

interface EditableItem extends ParsedItem {
  /// linkar ao SKU sugerido ('match'), criar novo ('new'), ou ignorar ('skip')
  action: 'match' | 'new' | 'skip';
  /// SKU vinculado manualmente (sobrescreve skuMatch quando action === 'match')
  manualSku?: SkuOption;
}

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

export default function NovaCompraPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl px-4 py-8 text-sm text-navy/60">Carregando…</div>}>
      <NovaCompraInner />
    </Suspense>
  );
}

function NovaCompraInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillId = searchParams.get('prefill');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [parsed, setParsed] = useState<ParsedDoc | null>(null);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!prefillId) return;
    let cancelled = false;
    fetch(`/api/bruno-nfe/prefill/${prefillId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json.ok) return;
        const doc: ParsedDoc = json.parsed;
        setParsed(doc);
        setItems(
          doc.items.map((it) => ({
            ...it,
            action: it.skuMatch && it.skuMatch.score >= 70 ? 'match' : 'new',
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setError('Não consegui carregar o prefill (expirou ou link inválido).');
      });
    return () => {
      cancelled = true;
    };
  }, [prefillId]);

  function pickFile(f: File) {
    setFile(f);
    if (f.type.startsWith('image/')) {
      setPreviewUrl(URL.createObjectURL(f));
    } else {
      setPreviewUrl(null);
    }
    setParsed(null);
    setItems([]);
    setError(null);
  }

  async function handleParse() {
    if (!file) return;
    setParsing(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/bruno-nfe/parse', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'falha no parse');
      const doc: ParsedDoc = json.parsed;
      setParsed(doc);
      setItems(
        doc.items.map((it) => ({
          ...it,
          action: it.skuMatch && it.skuMatch.score >= 70 ? 'match' : 'new',
        })),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setParsing(false);
    }
  }

  async function handleConfirm() {
    if (!parsed) return;
    setConfirming(true);
    setError(null);
    try {
      const payload = {
        supplier: parsed.supplier,
        supplierName: parsed.supplierName,
        invoiceRef: parsed.invoiceRef,
        occurredAt: parsed.occurredAt ?? new Date().toISOString().slice(0, 10),
        totalAmount: parsed.totalAmount,
        notes: notes || null,
        source: 'ui-upload',
        items: items
          .filter((it) => it.action !== 'skip')
          .map((it) => ({
            skuId:
              it.action === 'match' ? it.manualSku?.id ?? it.skuMatch?.id ?? null : null,
            productName: it.productName,
            productCode: it.productCode ?? null,
            qty: it.qty,
            unitCost: it.unitCost,
            totalCost: it.totalCost,
            // Pra Zelda auditar: o que o matcher sugeriu vs o que Luís escolheu
            suggestedSkuId: it.skuMatch?.id ?? null,
            suggestedScore: it.skuMatch?.score ?? null,
            suggestedName: it.skuMatch?.name ?? null,
            finalAction: it.action, // 'match' | 'new'
          })),
        rawParsed: parsed,
      };
      const res = await fetch('/api/bruno-nfe/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || 'falha ao gravar');
      router.push('/bruno');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  function updateItem(i: number, patch: Partial<EditableItem>) {
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  const computedTotal = items
    .filter((it) => it.action !== 'skip')
    .reduce((s, it) => s + it.totalCost, 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <div className="text-xs text-navy/60">
          <Link href="/bruno" className="hover:underline">
            ← Compras
          </Link>
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-navy">Nova compra</h1>
        <p className="text-sm text-navy/70">
          Manda foto da NF/cupom ou PDF — a Rita extrai os itens, você revisa e confirma.
        </p>
      </header>

      {!parsed && (
        <section className="rounded-lg border border-navy/15 bg-white p-6">
          <label
            htmlFor="nfe-file"
            className="block cursor-pointer rounded-lg border-2 border-dashed border-navy/25 px-6 py-12 text-center hover:border-navy/50 hover:bg-navy/5"
          >
            <div className="text-3xl">📎</div>
            <div className="mt-2 font-medium text-navy">
              {file ? file.name : 'Clica pra escolher ou arrasta o arquivo aqui'}
            </div>
            <div className="mt-1 text-xs text-navy/60">JPG, PNG, WebP ou PDF · até 8MB</div>
            <input
              ref={fileInputRef}
              id="nfe-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickFile(f);
              }}
            />
          </label>

          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="preview"
              className="mt-4 max-h-72 rounded border border-navy/15"
            />
          )}

          {error && (
            <div className="mt-4 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={!file || parsing}
              onClick={handleParse}
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white shadow disabled:bg-navy/30"
            >
              {parsing ? 'Lendo com vision…' : 'Ler NF-e'}
            </button>
          </div>
        </section>
      )}

      {parsed && (
        <section className="space-y-6">
          <div className="rounded-lg border border-navy/15 bg-white p-5">
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <Field label="Fornecedor" value={`${parsed.supplier}${parsed.supplierName ? ` · ${parsed.supplierName}` : ''}`} />
              <Field label="NF" value={parsed.invoiceRef ?? '—'} />
              <Field label="Data" value={parsed.occurredAt ?? '—'} />
              <Field label="Total NF" value={brl(parsed.totalAmount)} />
            </div>
            {(parsed.discountAmount ?? 0) > 0 && (
              <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                💸 Desconto da NF: <strong>{brl(parsed.discountAmount!)}</strong>
                {parsed.subtotalAmount && (
                  <> · Subtotal antes do desconto: {brl(parsed.subtotalAmount)}</>
                )}
                <span className="ml-1 text-emerald-700/70">
                  — rateado proporcionalmente nos itens (custo unit ajustado)
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-navy/15 bg-white">
            <div className="border-b border-navy/10 px-4 py-3 text-sm font-medium text-navy">
              Itens ({items.length}) · soma {brl(computedTotal)}
              {Math.abs(computedTotal - parsed.totalAmount) > 0.5 && (
                <span className="ml-3 text-amber-700">
                  ⚠️ diverge {brl(Math.abs(computedTotal - parsed.totalAmount))} do total
                </span>
              )}
            </div>
            <ul className="divide-y divide-navy/10">
              {items.map((it, i) => (
                <li key={i} className="px-4 py-3">
                  <div className="grid grid-cols-12 items-start gap-2 text-sm">
                    <input
                      className="col-span-4 rounded border border-navy/15 px-2 py-1"
                      value={it.productName}
                      onChange={(e) => updateItem(i, { productName: e.target.value })}
                    />
                    <input
                      className="col-span-1 rounded border border-navy/15 px-2 py-1 text-right"
                      type="number"
                      value={it.qty}
                      onChange={(e) => updateItem(i, { qty: parseInt(e.target.value) || 0 })}
                    />
                    <span className="col-span-1 pt-1 text-center text-navy/50">×</span>
                    <div className="col-span-2">
                      <input
                        className="w-full rounded border border-navy/15 px-2 py-1 text-right"
                        type="number"
                        step="0.01"
                        value={it.unitCost}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value) || 0;
                          updateItem(i, { unitCost: v, totalCost: v * it.qty });
                        }}
                      />
                      {it.originalUnitCost != null && it.originalUnitCost !== it.unitCost && (
                        <div className="mt-0.5 text-[10px] text-navy/40">
                          NF: {brl(it.originalUnitCost)}
                        </div>
                      )}
                    </div>
                    <span className="col-span-1 pt-1 text-right text-navy/70">{brl(it.totalCost)}</span>
                    <div className="col-span-3">
                      <SkuLinker item={it} onChange={(patch) => updateItem(i, patch)} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label className="block text-xs text-navy/70">Observações (opcional)</label>
            <textarea
              className="mt-1 w-full rounded border border-navy/15 px-3 py-2 text-sm"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: entregue no Bluemall pelo Weverton em 14/05"
            />
          </div>

          {error && (
            <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => {
                setParsed(null);
                setItems([]);
                setFile(null);
                setPreviewUrl(null);
              }}
              className="text-sm text-navy/60 underline"
            >
              ← Trocar arquivo
            </button>
            <button
              type="button"
              disabled={confirming || items.filter((it) => it.action !== 'skip').length === 0}
              onClick={handleConfirm}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow disabled:bg-emerald-300"
            >
              {confirming ? 'Gravando…' : `Confirmar e gravar (${items.filter((it) => it.action !== 'skip').length} itens)`}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

function SkuLinker({
  item,
  onChange,
}: {
  item: EditableItem;
  onChange: (patch: Partial<EditableItem>) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SkuOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!searching) return;
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(() => {
      fetch(`/api/bruno-nfe/sku-search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((j) => {
          if (cancelled) return;
          setResults(j.results ?? []);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, searching]);

  const linkedSku = item.manualSku ?? (item.action === 'match' ? item.skuMatch : null);

  if (searching) {
    return (
      <div className="space-y-1">
        <input
          autoFocus
          className="w-full rounded border border-navy/40 px-2 py-1"
          placeholder="buscar SKU (ex: powerade)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {loading && <div className="text-[10px] text-navy/40">buscando…</div>}
        {results.length > 0 && (
          <ul className="max-h-40 overflow-y-auto rounded border border-navy/15 bg-white text-xs shadow-sm">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="block w-full px-2 py-1.5 text-left hover:bg-navy/5"
                  onClick={() => {
                    onChange({
                      action: 'match',
                      manualSku: r,
                    });
                    setSearching(false);
                    setQ('');
                  }}
                >
                  <div className="font-medium text-navy">{r.name}</div>
                  <div className="text-[10px] text-navy/50">
                    {r.code} · {r.category}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!loading && q.trim().length >= 2 && results.length === 0 && (
          <div className="text-[10px] text-navy/40">nenhum SKU encontrado</div>
        )}
        <button
          type="button"
          className="text-[10px] text-navy/50 underline"
          onClick={() => {
            setSearching(false);
            setQ('');
          }}
        >
          cancelar busca
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <select
        className="w-full rounded border border-navy/15 px-2 py-1"
        value={item.action}
        onChange={(e) => onChange({ action: e.target.value as EditableItem['action'], manualSku: undefined })}
      >
        <option value="match" disabled={!linkedSku}>
          {linkedSku
            ? `↪ ${item.manualSku ? '🔗' : `${item.skuMatch?.score ?? 0}%`} ${linkedSku.name.slice(0, 28)}`
            : '↪ sem match'}
        </option>
        <option value="new">＋ criar SKU novo</option>
        <option value="skip">⨯ ignorar</option>
      </select>
      <button
        type="button"
        className="text-[10px] text-navy/60 underline hover:text-navy"
        onClick={() => setSearching(true)}
      >
        🔍 buscar SKU manual
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-navy/50">{label}</div>
      <div className="mt-0.5 font-medium text-navy">{value}</div>
    </div>
  );
}
