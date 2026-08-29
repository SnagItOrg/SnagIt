'use client'

/**
 * /privatliv — the privacy route.
 *
 * Stage 3 WP-5. See docs/stage-3-v1-decision-and-build-plan.md §12.4.5.
 *
 * PUBLIC, AND IDENTICAL IN EVERY CONSENT STATE. Classified `public_page` in
 * lib/route-access.ts, so it is reachable anonymously, and it renders exactly
 * the same content whether consent is granted, rejected or undecided. A
 * privacy page you have to agree to something in order to read is not one.
 *
 * WHY THE PROSE IS DANISH IN THE COMPONENT RATHER THAN IN lib/i18n.ts. The
 * i18n module is WP-1-owned and read-only for this package; it landed the
 * headings and the chrome, which are used below, but not the body. That is the
 * right split anyway: §12.4.5 requires this page to be specific and factual in
 * Danish — a statement about who processes what, not translatable interface
 * copy. Headings and controls come from `t.*`; the facts live here.
 *
 * NO GENERIC TEMPLATE TEXT. Every processor named below is one this codebase
 * actually contacts, every data category is one that is actually sent, and the
 * retention periods are stated as concrete durations rather than vaguely.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * @r6-confirm — release gate §16.6 H
 *
 * Four claims on this page are configuration facts that cannot be verified
 * from the repository. Each must be confirmed against the live configuration,
 * by a named person, before release. A processor or a period that cannot be
 * confirmed is removed from the product, not quietly omitted from the page.
 *
 *   1. privatliv@klup.dk actually receives mail. klup.dk uses Protonmail MX
 *      (CLAUDE.md §10), and whether this alias exists is not in the repo.
 *   2. PostHog EU project event retention really is 12 months.
 *   3. The Supabase project region is inside the EU.
 *   4. The Vercel project region is inside the EU.
 * ─────────────────────────────────────────────────────────────────────────
 */

import Link from 'next/link'

import { useConsent } from '@/components/ConsentProvider'
import { useLocale } from '@/components/LocaleProvider'

const PRIVACY_CONTACT_EMAIL = 'privatliv@klup.dk'

type Processor = {
  name: string
  role: string
  when: string
}

/**
 * Analytics purposes are named as product improvement and are never bundled
 * with service delivery, so that consenting to measurement and using the site
 * stay visibly separate decisions.
 */
const PROCESSORS: Processor[] = [
  {
    name: 'Supabase',
    role: 'Database, login og billedlager. Her ligger din konto, dine gemte annoncer og dine overvågninger.',
    when: 'Altid — det er selve tjenesten.',
  },
  {
    name: 'Vercel',
    role: 'Hosting. Leverer siderne til din browser.',
    when: 'Altid — det er selve tjenesten.',
  },
  {
    name: 'Cloudflare',
    role: 'DNS og edge-levering foran hostingen.',
    when: 'Altid — det er selve tjenesten.',
  },
  {
    name: 'Resend',
    role: 'Afsendelse af login-mails og beskeder om nye annoncer, du selv har bedt om.',
    when: 'Når du logger ind eller opretter en overvågning.',
  },
  {
    name: 'Frankfurter',
    role: 'Valutakurser, så priser i NOK, SEK, EUR og USD kan vises i kroner. Modtager ingen brugerdata overhovedet.',
    when: 'Altid — men uden data om dig.',
  },
  {
    name: 'PostHog (EU)',
    role: 'Produktanalyse: hvilke sider og produkter der bliver brugt, så Klup kan blive bedre. Ikke annoncering, ikke profilering, ikke deling.',
    when: 'Kun hvis du siger ja til måling.',
  },
  {
    name: 'Vercel Speed Insights',
    role: 'Måling af hvor hurtigt siderne indlæses hos rigtige besøgende.',
    when: 'Kun hvis du siger ja til måling.',
  },
  {
    name: 'DBA, Finn.no, Blocket, Kleinanzeigen og Reverb',
    role: 'De markedspladser Klup følger. Du klikker videre til dem — Klup sender dem ingen data om dig, og de får ikke at vide, at du kom fra Klup ud over det, din browser selv oplyser.',
    when: 'Kun når du selv klikker på en annonce.',
  },
]

