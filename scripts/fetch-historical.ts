import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const YEARS = [2023, 2024, 2025];
const CLASSES = ["4A", "5A", "6A"];
const SEASON_LABELS: Record<number, string> = {
  2023: "2022-23",
  2024: "2023-24",
  2025: "2024-25",
};

interface UhsaaEntry {
  Rank: string;
  School: string;
  SchoolID: string;
  RPI: string;
  WP: string;
  OWP: string;
  OOWP: string;
  "W-L-T": string;
}

interface NormalizedEntry {
  rank: number;
  school: string;
  schoolId: string;
  rpi: number;
  wp: number;
  owp: number;
  oowp: number;
  record: string;
}

interface HistoricalPayload {
  year: number;
  season: string;
  source: string;
  classes: Record<string, NormalizedEntry[]>;
}

async function fetchClass(year: number, cls: string): Promise<NormalizedEntry[]> {
  const url = `https://uhsaa.org/rpi/boyssoccer/${year}/${cls}final.php?_=${Date.now()}`;
  console.log(`  Fetching ${cls}...`);
  const res = await fetch(url, {
    headers: {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0 (compatible; rpi-fetcher/1.0)",
      "Referer": `https://uhsaa.org/rpi/boyssoccer/${year}/`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json: { data: UhsaaEntry[] } = await res.json();
  return json.data.map(e => ({
    rank: parseInt(e.Rank, 10),
    school: e.School,
    schoolId: e.SchoolID,
    rpi: parseFloat(e.RPI),
    wp: parseFloat(e.WP),
    owp: parseFloat(e.OWP),
    oowp: parseFloat(e.OOWP),
    record: e["W-L-T"],
  }));
}

async function main() {
  const outDir = join(process.cwd(), "public", "historical");
  mkdirSync(outDir, { recursive: true });

  for (const year of YEARS) {
    console.log(`\nFetching ${year} (${SEASON_LABELS[year]})...`);
    const payload: HistoricalPayload = {
      year,
      season: SEASON_LABELS[year],
      source: "UHSAA official",
      classes: {},
    };
    for (const cls of CLASSES) {
      payload.classes[cls] = await fetchClass(year, cls);
    }
    const outPath = join(outDir, `${year}.json`);
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`  Wrote ${outPath}`);
  }

  console.log("\nDone.");
}

main().catch(e => { console.error(e); process.exit(1); });
