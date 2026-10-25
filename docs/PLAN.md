# Wine Wizard — implementation plan

A personalized wine recommendation engine. Every wine and every drinker is represented in the same
named vector space of tasting descriptors, so recommendations come with reasons that read like a sommelier's notes.

Status legend: ✅ shipped in v1 · 🔜 next · 💡 later

---

## 1. Goals

| Goal | How |
|---|---|
| Thorough, interpretable taste vectors | 323-descriptor lexicon (283 flavor/texture/style dimensions + 10 structure scales + 30 pairings) |
| Store qualities of each individual wine | `wine_attributes` rows (wine × attribute × intensity 0–1) → derived vectors |
| Store people's preferences & flavor profiles | `palates` + `palate_weights` (signed weight per attribute) learned from a quiz and ratings |
| Personalized recommendations | pgvector cosine + structural fit + style affinity, with "why" and "caution" notes |
| Natural-language search | Free gte-small embeddings in Supabase Edge Functions + lexicon parsing |
| Free hosting | Supabase free tier (Postgres, pgvector, Auth, Edge Functions) + Vercel Hobby (Next.js) |
| Looks like it belongs on a fine wine list | Parchment & oxblood palette, Cormorant Garamond display, small caps, hairline rules, WSET dot scales, "cellar" dark mode |

## 2. Architecture

```
┌────────────────────────┐        ┌──────────────────────────────────────────────┐
│ Next.js 15 (Vercel)    │  RLS   │ Supabase (free tier)                         │
│  • server components   ├───────►│  Postgres + pgvector                         │
│  • @supabase/ssr auth  │  RPC   │   lexicon · wines · wine_attributes          │
│  • client: quiz, rate, │        │   palates · palate_weights · ratings         │
│    search, add wine    │        │   SQL: build vectors, learn palate,          │
└──────────┬─────────────┘        │        recommend, similar, hybrid search     │
           │ functions.invoke     │  Edge Functions (Deno)                       │
           └─────────────────────►│   search      – parse + gte-small + RPC      │
                                  │   embed-wines – gte-small backfill           │
                                  │   lookup-wine – Claude + web search draft    │
                                  │  Auth (email + password, Google)             │
                                  └──────────────────────────────────────────────┘
```

All scoring lives in SQL so it is fast, consistent across pages, and protected by row-level security.

## 3. The lexicon (`data/lexicon.mjs`) ✅

27 categories in 11 groups. Each attribute has a key, label and synonyms (synonyms power search: "cassis",
"smoky", "brisket").

| Group | Categories | Kind (vector) |
|---|---|---|
| Fruit | red, black, dried & cooked, citrus, orchard, stone, tropical, green | aroma (flavor) |
| Floral | floral | aroma |
| Herbal & Vegetal | green & vegetal, herbs, savory leaf & olive | aroma |
| Spice | spice | aroma |
| Earth & Mineral | mineral, earth | aroma |
| Oak & Cellar | oak, roast & confection, lees & malolactic | aroma |
| Bottle Age | tertiary, nut & oxidative | aroma |
| Texture | tannin texture, palate texture | texture (flavor, weight 0.7) |
| Style & Character | character, winemaking, ageing profile | style (flavor, weight 0.6) |
| Structure | sweetness, acidity, tannin, alcohol, body, intensity, finish, oak, effervescence, maturity | structure (separate vector) |
| At the Table | 30 classic pairings | pairing (search & display) |

Vector widths leave headroom (`vector(384)` for flavor, `vector(16)` for structure) so the lexicon can grow without a schema change.

## 4. Data model (Supabase) ✅

| Table | Purpose |
|---|---|
| `attribute_categories`, `attributes` | The lexicon. `vec_index` / `struct_index` = dimension position |
| `wines` | Label facts, service notes, `flavor_vec`, `struct_vec`, `embedding`, `search_tsv` |
| `wine_attributes` | Source of truth for a wine's profile (intensity 0–1) |
| `palates` | Per-user quiz, style prefs, computed `flavor_vec`, `struct_target`, `struct_mask`, `style_affinity` |
| `palate_weights` | Per-user signed weight per attribute: `quiz_weight`, `learned_weight`, blended `weight` |
| `ratings` | Tasting journal: 1–5 (half stars), notes, vintage, date, loved / disliked notes |
| `saved_wines` | Wish list (🔜 UI) |

Triggers keep everything derived:

- `wine_attributes` change → `build_wine_vectors()` rebuilds `flavor_vec`, `struct_vec` and `embedding_text`, and clears a stale `embedding`.
- `ratings` change → `recompute_palate()` re-learns the user's palate.
- New auth user → empty `palates` row.
- `wines_guard` stops clients writing vectors, curation flags or authorship.

**Security.** RLS is on for every table. The catalog is public-read. Members can add wines and edit only their own.
Everything personal is owner-only. Internal functions are `security definer` and not executable by clients.

## 5. The math ✅

**Wine flavor vector:** `v[i] = intensity · category_weight · attribute_weight` for aroma, texture and style attributes.

**Palate learning:**

