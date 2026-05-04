import { readFileSync, writeFileSync } from "fs";
import { extractFeaturesV3 } from "../../src/eval/features-v3";
import type { Snapshot } from "../../src/eval/types";

interface ModelFile {
  featureNames: string[];
  coefficients: number[];
}

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
  const { snapshot: snapshotPath, out, model: modelPath } = args;
  if (!snapshotPath || !out) {
    console.error("Usage: tsx scripts/eval/predict-v3.ts --snapshot <path> --out <path> [--model <path>]");
    process.exit(1);
  }
  const model = JSON.parse(
    readFileSync(modelPath ?? "scripts/eval/v3-model.json", "utf8")
  ) as ModelFile;
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;

  const predictions: Record<string, number> = {};
  for (const [slug, sched] of Object.entries(snapshot.scheduleCache)) {
    const strength = snapshot.strengthMap[slug] ?? 0;
    const feats = extractFeaturesV3(sched, strength);
    if (feats.length !== model.coefficients.length) {
      throw new Error(
        `Feature count mismatch: model has ${model.coefficients.length}, extractor produces ${feats.length}. ` +
          `Re-run fit:v3 to regenerate the model.`
      );
    }
    let p = 0;
    for (let i = 0; i < feats.length; i++) p += model.coefficients[i] * feats[i];
    predictions[slug] = p;
  }

  writeFileSync(out, JSON.stringify(predictions, null, 2));
  console.log(`Wrote ${Object.keys(predictions).length} predictions to ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