const DATA_ALWAYS: string[] = [
  'Din emailadresse — kun hvis du opretter en konto, og kun for at logge dig ind og sende de beskeder, du har bedt om.',
  'De annoncer du gemmer, og de overvågninger du opretter.',
  'Dit svar på spørgsmålet om måling. Det gemmes lokalt i din browser og sendes ingen steder hen.',
]

const DATA_ONLY_WITH_CONSENT: string[] = [
  'Et pseudonymt id for din browser, og — hvis du er logget ind — dit konto-id. Aldrig din emailadresse.',
  'Sidestier i skabelonform: /product/[slug], ikke /product/roland-juno-106 med et id på dig.',
  'Hvilket produkt en side handlede om, og hvilke annoncer du klikkede videre til.',
  'Normaliserede søgetermer — det opslag din søgning blev til, ikke det du skrev.',
  'Indlæsningstider (Core Web Vitals).',
]

const DATA_NEVER: string[] = [
  'Din rå søgetekst.',
  'Dit navn, din adresse eller dit telefonnummer.',
  'Betalingsoplysninger — Klup tager ikke imod betaling.',
  'Logins til markedspladserne. Klup beder aldrig om dem.',
  'Reklame-id’er eller sporing på tværs af andre websites. Klup har ingen.',
]

const RETENTION: Array<{ what: string; how_long: string }> = [
  { what: 'Konto, gemte annoncer og overvågninger', how_long: 'Så længe kontoen findes. Slettes på anmodning.' },
  { what: 'Dit samtykkevalg', how_long: 'Indtil du ændrer det, eller til du rydder din browsers lokale lager.' },
  { what: 'Måledata i PostHog EU', how_long: '12 måneder, hvorefter de slettes automatisk.' },
  { what: 'Indlæsningstider i Speed Insights', how_long: 'Opgøres samlet. Der gemmes ikke en profil pr. person.' },
  {
    what: 'Ugentlig opgørelse af søgninger, Klup ikke dækker',
    how_long:
      'Kun den normaliserede søgeterm og hvor mange forskellige personer der søgte på den. Ingen identifikatorer, og den kan ikke føres tilbage til dig.',
  },
]

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="type-card-title text-xl">
        {heading}
      </h2>
      {children}
    </section>
  )
}

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm" style={{ color: 'var(--muted-foreground)' }}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

