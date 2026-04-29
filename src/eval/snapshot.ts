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
