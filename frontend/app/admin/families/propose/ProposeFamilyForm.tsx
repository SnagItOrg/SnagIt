'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TextField } from '@/components/TextField'
import { Button } from '@/components/Button'
import { ToastViewport } from '@/components/Toast'
import { useToast } from '@/lib/use-toast'
import { useLocale } from '@/components/LocaleProvider'
import { fill } from '@/lib/i18n'
// Type-only: `family-proposal.ts` reaches `catalogue.ts`, which is server-only.
import type { FamilyPatch, ProposalIssue, ProposalResult } from '@/lib/family-proposal'

export type RootOption = { slug: string; name: string }
type Hit = { slug: string; canonical_name: string; kg_brand: { name: string } | { name: string }[] | null }
type Member = { slug: string; name: string; brand: string | null }

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function brandOf(hit: Hit): string | null {
  const b = Array.isArray(hit.kg_brand) ? hit.kg_brand[0] : hit.kg_brand
  return b?.name ?? null
}

const PATCH_PARTS: Array<{ key: keyof FamilyPatch; title: string }> = [
  { key: 'familySlugs', title: 'lib/family-slugs.ts' },
  { key: 'families', title: 'lib/families.ts' },
  { key: 'test', title: 'scripts/lib/wp2-families.test.ts' },
]

