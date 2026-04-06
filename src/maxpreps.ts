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
    console.log(`Fetching: ${url}`);
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
  console.log(`pageProps keys: ${Object.keys(pageProps).join(", ")}`);
  console.log(`first contest entry: ${JSON.stringify((pageProps.contests as unknown[][][])?.[0]?.[0])?.slice(0, 2000)}`);
  const rawLinkedData = pageProps?.linkedDataJson;
  const linkedDataJson: Record<string, unknown> =
    typeof rawLinkedData === "string"
      ? (JSON.parse(rawLinkedData) as Record<string, unknown>)
      : (rawLinkedData as Record<string, unknown>);
  const events: unknown[] =
    (linkedDataJson?.mainEntity as Record<string, unknown>)?.event as unknown[] ?? [];
  console.log(`Events found for ${teamSlug}: ${events.length}`);

  const games: Game[] = [];
  for (const ev of events) {
    const e = ev as Record<string, unknown>;
    let won: boolean | null;
    try {
      won = parseResult((e.description as string) ?? "");
    } catch {
      console.log(`Skipping unplayed: ${(e.description as string)?.slice(0, 80) ?? "(none)"}`);
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
      opponentSlug = homeSlug;
      opponentName = homeName;
      ourResult = won;
    } else {
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
