// Re-export Prisma types for convenience
export type {
  User,
  Account,
  Session,
  VerificationToken,
  Subscription,
  UsageLog,
  PaymentRecord,
} from '@prisma/client';

export {
  SubscriptionPlan,
  SubscriptionStatus,
} from '@prisma/client';

// Plan configuration with token limits and pricing
export const PLAN_CONFIG = {
  free: {
    name: 'Free',
    priceUSD: 0,
    priceTWD: 0,
    tokensLimit: 50_000, // 50K tokens
    exportLimit: 2, // 2 exports per month
    features: {
      modules: ['drills', 'lecture_rehearsal'], // Basic modules only
      prioritySupport: false,
      customModel: true, // All plans have custom model access
      webSearch: false,
      generationHistory: false,
      generationHistoryLimit: 0,
    },
    stripePriceId: null, // No payment needed
  },
  plus: {
    name: 'Plus',
    priceUSD: 9.99,
    priceTWD: 320,
    tokensLimit: 500_000, // 500K tokens
    exportLimit: 10, // 10 exports per month
    features: {
      modules: ['drills', 'homework', 'lecture_rehearsal'], // Plus modules
      prioritySupport: false,
      customModel: true, // All plans have custom model access
      webSearch: false,
      generationHistory: false,
      generationHistoryLimit: 0,
    },
    stripePriceId: process.env.STRIPE_PLUS_PRICE_ID || null,
  },
  pro: {
    name: 'Pro',
    priceUSD: 24.99,
    priceTWD: 800,
    tokensLimit: 2_000_000, // 2M tokens
    exportLimit: 50, // 50 exports per month
    features: {
      modules: ['drills', 'labs', 'homework', 'exams', 'lecture_rehearsal'], // Pro modules
      prioritySupport: true,
      customModel: true, // All plans have custom model access
      webSearch: true,
      generationHistory: false,
      generationHistoryLimit: 0,
    },
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID || null,
  },
  premium: {
    name: 'Premium',
    priceUSD: 49.99,
    priceTWD: 1600,
    tokensLimit: 10_000_000, // 10M tokens
    exportLimit: null, // Unlimited exports
    features: {
      modules: ['drills', 'labs', 'homework', 'exams', 'lecture_rehearsal', 'exam_evaluation'], // All modules
      prioritySupport: true,
      customModel: true, // All plans have custom model access
      webSearch: true,
      generationHistory: true, // Premium feature: save up to 50 generated files
      generationHistoryLimit: 50,
    },
    stripePriceId: process.env.STRIPE_PREMIUM_PRICE_ID || null,
  },
} as const;

// Auto top-up configuration
export const AUTO_TOPUP_CONFIG = {
  // Default top-up options
  options: [
    { tokens: 100_000, priceUSD: 5.00, priceTWD: 160 },
    { tokens: 500_000, priceUSD: 20.00, priceTWD: 640 },
    { tokens: 1_000_000, priceUSD: 35.00, priceTWD: 1120 },
  ],
  // Default values when quota runs out
  defaultTokens: 500_000,
  defaultPriceUSD: 20.00,
};

export type PlanType = keyof typeof PLAN_CONFIG;

// Overage pricing: $0.005 per 1K tokens
export const OVERAGE_RATE_PER_1K_TOKENS = 0.005;

// Extra tokens purchase configuration (one-time purchase)
// Prices are discounted based on purchase quantity (bulk discounts)
export const EXTRA_TOKENS_CONFIG = {
  // Base pricing per 1K tokens (before quantity discounts)
  basePricePer1K: 0.05, // $0.05 per 1K tokens (base price)
  
  // Quantity-based discounts (the more you buy, the more you save)
  // Discounts are applied as: price = basePrice * discountRate
  // So 0.8 means 80% of original price (20% off), 0.7 means 70% of original price (30% off), etc.
  quantityDiscounts: {
    100_000: 0.80,   // 100K: 打8折 (20% off)
    500_000: 0.70,   // 500K: 打7折 (30% off)
    1_000_000: 0.60, // 1M: 打6折 (40% off)
    2_000_000: 0.50, // 2M: 打5折 (50% off)
  },
  
  // Predefined purchase options
  options: [
    { tokens: 100_000, label: '100K tokens' },
    { tokens: 500_000, label: '500K tokens' },
    { tokens: 1_000_000, label: '1M tokens' },
    { tokens: 2_000_000, label: '2M tokens' },
  ],
  
  // Calculate price based on token amount (quantity-based discount only)
  // discountRate: 0.8 = 打8折 (20% off), 0.7 = 打7折 (30% off), etc.
  calculatePrice(tokens: number): { priceUSD: number; discount: number; originalPrice: number } {
    const discountRate = this.quantityDiscounts[tokens as keyof typeof this.quantityDiscounts] || 1.0;
    const basePrice = (tokens / 1000) * this.basePricePer1K;
    const originalPrice = basePrice;
    const priceUSD = basePrice * discountRate; // Apply discount rate (打X折)
    const discountPercent = (1 - discountRate) * 100; // Calculate discount percentage for display
    
    return {
      priceUSD: Math.round(priceUSD * 100) / 100, // Round to 2 decimals
      discount: Math.round(discountPercent * 10) / 10, // Round to 1 decimal
      originalPrice: Math.round(originalPrice * 100) / 100,
    };
  },
};
