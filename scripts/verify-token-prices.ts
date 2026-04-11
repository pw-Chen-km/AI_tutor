#!/usr/bin/env ts-node

/**
 * 驗證額外代幣價格 ID
 * 執行: npx ts-node scripts/verify-token-prices.ts
 */

import 'dotenv/config';
import Stripe from 'stripe';

// 預期的代幣數量和折扣價格
const EXPECTED_PRICES = {
  100_000: { base: 5.00, discounted: 4.00 }, // 100K: $5.00 base, $4.00 with 20% off
  500_000: { base: 25.00, discounted: 17.50 }, // 500K: $25.00 base, $17.50 with 30% off
  1_000_000: { base: 50.00, discounted: 30.00 }, // 1M: $50.00 base, $30.00 with 40% off
  2_000_000: { base: 100.00, discounted: 50.00 }, // 2M: $100.00 base, $50.00 with 50% off
};

async function verifyTokenPrices() {
  console.log('🔍 驗證額外代幣價格 ID...\n');

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('❌ STRIPE_SECRET_KEY 未設定');
    process.exit(1);
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-12-15.clover',
    typescript: true,
  });

  const tokenPriceIds = {
    100_000: process.env.STRIPE_100ktokens_PRICE_ID,
    500_000: process.env.STRIPE_500ktokens_PRICE_ID,
    1_000_000: process.env.STRIPE_1mtokens_PRICE_ID,
    2_000_000: process.env.STRIPE_2mtokens_PRICE_ID,
  };

  console.log('📋 檢查環境變數:\n');
  let allPresent = true;
  for (const [tokens, priceId] of Object.entries(tokenPriceIds)) {
    if (priceId) {
      console.log(`  ✅ STRIPE_${tokens === '100_000' ? '100k' : tokens === '500_000' ? '500k' : tokens === '1_000_000' ? '1m' : '2m'}tokens_PRICE_ID = ${priceId}`);
    } else {
      console.log(`  ❌ STRIPE_${tokens === '100_000' ? '100k' : tokens === '500_000' ? '500k' : tokens === '1_000_000' ? '1m' : '2m'}tokens_PRICE_ID - 未設定`);
      allPresent = false;
    }
  }

  if (!allPresent) {
    console.log('\n⚠️  部分價格 ID 未設定');
    return;
  }

  console.log('\n💰 驗證 Stripe 價格 ID:\n');
  let allValid = true;

  for (const [tokensStr, priceId] of Object.entries(tokenPriceIds)) {
    const tokens = parseInt(tokensStr);
    const expected = EXPECTED_PRICES[tokens as keyof typeof EXPECTED_PRICES];
    
    try {
      const price = await stripe.prices.retrieve(priceId!);
      
      const amountUSD = (price.unit_amount || 0) / 100;
      const isOneTime = !price.recurring;
      const isActive = price.active;
      
      console.log(`📦 ${(tokens / 1000).toLocaleString()}K tokens:`);
      console.log(`   Price ID: ${price.id}`);
      console.log(`   金額: $${amountUSD.toFixed(2)} ${price.currency.toUpperCase()}`);
      console.log(`   類型: ${isOneTime ? '一次性付款' : '訂閱'}`);
      console.log(`   狀態: ${isActive ? '✅ 啟用' : '❌ 停用'}`);
      
      // 檢查是否為一次性付款
      if (!isOneTime) {
        console.log(`   ⚠️  警告: 此價格是訂閱類型，但代幣購買應該是一次性付款`);
        allValid = false;
      }
      
      // 檢查是否啟用
      if (!isActive) {
        console.log(`   ⚠️  警告: 此價格已停用`);
        allValid = false;
      }
      
      // 檢查價格是否接近預期（允許 ±$0.50 的誤差）
      const expectedPrice = expected.discounted;
      if (Math.abs(amountUSD - expectedPrice) > 0.50) {
        console.log(`   ⚠️  警告: 價格 $${amountUSD.toFixed(2)} 與預期折扣價 $${expectedPrice.toFixed(2)} 差異較大`);
        console.log(`   預期折扣價: $${expectedPrice.toFixed(2)} (原價 $${expected.base.toFixed(2)} 打${tokens === 100_000 ? '8' : tokens === 500_000 ? '7' : tokens === 1_000_000 ? '6' : '5'}折)`);
      } else {
        console.log(`   ✅ 價格符合預期`);
      }
      
      // 檢查產品資訊
      if (price.product) {
        const product = typeof price.product === 'string' 
          ? await stripe.products.retrieve(price.product)
          : price.product;
        if (product && 'name' in product) {
          console.log(`   產品: ${product.name} (${product.id})`);
        }
      }
      
      console.log('');
      
    } catch (error: any) {
      console.log(`❌ ${(tokens / 1000).toLocaleString()}K tokens:`);
      console.log(`   Price ID: ${priceId}`);
      console.log(`   錯誤: ${error.message}`);
      console.log('');
      allValid = false;
    }
  }

  console.log('='.repeat(50));
  if (allValid) {
    console.log('✅ 所有價格 ID 驗證通過！');
    console.log('\n📝 下一步:');
    console.log('   1. 確認代碼中是否使用這些價格 ID');
    console.log('   2. 測試代幣購買流程');
    console.log('   3. 確認 Webhook 能正確處理代幣購買事件');
  } else {
    console.log('⚠️  發現問題，請檢查上述警告');
  }
  console.log('='.repeat(50));
}

verifyTokenPrices().catch(console.error);
