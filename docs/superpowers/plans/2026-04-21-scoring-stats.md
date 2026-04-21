# Scoring Stats (GPG, GAPG, GD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add goals-per-game, goals-allowed-per-game, and goal-differential-per-game stats to the RPI rankings — scraped from existing MaxPreps schedule data, surfaced as sortable table columns and a new detail-panel section.

**Architecture:** Score data (index `[6]` in each team entry array) is already in the schedule JSON we fetch — no new endpoints needed. Backend adds `goalsScored`/`goalsAllowed` to `Game`, computes `gpg`/`gapg`/`gd` in `calculateRpi()`, and stores them in `RpiResult`. Frontend adds 3 sortable columns to the rankings table, pins the RPI rank badge inside the team cell, and shows a new Scoring section in the detail panel.

**Tech Stack:** TypeScript, Cloudflare Workers, vanilla JS frontend (no framework). Type-check with `npm run typecheck`.

---

## Files

| File | Change |
|------|--------|
| `src/types.ts` | Add `goalsScored`/`goalsAllowed` to `Game`; add `gpg`/`gapg`/`gd` to `RpiResult` |
| `src/maxpreps.ts` | Add `C_SCORE = 6` constant; capture scores when parsing played games |
| `src/rpi.ts` | Compute GPG/GAPG/GD from played games, include in return value |
| `public/index.html` | New sort state; 5-column table; rank badge in team cell; Scoring detail section; remove formula footer |

---

## Task 1: Update types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add score fields to `Game` and scoring stats to `RpiResult`**

Replace `src/types.ts` entirely with:

```typescript
export interface Game {
  opponentSlug: string;
  opponentName: string;
  won: boolean | null; // null = tie
  goalsScored: number | null;  // ourTeam[6], null if unplayed
  goalsAllowed: number | null; // oppTeam[6], null if unplayed
}

export interface TeamSchedule {
  games: Game[];
  classification: number | "oos";
  teamName: string;
  fetchedAt: string; // ISO timestamp
}

export interface RpiResult {
  team: string;
  teamName: string;
  classification: string;
  record: string;
  gamesCounted: number;
  opponentsCounted: number;
  oppOppCounted: number;
  mwp: number;
  owp: number;
  oowp: number;
  rpi: number;
  gpg: number;
  gapg: number;
  gd: number;
  computedAt: string;
  formula: string;
}

export interface KVPayload {
  results: Record<string, RpiResult>;
  scheduleCache: Record<string, TeamSchedule>;
}

export interface Env {
  MAXPREPS_RPI: KVNamespace;
}
```

- [ ] **Step 2: Verify types compile**

```bash
npm run typecheck
```

Expected: errors in `maxpreps.ts` and `rpi.ts` because `Game` now requires `goalsScored`/`goalsAllowed` and `RpiResult` requires `gpg`/`gapg`/`gd` — those will be fixed in Tasks 2 and 3.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add goalsScored/goalsAllowed to Game, gpg/gapg/gd to RpiResult"
```

---

## Task 2: Parse scores in maxpreps.ts

**Files:**
- Modify: `src/maxpreps.ts:17-20, 155-157`

- [ ] **Step 1: Add the `C_SCORE` position constant**

In `src/maxpreps.ts`, the three position constants are at lines 17-19:

```typescript
const C_URL    = 13; // team schedule URL
const C_NAME   = 14; // school short name
const C_RESULT =  5; // "W", "L", "T", or null/missing for unplayed
```

Add `C_SCORE` on the line after `C_RESULT`:

```typescript
const C_URL    = 13; // team schedule URL
const C_NAME   = 14; // school short name
const C_RESULT =  5; // "W", "L", "T", or null/missing for unplayed
const C_SCORE  =  6; // goals scored by this team, null for unplayed
```

- [ ] **Step 2: Capture scores when building `Game` entries**

In `src/maxpreps.ts`, line 156 currently reads:

```typescript
      games.push({ opponentSlug, opponentName, won });
