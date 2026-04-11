import 'dotenv/config';
import { Pool } from 'pg';

// 測試資料庫連接
async function testConnection() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('❌ DATABASE_URL 環境變數未設定');
    process.exit(1);
  }

  console.log('🔍 測試資料庫連接...');
  console.log('連接字串:', connectionString.replace(/:[^:@]+@/, ':****@')); // 隱藏密碼

  const pool = new Pool({
    connectionString,
    // 連接超時設定
    connectionTimeoutMillis: 5000,
    // 查詢超時設定
    query_timeout: 5000,
  });

  try {
    // 測試連接
    const client = await pool.connect();
    console.log('✅ 資料庫連接成功！');

    // 執行簡單查詢
    const result = await client.query('SELECT version(), current_database(), current_user');
    console.log('\n📊 資料庫資訊:');
    console.log('  PostgreSQL 版本:', result.rows[0].version.split(',')[0]);
    console.log('  當前資料庫:', result.rows[0].current_database);
    console.log('  當前用戶:', result.rows[0].current_user);

    // 檢查表是否存在
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('\n📋 現有表:');
    if (tablesResult.rows.length === 0) {
      console.log('  (無表 - 需要執行 Prisma 遷移)');
    } else {
      tablesResult.rows.forEach(row => {
        console.log('  -', row.table_name);
      });
    }

    client.release();
    await pool.end();
    
    console.log('\n✅ 連接測試完成！');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ 資料庫連接失敗！');
    console.error('錯誤訊息:', error.message);
    console.error('錯誤代碼:', error.code);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 可能的原因:');
      console.error('  1. 資料庫服務未運行');
      console.error('  2. 主機名稱或端口不正確');
      console.error('  3. 防火牆阻擋連接');
    } else if (error.code === '28P01') {
      console.error('\n💡 可能的原因:');
      console.error('  1. 用戶名或密碼不正確');
      console.error('  2. 密碼中包含特殊字符，需要 URL 編碼');
      console.error('    例如: @ 應該編碼為 %40');
    } else if (error.code === '3D000') {
      console.error('\n💡 可能的原因:');
      console.error('  資料庫不存在');
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      console.error('\n💡 可能的原因:');
      console.error('  1. 主機名稱無法解析');
      console.error('  2. 網路連接問題');
      console.error('  3. Supabase 專案可能已暫停或刪除');
    }
    
    await pool.end();
    process.exit(1);
  }
}

testConnection();