export default function ProposeFamilyForm({ roots }: { roots: RootOption[] }) {
  const { toasts, showToast, dismissToast } = useToast()
  const { t } = useLocale()
  // Coded issues (PAN-194) carry their copy in lib/i18n.ts; the rest are Danish.
  const issueText = (issue: ProposalIssue) =>
    issue.code ? fill(t.adminFamilyProposal[issue.code], issue.params ?? {}) : issue.message

  const [label, setLabel] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [brand, setBrand] = useState('')
  const [brandTouched, setBrandTouched] = useState(false)
  const [root, setRoot] = useState('')
  const [members, setMembers] = useState<Member[]>([])

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])

  const [result, setResult] = useState<ProposalResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkFailed, setCheckFailed] = useState(false)

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(label))
  }, [label, slugTouched])

  useEffect(() => {
    if (!brandTouched) setBrand(members[0]?.brand ?? '')
  }, [members, brandTouched])

  // Member search reuses the admin product search (active rows, by name).
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/admin/match/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setHits((d.products ?? []) as Hit[]))
        .catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  // Live validation: every change is checked against the catalogue as it is now.
  useEffect(() => {
    if (!slug && members.length === 0) {
      setResult(null)
      setChecking(false)
      return
    }
    // Until this check answers, the patch on screen describes the previous
    // input, so it is hidden rather than offered for copying.
    setChecking(true)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch('/api/admin/families/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, label, brand, categoryRoot: root, members: members.map((m) => m.slug) }),
        signal: controller.signal,
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status))
          setResult((await r.json()) as ProposalResult)
          setCheckFailed(false)
        })
        .catch(() => {
          if (controller.signal.aborted) return
          setCheckFailed(true)
          setResult(null)
        })
        .finally(() => {
          if (!controller.signal.aborted) setChecking(false)
        })
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [slug, label, brand, root, members])

  function addMember(hit: Hit) {
    setMembers((prev) =>
      prev.some((m) => m.slug === hit.slug)
        ? prev
        : [...prev, { slug: hit.slug, name: hit.canonical_name, brand: brandOf(hit) }],
    )
    setQuery('')
    setHits([])
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      showToast('Kopieret.')
    } catch {
      showToast('Kunne ikke kopiere. Markér teksten og kopiér manuelt.', { type: 'error' })
    }
  }

  const errors = result?.issues.filter((i) => i.severity === 'error') ?? []
  const warnings = result?.issues.filter((i) => i.severity === 'warning') ?? []
  const reportBySlug = new Map((result?.members ?? []).map((m) => [m.slug, m]))
  const patch = checking ? null : (result?.patch ?? null)

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>
            Foreslå familie
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            Kontrolleres mod kataloget, mens du skriver. Intet gemmes her: koden nedenfor lander som en PR.
          </p>
        </div>
        <Link
          href="/admin/products"
          className="text-xs font-semibold px-3 py-2 rounded-xl"
          style={{ background: 'var(--secondary)', color: 'var(--muted-foreground)' }}
        >
          ← Produkter
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="family-label" label="Navn" helper="Aldrig et medlems eget navn. Eksempel: Roland Juno">
          <TextField
            id="family-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Roland Juno"
            className="w-full rounded-xl px-4 py-2.5 text-sm"
          />
        </Field>
        <Field id="family-slug" label="Slug" helper="Aldrig et supported produkts slug.">
          <TextField
            id="family-slug"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }}
            placeholder="roland-juno"
            className="w-full rounded-xl px-4 py-2.5 text-sm font-mono"
          />
        </Field>
        <Field id="family-brand" label="Brand" helper="Udfyldes fra første medlem.">
          <TextField
            id="family-brand"
            value={brand}
            onChange={(e) => { setBrand(e.target.value); setBrandTouched(true) }}
            placeholder="Roland"
            className="w-full rounded-xl px-4 py-2.5 text-sm"
          />
        </Field>
        <Field id="family-root" label="Hovedkategori" helper="Alle medlemmer skal ligge under den.">
          <select
            id="family-root"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            className="field w-full rounded-xl px-4 py-2.5 text-sm"
          >
            <option value="">Vælg…</option>
            {roots.map((r) => (
              <option key={r.slug} value={r.slug}>{r.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field id="family-member-search" label="Medlemmer" helper="Kun eksisterende KG-rækker, i den rækkefølge familien skal vise dem.">
        <TextField
          id="family-member-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Søg produkt…"
          autoComplete="off"
          className="w-full rounded-xl px-4 py-2.5 text-sm"
        />
        {hits.length > 0 && (
          <ul className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {hits.map((hit) => (
              <li key={hit.slug}>
                <button
                  type="button"
                  onClick={() => addMember(hit)}
                  className="w-full text-left px-4 py-2 text-sm"
                  style={{ color: 'var(--foreground)' }}
                >
                  {hit.canonical_name} <span className="font-mono text-xs" style={{ color: 'var(--muted-foreground)' }}>{hit.slug}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Field>

      {members.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {members.map((m) => {
            const report = reportBySlug.get(m.slug)
            const memberIssues = result?.issues.filter((i) => i.member === m.slug) ?? []
            return (
              <li key={m.slug} className="rounded-xl px-4 py-2" style={{ background: 'var(--secondary)' }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm" style={{ color: 'var(--foreground)' }}>
                    {m.name} <span className="font-mono text-xs" style={{ color: 'var(--muted-foreground)' }}>{m.slug}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    {report?.state && <span>{report.state}</span>}
                    {report && <span className="font-semibold">{report.renders ? 'Vises' : 'Vises ikke'}</span>}
                    <button
                      type="button"
                      onClick={() => setMembers((prev) => prev.filter((x) => x.slug !== m.slug))}
                      aria-label={`Fjern ${m.name}`}
                      className="px-2"
                    >
                      Fjern
                    </button>
                  </div>
                </div>
                {memberIssues.map((issue, i) => (
                  <p
                    key={i}
                    className="text-xs mt-1"
                    style={{ color: issue.severity === 'error' ? 'var(--destructive-text)' : 'var(--muted-foreground)' }}
                  >
                    {issue.severity === 'error' ? 'Fejl: ' : 'Bemærk: '}
                    {issueText(issue)}
                  </p>
                ))}
              </li>
            )
          })}
        </ol>
      )}

      <section aria-live="polite" className="flex flex-col gap-2">
        {checking && <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Kontrollerer…</p>}
        {checkFailed && (
          <p className="text-sm" style={{ color: 'var(--destructive-text)' }}>
            Kataloget svarede ikke. Forslaget er ikke kontrolleret.
          </p>
        )}
        {[...errors, ...warnings]
          .filter((issue) => !issue.member)
          .map((issue, i) => (
            <p
              key={i}
              className="text-sm"
              style={{ color: issue.severity === 'error' ? 'var(--destructive-text)' : 'var(--muted-foreground)' }}
            >
              {issue.severity === 'error' ? 'Fejl: ' : 'Bemærk: '}
              {issueText(issue)}
            </p>
          ))}
      </section>

      {patch && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold" style={{ color: 'var(--foreground)' }}>
            Kode til PR
          </h2>
          {PATCH_PARTS.map(({ key, title }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold font-mono" style={{ color: 'var(--foreground)' }}>{title}</span>
                <Button variant="secondary" onClick={() => copy(patch[key])} className="text-xs font-semibold px-3 py-1.5 rounded-xl">
                  Kopiér
                </Button>
              </div>
              <pre
                className="text-xs font-mono rounded-xl p-4 overflow-x-auto"
                style={{ background: 'var(--secondary)', color: 'var(--foreground)' }}
              >
                {patch[key]}
              </pre>
            </div>
          ))}
        </section>
      )}

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

function Field({ id, label, helper, children }: { id: string; label: string; helper?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold" style={{ color: 'var(--foreground)' }}>
        {label}
      </label>
      {children}
      {helper && <p className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>{helper}</p>}
    </div>
  )
}
