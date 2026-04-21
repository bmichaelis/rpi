# Scoring Stats: GPG, GAPG, GD — Design Spec

**Date:** 2026-04-21  
**Status:** Approved

## Overview

Add per-game scoring statistics (goals per game, goals against per game, goal differential per game) to the RPI rankings app. Expose them as sortable columns in the rankings table and as a new section on the team detail panel. Remove the redundant RPI formula footer from the detail panel.

## Data Source

Score data is already present in the MaxPreps schedule JSON endpoint we fetch (`/_next/data/{buildId}/{slug}/soccer/{season}/schedule.json`). Each team entry in a contest is a positional array; **index `[6]` is the team's goals scored** in that game. This is `null` for unplayed games.

No additional page fetches or endpoints are needed.

## Backend Changes

### `src/types.ts`

Add two optional fields to `Game`:

```typescript
interface Game {
  opponentSlug: string;
  opponentName: string;
  won: boolean | null;
  goalsScored: number | null;  // ourTeam[6], null if unplayed
  goalsAllowed: number | null; // oppTeam[6], null if unplayed
}
```

Add three fields to `RpiResult`:

```typescript
interface RpiResult {
  // ...existing fields...
  gpg: number;   // goals per game (2 decimal places)
  gapg: number;  // goals allowed per game (2 decimal places)
  gd: number;    // goal differential per game = gpg - gapg (2 decimal places)
}
```

### `src/maxpreps.ts`

In `getSchedule()`, when building a `Game` entry for a played game, read positions `[6]` from `ourTeam` and `oppTeam`:

- `goalsScored = ourTeam[6] as number | null`
- `goalsAllowed = oppTeam[6] as number | null`

For unplayed games (no `Game` entry created), no change needed — those are already skipped.

### `src/rpi.ts`

In `calculateRpi()`, after computing MWP/OWP/OOWP/RPI, compute scoring stats from the team's own played games (same `games` array used for MWP):

```
playedGames = games where goalsScored !== null
totalGoalsFor = sum(goalsScored)
totalGoalsAgainst = sum(goalsAllowed)
n = playedGames.length
gpg  = round(totalGoalsFor / n, 2)
gapg = round(totalGoalsAgainst / n, 2)
gd   = round((totalGoalsFor - totalGoalsAgainst) / n, 2)  // computed from raw totals, not from rounded gpg/gapg
```

If `playedGames.length === 0`, all three default to `0`.

## Frontend Changes (`public/index.html`)

### Rankings Table

**Columns:** RPI | Team | GPG | GAPG | GD/G (5 columns, all sortable)

**Team cell format:** `[#N badge] Team Name (W-L) [4A badge]`
- The `#N` RPI rank badge is assigned in the frontend after the API response is received, by sorting results by RPI descending and recording each team's 1-based position. This rank is stored alongside each result and remains fixed for the session — it does not change when the user re-sorts by a different column.
- W-L record in muted gray in parentheses after the name.
- Class badge (4A, etc.) after the record.

**Sorting behavior:**
- Clicking a column header sorts by that stat, toggling ascending/descending on repeated clicks.
- The active header is highlighted in blue with a ▾ (desc) or ▴ (asc) arrow.
- Default: RPI descending.
- The 4A/All filter toggle continues to work independently of sort state.

**RPI column:** The raw RPI value (e.g. `0.6812`) remains as its own column so it's visible even when sorted by a different stat.

### Team Detail Panel

Add a **Scoring** section between "RPI Components" and "Schedule Depth":

- Three stat boxes: GPG, GAPG, GD/G
- Green tinted background (`#f0fdf4`) with green border (`#bbf7d0`) to visually distinguish from RPI component boxes
- GD/G value prefixed with `+` when positive

**Remove** the formula footer div (`<div class="formula-footer">` or equivalent) at the bottom of the detail card. The formula is already displayed in the page header.

## What Is Not Changing

- RPI calculation formula and weights — no change
- Schedule fetching logic, caching TTLs, batch sizes — no change
- API response shape for existing fields — additive only
- The `record` field in `RpiResult` (W-L string) — still computed the same way
