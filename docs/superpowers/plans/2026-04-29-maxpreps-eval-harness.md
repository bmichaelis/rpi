# MaxPreps Rating Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared evaluation harness for the MaxPreps rating reproduction experiment — frozen training/held-out snapshots and a scorer — so three downstream worktrees can fairly compare reformulation attempts.

**Architecture:** Add a `src/eval/` module with snapshot building and scoring logic. Add `scripts/eval/` CLIs for fetching snapshots and running the scorer. Modify the schedule fetcher to include playoff games (currently silently dropped) and shift the playoff filter to the RPI use-site so the existing UHSAA RPI calculation is unchanged. Capture two snapshots (Utah 4A/5A/6A 2026 training + Texas boys soccer 2026 held-out), commit them as JSON, and produce a baseline `score.json` for the current OLS formula.

**Tech Stack:** TypeScript + tsx (existing). Adds `vitest` for unit tests. Hand-rolled regression metrics (MAE, RMSE, R², MaxErr) — no ML libraries.

**Spec:** `docs/superpowers/specs/2026-04-29-maxpreps-rating-reproduction-design.md`

**Out of scope (future plans):**
- Plan 2: Refined OLS approach (worktree A)
- Plan 3: Massey iteration approach (worktree B)
- Plan 4: Residual reverse-engineering (worktree C)
- Final merge plan (after all three worktrees produce results)

---

## File Structure

| File | Purpose |
|------|---------|
| `package.json` | Add vitest, scripts |
| `src/types.ts` | Add `isPlayoff` to `Game` type |
| `src/maxpreps.ts` | `getSchedule` keeps playoff games and tags them |
| `src/rpi.ts` | `calculateRpi` filters playoffs at use-site (preserves current RPI behavior) |
| `src/eval/types.ts` (new) | `Snapshot`, `Score` types |
| `src/eval/snapshot.ts` (new) | `buildSnapshot()` — assembles a snapshot from an arbitrary class set |
| `src/eval/score.ts` (new) | `score()` — pure metrics function (testable) |
| `src/eval/score.test.ts` (new) | Unit tests for metrics |
| `scripts/eval/fetch-snapshot.ts` (new) | CLI: pulls live data, writes snapshot JSON |
| `scripts/eval/score-cli.ts` (new) | CLI: loads snapshot + predictions, writes `score.json` |
| `scripts/eval/baseline.ts` (new) | CLI: runs current OLS against both snapshots, produces `BASELINE.md` |
| `scripts/eval/data/utah-2026.json` (new) | Training snapshot — committed |
| `scripts/eval/data/texas-2026.json` (new) | Held-out snapshot — committed |
| `scripts/eval/BASELINE.md` (new) | Baseline scores for current OLS |

---

## Task 1: Add vitest and npm scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest@^2.1.0
```

- [ ] **Step 2: Add scripts to package.json**

Modify the `scripts` block to:

```json
"scripts": {
  "typecheck": "tsc",
  "deploy": "wrangler deploy",
  "dev": "wrangler dev",
  "test": "vitest run",
  "test:watch": "vitest",
  "fetch-snapshot": "tsx scripts/eval/fetch-snapshot.ts",
  "score": "tsx scripts/eval/score-cli.ts",
  "baseline": "tsx scripts/eval/baseline.ts"
}
```

- [ ] **Step 3: Verify install**

```bash
npm run test -- --version
```

Expected: vitest version printed (e.g., `vitest/2.1.x`).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add vitest and eval npm scripts"
```

---

## Task 2: Add `isPlayoff` to the `Game` type

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add field to Game interface**

Replace the `Game` interface in `src/types.ts` with:

```typescript
export interface Game {
  opponentSlug: string;
  opponentName: string;
  won: boolean | null; // null = tie
  goalsScored: number | null;  // ourTeam[6], null if unplayed
  goalsAllowed: number | null; // oppTeam[6], null if unplayed
  isPlayoff: boolean;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: errors in `src/maxpreps.ts` (where `games.push({...})` doesn't include `isPlayoff`) and `src/rpi.ts` (none — only reads existing fields). Errors will be fixed in Task 3 and Task 4.

- [ ] **Step 3: Do not commit yet**

Type changes alone leave the codebase broken. Commit after Task 4 fixes consumers.

---

## Task 3: `getSchedule` keeps playoff games and tags them

**Files:**
- Modify: `src/maxpreps.ts:131-132, 173`

The current code drops post-season games at fetch time. Change it to keep them and set `isPlayoff: true`. RPI consumers will filter them in Task 4.

- [ ] **Step 1: Remove the playoff drop**

In `src/maxpreps.ts`, locate (around line 131):

```typescript
      if ((team1[C_GAME_TYPE] as number) === 4 || (team2[C_GAME_TYPE] as number) === 4) continue;
