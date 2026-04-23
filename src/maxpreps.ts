import { parse } from "node-html-parser";
import type { Game, TeamSchedule } from "./types";

const BASE_URL = "https://www.maxpreps.com";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "x-nextjs-data": "1",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

// Positions in each team entry within a contest tuple
const C_DELETED =  9; // true when this game is cancelled/deleted
const C_URL    = 13; // team schedule URL
const C_NAME   = 14; // school short name
const C_RESULT =  5; // "W", "L", "T", or null/missing for unplayed
const C_SCORE  =  6; // goals scored by this team, null for unplayed

function urlToSlug(fullUrl: string): string {
  const path = fullUrl.replace(BASE_URL + "/", "").replace(/^\/|\/$/g, "");
  const parts = path.split("/");
  return parts.length >= 3 ? parts.slice(0, 3).join("/") : path;
}

function getClassification(pageProps: Record<string, unknown>): number | "oos" {
  try {
    const division = (
      pageProps?.teamContext as Record<string, unknown>
    )?.data as Record<string, unknown>;
    const name = (division?.stateDivisionName as string) ?? "";
    const m = name.match(/(\d)A/);
    if (m) return parseInt(m[1], 10);
  } catch {
    // fall through
  }
  return "oos";
}

export async function getBuildId(): Promise<string> {
  const res = await fetch(BASE_URL, { headers: { ...HEADERS, Accept: "text/html" } });
  if (!res.ok) throw new Error(`MaxPreps homepage returned ${res.status}`);
  const html = await res.text();
  const root = parse(html);
  const tag = root.querySelector("script#__NEXT_DATA__");
  if (!tag) throw new Error("Could not find __NEXT_DATA__ on MaxPreps homepage");
  const data = JSON.parse(tag.text);
  return data.buildId.trim();
}

export async function getClassTeams(
  rankingsSlug: string,
  stateDivisionId: string,
  buildId: string
): Promise<Array<{ slug: string; teamName: string }>> {
  const seen = new Map<string, string>(); // slug → teamName
  let page = 1;

  while (true) {
    const url = `${BASE_URL}/_next/data/${buildId}/${rankingsSlug}/${page}.json?statedivisionid=${stateDivisionId}`;
    let pageProps: Record<string, unknown>;
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as Record<string, unknown>;
      pageProps = (data.pageProps as Record<string, unknown>) ?? {};
    } catch (e) {
      console.warn(`Could not fetch rankings page ${page}: ${e}`);
      break;
    }

    const listData = pageProps.rankingsListData as Record<string, unknown> | undefined;
    const teams = (listData?.rankings ?? []) as unknown[];
    const totalCount = (listData?.totalCount as number) ?? 0;

    for (const t of teams) {
      const team = t as Record<string, unknown>;
      const teamUrl = team.teamLink as string | undefined;
      const name = (team.schoolName as string) ?? "";
      if (teamUrl) seen.set(urlToSlug(teamUrl), name);
    }

    if (teams.length === 0 || seen.size >= totalCount) break;
    page++;
  }

  console.log(`Found ${seen.size} teams in class rankings`);
  return [...seen.entries()].map(([slug, teamName]) => ({ slug, teamName }));
}

export async function getSchedule(
  teamSlug: string,
  buildId: string,
  season: string
): Promise<{ games: Game[]; upcoming: { opponentSlug: string; opponentName: string }[]; allOpponentSlugs: string[]; teamName: string; classification: number | "oos" }> {
  const url = `${BASE_URL}/_next/data/${buildId}/${teamSlug}/soccer/${season}/schedule.json`;
  let pageProps: Record<string, unknown>;
  try {
    const res = await fetch(url, { headers: HEADERS });
    console.log(`Schedule fetch ${teamSlug}: HTTP ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    pageProps = (data.pageProps as Record<string, unknown>) ?? {};
  } catch (e) {
    console.warn(`Could not fetch schedule for ${teamSlug}: ${e}`);
    return { games: [], upcoming: [], allOpponentSlugs: [], teamName: "", classification: "oos" };
  }

  const classification = getClassification(pageProps);
  // contests[week][game] = [team1_entry, team2_entry]
  // each team entry is a positional array
  const contests = (pageProps.contests as unknown[][][]) ?? [];

  const games: Game[] = [];
  const upcoming: { opponentSlug: string; opponentName: string }[] = [];
  const allOpponentSlugs = new Set<string>();
  let teamName = "";

  for (const week of contests) {
    for (const game of week) {
      if (!game) continue;
      const team1 = game[0] as unknown[];
      const team2 = game[1] as unknown[];
      if (!team1 || !team2) continue;
      if (team1[C_DELETED] || team2[C_DELETED]) continue;

      const slug1 = urlToSlug((team1[C_URL] as string) ?? "");
      const slug2 = urlToSlug((team2[C_URL] as string) ?? "");

      let ourTeam: unknown[];
      let oppTeam: unknown[];
      if (slug1 === teamSlug) {
        ourTeam = team1;
        oppTeam = team2;
      } else if (slug2 === teamSlug) {
        ourTeam = team2;
        oppTeam = team1;
      } else {
        continue;
      }

      if (!teamName) teamName = (ourTeam[C_NAME] as string) ?? "";

      const opponentSlug = urlToSlug((oppTeam[C_URL] as string) ?? "");
      const opponentName = (oppTeam[C_NAME] as string) ?? "";
      if (opponentSlug) allOpponentSlugs.add(opponentSlug);

      const result = ourTeam[C_RESULT] as string | null | undefined;
      if (!result) {
        if (opponentSlug) upcoming.push({ opponentSlug, opponentName });
        continue;
      }

      let won: boolean | null;
      if (result === "W") won = true;
      else if (result === "L") won = false;
      else if (result === "T") won = null;
      else continue; // unrecognised

      const goalsScored = typeof ourTeam[C_SCORE] === "number"
        ? (ourTeam[C_SCORE] as number)
        : null;
      const goalsAllowed = typeof oppTeam[C_SCORE] === "number"
        ? (oppTeam[C_SCORE] as number)
        : null;
      games.push({ opponentSlug, opponentName, won, goalsScored, goalsAllowed });
    }
  }

  console.log(`Games found for ${teamSlug}: ${games.length} played, ${upcoming.length} upcoming, ${allOpponentSlugs.size} total opponents`);
  return { games, upcoming, allOpponentSlugs: [...allOpponentSlugs], teamName, classification };
}

export async function fetchBatch(
  slugs: string[],
  buildId: string,
  season: string,
  concurrency = 8
): Promise<Record<string, TeamSchedule>> {
  const result: Record<string, TeamSchedule> = {};
  for (let i = 0; i < slugs.length; i += concurrency) {
    const chunk = slugs.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      chunk.map((slug) => getSchedule(slug, buildId, season))
    );
    for (let j = 0; j < chunk.length; j++) {
      const s = settled[j];
      if (s.status === "fulfilled") {
        const { allOpponentSlugs: _a, ...rest } = s.value;
        result[chunk[j]] = { ...rest, fetchedAt: new Date().toISOString() };
      }
    }
    if (i + concurrency < slugs.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return result;
}
