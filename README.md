# Prisma Bun SQLite Adapter

A high-performance Prisma driver adapter that enables seamless integration between Prisma ORM and Bun's built-in SQLite driver.

## Features

- 🚀 **Native Bun Performance** - Leverages Bun's optimized SQLite implementation
- 🔗 **Full Prisma Compatibility** - Works with existing Prisma schemas and queries
- 📦 **Minimal Dependencies** - Only requires `async-mutex` as runtime dependency
- 🛡️ **TypeScript First** - Full type safety with comprehensive TypeScript definitions
- ⚡ **Complete Transaction Support** - ACID transactions with proper commit/rollback
- 🔒 **Thread-Safe** - Mutex-based transaction locking for data integrity
- 🎯 **Comprehensive Error Handling** - Detailed SQLite error mapping to Prisma errors
- 🧪 **Extensively Tested** - 74+ tests covering all functionality
- 📁 **Migration Support** - Full support for Prisma migrations with shadow databases

## Installation

```bash
bun add @cgenogo/prisma-bun-sqlite-adapter
```

## Quick Start

```typescript
import { PrismaClient } from '@prisma/client'
import { PrismaBunSQLite } from '@cgenogo/prisma-bun-sqlite-adapter'

// Create adapter factory
const adapter = new PrismaBunSQLite({ url: 'file:database.db' })

// Initialize Prisma with adapter
const prisma = new PrismaClient({ adapter })

// Use Prisma as usual
const users = await prisma.user.findMany()
```

## Configuration Options

### Factory Configuration

```typescript
interface BunSQLiteFactoryParams {
  url: ':memory:' | string;           // Database URL (file path or :memory:)
  shadowDatabaseURL?: ':memory:' | string;  // Optional: Shadow DB for migrations
}
```

### Usage Examples

```typescript
import { PrismaBunSQLite } from '@cgenogo/prisma-bun-sqlite-adapter'

// File database
const adapter = new PrismaBunSQLite({ 
  url: 'file:./database.db' 
})

// Memory database (great for testing)
const adapter = new PrismaBunSQLite({ 
  url: ':memory:' 
})

// With shadow database for migrations
const adapter = new PrismaBunSQLite({ 
  url: 'file:./database.db',
  shadowDatabaseURL: ':memory:'
})
```

## Usage Examples

### Basic CRUD Operations

```typescript
// Create
const newUser = await prisma.user.create({
  data: {
    name: 'John Doe',
    email: 'john@example.com'
  }
})

// Read
const users = await prisma.user.findMany({
  where: { active: true }
})

// Update
const updatedUser = await prisma.user.update({
  where: { id: 1 },
  data: { name: 'Jane Doe' }
})

// Delete
await prisma.user.delete({
  where: { id: 1 }
})
```

### Transactions

```typescript
await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({
    data: { name: 'Alice', email: 'alice@example.com' }
  })
  
  await tx.profile.create({
    data: { userId: user.id, bio: 'Software Developer' }
  })
})
```

### Raw Queries

```typescript
// Raw query
const result = await prisma.$queryRaw`
  SELECT * FROM User WHERE created_at > ${new Date('2024-01-01')}
`

// Raw execution
await prisma.$executeRaw`
  UPDATE User SET last_login = ${new Date()} WHERE id = ${userId}
`
```

## Environment Setup

### Development

```typescript
// Use in-memory database for testing
const adapter = new PrismaBunSQLite({ url: ':memory:' })
```

### Production

```typescript
// Use persistent database file
const adapter = new PrismaBunSQLite({ 
  url: 'file:./production.db',
  shadowDatabaseURL: ':memory:'  // Fast shadow DB for migrations
})
```

## Adapter Capabilities

### Core Features

- **CRUD Operations**: Full support for Create, Read, Update, Delete operations
- **Parameterized Queries**: Safe query execution with parameter binding
- **Raw Queries**: Support for `$queryRaw` and `$executeRaw`
- **Script Execution**: Multi-statement SQL script support
- **BLOB Handling**: Native support for binary data via `Uint8Array`
- **Foreign Key Constraints**: Automatically enabled for data integrity

### Transaction Support

```typescript
// Automatic transaction handling
await prisma.$transaction(async (tx) => {
  await tx.user.create({ data: { name: 'Alice' } })
  await tx.profile.create({ data: { userId: 1, bio: 'Developer' } })
})

// Manual transaction control via adapter
const adapter = await factory.connect()
const transaction = await adapter.startTransaction()
try {
  // Your operations
  await transaction.commit()
} catch (error) {
  await transaction.rollback()
}
```