export default function PrivacyPage() {
  const { t } = useLocale()
  const { state, hydrated, grant, withdraw, reject } = useConsent()

  return (
    <main
      className="mx-auto flex w-full max-w-[68ch] flex-col gap-10 px-4 py-10 md:px-8"
      style={{ color: 'var(--foreground)' }}
    >
      <header className="flex flex-col gap-3">
        <h1 className="type-title">
          {t.privacyTitle}
        </h1>
        <p className="type-body-secondary">
          Klup følger brugte instrumenter og studieudstyr på fem markedspladser og viser, hvad
          de faktisk koster. Denne side siger konkret, hvem der behandler hvilke data, hvorfor,
          hvor længe og hvor. Den er den samme, uanset om du har sagt ja eller nej til måling.
        </p>
        <p className="text-sm font-medium">{t.privacyNoRawSearch}</p>
      </header>

      <Section heading={t.privacyProcessorsHeading}>
        <div className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
          {PROCESSORS.map((processor) => (
            <div key={processor.name} className="flex flex-col gap-1 py-3">
              <p className="text-sm font-semibold">{processor.name}</p>
              <p className="type-body-secondary">
                {processor.role}
              </p>
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                {processor.when}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section heading={t.privacyPurposeHeading}>
        <p className="type-body-secondary">
          De fem første behandlere ovenfor er nødvendige for at levere tjenesten: uden dem er der
          ingen side, intet login og ingen mail. De to måleværktøjer har ét formål —
          produktforbedring — og de kører kun, hvis du siger ja. De to ting er ikke bundtet:
          siger du nej til måling, virker Klup nøjagtig som før. Ingen funktion, side, pris,
          prisinterval, annonce eller søgning bliver holdt tilbage, forsinket, sløret eller
          gentaget som en påmindelse, fordi du sagde nej.
        </p>
      </Section>

      <Section heading={t.privacyDataHeading}>
        <p className="text-sm font-medium">Altid, fordi tjenesten ikke kan fungere uden</p>
        <Bullets items={DATA_ALWAYS} />
        <p className="mt-2 text-sm font-medium">Kun hvis du siger ja til måling</p>
        <Bullets items={DATA_ONLY_WITH_CONSENT} />
        <p className="mt-2 text-sm font-medium">Aldrig</p>
        <Bullets items={DATA_NEVER} />
        <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Klup sætter ingen sporingscookies. PostHog gemmer sit pseudonyme id i din browsers
          lokale lager og ikke i en cookie, og det bliver slettet, i det øjeblik du trækker
          samtykket tilbage.
        </p>
      </Section>

      <Section heading={t.privacyRetentionHeading}>
        <div className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
          {RETENTION.map((row) => (
            <div key={row.what} className="flex flex-col gap-1 py-3">
              <p className="text-sm font-semibold">{row.what}</p>
              <p className="type-body-secondary">
                {row.how_long}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section heading="Hvor data ligger">
        <p className="type-body-secondary">
          PostHog kører på EU-hosting. Det er ikke en hensigt, men en regel i koden: Klup
          accepterer kun en EU-vært, og hvis den mangler eller peger et andet sted hen, starter
          målingen slet ikke. Der findes ingen amerikansk reserve — en manglende indstilling kan
          altså ikke flytte data ud af EU. Supabase og Vercel kører ligeledes i EU.
        </p>
      </Section>

      <Section heading={t.privacyRightsHeading}>
        <p className="type-body-secondary">
          Du kan skifte mening når som helst, her på siden eller nederst på enhver side.
        </p>

        <div
          className="flex flex-col gap-3 rounded-2xl border p-4"
          style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
        >
          <p className="text-sm font-medium" data-testid="privacy-consent-status">
            {!hydrated || state === 'undecided'
              ? t.consentHeading
              : state === 'granted'
                ? t.consentStatusGranted
                : t.consentStatusRejected}
          </p>
          <div className="flex flex-wrap gap-2">
            {state === 'granted' ? (
              <button
                type="button"
                data-testid="privacy-consent-withdraw"
                onClick={withdraw}
                className="min-h-[44px] rounded-xl px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: 'var(--secondary)',
                  color: 'var(--secondary-foreground)',
                  border: '1px solid var(--border)',
                }}
              >
                {t.consentWithdraw}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="privacy-consent-grant"
                  onClick={grant}
                  className="min-h-[44px] rounded-xl px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{
                    backgroundColor: 'var(--secondary)',
                    color: 'var(--secondary-foreground)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {t.consentGrantLater}
                </button>
                {state === 'undecided' && (
                  <button
                    type="button"
                    data-testid="privacy-consent-reject"
                    onClick={reject}
                    className="min-h-[44px] rounded-xl px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                    style={{
                      backgroundColor: 'var(--secondary)',
                      color: 'var(--secondary-foreground)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {t.consentReject}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <p className="type-body-secondary">
          Vil du have din konto og alt indhold slettet, eller vil du vide hvilke data der ligger
          om dig, så skriv til{' '}
          <a
            href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
            className="underline underline-offset-2"
            style={{ color: 'var(--foreground)' }}
          >
            {PRIVACY_CONTACT_EMAIL}
          </a>
          . Du behøver ikke have en konto for at bruge Klup.
        </p>
      </Section>

      <Section heading="Hvad Klup ikke er">
        <p className="type-body-secondary">
          Klup sælger ingenting, formidler ingen handler og tager ikke imod betaling. Der er
          ingen annoncer på Klup, og der bliver ikke delt data med de markedspladser, Klup
          følger. Klup køber ikke data om dig og sælger ikke data om dig.
        </p>
      </Section>

      <Section heading={t.privacyContactHeading}>
        <p className="type-body-secondary">
          <a
            href={`mailto:${PRIVACY_CONTACT_EMAIL}`}
            className="underline underline-offset-2"
            style={{ color: 'var(--foreground)' }}
          >
            {PRIVACY_CONTACT_EMAIL}
          </a>{' '}
          ·{' '}
          <Link href="/" className="underline underline-offset-2" style={{ color: 'var(--foreground)' }}>
            klup.dk
          </Link>
        </p>
      </Section>
    </main>
  )
}
