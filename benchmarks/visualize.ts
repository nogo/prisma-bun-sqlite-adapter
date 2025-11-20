/**
 * Visualization utilities for benchmark results
 * Generates charts and reports from benchmark data
 */

import type { BenchmarkResult } from './stats'
import { formatDuration, generateHistogram } from './stats'

interface ComparisonData {
  adapters: string[]
  results: Map<string, Map<string, BenchmarkResult>>
}

/**
 * Generate ASCII bar chart for comparing adapter performance
 */
export function generateBarChart(
  queryName: string,
  results: Map<string, BenchmarkResult>,
  width: number = 50
): string {
  const entries = Array.from(results.entries())
  const maxMedian = Math.max(...entries.map(([_, r]) => r.median))

  // Shorten adapter names for display and sort: LibSQL first, then Bun SQLite
  const entriesWithNames = entries.map(([name, result]) => {
    let displayName = name
    if (name.includes('synapsenwerkstatt')) displayName = 'Bun SQLite'
    else if (name.includes('adapter-libsql')) displayName = 'LibSQL'
    return { displayName, result, order: displayName === 'LibSQL' ? 0 : 1 }
  })

  // Sort: LibSQL first, Bun SQLite second
  entriesWithNames.sort((a, b) => a.order - b.order)

  const maxNameLength = Math.max(...entriesWithNames.map(e => e.displayName.length))

  let chart = `\n📊 ${queryName}\n`
  chart += '─'.repeat(width + maxNameLength + 15) + '\n'

  entriesWithNames.forEach(({ displayName, result }) => {
    const barLength = Math.round((result.median / maxMedian) * width)
    const bar = '█'.repeat(barLength)
    // Pad adapter name to align all bars
    const paddedName = displayName.padEnd(maxNameLength)
    chart += `${paddedName} ${bar} ${formatDuration(result.median)}\n`
  })

  return chart
}

/**
 * Generate comparison table for all queries
 */
export function generateComparisonTable(data: ComparisonData): string {
  const { adapters, results } = data

  if (adapters.length < 2) {
    return 'Need at least 2 adapters to compare\n'
  }

  const baseline = adapters[0]
  const comparison = adapters[1]
  const baselineResults = results.get(baseline)!
  const comparisonResults = results.get(comparison)!

  // Shorten adapter names for display - swap order so LibSQL is first column
  const col1Name = 'LibSQL'
  const col2Name = 'Bun SQLite'

  let table = '\n📊 PERFORMANCE COMPARISON TABLE\n'
  table += '='.repeat(80) + '\n\n'

  // Headers - LibSQL first, then Bun SQLite
  const col1 = 'Query'.padEnd(35)
  const col2 = col1Name.padEnd(15)
  const col3 = col2Name.padEnd(15)
  const col4 = 'Difference'.padEnd(12)

  table += `${col1} ${col2} ${col3} ${col4}\n`
  table += '-'.repeat(80) + '\n'

  // Rows - swap column order
  for (const [queryName, baselineResult] of baselineResults) {
    const comparisonResult = comparisonResults.get(queryName)
    if (!comparisonResult) continue

    // Calculate how much faster Bun is compared to LibSQL
    const speedup = ((comparisonResult.median - baselineResult.median) / comparisonResult.median) * 100
    const speedupStr = speedup.toFixed(1)
    const emoji = speedup > 0 ? '🟢' : speedup < 0 ? '🔴' : '⚪'

    // Show as positive percentage when Bun is faster
    const displayPercent = speedup > 0 ? `+${speedupStr}%` : `${speedupStr}%`

    const c1 = queryName.padEnd(35)
    const c2 = formatDuration(comparisonResult.median).padEnd(15)  // LibSQL
    const c3 = formatDuration(baselineResult.median).padEnd(15)    // Bun SQLite
    const c4 = `${emoji} ${displayPercent}`.padEnd(12)

    table += `${c1} ${c2} ${c3} ${c4}\n`
  }

  table += '\n' + '='.repeat(80) + '\n'
  table += '🟢 = Faster (Bun)   🔴 = Slower (Bun)   ⚪ = Same\n'

  return table
}

/**
 * Generate histogram visualization
 */
export function generateHistogramChart(
  result: BenchmarkResult,
  width: number = 50,
  height: number = 10
): string {
  const histogram = generateHistogram(result.measurements, 20)
  const maxCount = Math.max(...histogram.map(b => b.count))

  let chart = `\n📊 Distribution: ${result.name}\n`
  chart += '─'.repeat(width + 20) + '\n\n'

  // Generate bars from top to bottom
  for (let i = height; i > 0; i--) {
    const threshold = (i / height) * maxCount
    let row = ''

    for (const bin of histogram) {
      row += bin.count >= threshold ? '█' : ' '
    }

    chart += `${row}\n`
  }

  // X-axis
  chart += '─'.repeat(20) + '\n'
  chart += `${formatDuration(result.min)} → ${formatDuration(result.max)}\n`

  return chart
}

