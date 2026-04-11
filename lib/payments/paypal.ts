import { PLAN_CONFIG, type PlanType } from '@/lib/db/schema';

// PayPal API base URL
const PAYPAL_API_BASE = process.env.NODE_ENV === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

// Get access token for PayPal API
async function getPayPalAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured');
  }
  
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  
  if (!response.ok) {
    throw new Error('Failed to get PayPal access token');
  }
  
  const data = await response.json();
  return data.access_token;
}

// Map plan types to PayPal plan IDs
export function getPayPalPlanId(plan: PlanType): string | null {
  const planIds: Record<PlanType, string | null> = {
    free: null,
    plus: process.env.PAYPAL_PLUS_PLAN_ID || null,
    pro: process.env.PAYPAL_PRO_PLAN_ID || null,
    premium: process.env.PAYPAL_PREMIUM_PLAN_ID || null,
  };
  return planIds[plan];
}

// Get plan from PayPal plan ID
export function getPlanFromPayPalId(planId: string): PlanType | null {
  if (planId === process.env.PAYPAL_PLUS_PLAN_ID) return 'plus';
  if (planId === process.env.PAYPAL_PRO_PLAN_ID) return 'pro';
  if (planId === process.env.PAYPAL_PREMIUM_PLAN_ID) return 'premium';
  return null;
}

/**
 * Create a PayPal subscription
 */
export async function createPayPalSubscription({
  userId,
  plan,
  returnUrl,
  cancelUrl,
}: {
  userId: string;
  plan: PlanType;
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ subscriptionId: string; approvalUrl: string }> {
  const planId = getPayPalPlanId(plan);
  
  if (!planId) {
    throw new Error(`No PayPal plan configured for: ${plan}`);
  }
  
  const accessToken = await getPayPalAccessToken();
  
  const response = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      plan_id: planId,
      application_context: {
        brand_name: 'AI Teaching Assistant',
        locale: 'en-US',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
      custom_id: userId,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    console.error('PayPal subscription creation error:', error);
    throw new Error(error.message || 'Failed to create PayPal subscription');
  }
  
  const subscription = await response.json();
  
  // Find the approval URL
  const approvalLink = subscription.links?.find((link: any) => link.rel === 'approve');
  
  if (!approvalLink) {
    throw new Error('No approval URL in PayPal response');
  }
  
  return {
    subscriptionId: subscription.id,
    approvalUrl: approvalLink.href,
  };
}

/**
 * Get PayPal subscription details
 */
export async function getPayPalSubscription(subscriptionId: string): Promise<any> {
  const accessToken = await getPayPalAccessToken();
  
  const response = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions/${subscriptionId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error('Failed to get PayPal subscription');
  }
  
  return response.json();
}

/**
 * Cancel a PayPal subscription
 */
export async function cancelPayPalSubscription(
  subscriptionId: string,
  reason: string = 'User requested cancellation'
): Promise<void> {
  const accessToken = await getPayPalAccessToken();
  
  const response = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason }),
  });
  
  if (!response.ok && response.status !== 204) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to cancel PayPal subscription');
  }
}

/**
 * Activate a PayPal subscription (after user approval)
 */
export async function activatePayPalSubscription(subscriptionId: string): Promise<any> {
  const accessToken = await getPayPalAccessToken();
  
  const response = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions/${subscriptionId}/activate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'User completed approval' }),
  });
  
  if (!response.ok && response.status !== 204) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to activate PayPal subscription');
  }
  
  return getPayPalSubscription(subscriptionId);
}

/**
 * Verify PayPal webhook signature
 */
export async function verifyPayPalWebhook(
  headers: Record<string, string>,
  body: string
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  
  if (!webhookId) {
    console.warn('PayPal webhook ID not configured');
    return false;
  }
  
  const accessToken = await getPayPalAccessToken();
  
  const response = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: JSON.parse(body),
    }),
  });
  
  if (!response.ok) {
    return false;
  }
  
  const data = await response.json();
  return data.verification_status === 'SUCCESS';
}
