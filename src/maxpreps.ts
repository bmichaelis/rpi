import { parse } from "node-html-parser";
import type { Game, TeamSchedule } from "./types";

const BASE_URL = "https://www.maxpreps.com";
const PAGE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Upgrade-Insecure-Requests": "1",
};

// Positions in each team entry within a contest tuple
const C_URL    = 13; // team schedule URL
const C_NAME   = 14; // school short name
const C_RESULT =  5; // "W", "L", "T", or null/missing for unplayed

function urlToSlug(fullUrl: string): string {
  const path = fullUrl.replace(BASE_URL + "/", "").replace(/^\/|\/$/g, "");
  const parts = path.split("/");
  return parts.length >= 3 ? parts.slice(0, 3).join("/") : path;
}

function getPageProps(data: unknown): Record<string, unknown> {
  const d = data as Record<string, unknown>;
  return (
    ((d.props as Record<string, unknown>)?.pageProps as Record<string, unknown>) ?? {}
  );
}

function getClassification(data: unknown): number | "oos" {
  try {
    const division = (
      getPageProps(data)?.teamContext as Record<string, unknown>
    )?.data as Record<string, unknown>;
    const name = (division?.stateDivisionName as string) ?? "";
    const m = name.match(/(\d)A/);
    if (m) return parseInt(m[1], 10);
  } catch {
    // fall through
  }
  return "oos";
}

function parseNextData(html: string): unknown {
  const root = parse(html);
  const tag = root.querySelector("script#__NEXT_DATA__");
  if (!tag) throw new Error("Could not find __NEXT_DATA__");
  return JSON.parse(tag.text);
}

export async function getSchedule(
  teamSlug: string,
  season: string
): Promise<{ games: Game[]; classification: number | "oos" }> {
  const url = `${BASE_URL}/${teamSlug}/soccer/${season}/schedule/`;
  let data: unknown;
  try {
    const res = await fetch(url, { headers: PAGE_HEADERS });
    console.log(`Schedule fetch ${teamSlug}: HTTP ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    data = parseNextData(html);
  } catch (e) {
    console.warn(`Could not fetch schedule for ${teamSlug}: ${e}`);
    return { games: [], classification: "oos" };
  }

  const classification = getClassification(data);
  const pageProps = getPageProps(data);
  // contests[week][game] = [team1_entry, team2_entry]
  // each team entry is a positional array
  const contests = (pageProps.contests as unknown[][][]) ?? [];

  const games: Game[] = [];
  for (const week of contests) {
    for (const game of week) {
      const team1 = game[0] as unknown[];
      const team2 = game[1] as unknown[];
      if (!team1 || !team2) continue;

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

      const result = ourTeam[C_RESULT] as string | null | undefined;
      if (!result) continue; // unplayed

      let won: boolean | null;
      if (result === "W") won = true;
      else if (result === "L") won = false;
      else if (result === "T") won = null;
      else continue; // unrecognised

      const opponentSlug = urlToSlug((oppTeam[C_URL] as string) ?? "");
      const opponentName = (oppTeam[C_NAME] as string) ?? "";

      games.push({ opponentSlug, opponentName, won });
    }
  }

  console.log(`Games found for ${teamSlug}: ${games.length}`);
  return { games, classification };
}

export async function fetchBatch(
  slugs: string[],
  season: string,
  concurrency = 8
): Promise<Record<string, TeamSchedule>> {
  const result: Record<string, TeamSchedule> = {};
  for (let i = 0; i < slugs.length; i += concurrency) {
    const chunk = slugs.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      chunk.map((slug) => getSchedule(slug, season))
    );
    for (let j = 0; j < chunk.length; j++) {
      const s = settled[j];
      if (s.status === "fulfilled") {
        result[chunk[j]] = { ...s.value, fetchedAt: new Date().toISOString() };
      }
    }
    if (i + concurrency < slugs.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return result;
}