/**
 * Generate markdown report
 */
export function generateMarkdownReport(data: ComparisonData): string {
  const { adapters, results } = data

  let md = '# Prisma Adapter Benchmark Results\n\n'
  md += `**Date:** ${new Date().toISOString()}\n\n`
  md += `**Adapters Compared:** ${adapters.join(' vs ')}\n\n`

  md += '## Summary\n\n'

  // Calculate averages for each adapter
  for (const adapter of adapters) {
    const adapterResults = results.get(adapter)!
    const allMedians = Array.from(adapterResults.values()).map(r => r.median)
    const avgMedian = allMedians.reduce((sum, m) => sum + m, 0) / allMedians.length

    md += `### ${adapter}\n\n`
    md += `- **Queries tested:** ${adapterResults.size}\n`
    md += `- **Average median latency:** ${formatDuration(avgMedian)}\n`

    const sorted = Array.from(adapterResults.values()).sort((a, b) => a.median - b.median)
    md += `- **Fastest query:** ${sorted[0].name.split(' - ')[1]} (${formatDuration(sorted[0].median)})\n`
    md += `- **Slowest query:** ${sorted[sorted.length - 1].name.split(' - ')[1]} (${formatDuration(sorted[sorted.length - 1].median)})\n\n`
  }

  // Detailed results table
  if (adapters.length >= 2) {
    md += '## Detailed Comparison\n\n'
    md += '| Query | ' + adapters.map(a => `${a} (median)`).join(' | ') + ' | Difference |\n'
    md += '|-------|' + adapters.map(() => '--------').join('|') + '|------------|\n'

    const firstAdapter = adapters[0]
    const firstResults = results.get(firstAdapter)!

    for (const [queryName, firstResult] of firstResults) {
      const queryDisplayName = queryName.split(' - ')[1] || queryName
      let row = `| ${queryDisplayName} `

      const values = adapters.map(adapter => {
        const result = results.get(adapter)!.get(queryName)
        return result ? result.median : null
      })

      for (const val of values) {
        row += `| ${val ? formatDuration(val) : 'N/A'} `
      }

      // Calculate difference between first two adapters
      if (values[0] !== null && values[1] !== null) {
        const diff = ((values[1]! - values[0]!) / values[0]!) * 100
        const sign = diff > 0 ? '+' : ''
        row += `| ${sign}${diff.toFixed(1)}% `
      } else {
        row += '| N/A '
      }

      row += '|\n'
      md += row
    }
  }

  md += '\n## Methodology\n\n'
  md += 'These benchmarks follow the methodology outlined in [Prisma\'s performance benchmarks blog post](https://www.prisma.io/blog/performance-benchmarks-comparing-query-latency-across-typescript-orms-and-databases):\n\n'
  md += '- Each query ran 500 times (configurable)\n'
  md += '- Results above the 99th percentile were removed as outliers\n'
  md += '- Measurements taken using `performance.now()`\n'
  md += '- Test data generated with faker.js using deterministic seed\n'
  md += '- All tests run on local SQLite database\n\n'

  return md
}

/**
 * Load and visualize results from JSON file
 */
export async function visualizeResults(filename: string): Promise<void> {
  console.log(`📂 Loading results from: ${filename}`)

  const file = Bun.file(filename)
  const data = await file.json()

  const results = new Map<string, Map<string, BenchmarkResult>>()
  for (const [adapterName, queryResults] of Object.entries(data)) {
    results.set(adapterName, new Map(Object.entries(queryResults as any)))
  }

  const adapters = Array.from(results.keys())
  const comparisonData: ComparisonData = { adapters, results }

  // Generate comparison table
  console.log(generateComparisonTable(comparisonData))

  // Generate bar charts for selected queries
  const selectedQueries = [
    'findMany-users-limit',
    'findMany-posts-published',
    'findMany-users-with-profile',
    'findMany-posts-with-relations',
  ]

  console.log('\n📊 BAR CHARTS FOR SELECTED QUERIES\n')
  for (const queryName of selectedQueries) {
    const queryResults = new Map<string, BenchmarkResult>()
    for (const [adapterName, adapterResults] of results) {
      const result = adapterResults.get(queryName)
      if (result) {
        queryResults.set(adapterName, result)
      }
    }
    if (queryResults.size > 0) {
      console.log(generateBarChart(queryName, queryResults))
    }
  }

  // Generate markdown report
  const markdown = generateMarkdownReport(comparisonData)
  const mdFilename = filename.replace('.json', '.md')
  await Bun.write(mdFilename, markdown)
  console.log(`\n📝 Markdown report saved to: ${mdFilename}`)
}

// CLI runner
if (import.meta.main) {
  const args = Bun.argv.slice(2)
  const filename = args[0]

  if (!filename) {
    console.error('Usage: bun benchmarks/visualize.ts <results-file.json>')
    process.exit(1)
  }

  try {
    await visualizeResults(filename)
  } catch (error) {
    console.error('❌ Visualization failed:', error)
    process.exit(1)
  }
}
