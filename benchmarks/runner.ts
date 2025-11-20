import { PrismaClient } from './generated/client'
import { PrismaBunSQLite } from '../dist/index'
import { queries, getQuickBenchmarkQueries, type QueryBenchmark } from './queries'
import { analyzeMeasurements, printResults, compareResults, type BenchmarkResult } from './stats'
import { seedDatabase } from './seed'

/**
 * Benchmark runner configuration
 */
interface BenchmarkConfig {
  iterations: number
  warmupIterations: number
  adapters: AdapterConfig[]
  queries: QueryBenchmark[]
  freshDatabase: boolean
}

interface AdapterConfig {
  name: string
  createClient: () => Promise<PrismaClient>
  cleanup?: () => Promise<void>
}

/**
 * Run a single query benchmark
 */
async function benchmarkQuery(
  prisma: PrismaClient,
  query: QueryBenchmark,
  iterations: number,
  warmupIterations: number
): Promise<number[]> {
  const measurements: number[] = []

  // Warmup iterations
  console.log(`  Warmup (${warmupIterations} iterations)...`)
  for (let i = 0; i < warmupIterations; i++) {
    await query.query(prisma)
  }

  // Actual measurements
  console.log(`  Measuring (${iterations} iterations)...`)
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await query.query(prisma)
    const end = performance.now()
    measurements.push(end - start)

    if ((i + 1) % 100 === 0) {
      console.log(`    Progress: ${i + 1}/${iterations}`)
    }
  }

  return measurements
}

/**
 * Run benchmarks for a single adapter
 */
