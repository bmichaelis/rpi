import { getBuildId, getClassTeams, getSchedule, fetchBatch } from "../src/maxpreps";
import { calculateRpi, calculateAllMaxPrepsRatings } from "../src/rpi";
import type { KVPayload, RpiResult, TeamSchedule } from "../src/types";
import { writeFileSync, readFileSync, existsSync } from "fs";

const {
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  KV_NAMESPACE_ID,
  TEAM_SLUG,
  TEAM_CLASS,
  SEASON,
} = process.env;

const isVerifyMode = process.env.VERIFY === "true";
const needsKv = !isVerifyMode || process.env.FORCE_REFRESH !== "true";

if (!TEAM_SLUG || !TEAM_CLASS || !SEASON) {
  console.error("Missing required environment variables: TEAM_SLUG, TEAM_CLASS, SEASON");
  process.exit(1);
}
if (needsKv && (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !KV_NAMESPACE_ID)) {
  console.error("Missing Cloudflare KV credentials (not needed when VERIFY=true FORCE_REFRESH=true)");
  process.exit(1);
}

// Stable MaxPreps division IDs for Utah Boys Soccer classes
const CLASS_CONFIGS = [
  { cls: 4, divisionId: "c534b3e8-c200-4b4b-9aa6-f5aa1e5352bc" },
  { cls: 5, divisionId: "feaf72b1-8c0d-4a89-b835-a75c292d2347" },
  { cls: 6, divisionId: "0f72a3d1-ec2e-46f5-8a1a-6f4b6df56ca7" },
];

