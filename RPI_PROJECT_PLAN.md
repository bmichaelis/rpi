# UHSAA Boys Soccer RPI — Cloudflare TypeScript Rewrite Plan

## Overview
Port the existing `maxpreps_rpi.py` script into a Cloudflare Workers + Pages + KV
application. A cron Worker fetches MaxPreps schedules, computes the UHSAA RPI, and
stores the result in KV. A static frontend reads from KV and displays the rankings.

---

## Stack
- **Runtime:** Cloudflare Workers (TypeScript)
- **CLI:** Wrangler v3
- **Storage:** Cloudflare KV
- **Frontend:** Plain HTML/JS served from Cloudflare Pages (or a Worker)
- **Cron:** Cloudflare Workers Cron Trigger
- **HTML parsing:** `node-html-parser` (for extracting the Next.js build ID)

---

## Project Structure
```
rpi-app/
├── src/
│   ├── index.ts          # Worker entry point — routes cron vs HTTP
│   ├── maxpreps.ts       # Fetch + parse MaxPreps schedule pages
│   ├── rpi.ts            # UHSAA RPI calculation logic
│   └── types.ts          # Shared TypeScript interfaces
├── public/
│   └── index.html        # Frontend — reads from /api/rpi and displays table
├── wrangler.toml         # Cloudflare config (cron, KV binding, routes)
└── package.json
```

---

## wrangler.toml
```toml
name = "soccer-rpi"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "RPI_CACHE"
id = "YOUR_KV_NAMESPACE_ID"

[triggers]
crons = ["0 */2 * * *"]   # every 2 hours

[[routes]]
pattern = "yourdomain.com/*"
zone_name = "yourdomain.com"
```

---

## Types (`src/types.ts`)
```typescript
export interface Game {
  opponentSlug: string;
  opponentName: string;
  won: boolean | null;   // null = tie
}

export interface TeamSchedule {
  games: Game[];
  classification: number | "oos";
  fetchedAt: string;     // ISO timestamp — for cache TTL checks
}

export interface RpiResult {
  team: string;
  classification: string;
  record: string;
  gamesPlayed: number;
  mwp: number;
  owp: number;
  oowp: number;
  rpi: number;
  computedAt: string;
  formula: string;
}

// Shape of what gets stored in KV
export interface KVPayload {
  result: RpiResult;
  scheduleCache: Record<string, TeamSchedule>;
}
```

---

## maxpreps.ts

### `getBuildId(): Promise<string>`
- Fetch `https://www.maxpreps.com`
- Parse the `<script id="__NEXT_DATA__">` tag using `node-html-parser`
- Return `data.buildId.trim()` — **must `.trim()`** to strip the `%0A` newline bug

### `getSchedule(slug: string, buildId: string): Promise<{ games: Game[], classification: number | "oos" }>`
- Fetch `https://www.maxpreps.com/_next/data/{buildId}/{slug}/soccer/spring/schedule.json`
- Parse `pageProps.linkedDataJson.mainEntity.event[]`
- For each event:
  - Parse result from `description` field:
    - `" won "` → `true`
    - `" lost "` → `false`  
    - `" tied "` → `null`
    - anything else → skip (unplayed)
  - Extract `awayTeam.url` and `homeTeam.url`, convert to slugs (first 3 path segments)
  - **Flip result if our team is the home team** — descriptions are written from the
    away team's perspective. If `homeSlug === teamSlug`, flip the won value:
    `won = won === null ? null : !won`
  - Extract classification from `pageProps.teamContext.data.stateDivisionName`
    using regex `/(\d)A/` → parse as int, or `"oos"` if not found

### `fetchBatch(slugs: string[], buildId: string, concurrency = 8): Promise<Record<string, TeamSchedule>>`
- Fetch multiple team schedules in parallel batches of `concurrency`
- Use a simple chunk loop with `Promise.all()` per batch
- Add a small delay (200ms) between batches to avoid rate limiting MaxPreps
- Return a map of `slug → TeamSchedule`

---

## rpi.ts

Port directly from `maxpreps_rpi.py`. Key constants:

```typescript
const GAME_VALUE: Record<number | "oos", number> = {
  2: 1.0, 3: 1.0, 4: 1.25, 5: 1.25, 6: 1.25, oos: 1.25
};
const LOWER_CLASS_VALUES = new Set([2, 3]);
const CROSS_CLASS_EXEMPTIONS = 3;
```

### `calcMwp(games, myClass, oppClassifications, excludeSlug?): number`
- Port of Python `calc_mwp()` exactly
- Iterate games, skip `excludeSlug` (H2H exclusion)
- Track `exemptionsUsed` for cross-class wins
- Return `totalWinValue / totalGameValue`

