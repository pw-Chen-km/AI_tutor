/**
 * Get Stripe Price IDs
 * 
 * This script retrieves the actual Price IDs from Stripe for each plan.
 * Run with: npx ts-node scripts/get-stripe-price-ids.ts
 */

import 'dotenv/config';
import Stripe from 'stripe';

async function getStripePriceIds() {
  console.log('🔍 Retrieving Stripe Price IDs...\n');

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('❌ STRIPE_SECRET_KEY is not set in .env file');
    process.exit(1);
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-12-15.clover',
      typescript: true,
    });

    // Get all products
    console.log('📦 Fetching products from Stripe...\n');
    const products = await stripe.products.list({ limit: 100 });
    
    // Filter for subscription plans
    const planProducts = products.data.filter(p => 
      p.name.includes('Plus Plan') || 
      p.name.includes('Pro Plan') || 
      p.name.includes('Premium Plan')
    );

    if (planProducts.length === 0) {
      console.log('⚠️  No plan products found. Available products:');
      products.data.forEach(p => {
        console.log(`   - ${p.name} (${p.id})`);
      });
      return;
    }

    console.log('💰 Found Plan Products:\n');
    
    const priceIds: Record<string, string> = {};

    for (const product of planProducts) {
      // Get prices for this product
      const prices = await stripe.prices.list({
        product: product.id,
        limit: 10,
      });

      // Find the recurring monthly price
      const monthlyPrice = prices.data.find(
        p => p.recurring?.interval === 'month' && p.active
      ) || prices.data.find(p => p.active);

      if (monthlyPrice) {
        const planName = product.name.toLowerCase().replace(' plan', '').trim();
        priceIds[planName] = monthlyPrice.id;

        console.log(`✅ ${product.name}:`);
        console.log(`   Product ID: ${product.id}`);
        console.log(`   Price ID: ${monthlyPrice.id}`);
        console.log(`   Amount: $${((monthlyPrice.unit_amount || 0) / 100).toFixed(2)} ${monthlyPrice.currency.toUpperCase()}`);
        console.log(`   Interval: ${monthlyPrice.recurring?.interval || 'one-time'}`);
        console.log('');
      } else {
        console.log(`⚠️  ${product.name}: No active monthly price found`);
        console.log(`   Available prices:`);
        prices.data.forEach(p => {
          console.log(`     - ${p.id} (${p.recurring?.interval || 'one-time'}, ${p.active ? 'active' : 'inactive'})`);
        });
        console.log('');
      }
    }

    // Generate .env format output
    console.log('📝 Add these to your .env file:\n');
    console.log('# Stripe Price IDs');
    if (priceIds.plus) {
      console.log(`STRIPE_PLUS_PRICE_ID=${priceIds.plus}`);
    }
    if (priceIds.pro) {
      console.log(`STRIPE_PRO_PRICE_ID=${priceIds.pro}`);
    }
    if (priceIds.premium) {
      console.log(`STRIPE_PREMIUM_PRICE_ID=${priceIds.premium}`);
    }
    console.log('');

    // Also check for token products
    console.log('🎫 Token Products (for extra tokens purchase):\n');
    const tokenProducts = products.data.filter(p => 
      p.name.includes('tokens') || p.name.includes('Tokens')
    );

    if (tokenProducts.length > 0) {
      for (const product of tokenProducts) {
        const prices = await stripe.prices.list({
          product: product.id,
          limit: 10,
        });
        const activePrice = prices.data.find(p => p.active);
        if (activePrice) {
          console.log(`   ${product.name}:`);
          console.log(`     Price ID: ${activePrice.id}`);
          console.log(`     Amount: $${((activePrice.unit_amount || 0) / 100).toFixed(2)} ${activePrice.currency.toUpperCase()}`);
          console.log('');
        }
      }
    }

  } catch (error: any) {
    console.error('❌ Error retrieving Price IDs:');
    console.error(`   ${error.message}`);
    
    if (error.type === 'StripeAuthenticationError') {
      console.error('\n   This usually means:');
      console.error('   - Invalid STRIPE_SECRET_KEY');
      console.error('   - Wrong API key (using test key in production or vice versa)');
    }
    
    process.exit(1);
  }
}

getStripePriceIds().catch(console.error);