async function benchmarkAdapter(
  config: AdapterConfig,
  queries: QueryBenchmark[],
  iterations: number,
  warmupIterations: number
): Promise<Map<string, BenchmarkResult>> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🏃 Running benchmarks for: ${config.name}`)
  console.log(`${'='.repeat(60)}`)

  const prisma = await config.createClient()
  const results = new Map<string, BenchmarkResult>()

  try {
    for (const query of queries) {
      console.log(`\n📝 Query: ${query.name}`)
      console.log(`   ${query.description}`)

      const measurements = await benchmarkQuery(
        prisma,
        query,
        iterations,
        warmupIterations
      )

      const result = analyzeMeasurements(
        `${config.name} - ${query.name}`,
        measurements
      )

      results.set(query.name, result)
      printResults(result)
    }
  } finally {
    await prisma.$disconnect()
    if (config.cleanup) {
      await config.cleanup()
    }
  }

  return results
}

/**
 * Compare results from multiple adapters
 */
function compareAdapterResults(
  results: Map<string, Map<string, BenchmarkResult>>
): void {
  const adapterNames = Array.from(results.keys())
  if (adapterNames.length < 2) {
    return
  }

  console.log(`\n\n${'='.repeat(60)}`)
  console.log(`📊 COMPARISON RESULTS`)
  console.log(`${'='.repeat(60)}`)

  const baseline = adapterNames[0]
  const baselineResults = results.get(baseline)!

  for (let i = 1; i < adapterNames.length; i++) {
    const comparisonName = adapterNames[i]
    const comparisonResults = results.get(comparisonName)!

    console.log(`\n\n🔬 Comparing ${baseline} vs ${comparisonName}`)
    console.log(`${'─'.repeat(60)}`)

    for (const [queryName, baselineResult] of baselineResults) {
      const comparisonResult = comparisonResults.get(queryName)
      if (comparisonResult) {
        compareResults(baselineResult, comparisonResult)
      }
    }
  }
}

/**
 * Generate summary report
 */
function generateSummary(
  results: Map<string, Map<string, BenchmarkResult>>
): void {
  console.log(`\n\n${'='.repeat(60)}`)
  console.log(`📋 SUMMARY REPORT`)
  console.log(`${'='.repeat(60)}`)

  const adapterNames = Array.from(results.keys())

  for (const adapterName of adapterNames) {
    const adapterResults = results.get(adapterName)!
    const allMedians = Array.from(adapterResults.values()).map(r => r.median)
    const avgMedian = allMedians.reduce((sum, m) => sum + m, 0) / allMedians.length

    console.log(`\n${adapterName}:`)
    console.log(`  Queries tested: ${adapterResults.size}`)
    console.log(`  Average median latency: ${avgMedian.toFixed(2)}ms`)

    // Find fastest and slowest queries
    const sorted = Array.from(adapterResults.values()).sort((a, b) => a.median - b.median)
    console.log(`  Fastest query: ${sorted[0].name} (${sorted[0].median.toFixed(2)}ms)`)
    console.log(`  Slowest query: ${sorted[sorted.length - 1].name} (${sorted[sorted.length - 1].median.toFixed(2)}ms)`)
  }

  // Overall winner
  if (adapterNames.length > 1) {
    const averages = adapterNames.map(name => {
      const adapterResults = results.get(name)!
      const allMedians = Array.from(adapterResults.values()).map(r => r.median)
      return {
        name,
        avgMedian: allMedians.reduce((sum, m) => sum + m, 0) / allMedians.length,
      }
    })

    averages.sort((a, b) => a.avgMedian - b.avgMedian)
    console.log(`\n🏆 Overall fastest adapter: ${averages[0].name}`)
    console.log(`   Average median latency: ${averages[0].avgMedian.toFixed(2)}ms`)
  }
}

/**
 * Export results to JSON
 */
function exportResults(
  results: Map<string, Map<string, BenchmarkResult>>,
  filename: string
): void {
  const data = Object.fromEntries(
    Array.from(results.entries()).map(([adapterName, queryResults]) => [
      adapterName,
      Object.fromEntries(queryResults),
    ])
  )

  Bun.write(filename, JSON.stringify(data, null, 2))
  console.log(`\n💾 Results exported to: ${filename}`)
}

/**
 * Main benchmark execution
 */
export async function runBenchmarks(config: BenchmarkConfig): Promise<void> {
  console.log('🚀 Starting benchmarks...')
  console.log(`Configuration:`)
  console.log(`  Iterations: ${config.iterations}`)
  console.log(`  Warmup iterations: ${config.warmupIterations}`)
  console.log(`  Adapters: ${config.adapters.map(a => a.name).join(', ')}`)
  console.log(`  Queries: ${config.queries.length}`)

  // Seed database if needed
  if (config.freshDatabase) {
    console.log('\n🌱 Seeding database...')
    const prisma = await config.adapters[0].createClient()
    try {
      await seedDatabase(prisma)
    } finally {
      await prisma.$disconnect()
    }
  }

  // Run benchmarks for each adapter
  const allResults = new Map<string, Map<string, BenchmarkResult>>()

  for (const adapter of config.adapters) {
    const results = await benchmarkAdapter(
      adapter,
      config.queries,
      config.iterations,
      config.warmupIterations
    )
    allResults.set(adapter.name, results)
  }

  // Generate comparison and summary
  compareAdapterResults(allResults)
  generateSummary(allResults)

  // Export results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  exportResults(allResults, `results/${timestamp}.json`)

  console.log('\n✅ Benchmarks complete!')
}

// CLI runner
if (import.meta.main) {
  const args = Bun.argv.slice(2)
  const quick = args.includes('--quick')
  const iterations = parseInt(args.find(a => a.startsWith('--iterations='))?.split('=')[1] ?? '500')
  const warmup = parseInt(args.find(a => a.startsWith('--warmup='))?.split('=')[1] ?? '10')

  console.log('📊 Prisma Adapter Benchmark Suite')
  console.log('=' .repeat(60))

  // Bun SQLite adapter configuration
  const bunAdapter: AdapterConfig = {
    name: 'Bun SQLite Adapter',
    createClient: async () => {
      const adapter = new PrismaBunSQLite({
        url: 'file:benchmark.db',
      })
      return new PrismaClient({ adapter })
    },
  }

  // TODO: Add libsql adapter configuration when ready
  // const libsqlAdapter: AdapterConfig = {
  //   name: 'LibSQL Adapter',
  //   createClient: async () => {
  //     const { PrismaLibSQL } = await import('@prisma/adapter-libsql')
  //     const { createClient } = await import('@libsql/client')
  //     const libsql = createClient({ url: 'file:benchmarks/benchmark.db' })
  //     const adapter = new PrismaLibSQL(libsql)
  //     return new PrismaClient({ adapter })
  //   },
  // }

  const config: BenchmarkConfig = {
    iterations,
    warmupIterations: warmup,
    adapters: [bunAdapter],
    queries: quick ? getQuickBenchmarkQueries() : queries,
    freshDatabase: args.includes('--seed'),
  }

  try {
    await runBenchmarks(config)
  } catch (error) {
    console.error('❌ Benchmark failed:', error)
    process.exit(1)
  }
}