```

Replace with:

```typescript
      const isPlayoff =
        (team1[C_GAME_TYPE] as number) === 4 ||
        (team2[C_GAME_TYPE] as number) === 4;
```

- [ ] **Step 2: Pass the flag into the pushed game**

In the same file, locate the existing push (around line 173):

```typescript
      games.push({ opponentSlug, opponentName, won, goalsScored, goalsAllowed });
```

Replace with:

```typescript
      games.push({ opponentSlug, opponentName, won, goalsScored, goalsAllowed, isPlayoff });
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors from `maxpreps.ts`. (Errors may remain in `rpi.ts` from Task 2 — fixed in Task 4.)

---

## Task 4: `calculateRpi` filters playoffs at use-site

**Files:**
- Modify: `src/rpi.ts`

UHSAA RPI does not include playoff games. Preserve that behavior by filtering at the consumer.

- [ ] **Step 1: Filter playoff games at the top of calculateRpi**

In `src/rpi.ts`, locate (around line 80):

```typescript
  const mySchedule = allSchedules[mySlug];
  if (!mySchedule) throw new Error(`No schedule found for ${mySlug}`);
  const l1Games = mySchedule.games;
```

Replace with:

```typescript
  const mySchedule = allSchedules[mySlug];
  if (!mySchedule) throw new Error(`No schedule found for ${mySlug}`);
  const l1Games = mySchedule.games.filter((g) => !g.isPlayoff);
```

- [ ] **Step 2: Filter playoffs in opponent and opp-of-opp WP calls**

`calcWp` and `calcMwp` operate on a `Game[]`. Make playoff exclusion explicit at every call site within `calculateRpi`:

In `calculateRpi`, replace each occurrence of `opp.games` and `oppGame` accesses with playoff-filtered equivalents.

Find the OWP loop (around line 102):

```typescript
  for (const game of l1Games) {
    const opp = allSchedules[game.opponentSlug];
    if (!opp) continue;
    oppWps.push(calcWp(opp.games, mySlug));
  }
```

Replace with:

```typescript
  for (const game of l1Games) {
    const opp = allSchedules[game.opponentSlug];
    if (!opp) continue;
    oppWps.push(calcWp(opp.games.filter((g) => !g.isPlayoff), mySlug));
  }
```

Find the OOWP loop (around line 112):

```typescript
  for (const oppSlug of uniqueOppSlugs) {
    const opp = allSchedules[oppSlug];
    if (!opp) continue;
    const ooWps: number[] = [];
    for (const oppGame of opp.games) {
      if (oppGame.opponentSlug === mySlug) continue;
      const oo = allSchedules[oppGame.opponentSlug];
      if (!oo) continue;
      ooWps.push(calcWp(oo.games, oppSlug, mySlug));
    }
```

Replace with:

```typescript
  for (const oppSlug of uniqueOppSlugs) {
    const opp = allSchedules[oppSlug];
    if (!opp) continue;
    const ooWps: number[] = [];
    for (const oppGame of opp.games.filter((g) => !g.isPlayoff)) {
      if (oppGame.opponentSlug === mySlug) continue;
      const oo = allSchedules[oppGame.opponentSlug];
      if (!oo) continue;
      ooWps.push(calcWp(oo.games.filter((g) => !g.isPlayoff), oppSlug, mySlug));
    }
```

Find the oppOppSlugs collection loop (around line 141):

```typescript
  const oppOppSlugs = new Set<string>();
  for (const oppSlug of uniqueOppSlugs) {
    const opp = allSchedules[oppSlug];
    if (!opp) continue;
    for (const g of opp.games) {
      if (g.opponentSlug !== mySlug && !uniqueOppSlugs.includes(g.opponentSlug)) {
        oppOppSlugs.add(g.opponentSlug);
      }
    }
  }
```

Replace with:

