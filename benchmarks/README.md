# Prisma Adapter Benchmarks

This benchmark suite compares the performance of the Bun SQLite adapter (`@synapsenwerkstatt/prisma-bun-sqlite-adapter`) against Prisma's official LibSQL adapter (`@prisma/adapter-libsql`).

**Built for Prisma 7** with `prisma.config.ts` configuration.

## Methodology

The benchmarking approach follows [Prisma's official methodology](https://www.prisma.io/blog/performance-benchmarks-comparing-query-latency-across-typescript-orms-and-databases):

- **Query execution timing**: Uses `performance.now()` before and after each query
- **Multiple iterations**: Each query runs 500 times (configurable) to reduce variance
- **Outlier removal**: Removes measurements above the 99th percentile
- **Deterministic data**: Uses faker.js with a fixed seed for reproducible datasets
- **Comprehensive metrics**: Tracks median, mean, min, max, percentiles (P50-P99), and standard deviation

## Installation

Install the required dependencies:

```bash
# Install benchmark dependencies
bun add -d @faker-js/faker

# Install LibSQL adapter for comparison (optional)
bun add -d @prisma/adapter-libsql @libsql/client
```

## Database Schema

The benchmark uses a realistic e-commerce schema with 8 models:
- **User** - Basic user information
- **Profile** - User profile (1:1 with User)
- **Post** - Blog posts with many-to-many tags
- **Category** - Post categories
- **Tag** - Post tags (many-to-many)
- **Order** - User orders
- **OrderItem** - Order line items
- **Product** - Product catalog

## Setup

### 1. Configuration

Prisma 7 uses `prisma.config.ts` for configuration. The benchmark database URL is configured there:

```typescript
// benchmarks/prisma.config.ts
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'schema.prisma',
  migrations: {
    path: 'migrations',
  },
  datasource: {
    url: 'file:./benchmark.db',
  },
})
```

### 2. Generate Prisma Client

```bash
cd benchmarks
bunx prisma generate
```

### 3. Create and Seed Database

```bash
# Create database and run migrations
bunx prisma migrate dev --name init

# Seed with test data (1000 users, 3000 posts, 5000 orders, etc.)
bun seed.ts
```

## Running Benchmarks

### Benchmark Single Adapter (Bun SQLite)

```bash
# Run full benchmark suite (500 iterations per query)
bun runner.ts --seed

# Quick benchmark (6 selected queries)
bun runner.ts --quick

# Custom iteration count
bun runner.ts --iterations=1000 --warmup=20
```

### Compare Both Adapters

```bash
# Compare Bun SQLite vs LibSQL
bun compare-adapters.ts --seed

# Quick comparison
bun compare-adapters.ts --quick

# Custom iterations
bun compare-adapters.ts --iterations=1000 --warmup=20
```

### Command Line Options

- `--seed` - Drop and reseed database before benchmarking
- `--quick` - Run only 6 selected queries instead of full suite
- `--iterations=N` - Number of iterations per query (default: 500)
- `--warmup=N` - Number of warmup iterations (default: 10)

## Query Suite

The benchmark includes 27 queries covering various patterns:

### Simple Queries
- `findMany-users-simple` - Select all users
- `findMany-users-limit` - Select with limit
- `findUnique-user` - Find by ID

### Filtered Queries
- `findMany-posts-published` - Boolean filter
- `findMany-orders-status` - String filter
- `findMany-products-price-range` - Numeric range filter

### Queries with Relations
- `findMany-users-with-profile` - Single relation
- `findMany-posts-with-author` - Inverse relation
- `findMany-posts-with-relations` - Multiple relations
- `findMany-users-with-all-relations` - Complex nested relations
- `findUnique-user-nested` - Deeply nested includes

### Aggregations
- `aggregate-users-count` - Simple count
- `aggregate-orders-sum` - Sum aggregation
- `aggregate-products-stats` - Multiple aggregations
- `groupBy-posts-by-category` - Group by with count
- `groupBy-orders-by-status` - Group by with sum

### Complex Queries
- `findMany-posts-complex-filter` - Multiple conditions with OR
- `findMany-orders-with-items-and-products` - Multiple nested relations

### Write Operations
- `create-user` - Simple create
- `update-user` - Simple update
- `create-post-with-relations` - Create with relations

### Raw Queries
- `raw-query-simple` - Basic SQL
- `raw-query-join` - SQL with joins

### Transactions
- `transaction-simple` - Transaction with multiple queries

## Results

Results are saved to `benchmarks/results/` with timestamps:

- **JSON format**: `results-YYYY-MM-DDTHH-MM-SS.json` - Raw data for analysis
- **Markdown report**: Auto-generated with comparison tables and summary

### Visualize Results

```bash
# Generate visualizations from saved results
bun visualize.ts results/results-2024-01-15T10-30-00.json
```

This generates:
- Comparison tables showing performance differences
- ASCII bar charts for selected queries
- Markdown report with detailed analysis

## Understanding Results

### Metrics Explained

- **Median**: Middle value, less affected by outliers (primary metric)
- **Mean**: Average of all measurements
- **Min/Max**: Fastest and slowest measurements
- **P50-P99**: Percentiles showing distribution
- **Std Dev**: Variation in measurements

### Interpreting Comparisons

The comparison output shows:
- **Absolute timings**: Raw latency for each adapter
- **Percentage difference**: How much faster/slower one adapter is
- **Visual indicators**: 🟢 (faster), 🔴 (slower), ⚪ (same)

Example output:
```
Bun SQLite - findMany-users-limit
  Median: 2.45ms

LibSQL - findMany-users-limit
  Median: 3.12ms

Comparison: +27.35% slower
```

## Dataset Configuration

Edit the `CONFIG` object in `seed.ts` to adjust data volume:

```typescript
const CONFIG = {
  users: 1000,           // Number of users
  postsPerUser: 3,       // Posts per user
  categoriesCount: 20,   // Total categories
  tagsCount: 50,         // Total tags
  tagsPerPost: 3,        // Tags per post
  ordersPerUser: 5,      // Orders per user
  productsCount: 200,    // Total products
  itemsPerOrder: 4,      // Items per order
}
```

Default dataset:
- 1,000 users
- 1,000 profiles
- 3,000 posts
- 5,000 orders
- 20,000 order items
- 200 products
- 50 tags

## Troubleshooting

### "Module not found: @prisma/client"

Run Prisma generate first:
```bash
cd benchmarks
bunx prisma generate
```

### "Table does not exist"

Run migrations:
```bash
bunx prisma migrate dev --name init
```

### "Cannot find module 'prisma/config'"

Make sure you're using Prisma 7:
```bash
bunx prisma --version  # Should show 7.x.x
bun install            # Update dependencies
```

### "Cannot find module @prisma/adapter-libsql"

The LibSQL adapter is optional. To use it:
```bash
bun add -d @prisma/adapter-libsql @libsql/client
```

Or run only the Bun adapter benchmark:
```bash
bun runner.ts
```

### Out of Memory

Reduce iterations or dataset size:
```bash
bun runner.ts --iterations=100
```

Or edit `seed.ts` to reduce data volume.

## Requirements

- **Bun**: >= 1.0.0
- **Node.js**: >= 20.19.0 (required by Prisma 7)
- **TypeScript**: >= 5.4.0
- **Prisma**: >= 7.0.0
- **@prisma/client**: >= 7.0.0
- **@prisma/driver-adapter-utils**: >= 7.0.0

### Compatibility

| Prisma Version | Adapter Version | Status |
|----------------|-----------------|--------|
| 7.0.x+         | 2.0.x          | ✅ Stable |
| 6.13.x+        | 1.x.x          | ✅ Legacy |

## Contributing

To add new queries:

1. Add to `queries.ts`:
```typescript
{
  name: 'my-new-query',
  description: 'Description of what it tests',
  query: async (prisma) => {
    return prisma.model.findMany({ ... })
  },
}
```

2. Run benchmarks to test

## License

MIT