```

Replace it with:

```typescript
      const goalsScored = typeof ourTeam[C_SCORE] === "number"
        ? (ourTeam[C_SCORE] as number)
        : null;
      const goalsAllowed = typeof oppTeam[C_SCORE] === "number"
        ? (oppTeam[C_SCORE] as number)
        : null;
      games.push({ opponentSlug, opponentName, won, goalsScored, goalsAllowed });
```

- [ ] **Step 3: Verify no new type errors in maxpreps.ts**

```bash
npm run typecheck
```

Expected: `maxpreps.ts` is now clean; errors remain only in `rpi.ts` (missing `gpg`/`gapg`/`gd` in the return object).

- [ ] **Step 4: Commit**

```bash
git add src/maxpreps.ts
git commit -m "feat: capture goals scored/allowed from MaxPreps contest data (index 6)"
```

---

## Task 3: Compute scoring stats in rpi.ts

**Files:**
- Modify: `src/rpi.ts:122-150`

- [ ] **Step 1: Add GPG/GAPG/GD computation after the RPI formula**

In `src/rpi.ts`, line 122 is:

```typescript
  const rpi = Math.round((0.45 * mwp + 0.45 * owp + 0.1 * oowp) * 10000) / 10000;
```

Insert the following block immediately after that line (before the `// Count unique opp-of-opp` comment):

```typescript
  // Scoring stats — from played games only (goalsScored !== null)
  const scoredGames = l1Games.filter(g => g.goalsScored !== null);
  const n = scoredGames.length;
  const totalGF = scoredGames.reduce((sum, g) => sum + (g.goalsScored ?? 0), 0);
  const totalGA = scoredGames.reduce((sum, g) => sum + (g.goalsAllowed ?? 0), 0);
  const gpg  = n > 0 ? Math.round((totalGF / n) * 100) / 100 : 0;
  const gapg = n > 0 ? Math.round((totalGA / n) * 100) / 100 : 0;
  const gd   = n > 0 ? Math.round(((totalGF - totalGA) / n) * 100) / 100 : 0;
```

- [ ] **Step 2: Add `gpg`, `gapg`, `gd` to the return object**

The return statement starting at line 136 currently ends with:

```typescript
    rpi,
    computedAt: new Date().toISOString(),
    formula: "RPI = 0.45(MWP) + 0.45(OWP) + 0.10(OOWP)",
```

Add the three new fields before `computedAt`:

```typescript
    rpi,
    gpg,
    gapg,
    gd,
    computedAt: new Date().toISOString(),
    formula: "RPI = 0.45(MWP) + 0.45(OWP) + 0.10(OOWP)",
```

- [ ] **Step 3: Verify clean typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/rpi.ts
git commit -m "feat: compute gpg, gapg, gd in calculateRpi"
```

---

## Task 4: Update the rankings table (frontend)

**Files:**
- Modify: `public/index.html`

This task updates the left panel: widens it to fit 5 columns, adds sort state, rebuilds the column header with sort indicators, and puts the RPI rank badge + W-L record inside the team cell.

- [ ] **Step 1: Widen the left panel and update the column grid**

In the CSS, change the `.body` grid and the list column grid template. Find:

```css
    .body {
      display: grid;
      grid-template-columns: 280px 1fr;
      flex: 1;
      overflow: hidden;
    }
```

Replace with:

```css
    .body {
      display: grid;
      grid-template-columns: 400px 1fr;
      flex: 1;
      overflow: hidden;
    }
