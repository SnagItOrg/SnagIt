import {
  Bricolage_Grotesque,
  Instrument_Sans,
  JetBrains_Mono,
} from "next/font/google";
import { LocaleProvider } from "@/components/LocaleProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ConsentProvider } from "@/components/ConsentProvider";
import { ConsentBanner } from "@/components/ConsentBanner";
import { ConsentFooterControl } from "@/components/ConsentFooterControl";
import { AnalyticsRoot } from "@/components/AnalyticsRoot";
import { logPostHogMisconfigurationOnce } from "@/lib/analytics";
import { siteMetadata } from "@/lib/site-metadata";
import { ICON_FONT_HREF } from "@/lib/icon-font";
import "./globals.css";

/**
 * The root layout.
 *
 * Stage 3 WP-5 owns this file outright (build plan §15.7), because every
 * tracker in the application was mounted here and the consent contract of
 * §12.4 is meaningless if any other package can add one back.
 *
 * WHAT LEFT, AND WHY IT LEFT RATHER THAN BEING GATED (§12.4.1):
 *
 *   Google Analytics 4 — two injected script elements and a hardcoded id
 *   fallback. Its only product use was the onboarding funnel that WP-1
 *   retired. Removing it deletes a processor, a cookie family and a
 *   cross-border transfer; gating it would have kept all three and merely
 *   delayed them.
 *
 *   Vercel Analytics — pageview counts already covered by PostHog $pageview,
 *   and the measurement spec forbids drawing behavioural conclusions from it.
 *   Gating a third behavioural processor to collect data nobody reads is
 *   strictly worse than deleting it.
 *
 * WHAT STAYED, BEHIND THE GATE: PostHog and Speed Insights, mounted only by
 * <AnalyticsRoot />, which renders nothing at all until consent is `granted`.
 * Speed Insights measures real visitors' sessions, so it is behavioural rather
 * than operational and is consent-gated too — which is why guardrail G8 is
 * measured on the consenting population only.
 *
 * THE ICON FONT <link> TAGS WERE CHANGED BY PAN-71, and nothing else here was.
 * They used to request every axis range of Material Symbols with
 * `display=block` — a 3.98 MB download that painted nothing for its first
 * three seconds and then the literal ligature text ("notifications") until it
 * landed, 22 s under the throttled profile. The URL now pins the three axes
 * the design never varies (GRAD 0, opsz 24, wght 400) and keeps only
 * FILL 0..1, which `.filled` in globals.css uses: 460 KB, 8.7x smaller.
 * `display=swap` replaces `block`, and globals.css keeps the glyph invisible
 * with its box reserved until the font is usable, so no ligature is ever
 * painted and the swap changes ink only, never geometry.
 *
 * The two `no-page-custom-font` warnings remain and are expected. The two
 * `google-font-display` warnings are gone — that rule was reporting exactly
 * this bug — so the tracked lint baseline for this file is now two, not four.
 *
 * PAN-167 CHANGED ONLY THE URL: it now carries `icon_names`, built from the
 * glyph list in lib/icon-font.ts, so the font is 7.5 KB instead of 452 KB.
 * Everything above about axes, `swap` and the reveal script still holds. The
 * href is now an expression, which the `no-page-custom-font` rule does not
 * read, so those two warnings no longer appear.
 */

/**
 * Three families, one job each (PAN-DESIGN-REFRESH).
 *
 * Astryx keeps body, heading and display as SEPARATE family tokens and happens
 * to point all three at one face in its neutral theme
 * (packages/themes/neutral/src/neutralTheme.ts:80-90, clone 86e8392). Display
 * sizes inherit `heading.family` there, so a two-face split is inside their
 * model rather than a departure from it: Bricolage carries heading AND
 * display, Instrument Sans carries body.
 *
 * `axes: ["opsz"]` is the reason Bricolage is worth loading. Its optical-size
 * axis runs 12..96, so the display cut is drawn for display sizes instead of a
 * text cut stretched to 67px. That is what replaces the negative tracking the
 * old serif roles needed — see the type scale in globals.css.
 *
 * All three are variable, so `weight: "variable"` ships one file per family
 * and the whole 200..800 range, not six static cuts. JetBrains Mono replaces
 * the `ui-monospace` stack for prices and IDs: digits must be tabular and the
 * platform default is not, across Mac and Windows.
 */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: "variable",
  axes: ["opsz"],
  display: "swap",
  variable: "--font-display",
});
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  variable: "--font-body",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  variable: "--font-mono",
});

/**
 * Site metadata comes from lib/site-metadata.ts, which WP-1 shipped precisely
 * so that it did not have to open this file. WP-5 wires it in; the title and
 * description now name the vertical, which the previous "Klup" / "Kup efter
 * kup" pair did not communicate to a reader, a crawler or an affiliate
 * reviewer.
 */
export const metadata = siteMetadata;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // OPERATIONAL, NOT BEHAVIOURAL (§12.4.8). If the EU host is missing or is
  // not on the allow-list, exactly one line goes to the platform log, from the
  // server, once per instance. It never reaches PostHog — which could not
  // receive it anyway, since the reason we are here is that PostHog is
  // unusable — and it carries a reason code with no route, query or user.
  logPostHogMisconfigurationOnce();

  return (
    <html lang="da" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href={ICON_FONT_HREF}
          as="style"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href={ICON_FONT_HREF}
          crossOrigin="anonymous"
        />
        {/*
          Reveals the icons once the font can actually paint a glyph; until
          then globals.css holds them invisible in a reserved box, so the
          ligature text never reaches the screen.

          THIS MUST STAY AFTER THE STYLESHEET <link> ABOVE. A classic script is
          blocked until every stylesheet declared before it has loaded, and
          that is what guarantees the @font-face exists by the time
          `fonts.load()` is asked for it — asked any earlier it resolves
          immediately against nothing and would reveal the ligature.

          A font that fails outright still reveals, because a clipped 1em box
          beats navigation with no icons in it at all.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){var e=document.documentElement,r=function(){e.classList.add("icon-font-ready")};' +
              'if(!document.fonts||!document.fonts.load){r();return}' +
              'document.fonts.load(\'20px "Material Symbols Outlined"\').then(r,r)})();',
          }}
        />
      </head>
      <body
        className={`${bricolage.variable} ${instrumentSans.variable} ${jetbrainsMono.variable}`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
          <LocaleProvider>
            <ConsentProvider>
              {children}
              <ConsentFooterControl />
              <ConsentBanner />
              <AnalyticsRoot />
            </ConsentProvider>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
