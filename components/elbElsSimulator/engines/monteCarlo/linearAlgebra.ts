/** Cholesky factor for a 2×2 correlation matrix. */
export function cholesky2x2(correlation: number): readonly [number, number, number, number] {
  if (!Number.isFinite(correlation) || correlation < -1 || correlation > 1) throw new Error('Correlation must be within [-1, 1].')
  const safeCorrelation = Math.max(-0.999999, Math.min(0.999999, correlation))
  return [1, 0, safeCorrelation, Math.sqrt(1 - safeCorrelation ** 2)]
}

export function correlatedNormals(
  independentLeft: number,
  independentRight: number,
  factor: readonly [number, number, number, number],
): readonly [number, number] {
  return [factor[0] * independentLeft + factor[1] * independentRight, factor[2] * independentLeft + factor[3] * independentRight]
}
