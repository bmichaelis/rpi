import type { Game, RpiResult, TeamSchedule } from "./types";

function slugToName(slug: string): string {
  const last = slug.split("/").pop() ?? slug;
  return last.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const GAME_VALUE: Record<number | "oos", number> = {
  2: 1.0,
  3: 1.0,
  4: 1.25,
  5: 1.25,
  6: 1.25,
  oos: 1.25,
};
const LOWER_CLASS_VALUES = new Set([2, 3]);
const CROSS_CLASS_EXEMPTIONS = 3;

export function calcMwp(
  games: Game[],
  myClassification: number | "oos",
  oppClassifications: Record<string, number | "oos">,
  excludeSlug?: string
): number {
  const myGv = GAME_VALUE[myClassification] ?? 1.25;
  let exemptionsUsed = 0;
  let totalWinValue = 0;
  let totalGameValue = 0;

  for (const g of games) {
    if (excludeSlug && g.opponentSlug === excludeSlug) continue;

    const oppClass = oppClassifications[g.opponentSlug] ?? "oos";
    const trueOppGv = GAME_VALUE[oppClass] ?? 1.25;

    const isHigherVsLower =
      g.won === true &&
      typeof myClassification === "number" &&
      typeof oppClass === "number" &&
      LOWER_CLASS_VALUES.has(oppClass) &&
      !LOWER_CLASS_VALUES.has(myClassification);

    let effectiveOppGv: number;
    if (isHigherVsLower && exemptionsUsed < CROSS_CLASS_EXEMPTIONS) {
      effectiveOppGv = myGv;
      exemptionsUsed++;
    } else {
      effectiveOppGv = trueOppGv;
    }

    const gameValue = (myGv + effectiveOppGv) / 2;
    const winValue =
      g.won === true ? gameValue : g.won === null ? gameValue * 0.5 : 0;

    totalWinValue += winValue;
    totalGameValue += gameValue;
  }

  return totalGameValue > 0 ? totalWinValue / totalGameValue : 0;
}

export function calculateRpi(
  mySlug: string,
  myClassification: number | "oos",
  allSchedules: Record<string, TeamSchedule>
): RpiResult {
  const mySchedule = allSchedules[mySlug];
  if (!mySchedule) throw new Error(`No schedule found for ${mySlug}`);
  const l1Games = mySchedule.games;

  const wins = l1Games.filter((g) => g.won === true).length;
  const losses = l1Games.filter((g) => g.won === false).length;
  const ties = l1Games.filter((g) => g.won === null).length;
  const record = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;

  // Build classification lookup
  const classifications: Record<string, number | "oos"> = {
    [mySlug]: myClassification,
  };
  for (const [slug, sched] of Object.entries(allSchedules)) {
    classifications[slug] = sched.classification;
  }

  // MWP
  const mwp = calcMwp(l1Games, myClassification, classifications);

  // OWP — each opponent's MWP excluding H2H games vs us
  const uniqueOppSlugs = [...new Set(l1Games.map((g) => g.opponentSlug))];
  const oppMwps: number[] = [];
  for (const slug of uniqueOppSlugs) {
    const opp = allSchedules[slug];
    if (!opp) continue;
    const oppCls = opp.classification;
    const effCls = typeof oppCls === "number" ? oppCls : myClassification;
    oppMwps.push(calcMwp(opp.games, effCls, classifications, mySlug));
  }
  const owp = oppMwps.length > 0 ? oppMwps.reduce((a, b) => a + b, 0) / oppMwps.length : 0;

  // OOWP — for each opponent, average their opponents' MWP (excluding H2H vs the common opp)
  const oowpPerOpp: number[] = [];
  for (const oppSlug of uniqueOppSlugs) {
    const opp = allSchedules[oppSlug];
    if (!opp) continue;
    const ooSlugs = [
      ...new Set(opp.games.map((g) => g.opponentSlug).filter((s) => s !== mySlug)),
    ];
    const ooMwps: number[] = [];
    for (const ooSlug of ooSlugs) {
      const oo = allSchedules[ooSlug];
      if (!oo) continue;
      const ooCls = oo.classification;
      const effCls = typeof ooCls === "number" ? ooCls : myClassification;
      ooMwps.push(calcMwp(oo.games, effCls, classifications, oppSlug));
    }
    if (ooMwps.length > 0) {
      oowpPerOpp.push(ooMwps.reduce((a, b) => a + b, 0) / ooMwps.length);
    }
  }
  const oowp =
    oowpPerOpp.length > 0 ? oowpPerOpp.reduce((a, b) => a + b, 0) / oowpPerOpp.length : 0;

  const rpi = Math.round((0.45 * mwp + 0.45 * owp + 0.1 * oowp) * 10000) / 10000;

  // Scoring stats — from played games only (goalsScored !== null)
  const scoredGames = l1Games.filter(g => g.goalsScored !== null);
  const n = scoredGames.length;
  const totalGF = scoredGames.reduce((sum, g) => sum + (g.goalsScored ?? 0), 0);
  const totalGA = scoredGames.reduce((sum, g) => sum + (g.goalsAllowed ?? 0), 0);
  const gpg  = n > 0 ? Math.round((totalGF / n) * 100) / 100 : 0;
  const gapg = n > 0 ? Math.round((totalGA / n) * 100) / 100 : 0;
  const gd   = n > 0 ? Math.round(((totalGF - totalGA) / n) * 100) / 100 : 0;

  // Count unique opp-of-opp teams
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

  return {
    team: mySlug,
    teamName: mySchedule.teamName || slugToName(mySlug),
    classification: myClassification === "oos" ? "OOS" : `${myClassification}A`,
    record,
    gamesCounted: l1Games.length,
    opponentsCounted: uniqueOppSlugs.length,
    oppOppCounted: oppOppSlugs.size,
    mwp: Math.round(mwp * 10000) / 10000,
    owp: Math.round(owp * 10000) / 10000,
    oowp: Math.round(oowp * 10000) / 10000,
    rpi,
    gpg,
    gapg,
    gd,
    computedAt: new Date().toISOString(),
    formula: "RPI = 0.45(MWP) + 0.45(OWP) + 0.10(OOWP)",
  };
}
