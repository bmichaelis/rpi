import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { buildSnapshot, type ClassTarget } from "../../src/eval/snapshot";

interface SnapshotConfig {
  source: string;
  season: string;
  classes: ClassTarget[];
}

const PRESETS: Record<string, SnapshotConfig> = {
  "utah-2026": {
    source: "utah-4a5a6a-2026",
    season: "spring/25-26",
    classes: [
      {
        rankingsSlug: "ut/soccer/spring/25-26/class/class-4a/rankings",
        stateDivisionId: "c534b3e8-c200-4b4b-9aa6-f5aa1e5352bc",
      },
      {
        rankingsSlug: "ut/soccer/spring/25-26/class/class-5a/rankings",
        stateDivisionId: "feaf72b1-8c0d-4a89-b835-a75c292d2347",
      },
      {
        rankingsSlug: "ut/soccer/spring/25-26/class/class-6a/rankings",
        stateDivisionId: "0f72a3d1-ec2e-46f5-8a1a-6f4b6df56ca7",
      },
    ],
  },
  // texas-2026 added in Task 10 once division IDs are discovered
};

function parseArgs(argv: string[]): { preset?: string; out?: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return { preset: args.preset, out: args.out };
}

async function main() {
  const { preset, out } = parseArgs(process.argv.slice(2));
  if (!preset || !out) {
    console.error("Usage: tsx scripts/eval/fetch-snapshot.ts --preset <name> --out <path>");
    console.error("Presets:", Object.keys(PRESETS).join(", "));
    process.exit(1);
  }
  const config = PRESETS[preset];
  if (!config) {
    console.error(`Unknown preset: ${preset}`);
    process.exit(1);
  }
  console.log(`Building snapshot for ${preset}...`);
  const snap = await buildSnapshot(config);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snap, null, 2));
  console.log(
    `Wrote ${out}: ${Object.keys(snap.scheduleCache).length} teams, ` +
      `${Object.keys(snap.officialRatings).length} with official ratings`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