### `calculateRpi(mySlug, myClass, allSchedules): RpiResult`
- Port of Python `calculate_rpi()` exactly
- Level 1: compute MWP for our team
- Level 2: for each unique opponent, compute their MWP excluding H2H vs us → average = OWP
- Level 3: for each opponent's opponents, compute MWP excluding H2H vs common opp → average per opp → average of averages = OOWP
- `RPI = 0.45 * MWP + 0.45 * OWP + 0.10 * OOWP`

---

## index.ts

### Cron handler
```typescript
async scheduled(event, env, ctx) {
  // 1. Load existing cache from KV (to reuse still-fresh schedules)
  const existing = await env.RPI_CACHE.get("payload", "json") as KVPayload | null;
  const scheduleCache = existing?.scheduleCache ?? {};

  // 2. Get current MaxPreps build ID
  const buildId = await getBuildId();

  // 3. Always re-fetch our team's schedule (no cache)
  const mySchedule = await getSchedule(MY_TEAM_SLUG, buildId);

  // 4. Determine which opponent slugs need fetching (Level 2)
  const oppSlugs = [...new Set(mySchedule.games.map(g => g.opponentSlug))];
  const staleSlugs = oppSlugs.filter(s => isStale(scheduleCache[s], 12));  // 12hr TTL

  // 5. Fetch stale Level 2 schedules in batches
  const freshL2 = await fetchBatch(staleSlugs, buildId);
  Object.assign(scheduleCache, freshL2);

  // 6. Determine opp-of-opp slugs (Level 3)
  const oopSlugs = getOppOppSlugs(mySchedule, scheduleCache, MY_TEAM_SLUG);
  const staleOopSlugs = oopSlugs.filter(s => isStale(scheduleCache[s], 48));  // 48hr TTL

  // 7. Fetch stale Level 3 schedules in batches
  const freshL3 = await fetchBatch(staleOopSlugs, buildId);
  Object.assign(scheduleCache, freshL3);

  // 8. Store our team in the cache too
  scheduleCache[MY_TEAM_SLUG] = { ...mySchedule, fetchedAt: new Date().toISOString() };

  // 9. Compute RPI
  const result = calculateRpi(MY_TEAM_SLUG, MY_CLASSIFICATION, scheduleCache);

  // 10. Save result + updated cache back to KV
  const payload: KVPayload = { result, scheduleCache };
  await env.RPI_CACHE.put("payload", JSON.stringify(payload));
}
```

### HTTP handler (serves the frontend API)
```typescript
async fetch(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/api/rpi") {
    const payload = await env.RPI_CACHE.get("payload", "json") as KVPayload | null;
    if (!payload) return new Response("Not yet computed", { status: 503 });
    return Response.json(payload.result);
  }

  // Serve index.html for all other routes
  // (or let Cloudflare Pages handle static assets)
  return new Response("Not found", { status: 404 });
}
```

### Helper: `isStale(schedule, maxAgeHours): boolean`
```typescript
function isStale(schedule: TeamSchedule | undefined, maxAgeHours: number): boolean {
  if (!schedule) return true;
  const age = Date.now() - new Date(schedule.fetchedAt).getTime();
  return age > maxAgeHours * 60 * 60 * 1000;
}
```

### Helper: `getOppOppSlugs(mySchedule, cache, mySlug): string[]`
- Collect all opponent-of-opponent slugs from Level 2 schedules
- Exclude our own slug
- Return deduplicated list

---

## public/index.html
Simple HTML page that:
- On load, fetches `/api/rpi`
- Displays a table with: Team, Record, MWP, OWP, OOWP, RPI
- Shows `computedAt` timestamp
- Auto-refreshes every 10 minutes with `setInterval`
- No framework needed — plain `fetch()` + DOM manipulation is fine

---

## Setup Steps (run these before Claude Code starts)

1. Install Wrangler: `npm install -g wrangler`
2. Login: `wrangler login`
3. Create KV namespace: `wrangler kv:namespace create RPI_CACHE`
   - Copy the returned `id` into `wrangler.toml`
4. Install deps: `npm install node-html-parser`
5. Install dev deps: `npm install -D typescript @cloudflare/workers-types wrangler`

---

## Config Constants (set at top of `index.ts`)
```typescript
const MY_TEAM_SLUG     = "ut/orem/timpanogos-timberwolves";
const MY_CLASSIFICATION = 4;
const SEASON           = "spring";
```

---

## Key Bugs Already Solved (from Python version — don't re-introduce)
1. **Build ID newline** — always `.trim()` the buildId after parsing
2. **Result perspective flip** — descriptions are from the away team's POV.
   If our team is the home team, flip `won` (`true→false`, `false→true`, `null→null`)
3. **Classification detection** — regex `/(\d)A/` on `stateDivisionName` field

---

## Deployment
```bash
wrangler deploy          # deploys Worker + cron
wrangler pages deploy public  # deploys frontend (or serve via Worker)
```

To trigger the cron manually for testing:
```bash
wrangler dev             # local dev server
# then POST to /__scheduled endpoint to simulate cron
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```
