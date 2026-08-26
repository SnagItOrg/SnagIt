# Klup

> Kup efter kup – det er Klup

Klup er en kurateret overvågnings- og sammenligningstjeneste for brugt
musikudstyr og studieudstyr. Kanoniske produktsider er kerneoplevelsen; søgning
navigerer inden for et understøttet katalog.

Kilder: DBA.dk, Reverb, Kleinanzeigen.de, Finn.no og Blocket.se.

> Denne README dækker kun frontend-opsætning. Produktkontrakt, livscyklus og
> aktivering: se [`../docs/klup-foundation-handover.md`](../docs/klup-foundation-handover.md)
> og [`../CLAUDE.md`](../CLAUDE.md).

## Stack

- **Next.js 14** — App Router
- **Supabase** — database, auth, RLS
- **Resend** — email notifikationer
- **Vercel** — hosting + cron jobs (hvert 10. minut)

## Kom i gang

```bash
npm install
cp .env.example .env.local
# Udfyld env vars i .env.local
npm run dev
```

## Miljøvariabler

| Variabel | Beskrivelse |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase projekt-URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon nøgle |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role nøgle (server-side) |
| `CRON_SECRET` | Hemmeligt token til cron job |
| `RESEND_API_KEY` | Resend API nøgle |
| `RESEND_FROM_EMAIL` | Afsender-email (f.eks. `hej@ditdomæne.dk`) |
| `NEXT_PUBLIC_APP_URL` | Produktions-URL (f.eks. `https://klup.vercel.app`) |
