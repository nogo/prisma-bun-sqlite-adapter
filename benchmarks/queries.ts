import { PrismaClient } from './generated/client'

/**
 * Benchmark query suite
 * Covers various query patterns: simple selects, joins, filters, aggregations, writes
 */

export interface QueryBenchmark {
  name: string
  description: string
  query: (prisma: PrismaClient) => Promise<any>
}

export const queries: QueryBenchmark[] = [
  // Simple queries
  {
    name: 'findMany-users-simple',
    description: 'Select all users without relations',
    query: async (prisma) => {
      return prisma.user.findMany()
    },
  },
  {
    name: 'findMany-users-limit',
    description: 'Select 100 users with limit',
    query: async (prisma) => {
      return prisma.user.findMany({
        take: 100,
      })
    },
  },
  {
    name: 'findUnique-user',
    description: 'Find single user by ID',
    query: async (prisma) => {
      return prisma.user.findUnique({
        where: { id: 1 },
      })
    },
  },

  // Queries with simple filters
  {
    name: 'findMany-posts-published',
    description: 'Find published posts with boolean filter',
    query: async (prisma) => {
      return prisma.post.findMany({
        where: { published: true },
      })
    },
  },
  {
    name: 'findMany-orders-status',
    description: 'Find orders by status',
    query: async (prisma) => {
      return prisma.order.findMany({
        where: { status: 'delivered' },
      })
    },
  },
  {
    name: 'findMany-products-price-range',
    description: 'Find products in price range',
    query: async (prisma) => {
      return prisma.product.findMany({
        where: {
          price: {
            gte: 100,
            lte: 500,
          },
        },
      })
    },
  },

  // Queries with single includes
  {
    name: 'findMany-users-with-profile',
    description: 'Select users with profile relation',
    query: async (prisma) => {
      return prisma.user.findMany({
        include: {
          profile: true,
        },
        take: 100,
      })
    },
  },
  {
    name: 'findMany-posts-with-author',
    description: 'Select posts with author relation',
    query: async (prisma) => {
      return prisma.post.findMany({
        include: {
          author: true,
        },
        take: 100,
      })
    },
  },
  {
    name: 'findMany-orders-with-user',
    description: 'Select orders with user relation',
    query: async (prisma) => {
      return prisma.order.findMany({
        include: {
          user: true,
        },
        take: 100,
      })
    },
  },

  // Queries with multiple includes (complex joins)
  {
    name: 'findMany-posts-with-relations',
    description: 'Select posts with author, category, and tags',
    query: async (prisma) => {
      return prisma.post.findMany({
        include: {
          author: true,
          category: true,
          tags: true,
        },
        take: 50,
      })
    },
  },
  {
    name: 'findMany-users-with-all-relations',
    description: 'Select users with profile, posts, and orders',
    query: async (prisma) => {
      return prisma.user.findMany({
        include: {
          profile: true,
          posts: true,
          orders: true,
        },
        take: 20,
      })
    },
  },
  {
    name: 'findMany-orders-with-items-and-products',
    description: 'Select orders with items and product details',
    query: async (prisma) => {
      return prisma.order.findMany({
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
        take: 50,
      })
    },
  },

  // Nested queries
  {
    name: 'findUnique-user-nested',
    description: 'Find user with deeply nested relations',
    query: async (prisma) => {
      return prisma.user.findUnique({
        where: { id: 1 },
        include: {
          profile: true,
          posts: {
            include: {
              category: true,
              tags: true,
            },
          },
          orders: {
            include: {
              items: {
                include: {
                  product: true,
                },
              },
            },
          },
        },
      })
    },
  },

  // Aggregation queries
  {
    name: 'aggregate-users-count',
    description: 'Count total users',
    query: async (prisma) => {
      return prisma.user.count()
    },
  },
  {
    name: 'aggregate-orders-sum',
    description: 'Sum order totals',
    query: async (prisma) => {
      return prisma.order.aggregate({
        _sum: {
          total: true,
        },
      })
    },
  },
  {
    name: 'aggregate-products-stats',
    description: 'Calculate product price statistics',
    query: async (prisma) => {
      return prisma.product.aggregate({
        _avg: {
          price: true,
        },
        _min: {
          price: true,
        },
        _max: {
          price: true,
        },
      })
    },
  },

  // GroupBy queries
  {
    name: 'groupBy-posts-by-category',
    description: 'Group posts by category with count',
    query: async (prisma) => {
      return prisma.post.groupBy({
        by: ['categoryId'],
        _count: {
          id: true,
        },
      })
    },
  },
  {
    name: 'groupBy-orders-by-status',
    description: 'Group orders by status with sum',
    query: async (prisma) => {
      return prisma.order.groupBy({
        by: ['status'],
        _sum: {
          total: true,
        },
        _count: {
          id: true,
        },
      })
    },
  },

  // Complex filters
  {
    name: 'findMany-posts-complex-filter',
    description: 'Find posts with multiple conditions',
    query: async (prisma) => {
      return prisma.post.findMany({
        where: {
          published: true,
          author: {
            email: {
              contains: '@',
            },
          },
          OR: [
            {
              title: {
                contains: 'test',
              },
            },
            {
              content: {
                contains: 'example',
              },
            },
          ],
        },
        take: 50,
      })
    },
  },

  // Write operations
  {
    name: 'create-user',
    description: 'Create a new user',
    query: (() => {
      let counter = 0
      return async (prisma) => {
        counter++
        return prisma.user.create({
          data: {
            email: `test-${Date.now()}-${counter}-${Math.random().toString(36).substring(7)}@example.com`,
            name: `Test User ${counter}`,
          },
        })
      }
    })(),
  },
  {
    name: 'update-user',
    description: 'Update user name',
    query: async (prisma) => {
      return prisma.user.update({
        where: { id: 1 },
        data: {
          name: 'Updated Name',
        },
      })
    },
  },
  {
    name: 'create-post-with-relations',
    description: 'Create post with relations',
    query: async (prisma) => {
      return prisma.post.create({
        data: {
          title: 'Benchmark Post',
          content: 'Content for benchmark',
          published: true,
          author: {
            connect: { id: 1 },
          },
          category: {
            connect: { id: 1 },
          },
          tags: {
            connect: [{ id: 1 }, { id: 2 }],
          },
        },
      })
    },
  },

  // Raw queries
  {
    name: 'raw-query-simple',
    description: 'Execute raw SQL query',
    query: async (prisma) => {
      return prisma.$queryRaw`SELECT * FROM User LIMIT 100`
    },
  },
  {
    name: 'raw-query-join',
    description: 'Execute raw SQL with join',
    query: async (prisma) => {
      return prisma.$queryRaw`
        SELECT u.*, p.*
        FROM User u
        LEFT JOIN Profile p ON u.id = p.userId
        LIMIT 100
      `
    },
  },

  // Transaction
  {
    name: 'transaction-simple',
    description: 'Execute simple transaction',
    query: async (prisma) => {
      return prisma.$transaction([
        prisma.user.findUnique({ where: { id: 1 } }),
        prisma.post.findMany({ where: { authorId: 1 }, take: 10 }),
      ])
    },
  },
]

/**
 * Get a subset of queries for quick benchmarking
 */
export function getQuickBenchmarkQueries(): QueryBenchmark[] {
  return [
    queries.find(q => q.name === 'findMany-users-limit')!,
    queries.find(q => q.name === 'findMany-posts-published')!,
    queries.find(q => q.name === 'findMany-users-with-profile')!,
    queries.find(q => q.name === 'findMany-posts-with-relations')!,
    queries.find(q => q.name === 'aggregate-users-count')!,
    queries.find(q => q.name === 'create-user')!,
  ]
}
