import { getBuildId, getSchedule, fetchBatch } from "./maxpreps";
import { calculateRpi } from "./rpi";
import type { Env, KVPayload, TeamSchedule } from "./types";

function isStale(schedule: TeamSchedule | undefined, maxAgeHours: number): boolean {
  if (!schedule) return true;
  const age = Date.now() - new Date(schedule.fetchedAt).getTime();
  return age > maxAgeHours * 60 * 60 * 1000;
}

function getOppOppSlugs(
  myGames: { opponentSlug: string }[],
  cache: Record<string, TeamSchedule>,
  mySlug: string
): string[] {
  const oppSlugs = new Set(myGames.map((g) => g.opponentSlug));
  const result = new Set<string>();
  for (const oppSlug of oppSlugs) {
    const opp = cache[oppSlug];
    if (!opp) continue;
    for (const g of opp.games) {
      if (g.opponentSlug !== mySlug && !oppSlugs.has(g.opponentSlug)) {
        result.add(g.opponentSlug);
      }
    }
  }
  return [...result];
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const mySlug = env.TEAM_SLUG;
    const myClass = parseInt(env.TEAM_CLASS, 10);
    const season = env.SEASON;

    console.log(`Running RPI computation for ${mySlug} (${myClass}A)`);

    // Load existing cache
    const existing = await env.MAXPREPS_RPI.get("payload", "json") as KVPayload | null;
    const scheduleCache: Record<string, TeamSchedule> = existing?.scheduleCache ?? {};

    // Get current build ID
    const buildId = await getBuildId();
    console.log(`Build ID: ${buildId}`);

    // Always re-fetch our team's schedule
    const mySchedule = await getSchedule(mySlug, buildId, season);
    scheduleCache[mySlug] = { ...mySchedule, fetchedAt: new Date().toISOString() };
    console.log(`Our schedule: ${mySchedule.games.length} completed games`);

    // Level 2 — fetch stale opponent schedules
    const oppSlugs = [...new Set(mySchedule.games.map((g) => g.opponentSlug))];
    const staleL2 = oppSlugs.filter((s) => isStale(scheduleCache[s], 12));
    console.log(`Fetching ${staleL2.length} of ${oppSlugs.length} opponent schedules (Level 2)`);
    const freshL2 = await fetchBatch(staleL2, buildId, season);
    Object.assign(scheduleCache, freshL2);

    // Level 3 — fetch stale opp-of-opp schedules
    const oopSlugs = getOppOppSlugs(mySchedule.games, scheduleCache, mySlug);
    const staleL3 = oopSlugs.filter((s) => isStale(scheduleCache[s], 48));
    console.log(`Fetching ${staleL3.length} of ${oopSlugs.length} opp-of-opp schedules (Level 3)`);
    const freshL3 = await fetchBatch(staleL3, buildId, season);
    Object.assign(scheduleCache, freshL3);

    // Compute RPI
    const result = calculateRpi(mySlug, myClass, scheduleCache);
    console.log(`RPI: ${result.rpi} (MWP=${result.mwp}, OWP=${result.owp}, OOWP=${result.oowp})`);

    // Save to KV
    const payload: KVPayload = { result, scheduleCache };
    await env.MAXPREPS_RPI.put("payload", JSON.stringify(payload));
    console.log("Saved to KV");
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/rpi") {
      const payload = await env.MAXPREPS_RPI.get("payload", "json") as KVPayload | null;
      if (!payload) {
        return new Response("RPI not yet computed", { status: 503 });
      }
      return Response.json(payload.result, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // Trigger manual cron run (dev/testing only — remove or gate in production)
    if (url.pathname === "/__scheduled") {
      await this.scheduled({} as ScheduledEvent, env, {} as ExecutionContext);
      return new Response("Done", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};