### Data Type Conversion

- **Automatic Type Inference**: Infers column types from data when schema types unavailable
- **Boolean Conversion**: Handles SQLite integer (0/1) to boolean conversion
- **BigInt Support**: Converts large integers to strings for JSON compatibility
- **Date/Time Handling**: Proper ISO string formatting for temporal data
- **Binary Data**: Efficient `Uint8Array` to byte array conversion

## Migration Support

This adapter supports Prisma migrations out of the box:

```bash
# Generate migration
bunx prisma migrate dev --name init

# Deploy migration
bunx prisma migrate deploy

# Reset database
bunx prisma migrate reset
```

## Error Handling

The adapter provides comprehensive error mapping from SQLite to Prisma error types:

```typescript
try {
  await prisma.user.create({
    data: { email: 'duplicate@example.com' }
  })
} catch (error) {
  // Handles SQLite constraint errors as Prisma errors
  if (error.code === 'P2002') {
    console.log('Unique constraint violation')
  }
}
```

### Supported Error Types

- **UniqueConstraintViolation** - UNIQUE and PRIMARY KEY violations
- **NullConstraintViolation** - NOT NULL constraint failures
- **ForeignKeyConstraintViolation** - Foreign key constraint errors
- **TableDoesNotExist** - Missing table errors
- **ColumnNotFound** - Invalid column references
- **SocketTimeout** - Database busy/locked errors

## Troubleshooting

### Transaction Issues

Transactions use mutex locking to ensure SQLite's single-writer constraint:

```typescript
// Sequential transactions work automatically
const tx1 = await adapter.startTransaction()
// tx2 will wait for tx1 to complete
const tx2 = await adapter.startTransaction()
```

### URL Format Support

```typescript
// All these formats work:
const adapter1 = new PrismaBunSQLite({ url: 'database.db' })
const adapter2 = new PrismaBunSQLite({ url: 'file:database.db' })
const adapter3 = new PrismaBunSQLite({ url: 'file://database.db' })
const adapter4 = new PrismaBunSQLite({ url: ':memory:' })
```

## Requirements

- **Bun**: >= 1.0.0
- **Prisma**: >= 6.0.0
- **@prisma/client**: >= 6.13.0
- **@prisma/driver-adapter-utils**: >= 6.13.0

## Compatibility

| Prisma Version | Adapter Version | Status |
|----------------|-----------------|--------|
| 6.13.x+        | 1.0.x          | ✅ Stable |

### Runtime Support

- ✅ **Bun Runtime** - Primary target platform
- ❌ **Node.js** - Not supported (use native Prisma SQLite)
- ❌ **Browser** - Server-side only

## Limitations

- **Bun Runtime Only** - Requires Bun's native SQLite implementation
- **SQLite Specific** - Only supports SQLite databases (by design)
- **Single Connection** - No connection pooling (SQLite is single-writer)
- **SERIALIZABLE Only** - Only supports SERIALIZABLE isolation level (SQLite default)
- **No Distributed Setup** - SQLite is inherently single-file

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Testing

The adapter includes a comprehensive test suite with 74+ tests:

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test:watch

# Run tests with coverage
bun test:coverage

# Run specific test file
bun test tests/adapter.test.ts
```

### Test Coverage

- **Core Adapter** - CRUD operations, script execution, error handling
- **Transactions** - Commit, rollback, isolation, sequential processing  
- **Data Conversion** - Type mapping, argument processing, result formatting
- **Error Handling** - SQLite to Prisma error conversion
- **Factory Pattern** - Connection creation, shadow databases, URL parsing

All tests use in-memory SQLite databases for fast, isolated execution.

## License

MIT © [Danilo Kühn](https://github.com/nogo)

## Support

- 📖 [Documentation](https://github.com/nogo/prisma-adapter-bun-sqlite/wiki)
- 🐛 [Report Issues](https://github.com/nogo/prisma-adapter-bun-sqlite/issues)
- 💬 [Discussions](https://github.com/nogo/prisma-adapter-bun-sqlite/discussions)

## Related Projects

- [Prisma](https://prisma.io) - Modern database toolkit
- [Bun](https://bun.sh) - Fast all-in-one JavaScript runtime
- [SQLite](https://sqlite.org) - Lightweight database engine

---

Made with ❤️ for the Bun and Prisma communities