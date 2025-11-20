/**
 * Statistical utilities for benchmark analysis
 * Following Prisma's methodology for outlier removal and metric calculation
 */

export interface BenchmarkResult {
  name: string
  iterations: number
  measurements: number[]
  median: number
  mean: number
  min: number
  max: number
  p50: number
  p75: number
  p90: number
  p95: number
  p99: number
  stdDev: number
}

/**
 * Remove outliers above the 99th percentile
 */
function removeOutliers(measurements: number[]): number[] {
  const sorted = [...measurements].sort((a, b) => a - b)
  const p99Index = Math.floor(sorted.length * 0.99)
  return sorted.slice(0, p99Index)
}

/**
 * Calculate percentile value
 */
function percentile(sorted: number[], p: number): number {
  const index = Math.ceil(sorted.length * p) - 1
  return sorted[Math.max(0, index)]
}

/**
 * Calculate median
 */
function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

/**
 * Calculate mean
 */
function mean(values: number[]): number {
  return values.reduce((sum, val) => sum + val, 0) / values.length
}

/**
 * Calculate standard deviation
 */
function stdDev(values: number[], meanValue: number): number {
  const variance = values.reduce((sum, val) => {
    const diff = val - meanValue
    return sum + diff * diff
  }, 0) / values.length
  return Math.sqrt(variance)
}

/**
 * Analyze benchmark measurements and calculate statistics
 */
export function analyzeMeasurements(
  name: string,
  measurements: number[]
): BenchmarkResult {
  // Remove outliers above 99th percentile
  const filtered = removeOutliers(measurements)
  const sorted = [...filtered].sort((a, b) => a - b)

  const meanValue = mean(filtered)

  return {
    name,
    iterations: measurements.length,
    measurements: filtered,
    median: median(sorted),
    mean: meanValue,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    stdDev: stdDev(filtered, meanValue),
  }
}

/**
 * Format duration in milliseconds with appropriate precision
 */
export function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}μs`
  } else if (ms < 1000) {
    return `${ms.toFixed(2)}ms`
  } else {
    return `${(ms / 1000).toFixed(2)}s`
  }
}

/**
 * Calculate percentage difference between two values
 */
export function percentDiff(baseline: number, comparison: number): string {
  const diff = ((comparison - baseline) / baseline) * 100
  const sign = diff > 0 ? '+' : ''
  return `${sign}${diff.toFixed(2)}%`
}

/**
 * Generate histogram data for visualization
 */
export interface HistogramBin {
  min: number
  max: number
  count: number
  percentage: number
}

export function generateHistogram(
  measurements: number[],
  bins: number = 20
): HistogramBin[] {
  const sorted = [...measurements].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const binSize = (max - min) / bins

  const histogram: HistogramBin[] = []

  for (let i = 0; i < bins; i++) {
    const binMin = min + i * binSize
    const binMax = binMin + binSize
    const count = sorted.filter(v => v >= binMin && v < binMax).length

    histogram.push({
      min: binMin,
      max: binMax,
      count,
      percentage: (count / measurements.length) * 100,
    })
  }

  return histogram
}

/**
 * Print benchmark results to console in a formatted table
 */
export function printResults(result: BenchmarkResult): void {
  console.log(`\n📊 ${result.name}`)
  console.log(`${'─'.repeat(60)}`)
  console.log(`Iterations:     ${result.iterations}`)
  console.log(`Median:         ${formatDuration(result.median)}`)
  console.log(`Mean:           ${formatDuration(result.mean)}`)
  console.log(`Std Dev:        ${formatDuration(result.stdDev)}`)
  console.log(`Min:            ${formatDuration(result.min)}`)
  console.log(`Max:            ${formatDuration(result.max)}`)
  console.log(`P50:            ${formatDuration(result.p50)}`)
  console.log(`P75:            ${formatDuration(result.p75)}`)
  console.log(`P90:            ${formatDuration(result.p90)}`)
  console.log(`P95:            ${formatDuration(result.p95)}`)
  console.log(`P99:            ${formatDuration(result.p99)}`)
}

/**
 * Compare two benchmark results
 */
export function compareResults(
  baseline: BenchmarkResult,
  comparison: BenchmarkResult
): void {
  console.log(`\n🔬 Comparison: ${baseline.name} vs ${comparison.name}`)
  console.log(`${'─'.repeat(60)}`)
  console.log(`Median:         ${formatDuration(baseline.median)} → ${formatDuration(comparison.median)} (${percentDiff(baseline.median, comparison.median)})`)
  console.log(`Mean:           ${formatDuration(baseline.mean)} → ${formatDuration(comparison.mean)} (${percentDiff(baseline.mean, comparison.mean)})`)
  console.log(`P95:            ${formatDuration(baseline.p95)} → ${formatDuration(comparison.p95)} (${percentDiff(baseline.p95, comparison.p95)})`)
  console.log(`P99:            ${formatDuration(baseline.p99)} → ${formatDuration(comparison.p99)} (${percentDiff(baseline.p99, comparison.p99)})`)
}
