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
 * 設定 Super User
 * 執行: npx ts-node scripts/setup-super-user.ts
 */

async function setupSuperUser() {
  // IMPORTANT: Set this to the email of the user you logged in as
  // so the script can mark your account as isAdmin/isSuperUser.
  const superUserEmail = 'chenpiway@gmail.com';

  try {
    console.log(`🔍 尋找用戶: ${superUserEmail}...`);

    // 查找或創建用戶
    let user = await prisma.user.findUnique({
      where: { email: superUserEmail },
      include: { subscription: true },
    });

    if (!user) {
      console.log('❌ 用戶不存在，請先使用 Google Sign In 登入一次');
      console.log('   登入後會自動創建用戶，然後再執行此腳本');
      process.exit(1);
    }

    console.log('✅ 找到用戶');

    // 更新用戶為 Super User
    const updatedUser = await prisma.user.update({
      where: { email: superUserEmail },
      data: {
        isAdmin: true,
        isSuperUser: true,
      },
      include: { subscription: true },
    });
    
    user = updatedUser;

    console.log('✅ 已設定為 Super User');

    // 更新或創建 Premium 訂閱（無限制）
    const subscription = await prisma.subscription.upsert({
      where: { userId: user.id },
      update: {
        plan: 'premium',
        status: 'active',
        tokensLimit: BigInt(999999999999), // 幾乎無限
        tokensUsed: BigInt(0),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(new Date().setFullYear(new Date().getFullYear() + 100)), // 100 年後
        cancelAtPeriodEnd: false,
      },
      create: {
        userId: user.id,
        plan: 'premium',
        status: 'active',
        tokensLimit: BigInt(999999999999), // 幾乎無限
        tokensUsed: BigInt(0),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(new Date().setFullYear(new Date().getFullYear() + 100)), // 100 年後
        cancelAtPeriodEnd: false,
      },
    });

    console.log('✅ 已設定 Premium 訂閱（無限制）');
    console.log('');
    console.log('📊 Super User 資訊:');
    console.log(`   用戶 ID: ${user.id}`);
    console.log(`   電子郵件: ${user.email}`);
    console.log(`   名稱: ${user.name || 'N/A'}`);
    console.log(`   管理員: ${user.isAdmin ? '是' : '否'}`);
    console.log(`   Super User: ${user.isSuperUser ? '是' : '否'}`);
    console.log(`   訂閱方案: ${subscription.plan}`);
    console.log(`   訂閱狀態: ${subscription.status}`);
    console.log(`   Token 限制: ${subscription.tokensLimit.toString()} (幾乎無限)`);
    console.log(`   已使用 Token: ${subscription.tokensUsed.toString()}`);

    console.log('');
    console.log('🎉 Super User 設定完成！');
    console.log('   現在可以訪問管理員頁面查看所有用戶資訊');

  } catch (error: any) {
    console.error('❌ 錯誤:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

setupSuperUser();
