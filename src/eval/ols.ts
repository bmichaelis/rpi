/**
 * Solve the OLS problem min_β ||Xβ − y||² via the normal equations.
 * Returns β. Uses Gaussian elimination with partial pivoting.
 *
 * Inputs:
 *   X: n×p matrix as an array of n rows, each of length p
 *   y: n-vector
 * Returns:
 *   β: p-vector
 *
 * Throws if X is shape-mismatched with y, or if X^T X is singular.
 */
export function solveOls(X: number[][], y: number[]): number[] {
  const n = X.length;
  if (n === 0) throw new Error("solveOls: empty design matrix");
  const p = X[0].length;
  if (y.length !== n) throw new Error(`solveOls: shape mismatch (n=${n}, |y|=${y.length})`);
  for (const row of X) {
    if (row.length !== p) throw new Error("solveOls: ragged design matrix");
  }

  // A = X^T X (p×p), b = X^T y (p)
  const A: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const b: number[] = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      b[j] += X[i][j] * y[i];
      for (let k = 0; k <= j; k++) {
        A[j][k] += X[i][j] * X[i][k];
      }
    }
  }
  // A is symmetric — mirror upper triangle
  for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) A[k][j] = A[j][k];

  return gaussianElim(A, b);
}

function gaussianElim(A: number[][], b: number[]): number[] {
  const n = A.length;
  // Augment
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot: find row with max |M[r][col]| for r >= col
    let pivot = col;
    let pivotMag = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const mag = Math.abs(M[r][col]);
      if (mag > pivotMag) {
        pivot = r;
        pivotMag = mag;
      }
    }
    if (pivotMag < 1e-12) throw new Error("solveOls: singular matrix");
    if (pivot !== col) {
      const tmp = M[col];
      M[col] = M[pivot];
      M[pivot] = tmp;
    }
    // Eliminate
    for (let r = col + 1; r < n; r++) {
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  // Back-substitute
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}