```typescript
  const oppOppSlugs = new Set<string>();
  for (const oppSlug of uniqueOppSlugs) {
    const opp = allSchedules[oppSlug];
    if (!opp) continue;
    for (const g of opp.games.filter((g) => !g.isPlayoff)) {
      if (g.opponentSlug !== mySlug && !uniqueOppSlugs.includes(g.opponentSlug)) {
        oppOppSlugs.add(g.opponentSlug);
      }
    }
  }
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Verify RPI is unchanged with no playoff data**

Run the existing verify path (which still uses the schedule cache without playoffs since none were captured before):

```bash
ls verify-results.json
```

Expected: file exists. Do NOT regenerate it — its purpose is to provide a baseline. As long as `npm run typecheck` passes and the filter logic preserves "no playoffs in input → no playoff filtering needed" semantics, RPI behavior is preserved.

- [ ] **Step 5: Commit Tasks 2-4 together**

```bash
git add src/types.ts src/maxpreps.ts src/rpi.ts
git commit -m "Capture playoff games at fetch, filter at RPI use-site

Schedule fetcher previously dropped post-season games (game type 4),
making mpRating diverge from MaxPreps's official rating which
includes playoff results. Tag games with isPlayoff and filter at
the RPI consumer, preserving UHSAA RPI behavior."
```

---

## Task 5: Define eval types

**Files:**
- Create: `src/eval/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
import type { TeamSchedule } from "../types";

export interface Snapshot {
  capturedAt: string;
  source: string; // e.g. "utah-4a5a6a-2026" or "texas-uil-6a-2026"
  scheduleCache: Record<string, TeamSchedule>;
  officialRatings: Record<string, number>; // slug → MaxPreps rating
  strengthMap: Record<string, number>;     // slug → MaxPreps strength
}

export interface ResidualBucket {
  binStart: number;
  binEnd: number;
  count: number;
}

export interface ClassMetrics {
  n: number;
  mae: number;
  rmse: number;
  maxErr: number;
  r2: number;
}

export interface Score {
  n: number;
  mae: number;
  rmse: number;
  maxErr: number;
  r2: number;
  residualHistogram: ResidualBucket[];
  byClass: Record<string, ClassMetrics>;
  worst10: { slug: string; predicted: number; official: number; residual: number }[];
}
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/eval/types.ts
git commit -m "Add eval types (Snapshot, Score)"
```

---

## Task 6: Write the scorer with TDD

**Files:**
- Create: `src/eval/score.ts`
- Create: `src/eval/score.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/eval/score.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { score } from "./score";
import type { Snapshot } from "./types";

function makeSnapshot(officialRatings: Record<string, number>, classifications: Record<string, number | "oos"> = {}): Snapshot {
  const scheduleCache: Snapshot["scheduleCache"] = {};
  for (const slug of Object.keys(officialRatings)) {
    scheduleCache[slug] = {
      games: [],
      upcoming: [],
      classification: classifications[slug] ?? 4,
      teamName: slug,
      fetchedAt: "2026-01-01T00:00:00Z",
    };
  }
  return {
    capturedAt: "2026-01-01T00:00:00Z",
    source: "test",
    scheduleCache,
    officialRatings,
    strengthMap: {},
  };
}

describe("score", () => {
  it("returns zero error when predictions match", () => {
    const snap = makeSnapshot({ a: 5, b: 10, c: 15 });
    const preds = { a: 5, b: 10, c: 15 };
    const s = score(snap, preds);
    expect(s.mae).toBe(0);
    expect(s.rmse).toBe(0);
    expect(s.maxErr).toBe(0);
    expect(s.r2).toBe(1);
    expect(s.n).toBe(3);
  });

  it("computes MAE, RMSE, MaxErr correctly", () => {
    const snap = makeSnapshot({ a: 10, b: 10, c: 10 });
    const preds = { a: 11, b: 12, c: 7 };
    const s = score(snap, preds);
    // residuals: +1, +2, -3 → |residuals|: 1, 2, 3
    expect(s.mae).toBeCloseTo((1 + 2 + 3) / 3, 6);
    expect(s.rmse).toBeCloseTo(Math.sqrt((1 + 4 + 9) / 3), 6);
    expect(s.maxErr).toBe(3);
  });

  it("ignores teams missing from predictions", () => {
    const snap = makeSnapshot({ a: 5, b: 10, c: 15 });
    const preds = { a: 5, b: 10 }; // no c
    const s = score(snap, preds);
    expect(s.n).toBe(2);
  });

  it("ignores teams missing from officialRatings", () => {
    const snap = makeSnapshot({ a: 5 });
    const preds = { a: 5, b: 999 }; // b not in official
    const s = score(snap, preds);
    expect(s.n).toBe(1);
  });

  it("breaks down metrics by class", () => {
    const snap = makeSnapshot(
      { a: 10, b: 10, c: 10, d: 10 },
      { a: 4, b: 4, c: 5, d: 5 }
    );
    const preds = { a: 12, b: 12, c: 11, d: 11 };
    const s = score(snap, preds);
    expect(s.byClass["4A"].mae).toBeCloseTo(2, 6);
    expect(s.byClass["4A"].n).toBe(2);
    expect(s.byClass["5A"].mae).toBeCloseTo(1, 6);
    expect(s.byClass["5A"].n).toBe(2);
  });

  it("returns worst10 sorted by absolute residual descending", () => {
    const snap = makeSnapshot({ a: 0, b: 0, c: 0, d: 0 });
    const preds = { a: 0.5, b: -2, c: 1, d: -3 };
    const s = score(snap, preds);
    const order = s.worst10.map((w) => w.slug);
    expect(order).toEqual(["d", "b", "c", "a"]);
  });

  it("computes R² = 1 - SS_res/SS_tot", () => {
    // Mean of officials (1, 2, 3) = 2. SS_tot = 1 + 0 + 1 = 2.
    // Predictions (1.5, 2, 2.5). Residuals (0.5, 0, 0.5). SS_res = 0.25 + 0 + 0.25 = 0.5.
    // R² = 1 - 0.5/2 = 0.75.
    const snap = makeSnapshot({ a: 1, b: 2, c: 3 });
    const preds = { a: 1.5, b: 2, c: 2.5 };
    const s = score(snap, preds);
    expect(s.r2).toBeCloseTo(0.75, 6);
  });

  it("produces a residual histogram with 10 buckets", () => {
    const snap = makeSnapshot(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`t${i}`, 0])));
    // Predictions span -1 to +1 in 0.1 increments
    const preds = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`t${i}`, -1 + i * 0.1]));
    const s = score(snap, preds);
    expect(s.residualHistogram).toHaveLength(10);
    const total = s.residualHistogram.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(20);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test
