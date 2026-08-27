import type { Metadata } from 'next'

/**
 * Site-wide metadata, authored here rather than in app/layout.tsx.
 *
 * Stage 3 V1, WP-1. See docs/stage-3-v1-decision-and-build-plan.md §13.1 and
 * the contention register at §15.7.
 *
 * WHY NOT IN app/layout.tsx. All four analytics trackers are mounted in that
 * file, so WP-5 owns it exclusively as part of the consent contract (§12.4).
 * WP-1 therefore ships the metadata object and WP-5 wires it in at R2. Nothing
 * regresses in the meantime: the layout keeps its current metadata until then,
 * and per-page `generateMetadata` is WP-3 at R4 either way.
 *
 * The title and description must name the vertical. Today they read
 * "Klup" / "Kup efter kup – det er Klup", which communicates nothing about
 * musical equipment to a reader, a crawler or an affiliate reviewer.
 */

export const SITE_NAME = 'Klup'
export const SITE_URL = 'https://www.klup.dk'

export const SITE_TITLE = 'Klup — brugte instrumenter og studieudstyr'

export const SITE_DESCRIPTION =
  'Klup følger brugte instrumenter og studieudstyr på DBA, Finn, Blocket, ' +
  'Kleinanzeigen og Reverb — og fortæller dig, hvad de faktisk koster.'

export const SITE_DESCRIPTION_EN =
  'Klup tracks used musical instruments and studio equipment across DBA, Finn, ' +
  'Blocket, Kleinanzeigen and Reverb — and tells you what they actually cost.'

export const siteMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: '%s | Klup',
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: {
    canonical: '/',
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'da_DK',
    url: SITE_URL,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
}
