import { Inter, DM_Serif_Display } from "next/font/google";
import { LocaleProvider } from "@/components/LocaleProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ConsentProvider } from "@/components/ConsentProvider";
import { ConsentBanner } from "@/components/ConsentBanner";
import { ConsentFooterControl } from "@/components/ConsentFooterControl";
import { AnalyticsRoot } from "@/components/AnalyticsRoot";
import { logPostHogMisconfigurationOnce } from "@/lib/analytics";
import { siteMetadata } from "@/lib/site-metadata";
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
 * THE FONT <link> TAGS ARE LEFT EXACTLY AS THEY WERE. They produce the four
 * documented lint warnings, and the release criterion is that the count stays
 * four. "Fixing" them here would be an unrelated change inside the one file
 * whose warning count is a tracked baseline.
 */

const inter = Inter({ subsets: ["latin"], display: "swap" });
const dmSerifDisplay = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-dm-serif",
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
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
          as="style"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
          crossOrigin="anonymous"
        />
      </head>
      <body className={`${inter.className} ${dmSerifDisplay.variable}`}>
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
