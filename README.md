# Wine Wizard

*A cellar that knows your palate.* Personalized wine recommendations from a 323-descriptor vector space of aroma,
texture, style and structure. It runs entirely on free tiers: Supabase for Postgres, pgvector, Auth and Edge
Functions, and Vercel for the Next.js app.

See **[docs/PLAN.md](docs/PLAN.md)** for the architecture, data model, scoring math and roadmap.

## Stack

| Layer | Tech |
|---|---|
| App | Next.js 15 (App Router), React 19, TypeScript, hand-written CSS design system |
| Data | Supabase Postgres, pgvector (`flavor_vec` 384, `struct_vec` 16, `embedding` 384) |
| Auth | Supabase Auth (email + password, Google), row-level security everywhere |
| AI | `gte-small` embeddings built into Supabase Edge Functions (no API keys, no cost) |

## Repo layout

```
data/lexicon.mjs            the vector space: 27 categories, 323 attributes, synonyms, scales
data/wines/*.json           211 curated wine profiles
data/imports/xwines.json    ~12,600 popular labels from X-Wines (CC0), profiles estimated at build time
data/typicity.mjs           grape, place and style typicity used for those estimates
scripts/validate-wines.mjs  checks wine files against the lexicon
scripts/build-seed.mjs      emits supabase/seed/*.sql
supabase/migrations/        schema, vector triggers, palate learning, recommend/similar/search RPCs
supabase/functions/         search (NL query parsing + embeddings), embed-wines (backfill), lookup-wine (web lookup for new bottles)
src/                        Next.js app
```

## Local development

```bash
npm install
cp .env.example .env.local      # fill in the publishable key
npm run dev
```

Database changes are made with the Supabase CLI (`supabase db push`) or through the dashboard SQL editor, using the
files in `supabase/migrations`. After editing wine data:

```bash
npm run seed:validate && npm run seed:build
```

Commit the regenerated `supabase/seed/*.sql` along with the wine data. When it lands on `main`, the
**Sync wines to Supabase** workflow (`.github/workflows/sync-wines.yml`) applies the seed files and runs `embed-wines`
until every wine has an embedding. It needs a `SUPABASE_DB_URL` repository secret holding the Session pooler
connection string from Supabase → Connect. The seed only inserts and updates, so removing a wine from the JSON doesn't
delete it from the database.

### Imported wines

Beyond the curated benchmarks, the cellar carries the most-rated labels from [X-Wines](https://github.com/rogerioxavier/X-Wines)
(CC0; 100k wines and 21M community ratings collected in 2022): the top 12,000 by number of ratings, plus every dessert
wine and port with at least 100. `npm run import:select` re-downloads the dataset and rewrites `data/imports/xwines.json`.

X-Wines gives grapes, region, body, ABV, pairings and ratings, but no tasting notes or prices. `npm run seed:build`
estimates each wine's structure and notes from `data/typicity.mjs` (grape typicity, then place, then style words such as
"Tawny", "Amarone" or "Gran Reserva") and writes `supabase/seed/imports/*.sql`, which is generated and not committed.
Labels that duplicate a curated wine are skipped, and their community ratings are copied onto the curated wine. These wines
are stored with `source = 'xwines'`. The wine page says their profile is estimated, and rankings treat them a little more
cautiously than tasted profiles. The sync workflow stops loading if the database passes 420 MB.

## Supabase settings to check

- **Auth → Sign In / Providers → Email:** turn off "Confirm email" for instant sign-up, or configure SMTP.
  The built-in mailer is rate-limited.
- **Auth → URL Configuration:** set the Site URL to your Vercel domain so confirmation links return to the app, and
  add `http://localhost:3000/auth/callback` and `https://<your-vercel-domain>/auth/callback` to **Redirect URLs**.
  Supabase ignores any `redirectTo` that isn't on that list and sends people to the Site URL instead.

### Looking up new bottles online

`/wines/new` (the **Add wine** button in the header) starts with a web lookup: type a producer and wine, and the
`lookup-wine` Edge Function has Claude search winery pages, tech sheets and reviews, then drafts the label facts,
structure, lexicon notes and pairings into the form. Nothing is saved until the member reviews the draft and clicks
**Add to the cellar**. Searches in the cellar link straight to a lookup of the same text.

This is the one feature that isn't free: each lookup is a Claude API call with web search, usually a few cents. To turn it on:

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy lookup-wine
```

Without the secret, the lookup says it isn't set up and the manual form still works.

### Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), configure the OAuth consent screen
   (scopes `openid`, `email`, `profile`), then create an **OAuth client ID** of type *Web application*:
   - Authorized JavaScript origins: `http://localhost:3000`, `https://<your-vercel-domain>`
   - Authorized redirect URI: `https://wjcoghtswckuafjkruwc.supabase.co/auth/v1/callback`
2. In Supabase, go to **Auth → Sign In / Providers → Google**. Turn it on and paste the client ID and secret.
3. Apply `supabase/migrations/20261020000001_google_auth.sql`. It seeds `display_name` from the Google profile name.

The app needs no new environment variables. Google users who sign in for the first time are sent through
`/for-you`, which redirects them to the palate quiz.
