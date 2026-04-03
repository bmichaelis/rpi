import { parse } from "node-html-parser";
import type { Game, TeamSchedule } from "./types";

const BASE_URL = "https://www.maxpreps.com";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.maxpreps.com/",
  Accept: "application/json, text/html",
};

export async function getBuildId(): Promise<string> {
  const res = await fetch(BASE_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`MaxPreps homepage returned ${res.status}`);
  const html = await res.text();
  const root = parse(html);
  const tag = root.querySelector("script#__NEXT_DATA__");
  if (!tag) throw new Error("Could not find __NEXT_DATA__ on MaxPreps homepage");
  const data = JSON.parse(tag.text);
  return data.buildId.trim(); // .trim() is critical — buildId has a trailing newline
}

function urlToSlug(fullUrl: string): string {
  const path = fullUrl.replace(BASE_URL + "/", "").replace(/^\/|\/$/g, "");
  const parts = path.split("/");
  return parts.length >= 3 ? parts.slice(0, 3).join("/") : path;
}

function parseResult(description: string): boolean | null {
  if (description.includes(" won ")) return true;
  if (description.includes(" lost ")) return false;
  if (description.includes(" tied ")) return null;
  throw new Error("unplayed");
}

function getClassification(data: unknown): number | "oos" {
  try {
    const d = data as Record<string, unknown>;
    const division = (
      (d.pageProps as Record<string, unknown>)?.teamContext as Record<string, unknown>
    )?.data as Record<string, unknown>;
    const name = (division?.stateDivisionName as string) ?? "";
    const m = name.match(/(\d)A/);
    if (m) return parseInt(m[1], 10);
  } catch {
    // fall through
  }
  return "oos";
}

export async function getSchedule(
  teamSlug: string,
  buildId: string,
  season: string
): Promise<{ games: Game[]; classification: number | "oos" }> {
  const url = `${BASE_URL}/_next/data/${buildId}/${teamSlug}/soccer/${season}/schedule.json`;
  let data: unknown;
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    console.warn(`Could not fetch schedule for ${teamSlug}: ${e}`);
    return { games: [], classification: "oos" };
  }

  const classification = getClassification(data);
  const d = data as Record<string, unknown>;
  const events: unknown[] =
    (
      (
        (d.pageProps as Record<string, unknown>)?.linkedDataJson as Record<string, unknown>
      )?.mainEntity as Record<string, unknown>
    )?.event as unknown[] ?? [];

  const games: Game[] = [];
  for (const ev of events) {
    const e = ev as Record<string, unknown>;
    let won: boolean | null;
    try {
      won = parseResult((e.description as string) ?? "");
    } catch {
      continue; // unplayed game
    }

    const awayTeam = e.awayTeam as Record<string, string>;
    const homeTeam = e.homeTeam as Record<string, string>;
    const awaySlug = urlToSlug(awayTeam?.url ?? "");
    const homeSlug = urlToSlug(homeTeam?.url ?? "");
    const awayName = awayTeam?.name ?? "";
    const homeName = homeTeam?.name ?? "";

    let opponentSlug: string;
    let opponentName: string;
    let ourResult: boolean | null;

    if (awaySlug === teamSlug) {
      // We are the away team — description is from our perspective
      opponentSlug = homeSlug;
      opponentName = homeName;
      ourResult = won;
    } else {
      // We are the home team — description is from away team's perspective, flip it
      opponentSlug = awaySlug;
      opponentName = awayName;
      ourResult = won === null ? null : !won;
    }

    games.push({ opponentSlug, opponentName, won: ourResult });
  }

  return { games, classification };
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
        result[chunk[j]] = { ...s.value, fetchedAt: new Date().toISOString() };
      }
    }
    if (i + concurrency < slugs.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return result;
}