```

Expected: FAIL — `score` is not defined.

- [ ] **Step 3: Implement score()**

Create `src/eval/score.ts`:

```typescript
import type { Snapshot, Score, ClassMetrics, ResidualBucket } from "./types";

function classLabel(cls: number | "oos"): string {
  return cls === "oos" ? "OOS" : `${cls}A`;
}

function metricsFor(
  pairs: { predicted: number; official: number }[]
): { mae: number; rmse: number; maxErr: number; r2: number } {
  if (pairs.length === 0) return { mae: 0, rmse: 0, maxErr: 0, r2: 0 };

  let sumAbs = 0;
  let sumSq = 0;
  let maxErr = 0;
  let sumOfficial = 0;
  for (const { predicted, official } of pairs) {
    const residual = predicted - official;
    const absR = Math.abs(residual);
    sumAbs += absR;
    sumSq += residual * residual;
    if (absR > maxErr) maxErr = absR;
    sumOfficial += official;
  }
  const n = pairs.length;
  const meanOfficial = sumOfficial / n;
  let ssTot = 0;
  for (const { official } of pairs) {
    const d = official - meanOfficial;
    ssTot += d * d;
  }
  const r2 = ssTot === 0 ? 1 : 1 - sumSq / ssTot;
  return {
    mae: sumAbs / n,
    rmse: Math.sqrt(sumSq / n),
    maxErr,
    r2,
  };
}

function histogram(residuals: number[], buckets = 10): ResidualBucket[] {
  if (residuals.length === 0) return [];
  const min = Math.min(...residuals);
  const max = Math.max(...residuals);
  // Edge case: all residuals identical → put them all in one bucket
  if (min === max) {
    return [{ binStart: min, binEnd: min, count: residuals.length }];
  }
  const width = (max - min) / buckets;
  const result: ResidualBucket[] = [];
  for (let i = 0; i < buckets; i++) {
    const binStart = min + i * width;
    const binEnd = i === buckets - 1 ? max : min + (i + 1) * width;
    result.push({ binStart, binEnd, count: 0 });
  }
  for (const r of residuals) {
    let idx = Math.floor((r - min) / width);
    if (idx >= buckets) idx = buckets - 1; // include max in last bucket
    result[idx].count++;
  }
  return result;
}

