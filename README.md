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
| Auth | Supabase Auth (email + password), row-level security everywhere |
| AI | `gte-small` embeddings built into Supabase Edge Functions (no API keys, no cost) |

## Repo layout

```
data/lexicon.mjs            the vector space: 27 categories, 323 attributes, synonyms, scales
data/wines/*.json           210 curated wine profiles
scripts/validate-wines.mjs  checks wine files against the lexicon
scripts/build-seed.mjs      emits supabase/seed/*.sql
supabase/migrations/        schema, vector triggers, palate learning, recommend/similar/search RPCs
supabase/functions/         search (NL query parsing + embeddings), embed-wines (backfill)
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

## Supabase settings to check

- **Auth → Sign In / Providers → Email:** turn off "Confirm email" for instant sign-up, or configure SMTP.
  The built-in mailer is rate-limited.
- **Auth → URL Configuration:** set the Site URL to your Vercel domain so confirmation links return to the app.
