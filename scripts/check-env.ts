#!/usr/bin/env ts-node

/**
 * 檢查環境變數設定
 * 執行: npx ts-node scripts/check-env.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// 必需的環境變數
const REQUIRED_ENV = [
  'DATABASE_URL',
  'NEXTAUTH_URL',
  'NEXTAUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM',
];

// Stripe 相關 (如果使用 Stripe)
const STRIPE_ENV = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PLUS_PRICE_ID',
  'STRIPE_PRO_PRICE_ID',
  'STRIPE_PREMIUM_PRICE_ID',
];

// PayPal 相關 (可選)
const PAYPAL_ENV = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'PAYPAL_PLUS_PLAN_ID',
  'PAYPAL_PRO_PLAN_ID',
  'PAYPAL_PREMIUM_PLAN_ID',
];

// Line Pay 相關 (可選)
const LINEPAY_ENV = [
  'LINEPAY_CHANNEL_ID',
  'LINEPAY_CHANNEL_SECRET',
];

// 載入 .env 檔案
function loadEnvFile(): Record<string, string> {
  const envPath = path.join(process.cwd(), '.env');
  const env: Record<string, string> = {};
  
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env 檔案不存在！');
    console.log('請建立 .env 檔案並參考 ENV_SETUP.md');
    return env;
  }
  
  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        env[key] = value;
      }
    }
  }
  
  return env;
}

// 檢查環境變數
function checkEnvVars(env: Record<string, string>) {
  console.log('🔍 檢查環境變數設定...\n');
  
  let hasErrors = false;
  let hasWarnings = false;
  
  // 檢查必需的環境變數
  console.log('📋 必需設定 (Required):');
  const missingRequired: string[] = [];
  for (const key of REQUIRED_ENV) {
    const value = env[key];
    if (!value || value === '' || value.includes('your-') || value.includes('xxxxx')) {
      console.log(`  ❌ ${key} - 未設定或使用預設值`);
      missingRequired.push(key);
      hasErrors = true;
    } else {
      // 隱藏敏感資訊，只顯示前後幾位
      const displayValue = key.includes('SECRET') || key.includes('KEY') || key.includes('PASSWORD')
        ? `${value.substring(0, 8)}...${value.substring(value.length - 4)}`
        : value;
      console.log(`  ✅ ${key} = ${displayValue}`);
    }
  }
  
  console.log('\n💳 Stripe 設定 (如果使用 Stripe):');
  const missingStripe: string[] = [];
  for (const key of STRIPE_ENV) {
    const value = env[key];
    if (!value || value === '' || value.includes('your-') || value.includes('xxxxx')) {
      console.log(`  ⚠️  ${key} - 未設定`);
      missingStripe.push(key);
      hasWarnings = true;
    } else {
      const displayValue = key.includes('SECRET') || key.includes('KEY')
        ? `${value.substring(0, 8)}...${value.substring(value.length - 4)}`
        : value;
      console.log(`  ✅ ${key} = ${displayValue}`);
    }
  }
  
  console.log('\n💳 PayPal 設定 (可選):');
  const missingPayPal: string[] = [];
  for (const key of PAYPAL_ENV) {
    const value = env[key];
    if (!value || value === '' || value.includes('your-') || value.includes('xxxxx')) {
      console.log(`  ⚠️  ${key} - 未設定`);
      missingPayPal.push(key);
    } else {
      const displayValue = key.includes('SECRET') || key.includes('KEY')
        ? `${value.substring(0, 8)}...${value.substring(value.length - 4)}`
        : value;
      console.log(`  ✅ ${key} = ${displayValue}`);
    }
  }
  
  console.log('\n💳 Line Pay 設定 (可選):');
  const missingLinePay: string[] = [];
  for (const key of LINEPAY_ENV) {
    const value = env[key];
    if (!value || value === '' || value.includes('your-') || value.includes('xxxxx')) {
      console.log(`  ⚠️  ${key} - 未設定`);
      missingLinePay.push(key);
    } else {
      const displayValue = key.includes('SECRET') || key.includes('KEY')
        ? `${value.substring(0, 8)}...${value.substring(value.length - 4)}`
        : value;
      console.log(`  ✅ ${key} = ${displayValue}`);
    }
  }
  
  // 總結
  console.log('\n' + '='.repeat(50));
  if (hasErrors) {
    console.log('❌ 發現錯誤：缺少必需的環境變數');
    console.log('\n缺少的必需變數:');
    missingRequired.forEach(key => console.log(`  - ${key}`));
    console.log('\n請參考 ENV_SETUP.md 進行設定');
  } else {
    console.log('✅ 所有必需的環境變數已設定');
  }
  
  if (hasWarnings && missingStripe.length > 0) {
    console.log('\n⚠️  警告：Stripe 相關變數未設定');
    console.log('如果不需要使用 Stripe，可以忽略此警告');
  }
  
  if (missingPayPal.length === PAYPAL_ENV.length) {
    console.log('\nℹ️  PayPal 未設定 (可選)');
  }
  
  if (missingLinePay.length === LINEPAY_ENV.length) {
    console.log('\nℹ️  Line Pay 未設定 (可選)');
  }
  
  console.log('\n' + '='.repeat(50));
  
  return !hasErrors;
}

// 主程式
function main() {
  const env = loadEnvFile();
  const isValid = checkEnvVars(env);
  process.exit(isValid ? 0 : 1);
}

main();