export function score(
  snapshot: Snapshot,
  predictions: Record<string, number>
): Score {
  const pairs: { slug: string; predicted: number; official: number; cls: string }[] = [];
  for (const [slug, official] of Object.entries(snapshot.officialRatings)) {
    const predicted = predictions[slug];
    if (predicted === undefined) continue;
    const cls = classLabel(snapshot.scheduleCache[slug]?.classification ?? "oos");
    pairs.push({ slug, predicted, official, cls });
  }

  const overall = metricsFor(pairs);

  const residualHistogram = histogram(
    pairs.map((p) => p.predicted - p.official)
  );

  const byClass: Record<string, ClassMetrics> = {};
  const classes = [...new Set(pairs.map((p) => p.cls))];
  for (const cls of classes) {
    const subset = pairs.filter((p) => p.cls === cls);
    const m = metricsFor(subset);
    byClass[cls] = { n: subset.length, ...m };
  }

  const worst10 = [...pairs]
    .sort((a, b) => Math.abs(b.predicted - b.official) - Math.abs(a.predicted - a.official))
    .slice(0, 10)
    .map((p) => ({
      slug: p.slug,
      predicted: p.predicted,
      official: p.official,
      residual: p.predicted - p.official,
    }));

  return {
    n: pairs.length,
    ...overall,
    residualHistogram,
    byClass,
    worst10,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/eval/score.ts src/eval/score.test.ts
git commit -m "Add scorer with MAE/RMSE/MaxErr/R²/histogram/by-class/worst10"
```

---

## Task 7: Snapshot builder

**Files:**
- Create: `src/eval/snapshot.ts`

The builder takes a list of `(class label, divisionId, rankingsSlug)` tuples and returns a `Snapshot`. It reuses existing fetchers in `src/maxpreps.ts`.

- [ ] **Step 1: Write the builder**

Create `src/eval/snapshot.ts`:

```typescript
import { getBuildId, getClassTeams, fetchBatch } from "../maxpreps";
import type { TeamSchedule } from "../types";
import type { Snapshot } from "./types";

export interface ClassTarget {
  rankingsSlug: string;     // e.g. "ut/soccer/spring-2026/class/class-4a/rankings"
  stateDivisionId: string;  // MaxPreps division UUID
}

export interface BuildSnapshotArgs {
  source: string;           // e.g. "utah-4a5a6a-2026"
  season: string;           // e.g. "spring-2026"
  classes: ClassTarget[];
}

export async function buildSnapshot(args: BuildSnapshotArgs): Promise<Snapshot> {
  const buildId = await getBuildId();

  const officialRatings: Record<string, number> = {};
  const strengthMap: Record<string, number> = {};
  const classTeamMap = new Map<string, string>();

  for (const { rankingsSlug, stateDivisionId } of args.classes) {
    const teams = await getClassTeams(rankingsSlug, stateDivisionId, buildId);
    for (const { slug, teamName, mpOfficialRating, mpStrength } of teams) {
      classTeamMap.set(slug, teamName);
      if (mpOfficialRating !== undefined) officialRatings[slug] = mpOfficialRating;
      if (mpStrength !== undefined) strengthMap[slug] = mpStrength;
    }
  }

  // Fetch direct opponents (L2)
  const targetSlugs = [...classTeamMap.keys()];
  const scheduleCache: Record<string, TeamSchedule> = {};
  Object.assign(scheduleCache, await fetchBatch(targetSlugs, buildId, args.season));

  // Backfill teamName for cached schedules missing it
  for (const [slug, teamName] of classTeamMap) {
    if (scheduleCache[slug] && !scheduleCache[slug].teamName) {
      scheduleCache[slug] = { ...scheduleCache[slug], teamName };
    }
  }

  // Opp-of-opp (L3)
  const targetSet = new Set(targetSlugs);
  const oopSet = new Set<string>();
  for (const slug of targetSlugs) {
    const sched = scheduleCache[slug];
    if (!sched) continue;
    for (const g of sched.games) {
      if (!targetSet.has(g.opponentSlug)) oopSet.add(g.opponentSlug);
    }
  }
  Object.assign(scheduleCache, await fetchBatch([...oopSet], buildId, args.season));

  return {
    capturedAt: new Date().toISOString(),
    source: args.source,
    scheduleCache,
    officialRatings,
    strengthMap,
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/eval/snapshot.ts
git commit -m "Add buildSnapshot helper for assembling eval snapshots"
```

---

## Task 8: fetch-snapshot CLI

**Files:**
- Create: `scripts/eval/fetch-snapshot.ts`

- [ ] **Step 1: Write the CLI**

Create `scripts/eval/fetch-snapshot.ts`:

```typescript
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { buildSnapshot, type ClassTarget } from "../../src/eval/snapshot";

interface SnapshotConfig {
  source: string;
  season: string;
  classes: ClassTarget[];
}

const PRESETS: Record<string, SnapshotConfig> = {
  "utah-2026": {
    source: "utah-4a5a6a-2026",
    season: "spring-2026",
    classes: [
      {
        rankingsSlug: "ut/soccer/spring-2026/class/class-4a/rankings",
        stateDivisionId: "c534b3e8-c200-4b4b-9aa6-f5aa1e5352bc",
      },
      {
        rankingsSlug: "ut/soccer/spring-2026/class/class-5a/rankings",
        stateDivisionId: "feaf72b1-8c0d-4a89-b835-a75c292d2347",
      },
      {
        rankingsSlug: "ut/soccer/spring-2026/class/class-6a/rankings",
        stateDivisionId: "0f72a3d1-ec2e-46f5-8a1a-6f4b6df56ca7",
      },
    ],
  },
  // texas-2026 added in Task 9 once division IDs are discovered
};

function parseArgs(argv: string[]): { preset?: string; out?: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return { preset: args.preset, out: args.out };
}

async function main() {
  const { preset, out } = parseArgs(process.argv.slice(2));
  if (!preset || !out) {
    console.error("Usage: tsx scripts/eval/fetch-snapshot.ts --preset <name> --out <path>");
    console.error("Presets:", Object.keys(PRESETS).join(", "));
    process.exit(1);
  }
  const config = PRESETS[preset];
  if (!config) {
    console.error(`Unknown preset: ${preset}`);
    process.exit(1);
  }
  console.log(`Building snapshot for ${preset}...`);
  const snap = await buildSnapshot(config);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snap, null, 2));
  console.log(
    `Wrote ${out}: ${Object.keys(snap.scheduleCache).length} teams, ` +
      `${Object.keys(snap.officialRatings).length} with official ratings`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/eval/fetch-snapshot.ts
git commit -m "Add fetch-snapshot CLI with utah-2026 preset"
```

---

## Task 9: Capture utah-2026 snapshot

**Files:**
- Create: `scripts/eval/data/utah-2026.json`

Pulls live data and commits the result. This snapshot is the training set.

- [ ] **Step 1: Run the fetcher**

```bash
npm run fetch-snapshot -- --preset utah-2026 --out scripts/eval/data/utah-2026.json
```

Expected output: a line like `Wrote scripts/eval/data/utah-2026.json: 77 teams, 77 with official ratings` (counts may vary).

- [ ] **Step 2: Sanity-check the file**

```bash
node -e "const s = require('./scripts/eval/data/utah-2026.json'); console.log({teams: Object.keys(s.scheduleCache).length, official: Object.keys(s.officialRatings).length, strength: Object.keys(s.strengthMap).length, source: s.source, sampleGame: s.scheduleCache[Object.keys(s.scheduleCache)[0]].games[0]});"
```

Expected: counts > 50 for teams + official + strength; sampleGame has the new `isPlayoff` boolean field.

- [ ] **Step 3: Commit**

```bash
git add scripts/eval/data/utah-2026.json
git commit -m "Capture utah-2026 training snapshot"
```

---

## Task 10: Discover Texas division IDs and capture texas-2026 snapshot

**Files:**
- Modify: `scripts/eval/fetch-snapshot.ts` (add texas-2026 preset)
- Create: `scripts/eval/data/texas-2026.json`

Texas boys soccer division IDs are not known up front. The engineer fetches the rankings index page to get them.

- [ ] **Step 1: Discover the rankings index for Texas**

Try the rankings index page:

```bash
curl -s "https://www.maxpreps.com/tx/soccer/spring-2026/state/rankings/" -H "User-Agent: Mozilla/5.0" -L | grep -oE '/tx/soccer/spring-2026/class/class-[0-9]+a/rankings' | sort -u
```

Expected output: a list of paths like `/tx/soccer/spring-2026/class/class-6a/rankings`. If empty, try the Next.js JSON endpoint:

```bash
BUILD_ID=$(curl -s "https://www.maxpreps.com/" -H "User-Agent: Mozilla/5.0" | grep -oE '"buildId":"[^"]+"' | head -1 | sed 's/"buildId":"//;s/"//')
echo "BuildId: $BUILD_ID"
curl -s "https://www.maxpreps.com/_next/data/$BUILD_ID/tx/soccer/spring-2026/state/rankings.json" -H "User-Agent: Mozilla/5.0" -H "x-nextjs-data: 1" -L | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d,indent=2))" | grep -E '(class-|stateDivisionId)' | head -40
```

If both still fail, browse https://www.maxpreps.com/tx/soccer/rankings/ in a browser, view source, and search for `stateDivisionId` and `class-`.

- [ ] **Step 2: Get divisionId for each class**

For each class slug found in step 1, fetch the rankings page and extract the division UUID. E.g., for 6A:

```bash
BUILD_ID=$(curl -s "https://www.maxpreps.com/" -H "User-Agent: Mozilla/5.0" | grep -oE '"buildId":"[^"]+"' | head -1 | sed 's/"buildId":"//;s/"//')
curl -s "https://www.maxpreps.com/_next/data/$BUILD_ID/tx/soccer/spring-2026/class/class-6a/rankings/1.json" -H "User-Agent: Mozilla/5.0" -H "x-nextjs-data: 1" -L | grep -oE '"stateDivisionId":"[a-f0-9-]+"' | head -1
```

Expected output: `"stateDivisionId":"<uuid>"` — note the UUID for use in step 3.

Repeat for any other classes you intend to include. **For the held-out set, capturing one Texas class is sufficient — pick the largest (likely 6A).** If 6A produces fewer than 30 teams with official ratings (per Step 5 below), re-run after adding 5A to the preset.

**Note on 6A division naming:** Texas UIL 6A may also appear as "6A Division I" / "6A Division II" depending on MaxPreps's structure. If you see two 6A division IDs, include both as separate `ClassTarget` entries — `getClassTeams` deduplicates by slug.

- [ ] **Step 3: Add the texas-2026 preset**

In `scripts/eval/fetch-snapshot.ts`, locate the `PRESETS` block and add (replacing `<UUID>` with the actual UUID from step 2):

```typescript
  "texas-2026": {
    source: "texas-uil-6a-2026",
    season: "spring-2026",
    classes: [
      {
        rankingsSlug: "tx/soccer/spring-2026/class/class-6a/rankings",
        stateDivisionId: "<UUID>",
      },
      // Add additional classes if 6A alone has fewer than 30 ranked teams.
    ],
  },
```

If you added a second class, include it as another array entry with its rankingsSlug and stateDivisionId.

- [ ] **Step 4: Run the fetcher**

```bash
npm run fetch-snapshot -- --preset texas-2026 --out scripts/eval/data/texas-2026.json
```

Expected output: a line like `Wrote scripts/eval/data/texas-2026.json: <N> teams, <M> with official ratings` where M ≥ 30.

- [ ] **Step 5: Sanity-check**

```bash
node -e "const s = require('./scripts/eval/data/texas-2026.json'); console.log({teams: Object.keys(s.scheduleCache).length, official: Object.keys(s.officialRatings).length, strength: Object.keys(s.strengthMap).length, source: s.source});"
```

Expected: official ratings count ≥ 30.

- [ ] **Step 6: Commit**

```bash
git add scripts/eval/fetch-snapshot.ts scripts/eval/data/texas-2026.json
git commit -m "Capture texas-2026 held-out snapshot"
```

---

## Task 11: score-cli

**Files:**
- Create: `scripts/eval/score-cli.ts`

- [ ] **Step 1: Write the CLI**

Create `scripts/eval/score-cli.ts`:

```typescript
import { readFileSync, writeFileSync } from "fs";
import { score } from "../../src/eval/score";
import type { Snapshot } from "../../src/eval/types";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { snapshot: snapshotPath, predictions: predictionsPath, out } = args;
  if (!snapshotPath || !predictionsPath || !out) {
    console.error(
      "Usage: tsx scripts/eval/score-cli.ts --snapshot <path> --predictions <path> --out <path>"
    );
    process.exit(1);
  }
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;
  const predictions = JSON.parse(readFileSync(predictionsPath, "utf8")) as Record<string, number>;
  const result = score(snapshot, predictions);
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(
    `Scored ${result.n} teams. MAE=${result.mae.toFixed(4)}, RMSE=${result.rmse.toFixed(4)}, MaxErr=${result.maxErr.toFixed(4)}, R²=${result.r2.toFixed(4)}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/eval/score-cli.ts
git commit -m "Add score-cli for running the scorer from JSON files"
```

---

## Task 12: Baseline runner — score the current OLS

**Files:**
- Create: `scripts/eval/baseline.ts`
- Create: `scripts/eval/BASELINE.md`

This produces predictions using the existing `calculateAllMaxPrepsRatings` and writes `BASELINE.md` with both train and held-out scores. This is the bar each approach must beat by ≥ 0.20 MAE on Texas held-out.

- [ ] **Step 1: Write the baseline script**

Create `scripts/eval/baseline.ts`:

```typescript
import { readFileSync, writeFileSync } from "fs";
import { calculateAllMaxPrepsRatings } from "../../src/rpi";
import { score } from "../../src/eval/score";
import type { Snapshot, Score } from "../../src/eval/types";

function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function predict(snapshot: Snapshot): Record<string, number> {
  return calculateAllMaxPrepsRatings(snapshot.scheduleCache, snapshot.strengthMap);
}

function fmt(s: Score): string {
  const lines: string[] = [];
  lines.push(`- n: ${s.n}`);
  lines.push(`- MAE: ${s.mae.toFixed(4)}`);
  lines.push(`- RMSE: ${s.rmse.toFixed(4)}`);
  lines.push(`- MaxErr: ${s.maxErr.toFixed(4)}`);
  lines.push(`- R²: ${s.r2.toFixed(4)}`);
  lines.push("");
  lines.push("By class:");
  for (const [cls, m] of Object.entries(s.byClass).sort()) {
    lines.push(`- ${cls}: n=${m.n}, MAE=${m.mae.toFixed(4)}, MaxErr=${m.maxErr.toFixed(4)}`);
  }
  lines.push("");
  lines.push("Worst 10:");
  lines.push("| slug | predicted | official | residual |");
  lines.push("|------|-----------|----------|----------|");
  for (const w of s.worst10) {
    lines.push(`| ${w.slug} | ${w.predicted.toFixed(4)} | ${w.official.toFixed(4)} | ${w.residual.toFixed(4)} |`);
  }
  return lines.join("\n");
}

async function main() {
  const utah = loadSnapshot("scripts/eval/data/utah-2026.json");
  const texas = loadSnapshot("scripts/eval/data/texas-2026.json");

  const utahPreds = predict(utah);
  const texasPreds = predict(texas);

  const utahScore = score(utah, utahPreds);
  const texasScore = score(texas, texasPreds);

  writeFileSync(
    "scripts/eval/BASELINE.md",
    `# Baseline — current OLS formula

\`rating = 0.8809*(W-L) + 0.9183*strength + 1.6813*gdCap + 0.0552\`

Captured: ${new Date().toISOString()}

## Training set: utah-2026

${fmt(utahScore)}

## Held-out set: texas-2026

${fmt(texasScore)}

## Acceptance bar for new approaches

A new formula must beat this baseline by **≥ 0.20 MAE on the texas-2026 held-out set**.
Current bar: MAE < ${(texasScore.mae - 0.2).toFixed(4)}.
`
  );

  console.log(`Utah-2026:  MAE=${utahScore.mae.toFixed(4)}, MaxErr=${utahScore.maxErr.toFixed(4)}`);
  console.log(`Texas-2026: MAE=${texasScore.mae.toFixed(4)}, MaxErr=${texasScore.maxErr.toFixed(4)}`);
  console.log(`Acceptance bar: Texas MAE < ${(texasScore.mae - 0.2).toFixed(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

```bash
npm run baseline
```

Expected: prints two MAE/MaxErr lines and an acceptance bar; creates `scripts/eval/BASELINE.md`.

- [ ] **Step 3: Inspect the output**

```bash
cat scripts/eval/BASELINE.md
```

Expected: a markdown report with two scored sections and an acceptance bar.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval/baseline.ts scripts/eval/BASELINE.md
git commit -m "Score current OLS as baseline; document acceptance bar for approaches"
```

---

## Task 13: Final summary and handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-04-29-maxpreps-rating-reproduction-design.md` — add a "Status" section at the top noting eval harness is complete

- [ ] **Step 1: Add a status note to the spec**

At the top of `docs/superpowers/specs/2026-04-29-maxpreps-rating-reproduction-design.md`, immediately after the `# MaxPreps Rating Reproduction — Design` heading, insert:

```markdown
## Status

- [x] Phase 1: Eval harness on `main` (this commit chain)
- [ ] Phase 2: Worktree A — Refined OLS (Plan 2 — to be written)
- [ ] Phase 3: Worktree B — Massey iteration (Plan 3 — to be written)
- [ ] Phase 4: Worktree C — Residual reverse-engineering (Plan 4 — to be written)
- [ ] Phase 5: Compare results, merge winner (Plan 5 — to be written)

```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-29-maxpreps-rating-reproduction-design.md
git commit -m "Mark eval harness phase complete in design spec"
```

- [ ] **Step 3: Verify the handoff state**

```bash
npm run test && npm run typecheck && ls scripts/eval/data/ scripts/eval/BASELINE.md
```

Expected: all tests pass, typecheck clean, both snapshot files and the baseline document exist.

The next plan (Plan 2) creates worktree A and writes the Refined OLS implementation. It will:
1. Branch a worktree off `main` at this commit.
2. Add `predict-v1.ts` script implementing functional-form search.
3. Score against both snapshots; record results in `RESULT.md`.
4. Open a PR back to `main`.
