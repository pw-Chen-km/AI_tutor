import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import prisma from '@/lib/db/client';
import { createTokenPurchaseSession, createStripeCustomer } from '@/lib/payments/stripe';
import { EXTRA_TOKENS_CONFIG, PLAN_CONFIG, type PlanType } from '@/lib/db/schema';

/**
 * Create a checkout session for purchasing extra tokens
 * POST /api/subscription/purchase-tokens
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const { tokens } = await req.json();
    
    // Validate tokens amount
    if (!tokens || typeof tokens !== 'number' || tokens <= 0) {
      return NextResponse.json({ error: 'Invalid tokens amount' }, { status: 400 });
    }
    
    // Validate tokens is one of the predefined options
    const validOptions = EXTRA_TOKENS_CONFIG.options.map(opt => opt.tokens);
    if (!validOptions.includes(tokens)) {
      return NextResponse.json(
        { error: `Invalid tokens amount. Valid options: ${validOptions.join(', ')}` },
        { status: 400 }
      );
    }
    
    // Get user's current subscription to determine discount
    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
    });
    
    const plan = (subscription?.plan || 'free') as PlanType;
    
    // Calculate price with quantity-based discount
    const { priceUSD, discount, originalPrice } = EXTRA_TOKENS_CONFIG.calculatePrice(tokens);
    
    // Get or create Stripe customer
    let customerId = subscription?.stripeCustomerId;
    
    if (!customerId) {
      customerId = await createStripeCustomer(session.user.email, session.user.name || undefined);
      
      if (subscription) {
        await prisma.subscription.update({
          where: { userId: session.user.id },
          data: { stripeCustomerId: customerId },
        });
      }
    }
    
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    
    // Create checkout session
    const checkoutUrl = await createTokenPurchaseSession({
      userId: session.user.id,
      email: session.user.email,
      tokens,
      amountUSD: priceUSD,
      customerId,
      successUrl: `${baseUrl}/billing?success=tokens&tokens=${tokens}`,
      cancelUrl: `${baseUrl}/billing?cancelled=tokens`,
    });
    
    return NextResponse.json({
      url: checkoutUrl,
      price: {
        usd: priceUSD,
      },
      discount,
      originalPrice,
      tokens,
    });
  } catch (error: any) {
    console.error('Purchase tokens API error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create purchase session' },
      { status: 500 }
    );
  }
}
