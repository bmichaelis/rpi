import { readFileSync, writeFileSync } from "fs";
import { calculateAllMaxPrepsRatings } from "../../src/rpi";
import { score } from "../../src/eval/score";
import type { Snapshot, Score } from "../../src/eval/types";

function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, "utf8")) as Snapshot;
}

function predict(snapshot: Snapshot): Record<string, number> {
  return calculateAllMaxPrepsRatings(snapshot.scheduleCache, snapshot.strengthMap);
}

function fmt(s: Score): string {
  const lines: string[] = [];
  lines.push(`- n: ${s.n}`);
  lines.push(`- MAE: ${s.mae.toFixed(4)}`);
  lines.push(`- RMSE: ${s.rmse.toFixed(4)}`);
  lines.push(`- MaxErr: ${s.maxErr.toFixed(4)}`);
  lines.push(`- R²: ${s.r2.toFixed(4)}`);
  lines.push("");
  lines.push("By class:");
  for (const [cls, m] of Object.entries(s.byClass).sort()) {
    lines.push(`- ${cls}: n=${m.n}, MAE=${m.mae.toFixed(4)}, MaxErr=${m.maxErr.toFixed(4)}`);
  }
  lines.push("");
  lines.push("Worst 10:");
  lines.push("| slug | predicted | official | residual |");
  lines.push("|------|-----------|----------|----------|");
  for (const w of s.worst10) {
    lines.push(`| ${w.slug} | ${w.predicted.toFixed(4)} | ${w.official.toFixed(4)} | ${w.residual.toFixed(4)} |`);
  }
  return lines.join("\n");
}

async function main() {
  const utah = loadSnapshot("scripts/eval/data/utah-2026.json");
  const texas = loadSnapshot("scripts/eval/data/texas-2026.json");

  const utahPreds = predict(utah);
  const texasPreds = predict(texas);

  const utahScore = score(utah, utahPreds);
  const texasScore = score(texas, texasPreds);

  writeFileSync(
    "scripts/eval/BASELINE.md",
    `# Baseline — current OLS formula

\`rating = 0.8809*(W-L) + 0.9183*strength + 1.6813*gdCap + 0.0552\`

Captured: ${new Date().toISOString()}

## Training set: utah-2026

${fmt(utahScore)}

## Held-out set: texas-2026

${fmt(texasScore)}

## Acceptance bar for new approaches

A new formula must beat this baseline by **≥ 0.20 MAE on the texas-2026 held-out set**.
Current bar: MAE < ${(texasScore.mae - 0.2).toFixed(4)}.
`
  );

  console.log(`Utah-2026:  MAE=${utahScore.mae.toFixed(4)}, MaxErr=${utahScore.maxErr.toFixed(4)}`);
  console.log(`Texas-2026: MAE=${texasScore.mae.toFixed(4)}, MaxErr=${texasScore.maxErr.toFixed(4)}`);
  console.log(`Acceptance bar: Texas MAE < ${(texasScore.mae - 0.2).toFixed(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
