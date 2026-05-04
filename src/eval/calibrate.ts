import { solveOls } from "./ols";

export interface Affine {
  a: number;
  b: number;
}

/**
 * Fit `r_official ≈ a · r_raw + b` by least squares. Uses paired entries
 * (slugs present in both `raw` and `official`).
 *
 * If fewer than 2 paired points are available, falls back to (a=1, b=mean(diff)).
 */
export function fitAffine(
  raw: Map<string, number>,
  official: Record<string, number>
): Affine {
  const pairs: { r: number; o: number }[] = [];
  for (const [slug, r] of raw) {
    const o = official[slug];
    if (o !== undefined) pairs.push({ r, o });
  }
  if (pairs.length === 0) return { a: 1, b: 0 };
  if (pairs.length === 1) return { a: 1, b: pairs[0].o - pairs[0].r };

  const X = pairs.map((p) => [1, p.r]);
  const y = pairs.map((p) => p.o);
  const beta = solveOls(X, y);
  return { a: beta[1], b: beta[0] };
}

export function applyAffine(raw: Map<string, number>, affine: Affine): Map<string, number> {
  const out = new Map<string, number>();
  for (const [slug, r] of raw) out.set(slug, affine.a * r + affine.b);
  return out;
}