const KV_BASE = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}`;
const KV_HEADERS = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };

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
  const res = await fetch(`${KV_BASE}/values/${key}`, { method: "PUT", headers: KV_HEADERS, body });
  if (!res.ok) throw new Error(`KV PUT failed: ${res.status}`);
}

function isStale(schedule: TeamSchedule | undefined, maxAgeHours: number): boolean {
  if (!schedule) return true;
  const age = Date.now() - new Date(schedule.fetchedAt).getTime();
  return age > maxAgeHours * 60 * 60 * 1000;
}

async function main() {
  const myClass = parseInt(TEAM_CLASS!, 10);
  console.log(`Running RPI computation for ${TEAM_SLUG} (${myClass}A), classes: 4A/5A/6A`);

  const buildId = await getBuildId();
  console.log(`Build ID: ${buildId}`);

  const forceRefresh = process.env.FORCE_REFRESH === "true";
  const existing = forceRefresh ? null : await kvGet("payload") as KVPayload | null;
  if (forceRefresh) console.log("FORCE_REFRESH: ignoring schedule cache");
  const scheduleCache: Record<string, TeamSchedule> = existing?.scheduleCache ?? {};

  // Our team — always freshly fetched
  const mySchedule = await getSchedule(TEAM_SLUG!, buildId, SEASON!);
  const { allOpponentSlugs: myOppSlugs, ...myScheduleData } = mySchedule;
  scheduleCache[TEAM_SLUG!] = { ...myScheduleData, fetchedAt: new Date().toISOString() };
  console.log(`Our schedule: ${mySchedule.games.length} completed games`);

  // Fetch all class teams (4A + 5A + 6A)
  // SLUG_LIST_FILE overrides rankings pages (useful when historical rankings 404)
  const classTeamMap = new Map<string, string>(); // slug → teamName
  const officialRatings: Record<string, number> = {};
  const slugListFile = process.env.SLUG_LIST_FILE;
  if (slugListFile) {
    const slugs: string[] = JSON.parse(readFileSync(slugListFile, "utf8"));
    for (const slug of slugs) classTeamMap.set(slug, "");
    console.log(`Loaded ${slugs.length} team slugs from ${slugListFile}`);
  } else {
    for (const { cls, divisionId } of CLASS_CONFIGS) {
      const rankingsSlug = `ut/soccer/${SEASON}/class/class-${cls}a/rankings`;
      const teams = await getClassTeams(rankingsSlug, divisionId, buildId);
      for (const { slug, teamName, mpOfficialRating } of teams) {
        classTeamMap.set(slug, teamName);
        if (mpOfficialRating !== undefined) officialRatings[slug] = mpOfficialRating;
      }
      console.log(`Found ${teams.length} ${cls}A teams`);
    }
  }

  // Backfill teamName into cached schedules missing it
  for (const [slug, teamName] of classTeamMap) {
    if (scheduleCache[slug] && !scheduleCache[slug].teamName) {
      scheduleCache[slug] = { ...scheduleCache[slug], teamName };
    }
  }

  // All targets: class teams + our team's direct opponents, excluding our slug
  const allTargetSlugs = [...new Set([...myOppSlugs, ...classTeamMap.keys()])].filter(
    (s) => s !== TEAM_SLUG
  );

  const staleL2 = allTargetSlugs.filter(
    (s) => isStale(scheduleCache[s], 12) || !scheduleCache[s]?.upcoming
  );
  console.log(`Fetching ${staleL2.length} of ${allTargetSlugs.length} target schedules`);
  const freshL2 = await fetchBatch(staleL2, buildId, SEASON!);
  Object.assign(scheduleCache, freshL2);

  // Opp-of-opp: opponents of any target team not already in the target set
  const targetSlugSet = new Set([...allTargetSlugs, TEAM_SLUG!]);
  const oopSet = new Set<string>();
  for (const slug of allTargetSlugs) {
    const sched = scheduleCache[slug];
    if (!sched) continue;
    for (const g of sched.games) {
      if (!targetSlugSet.has(g.opponentSlug)) oopSet.add(g.opponentSlug);
    }
  }
  const oopSlugs = [...oopSet];

  const staleL3 = oopSlugs.filter(
    (s) => isStale(scheduleCache[s], 48) || !scheduleCache[s]?.upcoming
  );
  console.log(`Fetching ${staleL3.length} of ${oopSlugs.length} opp-of-opp schedules`);
  const freshL3 = await fetchBatch(staleL3, buildId, SEASON!);
  Object.assign(scheduleCache, freshL3);

  // Compute MaxPreps-style ratings for all teams in the schedule cache
  const mpRatings = calculateAllMaxPrepsRatings(scheduleCache);
  console.log(`Computed MaxPreps ratings for ${Object.keys(mpRatings).length} teams`);

  const results: Record<string, RpiResult> = {};

  // Our team
  const myResult = calculateRpi(TEAM_SLUG!, myClass, scheduleCache);
  myResult.mpRating = Math.round((mpRatings[TEAM_SLUG!] ?? 0) * 100) / 100;
  if (officialRatings[TEAM_SLUG!] !== undefined) myResult.mpOfficialRating = officialRatings[TEAM_SLUG!];
  results[TEAM_SLUG!] = myResult;
  console.log(`RPI ${TEAM_SLUG}: ${myResult.rpi} | Rating: ${myResult.mpRating}`);

  // All target teams
  for (const slug of allTargetSlugs) {
    const team = scheduleCache[slug];
    if (!team) continue;
    try {
      const r = calculateRpi(slug, team.classification, scheduleCache);
      r.mpRating = Math.round((mpRatings[slug] ?? 0) * 100) / 100;
      if (officialRatings[slug] !== undefined) r.mpOfficialRating = officialRatings[slug];
      results[slug] = r;
    } catch (e) {
      console.warn(`Could not calculate RPI for ${slug}: ${e}`);
    }
  }

  console.log(`Computed RPI for ${Object.keys(results).length} teams`);

  // VERIFY mode: write to file and diff against UHSAA, skip KV write
  if (process.env.VERIFY === "true") {
    writeFileSync("verify-results.json", JSON.stringify(results, null, 2));
    console.log("\nWrote verify-results.json");

    const uhsaaYear = process.env.VERIFY_YEAR ?? "2025";
    const uhsaaPath = `public/historical/${uhsaaYear}.json`;
    if (!existsSync(uhsaaPath)) {
      console.log(`No UHSAA data at ${uhsaaPath} — run fetch-historical.ts first`);
      return;
    }
    const uhsaa = JSON.parse(readFileSync(uhsaaPath, "utf8"));
    const uhsaaByName: Record<string, Record<string, unknown>> = {};
    for (const [cls, entries] of Object.entries(uhsaa.classes) as [string, any[]][]) {
      for (const e of entries) uhsaaByName[e.school.toLowerCase()] = { ...e, _class: cls };
    }

    console.log("\n─── UHSAA vs Our Calculation ───────────────────────────────────────");
    console.log(
      "School".padEnd(22) +
      "Cls".padEnd(5) +
      ["UHSAA WP","Our MWP","UHSAA OWP","Our OWP","UHSAA OOWP","Our OOWP","UHSAA RPI","Our RPI"]
        .map(h => h.padStart(10)).join("")
    );
    console.log("─".repeat(22 + 5 + 80));

    for (const result of Object.values(results).sort((a: any, b: any) => b.rpi - a.rpi)) {
      const r = result as RpiResult;
      const nameKey = r.teamName.toLowerCase();
      const u = uhsaaByName[nameKey];
      if (!u) continue;
      const fmt = (n: number) => (typeof n === "number" ? n.toFixed(6) : "      —").padStart(10);
      console.log(
        r.teamName.padEnd(22) +
        r.classification.padEnd(5) +
        fmt(u.wp as number) + fmt(r.mwp) +
        fmt(u.owp as number) + fmt(r.owp) +
        fmt(u.oowp as number) + fmt(r.oowp) +
        fmt(u.rpi as number) + fmt(r.rpi)
      );
    }
    return;
  }

  const payload: KVPayload = { results, scheduleCache };
  await kvPut("payload", payload);
  console.log("Saved to KV");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
