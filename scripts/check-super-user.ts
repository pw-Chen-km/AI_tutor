import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * 檢查 Super User 狀態
 * 執行: npx ts-node scripts/check-super-user.ts
 */

async function checkSuperUser() {
  // IMPORTANT: Must match the email you want to verify
  const email = 'chenpiway@gmail.com';

  try {
    console.log(`🔍 檢查用戶: ${email}...\n`);

    const user = await prisma.user.findUnique({
      where: { email },
      include: { subscription: true },
    });

    if (!user) {
      console.log('❌ 用戶不存在');
      console.log('   請先使用 Google Sign In 登入一次');
      process.exit(1);
    }

    console.log('✅ 用戶資訊:');
    console.log(`   用戶 ID: ${user.id}`);
    console.log(`   電子郵件: ${user.email}`);
    console.log(`   名稱: ${user.name || 'N/A'}`);
    console.log(`   管理員 (isAdmin): ${user.isAdmin ? '✅ 是' : '❌ 否'}`);
    console.log(`   Super User (isSuperUser): ${user.isSuperUser ? '✅ 是' : '❌ 否'}`);
    console.log('');

    if (user.subscription) {
      console.log('📊 訂閱資訊:');
      console.log(`   方案: ${user.subscription.plan}`);
      console.log(`   狀態: ${user.subscription.status}`);
      console.log(`   Token 限制: ${user.subscription.tokensLimit.toString()}`);
      console.log(`   已使用 Token: ${user.subscription.tokensUsed.toString()}`);
    } else {
      console.log('⚠️  沒有訂閱資訊');
    }

    console.log('');

    if (user.isSuperUser && user.isAdmin) {
      console.log('🎉 用戶已設定為 Super User 和管理員！');
      console.log('   可以訪問 /admin 頁面查看所有用戶資訊');
    } else {
      console.log('⚠️  用戶尚未設定為 Super User');
      console.log('   執行以下命令來設定:');
      console.log('   npx ts-node scripts/setup-super-user.ts');
    }

  } catch (error: any) {
    console.error('❌ 錯誤:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

checkSuperUser();