```
learned[a] = 1.6 · Σ_r ((rating_r − 3) / 2) · intensity_r[a]  /  (Σ_r |rating_r − 3| / 2 + 0.5)
             + 0.3 · (#times tagged loved − #times tagged disliked)
weight[a]  = (quiz[a] · Q + learned[a] · n) / (Q + n)      Q = 3 once the quiz is done, n = Σ|rating−3|/2
```

The quiz behaves like three opening ratings, then your real ratings take over.

**Structure target:** quiz sliders blended with a rating-weighted average of the structures of wines rated ≥ 3½.
A confidence mask means unanswered scales don't count. Tannin preference only applies to tannic wines.

**Match score:**

```
match = 0.62 · √max(0, cos(palate, wine))                          aroma fit (signed: avoided notes repel)
      + 0.23 · max(0, 1 − 1.8 · weighted_RMS(target − structure))  shape fit
      + 0.15 · (style_affinity[type] + 1) / 2                       style fit
      × soft budget penalty (floor 0.75)
display = 100 · (1 − (1 − match)^1.6)                               monotonic calibration
```

**Reasons:** the top three `intensity × weight` aroma contributions. **Cautions:** the most negative contributions.

**Similar wines:** `0.75 · cos(flavor) + 0.25 · (1 − ‖Δstructure‖ / √10)`.

**Hybrid search** combines up to six weighted signals, normalised by whichever are present:

- semantic gte-small similarity (0.35)
- lexicon notes found in the query (0.35)
- pairings (0.15)
- keywords such as grape, region or producer (0.30)
- structure words like "crisp" or "full-bodied" (0.15)
- light personalisation when signed in (0.10)

Type and price are hard filters parsed from the text ("under $40", "rosé", "bubbles").

## 6. Seed catalog ✅

211 benchmark wines (`data/wines/*.json`) across Bordeaux, Loire, Burgundy, Champagne, Rhône, Provence, Languedoc,
Alsace, Jura, Italy, Spain, Portugal, Germany, Austria, Hungary, Greece, Georgia, Lebanon, Slovenia, USA, Australia,
New Zealand, South Africa, Argentina, Chile and Uruguay. They span every price tier and every style.

- Profiles describe each wine's typical house style, not a specific vintage.
- Descriptions are original.
- `scripts/validate-wines.mjs` checks every key against the lexicon.
- `scripts/build-seed.mjs` emits `supabase/seed/*.sql`.

Imported catalog: ~12,500 of the most-rated labels from X-Wines (CC0), selected by `scripts/xwines-select.mjs` and stored
in `data/imports/xwines.json`. Their profiles are estimated by `scripts/lib/profile.mjs` from grape, place and style
typicity (`data/typicity.mjs`), blended with the dataset's stated body, ABV and pairings. Ranking adjusts for them:
- Recommendations multiply palate fit by a confidence factor: 0.92–1.0 from the community rating, × 0.97 for an estimate.
- Lists show at most two imports that share a type, lead grape and region.
- Search breaks near-ties toward wines with more community ratings.

## 7. App (Next.js 15, App Router) ✅

| Route | What it does |
|---|---|
| `/` | Landing: hero aroma wheel, the method, sample sommelier queries |
| `/signup`, `/login` | Email + password or Google (Supabase Auth). OAuth returns through `/auth/callback` |
| `/onboarding` | 6-step palate quiz: styles, structure sliders, aroma families, specific notes, bottles you love, budget |
| `/for-you` | Ranked recommendations with match rings, reasons, cautions, filters |
| `/cellar` | Natural-language search ("Reading this as…" chips) and the browsable catalog |
| `/wines/[slug]` | Label header, match ring, tasting note, aroma wheel, notes by family, WSET structure dots, texture, service card, pairings, rate panel, "Drinks alike" |
| `/palate` | Radar by family, loved and avoided notes, preferred structure, style affinities, how learning works |
| `/journal` | Tasting history |
| `/wines/new` | Look a bottle up online (`lookup-wine`: Claude with web search drafts label facts, structure, notes and pairings from lexicon keys, with sources), or profile it by hand. The member reviews and saves; it is embedded automatically |
| `/lexicon` | The full vector space with usage counts |

## 8. Hosting & ops

- **Supabase** project `wine-wizard` (us-west-1, free tier). Migrations are in `supabase/migrations`, functions in `supabase/functions`.
- **Vercel** project `wine-wizard` (Hobby). Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Free-tier notes:
  - Supabase pauses projects after 7 days of inactivity. Visiting the app or using the dashboard wakes them.
  - The built-in auth mailer is rate-limited, so turn off "Confirm email" or add SMTP.

## 9. Roadmap

- 🔜 Saved wines / wish list UI (table exists)
- 🔜 Edit and delete your own added wines
- 🔜 "Why not?" explorer: drag a palate weight and watch the rankings move
- 🔜 Food-first mode: pick a dish and rank by pairing × palate
- 💡 Bulk import of a public review corpus, with LLM-assisted extraction of attribute intensities from tasting notes
- 💡 Collaborative signal: blend in item-item similarity from co-ratings once there are enough users
- 💡 Vintage-specific profiles (a `wine_vintages` table overriding the house profile)
- 💡 Label photo → wine lookup