```

Find:

```css
    .list-col-head {
      display: grid;
      grid-template-columns: 2rem 1fr 4.5rem;
      gap: 0.25rem;
      padding: 0.45rem 0.75rem;
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .list-col-head .rpi-col { text-align: right; }
```

Replace with:

```css
    .list-col-head {
      display: grid;
      grid-template-columns: 4.5rem 1fr 3rem 3.2rem 3.6rem;
      gap: 0.25rem;
      padding: 0.45rem 0.75rem;
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      background: var(--bg);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      cursor: default;
    }

    .list-col-head span { text-align: right; }
    .list-col-head span:nth-child(2) { text-align: left; }

    .list-col-head span.sortable {
      cursor: pointer;
      user-select: none;
    }

    .list-col-head span.sortable:hover { color: var(--accent); }

    .list-col-head span.sort-active { color: var(--accent); }
```

Find:

```css
    .team-row {
      display: grid;
      grid-template-columns: 2rem 1fr 4.5rem;
      gap: 0.25rem;
      align-items: center;
      padding: 0.55rem 0.75rem;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      transition: background 0.1s;
      user-select: none;
    }
```

Replace with:

```css
    .team-row {
      display: grid;
      grid-template-columns: 4.5rem 1fr 3rem 3.2rem 3.6rem;
      gap: 0.25rem;
      align-items: center;
      padding: 0.55rem 0.75rem;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      transition: background 0.1s;
      user-select: none;
    }
```

- [ ] **Step 2: Add CSS for the rank badge, record inline, and stat columns**

Find the `.rpi-pill` rule:

```css
    .rpi-pill {
      font-size: 0.75rem;
      font-family: var(--mono);
      font-weight: 600;
      color: var(--accent);
      text-align: right;
    }
```

Replace with:

```css
    .rpi-pill {
      font-size: 0.75rem;
      font-family: var(--mono);
      font-weight: 600;
      color: var(--accent);
      text-align: right;
    }

    .rank-badge {
      display: inline-block;
      background: var(--accent);
      color: #fff;
      border-radius: var(--radius-sm);
      font-size: 0.62rem;
      font-weight: 700;
      padding: 0.1em 0.4em;
      margin-right: 0.3em;
      vertical-align: middle;
      flex-shrink: 0;
    }

    .record-inline {
      color: var(--muted);
      font-size: 0.72rem;
      margin-left: 0.25em;
      white-space: nowrap;
    }

    .class-pill {
      display: inline-block;
      background: var(--accent-bg);
      color: var(--accent);
      border-radius: 3px;
      font-size: 0.6rem;
      font-weight: 600;
      padding: 0.05em 0.35em;
      margin-left: 0.25em;
      vertical-align: middle;
    }

    .stat-cell {
      font-size: 0.72rem;
      font-family: var(--mono);
      text-align: right;
      color: var(--text);
    }
```

- [ ] **Step 3: Add sort state variables and `setSort` / helper functions to the script**

In the `<script>` block, find the top where global state is declared:

```javascript
    let OUR_SLUG = null;
    let allData = {};
    let activeFilter = "4A";
```

Add sort state after those three lines:

```javascript
    let OUR_SLUG = null;
    let allData = {};
    let activeFilter = "4A";
    let sortCol = "rpi";
    let sortDir = "desc";
```

Find the two existing format helpers:

```javascript
    function fmt4(n) { return (+n).toFixed(4); }
    function esc(s) {
```

Add `fmt2` and `fmtGd` before `fmt4`:

```javascript
    function fmt2(n) { return (+n).toFixed(2); }
    function fmtGd(n) { const v = +n; return v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2); }
    function fmt4(n) { return (+n).toFixed(4); }
    function esc(s) {
```

Add the `setSort` function immediately after `setFilter`:

```javascript
    function setSort(col) {
      if (sortCol === col) {
        sortDir = sortDir === "desc" ? "asc" : "desc";
      } else {
        sortCol = col;
        sortDir = "desc";
      }
      buildUI(allData);
    }

    function sortArrow(col) {
      if (sortCol !== col) return "";
      return sortDir === "desc" ? " ▾" : " ▴";
    }
```

- [ ] **Step 4: Rewrite `buildUI` to assign RPI ranks, sort by active column, and render the new table**

Find the entire `buildUI` function:

```javascript
    function buildUI(data) {
      allData = data;
      const teams = Object.values(data)
        .filter(t => activeFilter === "all" || t.classification === activeFilter)
        .sort((a, b) => b.rpi - a.rpi);

      document.getElementById("body").innerHTML = `
        <div class="list-panel">
          <div class="list-col-head">
            <span>#</span><span>Team</span><span class="rpi-col">RPI</span>
          </div>
          <div class="list-scroll" id="list-scroll"></div>
        </div>
        <div class="detail-panel" id="detail-panel">
          <div class="detail-empty">Select a team to see details.</div>
        </div>
      `;

      const listEl = document.getElementById("list-scroll");
      teams.forEach((team, i) => {
        const isOurs = team.team === OUR_SLUG;
        const row = document.createElement("div");
        row.className = "team-row" + (isOurs ? " our-team" : "");
        row.dataset.slug = team.team;
        row.innerHTML = `
          <span class="rank">${i + 1}</span>
          <span class="team-name" title="${esc(team.teamName)}">${esc(team.teamName)}</span>
          <span class="rpi-pill">${fmt4(team.rpi)}</span>
        `;
        row.addEventListener("click", () => selectTeam(team, i + 1));
        listEl.appendChild(row);
      });

      const ourTeam = data[OUR_SLUG];
      if (ourTeam) {
        document.getElementById("computed-at").textContent =
          "Updated: " + fmtTime(ourTeam.computedAt);
        const ourRank = teams.findIndex(t => t.team === OUR_SLUG) + 1;
        selectTeam(ourTeam, ourRank);
      } else if (teams.length) {
        selectTeam(teams[0], 1);
      }
    }
```

Replace it with:

```javascript
    function buildUI(data) {
      allData = data;

      // Assign fixed RPI ranks before any filtering/sorting
      const allByRpi = Object.values(data).sort((a, b) => b.rpi - a.rpi);
      allByRpi.forEach((t, i) => { t._rpiRank = i + 1; });

      // Filter then sort by active column
      const teams = allByRpi
        .filter(t => activeFilter === "all" || t.classification === activeFilter);
      teams.sort((a, b) => {
        const val = { rpi: t => t.rpi, gpg: t => t.gpg, gapg: t => t.gapg, gd: t => t.gd };
        const fn = val[sortCol] ?? val.rpi;
        return sortDir === "desc" ? fn(b) - fn(a) : fn(a) - fn(b);
      });

      document.getElementById("body").innerHTML = `
        <div class="list-panel">
          <div class="list-col-head">
            <span class="sortable${sortCol === "rpi" ? " sort-active" : ""}"
                  onclick="setSort('rpi')">RPI${sortArrow("rpi")}</span>
            <span>Team</span>
            <span class="sortable${sortCol === "gpg" ? " sort-active" : ""}"
                  onclick="setSort('gpg')">GPG${sortArrow("gpg")}</span>
            <span class="sortable${sortCol === "gapg" ? " sort-active" : ""}"
                  onclick="setSort('gapg')">GAPG${sortArrow("gapg")}</span>
            <span class="sortable${sortCol === "gd" ? " sort-active" : ""}"
                  onclick="setSort('gd')">GD/G${sortArrow("gd")}</span>
          </div>
          <div class="list-scroll" id="list-scroll"></div>
        </div>
        <div class="detail-panel" id="detail-panel">
          <div class="detail-empty">Select a team to see details.</div>
        </div>
      `;

      const listEl = document.getElementById("list-scroll");
      teams.forEach((team) => {
        const isOurs = team.team === OUR_SLUG;
        const row = document.createElement("div");
        row.className = "team-row" + (isOurs ? " our-team" : "");
        row.dataset.slug = team.team;
        row.innerHTML = `
          <span class="rpi-pill">${fmt4(team.rpi)}</span>
          <span class="team-name" title="${esc(team.teamName)}">
            <span class="rank-badge">#${team._rpiRank}</span>${esc(team.teamName)}<span class="record-inline">(${esc(team.record)})</span><span class="class-pill">${esc(team.classification)}</span>
          </span>
          <span class="stat-cell">${fmt2(team.gpg)}</span>
          <span class="stat-cell">${fmt2(team.gapg)}</span>
          <span class="stat-cell">${fmtGd(team.gd)}</span>
        `;
        row.addEventListener("click", () => selectTeam(team));
        listEl.appendChild(row);
      });

      const ourTeam = data[OUR_SLUG];
      if (ourTeam) {
        document.getElementById("computed-at").textContent =
          "Updated: " + fmtTime(ourTeam.computedAt);
        selectTeam(ourTeam);
      } else if (teams.length) {
        selectTeam(teams[0]);
      }
    }
```

- [ ] **Step 5: Update `selectTeam` to drop the `rank` parameter**

Find:

```javascript
    function selectTeam(team, rank) {
      currentSlug = team.team;
      document.querySelectorAll(".team-row").forEach(r => {
        r.classList.toggle("active", r.dataset.slug === currentSlug);
      });
      const activeRow = document.querySelector(".team-row.active");
      if (activeRow) activeRow.scrollIntoView({ block: "nearest" });
      renderDetail(team, rank);
    }
```

Replace with:

```javascript
    function selectTeam(team) {
      currentSlug = team.team;
      document.querySelectorAll(".team-row").forEach(r => {
        r.classList.toggle("active", r.dataset.slug === currentSlug);
      });
      const activeRow = document.querySelector(".team-row.active");
      if (activeRow) activeRow.scrollIntoView({ block: "nearest" });
      renderDetail(team);
    }
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: add sortable GPG/GAPG/GD columns to rankings table"
```

---

## Task 5: Update the team detail panel

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Add CSS for scoring cells**

In the CSS block, find the `.formula` rule:

```css
    /* Formula */
    .formula {
      padding: 0.6rem 1.25rem;
      font-size: 0.7rem;
      color: var(--muted);
      font-family: var(--mono);
      border-top: 1px solid var(--border);
    }
```

Add scoring cell CSS directly before it:

```css
    /* Scoring cells */
    .scoring-cell {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
    }

    .scoring-cell .cc-val { color: #15803d; }

    /* Formula */
    .formula {
      padding: 0.6rem 1.25rem;
      font-size: 0.7rem;
      color: var(--muted);
      font-family: var(--mono);
      border-top: 1px solid var(--border);
    }
```

- [ ] **Step 2: Rewrite `renderDetail` — add Scoring section, remove formula footer, use `team._rpiRank`**

Find the entire `renderDetail` function:

```javascript
    function renderDetail(team, rank) {
      const isOurs = team.team === OUR_SLUG;
      document.getElementById("detail-panel").innerHTML = `
        <div class="detail-card">
          <div class="card-head">
            <div class="title">${esc(team.teamName)}</div>
            <div class="meta-row">
              <span class="badge badge-class">${esc(team.classification)}</span>
              <span class="record">${esc(team.record)}</span>
              <span class="badge badge-rank">Rank #${rank}</span>
              ${isOurs ? '<span class="badge badge-ours">Our Team</span>' : ""}
              <a class="maxpreps-link" href="${esc(maxPrepsUrl(team.team))}"
                 target="_blank" rel="noopener">MaxPreps &rarr;</a>
            </div>
          </div>

          <div class="rpi-hero">
            <span class="rpi-big">${fmt4(team.rpi)}</span>
            <span class="rpi-label">RPI</span>
          </div>

          <div class="section">
            <div class="section-title">Component Breakdown</div>
            <div class="component-grid">
              <div class="component-cell">
                <div class="cc-label">MWP</div>
                <div class="cc-val">${fmt4(team.mwp)}</div>
                <div class="cc-weight">45% weight</div>
              </div>
              <div class="component-cell">
                <div class="cc-label">OWP</div>
                <div class="cc-val">${fmt4(team.owp)}</div>
                <div class="cc-weight">45% weight</div>
              </div>
              <div class="component-cell">
                <div class="cc-label">OOWP</div>
                <div class="cc-val">${fmt4(team.oowp)}</div>
                <div class="cc-weight">10% weight</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Schedule Depth</div>
            <div class="stat-row">
              <span class="stat-label">Games counted</span>
              <span class="stat-val">${team.gamesCounted}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Opponents counted</span>
              <span class="stat-val">${team.opponentsCounted}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Opp-of-opp counted</span>
              <span class="stat-val">${team.oppOppCounted}</span>
            </div>
          </div>

          <div class="formula">${esc(team.formula)}</div>
        </div>
      `;
    }
```

Replace with:

```javascript
    function renderDetail(team) {
      const isOurs = team.team === OUR_SLUG;
      document.getElementById("detail-panel").innerHTML = `
        <div class="detail-card">
          <div class="card-head">
            <div class="title">${esc(team.teamName)}</div>
            <div class="meta-row">
              <span class="badge badge-class">${esc(team.classification)}</span>
              <span class="record">${esc(team.record)}</span>
              <span class="badge badge-rank">Rank #${team._rpiRank ?? "—"}</span>
              ${isOurs ? '<span class="badge badge-ours">Our Team</span>' : ""}
              <a class="maxpreps-link" href="${esc(maxPrepsUrl(team.team))}"
                 target="_blank" rel="noopener">MaxPreps &rarr;</a>
            </div>
          </div>

          <div class="rpi-hero">
            <span class="rpi-big">${fmt4(team.rpi)}</span>
            <span class="rpi-label">RPI</span>
          </div>

          <div class="section">
            <div class="section-title">Component Breakdown</div>
            <div class="component-grid">
              <div class="component-cell">
                <div class="cc-label">MWP</div>
                <div class="cc-val">${fmt4(team.mwp)}</div>
                <div class="cc-weight">45% weight</div>
              </div>
              <div class="component-cell">
                <div class="cc-label">OWP</div>
                <div class="cc-val">${fmt4(team.owp)}</div>
                <div class="cc-weight">45% weight</div>
              </div>
              <div class="component-cell">
                <div class="cc-label">OOWP</div>
                <div class="cc-val">${fmt4(team.oowp)}</div>
                <div class="cc-weight">10% weight</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Scoring</div>
            <div class="component-grid">
              <div class="component-cell scoring-cell">
                <div class="cc-label">GPG</div>
                <div class="cc-val">${fmt2(team.gpg)}</div>
                <div class="cc-weight">goals/game</div>
              </div>
              <div class="component-cell scoring-cell">
                <div class="cc-label">GAPG</div>
                <div class="cc-val">${fmt2(team.gapg)}</div>
                <div class="cc-weight">allowed/game</div>
              </div>
              <div class="component-cell scoring-cell">
                <div class="cc-label">GD/G</div>
                <div class="cc-val">${fmtGd(team.gd)}</div>
                <div class="cc-weight">differential</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Schedule Depth</div>
            <div class="stat-row">
              <span class="stat-label">Games counted</span>
              <span class="stat-val">${team.gamesCounted}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Opponents counted</span>
              <span class="stat-val">${team.opponentsCounted}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Opp-of-opp counted</span>
              <span class="stat-val">${team.oppOppCounted}</span>
            </div>
          </div>
        </div>
      `;
    }
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add Scoring section to detail panel, remove formula footer"
```

---

## Self-Review Checklist

- [x] `Game.goalsScored` / `goalsAllowed` added (Task 1) and populated from `ourTeam[6]` / `oppTeam[6]` (Task 2)
- [x] `RpiResult.gpg` / `gapg` / `gd` added (Task 1) and computed from raw totals (Task 3)
- [x] Table: 5 sortable columns — RPI, Team, GPG, GAPG, GD/G (Task 4)
- [x] Rank badge `#N` inside team cell, based on RPI order, fixed regardless of active sort (Task 4)
- [x] W-L record in parens after team name, class pill after record (Task 4)
- [x] 4A/All filter toggle unaffected (Task 4 — `setFilter` unchanged)
- [x] Detail panel: Scoring section between Component Breakdown and Schedule Depth (Task 5)
- [x] Detail panel: formula footer removed (Task 5)
- [x] `renderDetail` no longer takes a `rank` parameter — uses `team._rpiRank` (Tasks 4 & 5)
- [x] `fmt2` and `fmtGd` helpers added before use (Task 4 Step 3)
- [x] All type names consistent (`goalsScored`/`goalsAllowed` throughout, `gpg`/`gapg`/`gd` throughout)
