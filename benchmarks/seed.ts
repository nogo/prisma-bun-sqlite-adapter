import { PrismaClient } from './generated/client'
import { PrismaBunSQLite } from '../dist/index'
import { faker } from '@faker-js/faker'

// Deterministic seed for reproducibility
const SEED_VALUE = 12345
faker.seed(SEED_VALUE)

// Configuration
const CONFIG = {
  users: 1000,
  postsPerUser: 3,
  categoriesCount: 20,
  tagsCount: 50,
  tagsPerPost: 3,
  ordersPerUser: 5,
  productsCount: 200,
  itemsPerOrder: 4,
}

export async function seedDatabase(prisma: PrismaClient) {
  console.log('🌱 Starting database seeding...')
  console.log(`Configuration:`, CONFIG)

  // Clear existing data
  console.log('\n📦 Clearing existing data...')
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.product.deleteMany()
  await prisma.post.deleteMany()
  await prisma.tag.deleteMany()
  await prisma.category.deleteMany()
  await prisma.profile.deleteMany()
  await prisma.user.deleteMany()

  // Create categories
  console.log('\n📂 Creating categories...')
  const categories = await Promise.all(
    Array.from({ length: CONFIG.categoriesCount }, (_, i) => {
      return prisma.category.create({
        data: {
          name: `${faker.commerce.department()}-${i}`,
        },
      })
    })
  )
  console.log(`✅ Created ${categories.length} categories`)

  // Create tags
  console.log('\n🏷️  Creating tags...')
  const tags = await Promise.all(
    Array.from({ length: CONFIG.tagsCount }, (_, i) => {
      return prisma.tag.create({
        data: {
          name: `${faker.word.noun()}-${i}`,
        },
      })
    })
  )
  console.log(`✅ Created ${tags.length} tags`)

  // Create products
  console.log('\n🛍️  Creating products...')
  const products = await Promise.all(
    Array.from({ length: CONFIG.productsCount }, () => {
      return prisma.product.create({
        data: {
          name: faker.commerce.productName(),
          description: faker.commerce.productDescription(),
          price: parseFloat(faker.commerce.price({ min: 10, max: 1000 })),
          stock: faker.number.int({ min: 0, max: 1000 }),
        },
      })
    })
  )
  console.log(`✅ Created ${products.length} products`)

  // Create users with profiles, posts, and orders
  console.log('\n👥 Creating users with related data...')
  const batchSize = 50
  let userCount = 0

  for (let i = 0; i < CONFIG.users; i += batchSize) {
    const batch = Math.min(batchSize, CONFIG.users - i)

    await Promise.all(
      Array.from({ length: batch }, async () => {
        const user = await prisma.user.create({
          data: {
            email: faker.internet.email(),
            name: faker.person.fullName(),
          },
        })

        // Create profile
        await prisma.profile.create({
          data: {
            userId: user.id,
            bio: faker.person.bio(),
            avatar: faker.image.avatar(),
          },
        })

        // Create posts
        await Promise.all(
          Array.from({ length: CONFIG.postsPerUser }, async () => {
            const selectedTags = faker.helpers.arrayElements(
              tags,
              CONFIG.tagsPerPost
            )

            await prisma.post.create({
              data: {
                title: faker.lorem.sentence(),
                content: faker.lorem.paragraphs(3),
                published: faker.datatype.boolean(),
                authorId: user.id,
                categoryId: faker.helpers.arrayElement(categories).id,
                tags: {
                  connect: selectedTags.map(tag => ({ id: tag.id })),
                },
              },
            })
          })
        )

        // Create orders
        await Promise.all(
          Array.from({ length: CONFIG.ordersPerUser }, async () => {
            const selectedProducts = faker.helpers.arrayElements(
              products,
              CONFIG.itemsPerOrder
            )

            const items = selectedProducts.map(product => ({
              productId: product.id,
              quantity: faker.number.int({ min: 1, max: 5 }),
              price: product.price,
            }))

            const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)

            await prisma.order.create({
              data: {
                orderNumber: faker.string.alphanumeric(10).toUpperCase(),
                total,
                status: faker.helpers.arrayElement(['pending', 'processing', 'shipped', 'delivered']),
                userId: user.id,
                items: {
                  create: items,
                },
              },
            })
          })
        )

        userCount++
      })
    )

    console.log(`  Progress: ${userCount}/${CONFIG.users} users`)
  }

  console.log(`✅ Created ${userCount} users with profiles, posts, and orders`)

  // Summary
  const counts = {
    users: await prisma.user.count(),
    profiles: await prisma.profile.count(),
    posts: await prisma.post.count(),
    categories: await prisma.category.count(),
    tags: await prisma.tag.count(),
    orders: await prisma.order.count(),
    orderItems: await prisma.orderItem.count(),
    products: await prisma.product.count(),
  }

  console.log('\n📊 Database seeding complete!')
  console.log('Final counts:')
  console.log(JSON.stringify(counts, null, 2))

  return counts
}

// Run directly if this file is executed
if (import.meta.main) {
  const adapter = new PrismaBunSQLite({
    url: 'file:./benchmark.db',
  })
  const prisma = new PrismaClient({ adapter })

  try {
    await seedDatabase(prisma)
  } catch (error) {
    console.error('❌ Seeding failed:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}
