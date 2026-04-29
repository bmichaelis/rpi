import { readFileSync, writeFileSync } from "fs";
import { score } from "../../src/eval/score";
import type { Snapshot } from "../../src/eval/types";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { snapshot: snapshotPath, predictions: predictionsPath, out } = args;
  if (!snapshotPath || !predictionsPath || !out) {
    console.error(
      "Usage: tsx scripts/eval/score-cli.ts --snapshot <path> --predictions <path> --out <path>"
    );
    process.exit(1);
  }
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;
  const predictions = JSON.parse(readFileSync(predictionsPath, "utf8")) as Record<string, number>;
  const result = score(snapshot, predictions);
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(
    `Scored ${result.n} teams. MAE=${result.mae.toFixed(4)}, RMSE=${result.rmse.toFixed(4)}, MaxErr=${result.maxErr.toFixed(4)}, R²=${result.r2.toFixed(4)}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
