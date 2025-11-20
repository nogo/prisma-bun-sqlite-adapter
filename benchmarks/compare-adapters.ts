/**
 * Comparison runner for Bun SQLite vs LibSQL adapters
 *
 * This script benchmarks both adapters side-by-side to compare performance
 */

import { PrismaClient } from './generated/client'
import { PrismaBunSQLite } from '../dist/index'
import { runBenchmarks } from './runner'
import { queries, getQuickBenchmarkQueries } from './queries'

interface AdapterConfig {
  name: string
  createClient: () => Promise<PrismaClient>
  cleanup?: () => Promise<void>
}

async function main() {
  const args = Bun.argv.slice(2)
  const quick = args.includes('--quick')
  const iterations = parseInt(args.find(a => a.startsWith('--iterations='))?.split('=')[1] ?? '500')
  const warmup = parseInt(args.find(a => a.startsWith('--warmup='))?.split('=')[1] ?? '10')
  const seed = args.includes('--seed')

  console.log('🔬 Prisma Adapter Comparison: Bun SQLite vs LibSQL')
  console.log('=' .repeat(60))

  // Configuration
  const dbPath = 'benchmark.db'

  // Bun SQLite adapter
  const bunAdapter: AdapterConfig = {
    name: 'Bun SQLite (@synapsenwerkstatt/prisma-bun-sqlite-adapter)',
    createClient: async () => {
      const adapter = new PrismaBunSQLite({
        url: `file:${dbPath}`,
      })
      return new PrismaClient({ adapter })
    },
  }

  // LibSQL adapter (requires @prisma/adapter-libsql and @libsql/client)
  const libsqlAdapter: AdapterConfig = {
    name: 'LibSQL (@prisma/adapter-libsql)',
    createClient: async () => {
      try {
        const { PrismaLibSql } = await import('@prisma/adapter-libsql')

        // In Prisma 7, PrismaLibSql is a factory that takes config
        const adapter = new PrismaLibSql({
          url: `file:${dbPath}`,
        })
        return new PrismaClient({ adapter })
      } catch (error) {
        console.error('\n❌ Failed to load LibSQL adapter. Make sure you have installed:')
        console.error('   bun add @prisma/adapter-libsql @libsql/client')
        console.error('   Error:', error)
        throw error
      }
    },
  }

  // Run benchmarks
  await runBenchmarks({
    iterations,
    warmupIterations: warmup,
    adapters: [bunAdapter, libsqlAdapter],
    queries: quick ? getQuickBenchmarkQueries() : queries,
    freshDatabase: seed,
  })
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error('❌ Comparison failed:', error)
    process.exit(1)
  }
}
