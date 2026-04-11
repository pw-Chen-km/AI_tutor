import crypto from 'crypto';
import { PLAN_CONFIG, type PlanType } from '@/lib/db/schema';

// Line Pay API base URLs
const LINEPAY_API_BASE = process.env.NODE_ENV === 'production'
  ? 'https://api-pay.line.me'
  : 'https://sandbox-api-pay.line.me';

interface LinePayRequestOptions {
  amount: number;
  currency: string;
  orderId: string;
  packages: {
    id: string;
    amount: number;
    name: string;
    products: {
      id: string;
      name: string;
      quantity: number;
      price: number;
    }[];
  }[];
  redirectUrls: {
    confirmUrl: string;
    cancelUrl: string;
  };
}

/**
 * Generate Line Pay signature
 */
function generateLinePaySignature(
  channelSecret: string,
  requestUri: string,
  requestBody: string,
  nonce: string
): string {
  const message = channelSecret + requestUri + requestBody + nonce;
  return crypto
    .createHmac('sha256', channelSecret)
    .update(message)
    .digest('base64');
}

/**
 * Make Line Pay API request
 */
async function linePayRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: any
): Promise<any> {
  const channelId = process.env.LINEPAY_CHANNEL_ID;
  const channelSecret = process.env.LINEPAY_CHANNEL_SECRET;
  
  if (!channelId || !channelSecret) {
    throw new Error('Line Pay credentials not configured');
  }
  
  const nonce = crypto.randomUUID();
  const requestBody = body ? JSON.stringify(body) : '';
  const signature = generateLinePaySignature(channelSecret, path, requestBody, nonce);
  
  const response = await fetch(`${LINEPAY_API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-LINE-ChannelId': channelId,
      'X-LINE-Authorization-Nonce': nonce,
      'X-LINE-Authorization': signature,
    },
    body: method === 'POST' ? requestBody : undefined,
  });
  
  const data = await response.json();
  
  if (data.returnCode !== '0000') {
    throw new Error(data.returnMessage || 'Line Pay API error');
  }
  
  return data;
}

/**
 * Create a Line Pay payment request
 */
export async function createLinePayRequest({
  userId,
  plan,
  confirmUrl,
  cancelUrl,
}: {
  userId: string;
  plan: PlanType;
  confirmUrl: string;
  cancelUrl: string;
}): Promise<{ transactionId: string; paymentUrl: string }> {
  const planConfig = PLAN_CONFIG[plan];
  
  if (!planConfig || planConfig.priceUSD === 0) {
    throw new Error(`Invalid plan for Line Pay: ${plan}`);
  }
  
  // Convert USD to TWD (approximate)
  const amount = planConfig.priceTWD || Math.round(planConfig.priceUSD * 32);
  const orderId = `${userId}-${plan}-${Date.now()}`;
  
  const requestBody: LinePayRequestOptions = {
    amount,
    currency: 'TWD',
    orderId,
    packages: [
      {
        id: `pkg-${plan}`,
        amount,
        name: `AI Teaching Assistant - ${planConfig.name}`,
        products: [
          {
            id: plan,
            name: `${planConfig.name} Plan (Monthly)`,
            quantity: 1,
            price: amount,
          },
        ],
      },
    ],
    redirectUrls: {
      confirmUrl: `${confirmUrl}?orderId=${orderId}&plan=${plan}&userId=${userId}`,
      cancelUrl,
    },
  };
  
  const response = await linePayRequest('POST', '/v3/payments/request', requestBody);
  
  return {
    transactionId: response.info.transactionId.toString(),
    paymentUrl: response.info.paymentUrl.web,
  };
}

/**
 * Confirm a Line Pay payment
 */
export async function confirmLinePayPayment({
  transactionId,
  amount,
  currency = 'TWD',
}: {
  transactionId: string;
  amount: number;
  currency?: string;
}): Promise<any> {
  const response = await linePayRequest(
    'POST',
    `/v3/payments/requests/${transactionId}/confirm`,
    { amount, currency }
  );
  
  return response.info;
}

/**
 * Refund a Line Pay payment
 */
export async function refundLinePayPayment({
  transactionId,
  refundAmount,
}: {
  transactionId: string;
  refundAmount?: number;
}): Promise<any> {
  const response = await linePayRequest(
    'POST',
    `/v3/payments/${transactionId}/refund`,
    refundAmount ? { refundAmount } : {}
  );
  
  return response.info;
}

/**
 * Get Line Pay payment details
 */
export async function getLinePayPaymentDetails(transactionId: string): Promise<any> {
  const response = await linePayRequest(
    'GET',
    `/v3/payments/requests/${transactionId}/check`
  );
  
  return response.info;
}
