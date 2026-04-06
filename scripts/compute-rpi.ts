import { getBuildId, getSchedule, fetchBatch } from "../src/maxpreps";
import { calculateRpi } from "../src/rpi";
import type { KVPayload, RpiResult, TeamSchedule } from "../src/types";

const {
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  KV_NAMESPACE_ID,
  TEAM_SLUG,
  TEAM_CLASS,
  SEASON,
} = process.env;

if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !KV_NAMESPACE_ID || !TEAM_SLUG || !TEAM_CLASS || !SEASON) {
  console.error("Missing required environment variables");
  process.exit(1);
}

const KV_BASE = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}`;
const KV_HEADERS = {
  Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
};

async function kvGet(key: string): Promise<unknown> {
  const res = await fetch(`${KV_BASE}/values/${key}`, { headers: KV_HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV GET failed: ${res.status}`);
  return res.json();
}

async function kvPut(key: string, value: unknown): Promise<void> {
  const body = new FormData();
  body.append("value", JSON.stringify(value));
  body.append("metadata", "{}");
  const res = await fetch(`${KV_BASE}/values/${key}`, {
    method: "PUT",
    headers: KV_HEADERS,
    body,
  });
  if (!res.ok) throw new Error(`KV PUT failed: ${res.status}`);
}

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

async function main() {
  const myClass = parseInt(TEAM_CLASS!, 10);

  console.log(`Running RPI computation for ${TEAM_SLUG} (${myClass}A)`);

  const buildId = await getBuildId();
  console.log(`Build ID: ${buildId}`);

  const existing = await kvGet("payload") as KVPayload | null;
  const scheduleCache: Record<string, TeamSchedule> = existing?.scheduleCache ?? {};

  const mySchedule = await getSchedule(TEAM_SLUG!, buildId, SEASON!);
  scheduleCache[TEAM_SLUG!] = { ...mySchedule, fetchedAt: new Date().toISOString() };
  console.log(`Our schedule: ${mySchedule.games.length} completed games`);

  const oppSlugs = mySchedule.allOpponentSlugs;
  const staleL2 = oppSlugs.filter((s) => isStale(scheduleCache[s], 12));
  console.log(`Fetching ${staleL2.length} of ${oppSlugs.length} opponent schedules (Level 2, played + unplayed)`);
  const freshL2 = await fetchBatch(staleL2, buildId, SEASON!);
  Object.assign(scheduleCache, freshL2);

  const oopSlugs = getOppOppSlugs(mySchedule.games, scheduleCache, TEAM_SLUG!);
  const staleL3 = oopSlugs.filter((s) => isStale(scheduleCache[s], 48));
  console.log(`Fetching ${staleL3.length} of ${oopSlugs.length} opp-of-opp schedules (Level 3)`);
  const freshL3 = await fetchBatch(staleL3, buildId, SEASON!);
  Object.assign(scheduleCache, freshL3);

  const results: Record<string, RpiResult> = {};

  // Our team
  const myResult = calculateRpi(TEAM_SLUG!, myClass, scheduleCache);
  results[TEAM_SLUG!] = myResult;
  console.log(`RPI ${TEAM_SLUG}: ${myResult.rpi} (MWP=${myResult.mwp}, OWP=${myResult.owp}, OOWP=${myResult.oowp})`);

  // All opponents
  for (const oppSlug of oppSlugs) {
    const opp = scheduleCache[oppSlug];
    if (!opp) continue;
    try {
      const oppResult = calculateRpi(oppSlug, opp.classification, scheduleCache);
      results[oppSlug] = oppResult;
      console.log(`RPI ${oppSlug}: ${oppResult.rpi}`);
    } catch (e) {
      console.warn(`Could not calculate RPI for ${oppSlug}: ${e}`);
    }
  }

  console.log(`Computed RPI for ${Object.keys(results).length} teams`);

  const payload: KVPayload = { results, scheduleCache };
  await kvPut("payload", payload);
  console.log("Saved to KV");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
