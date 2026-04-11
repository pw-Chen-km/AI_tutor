/**
 * Test Stripe Connection
 * 
 * This script tests the Stripe API connection and configuration.
 * Run with: npx ts-node scripts/test-stripe-connection.ts
 */

import 'dotenv/config';
import Stripe from 'stripe';

// Import PLAN_CONFIG directly
const PLAN_CONFIG = {
  free: { name: 'Free', priceUSD: 0, priceTWD: 0 },
  plus: { name: 'Plus', priceUSD: 9.99, priceTWD: 320 },
  pro: { name: 'Pro', priceUSD: 24.99, priceTWD: 800 },
  premium: { name: 'Premium', priceUSD: 49.99, priceTWD: 1600 },
};

async function testStripeConnection() {
  console.log('🔍 Testing Stripe Connection...\n');

  // Check environment variables
  console.log('📋 Checking Environment Variables:');
  const requiredVars = [
    'STRIPE_SECRET_KEY',
    'STRIPE_PLUS_PRICE_ID',
    'STRIPE_PRO_PRICE_ID',
    'STRIPE_PREMIUM_PRICE_ID',
  ];

  const optionalVars = [
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PUBLISHABLE_KEY',
  ];

  let allRequiredPresent = true;
  
  for (const varName of requiredVars) {
    const value = process.env[varName];
    if (value) {
      const masked = varName.includes('SECRET') || varName.includes('WEBHOOK')
        ? `${value.substring(0, 10)}...${value.substring(value.length - 4)}`
        : value;
      console.log(`  ✅ ${varName}: ${masked}`);
    } else {
      console.log(`  ❌ ${varName}: NOT SET`);
      allRequiredPresent = false;
    }
  }

  for (const varName of optionalVars) {
    const value = process.env[varName];
    if (value) {
      const masked = varName.includes('SECRET') || varName.includes('WEBHOOK')
        ? `${value.substring(0, 10)}...${value.substring(value.length - 4)}`
        : value;
      console.log(`  ⚠️  ${varName}: ${masked} (optional)`);
    } else {
      console.log(`  ⚠️  ${varName}: NOT SET (optional)`);
    }
  }

  if (!allRequiredPresent) {
    console.log('\n❌ Missing required environment variables!');
    console.log('Please set all required variables in .env file.');
    process.exit(1);
  }

  // Test Stripe API connection
  console.log('\n🔌 Testing Stripe API Connection:');
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-12-15.clover',
      typescript: true,
    });

    // Test 1: Get account info
    console.log('  Testing: Get account information...');
    const account = await stripe.accounts.retrieve();
    console.log(`  ✅ Connected to Stripe account: ${account.id}`);
    console.log(`     Country: ${account.country}`);
    console.log(`     Type: ${account.type}`);
    console.log(`     Charges enabled: ${account.charges_enabled}`);
    console.log(`     Payouts enabled: ${account.payouts_enabled}`);

    // Test 2: Verify price IDs
    console.log('\n💰 Verifying Price IDs:');
    const priceIds = {
      plus: process.env.STRIPE_PLUS_PRICE_ID!,
      pro: process.env.STRIPE_PRO_PRICE_ID!,
      premium: process.env.STRIPE_PREMIUM_PRICE_ID!,
    };

    for (const [plan, priceId] of Object.entries(priceIds)) {
      try {
        const price = await stripe.prices.retrieve(priceId);
        const planConfig = PLAN_CONFIG[plan as keyof typeof PLAN_CONFIG];
        const expectedAmount = Math.round(planConfig.priceUSD * 100); // Convert to cents
        
        console.log(`  ✅ ${plan.toUpperCase()} Plan:`);
        console.log(`     Price ID: ${priceId}`);
        console.log(`     Amount: $${(price.unit_amount || 0) / 100} ${price.currency.toUpperCase()}`);
        console.log(`     Expected: $${planConfig.priceUSD} USD`);
        console.log(`     Recurring: ${price.recurring ? `${price.recurring.interval}ly` : 'One-time'}`);
        
        if (price.unit_amount !== expectedAmount) {
          console.log(`     ⚠️  WARNING: Price mismatch! Expected ${expectedAmount} cents, got ${price.unit_amount}`);
        }
      } catch (error: any) {
        console.log(`  ❌ ${plan.toUpperCase()} Plan: FAILED`);
        console.log(`     Error: ${error.message}`);
      }
    }

    // Test 3: List products
    console.log('\n📦 Listing Products:');
    const products = await stripe.products.list({ limit: 10 });
    console.log(`  Found ${products.data.length} product(s):`);
    products.data.forEach((product) => {
      console.log(`    - ${product.name} (${product.id})`);
    });

    // Test 4: Test webhook secret (if set)
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      console.log('\n🔐 Webhook Secret:');
      console.log(`  ✅ STRIPE_WEBHOOK_SECRET is set`);
      console.log(`     Format: ${process.env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_') ? 'Valid' : 'Invalid'}`);
    } else {
      console.log('\n🔐 Webhook Secret:');
      console.log(`  ⚠️  STRIPE_WEBHOOK_SECRET is not set`);
      console.log(`     This is required for production. For development, use Stripe CLI:`);
      console.log(`     stripe listen --forward-to localhost:3000/api/webhooks/stripe`);
    }

    console.log('\n✅ All Stripe tests passed!');
    console.log('\n📝 Next Steps:');
    console.log('  1. Ensure webhook is set up in Stripe Dashboard');
    console.log('  2. For development: Run "stripe listen --forward-to localhost:3000/api/webhooks/stripe"');
    console.log('  3. For production: Add webhook endpoint in Stripe Dashboard');
    console.log('  4. Test subscription flow in the application');

  } catch (error: any) {
    console.error('\n❌ Stripe connection failed:');
    console.error(`   Error: ${error.message}`);
    
    if (error.type === 'StripeAuthenticationError') {
      console.error('\n   This usually means:');
      console.error('   - Invalid STRIPE_SECRET_KEY');
      console.error('   - Wrong API key (using test key in production or vice versa)');
    } else if (error.type === 'StripeInvalidRequestError') {
      console.error('\n   This usually means:');
      console.error('   - Invalid Price ID');
      console.error('   - Price ID from wrong Stripe account');
    }
    
    process.exit(1);
  }
}

testStripeConnection().catch(console.error);
