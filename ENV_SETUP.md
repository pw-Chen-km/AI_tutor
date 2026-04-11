# 環境變數設定指南

請在專案根目錄建立 `.env` 檔案，並填入以下環境變數。

## 🔴 必需設定 (Required)

### 資料庫設定
```env
# PostgreSQL 連接字串 (Supabase 或其他 PostgreSQL 服務)
# 格式: postgresql://user:password@host:port/database?sslmode=require
DATABASE_URL="postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres"
```

### NextAuth.js 認證設定
```env
# 應用程式基本 URL
# 開發環境: http://localhost:3000
# 生產環境: https://yourdomain.com
NEXTAUTH_URL="http://localhost:3000"

# NextAuth 加密密鑰 (至少 32 個字元)
# 生成方式: openssl rand -base64 32
# 或訪問: https://generate-secret.vercel.app/32
NEXTAUTH_SECRET="your-secret-key-here-minimum-32-characters-long"
```

### Google OAuth (Google 登入)
```env
# 取得方式: https://console.cloud.google.com/apis/credentials
# 1. 建立 OAuth 2.0 客戶端 ID
# 2. 設定授權的重新導向 URI: http://localhost:3000/api/auth/callback/google
GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
```

### Email 服務 (Resend)
```env
# 取得方式: https://resend.com/api-keys
RESEND_API_KEY="re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Email 發送者地址 (必須是 Resend 中驗證過的網域)
EMAIL_FROM="AI Teaching Assistant <noreply@yourdomain.com>"
```

## 🟡 Stripe 支付設定 (如果使用 Stripe)

```env
# Stripe API 密鑰
# 取得方式: https://dashboard.stripe.com/apikeys
# 測試環境使用 test keys，生產環境使用 live keys
STRIPE_SECRET_KEY="（於 Stripe Dashboard 貼上 sk_test_…）"
STRIPE_PUBLISHABLE_KEY="（於 Stripe Dashboard 貼上 pk_test_…）"

# Stripe Webhook 密鑰
# 取得方式: Stripe Dashboard > Developers > Webhooks > 選擇 webhook > Signing secret
# Webhook URL: https://yourdomain.com/api/webhooks/stripe
# 需要監聽的事件: checkout.session.completed, invoice.paid, customer.subscription.updated, customer.subscription.deleted
STRIPE_WEBHOOK_SECRET="whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Stripe 訂閱價格 ID
# 取得方式: Stripe Dashboard > Products > 建立產品 > 複製 Price ID
STRIPE_PLUS_PRICE_ID="price_xxxxxxxxxxxxxxxxxxxxx"
STRIPE_PRO_PRICE_ID="price_xxxxxxxxxxxxxxxxxxxxx"
STRIPE_PREMIUM_PRICE_ID="price_xxxxxxxxxxxxxxxxxxxxx"
```

## 🟢 PayPal 支付設定 (可選)

```env
# PayPal API 憑證
# 取得方式: https://developer.paypal.com/dashboard/applications/sandbox
PAYPAL_CLIENT_ID="your-paypal-client-id"
PAYPAL_CLIENT_SECRET="your-paypal-client-secret"

# PayPal Webhook ID
# 取得方式: PayPal Dashboard > My Apps & Credentials > Webhooks
# Webhook URL: https://yourdomain.com/api/webhooks/paypal
PAYPAL_WEBHOOK_ID="your-paypal-webhook-id"

# PayPal 訂閱方案 ID
# 取得方式: PayPal Dashboard > Products > 建立訂閱產品 > 複製 Plan ID
PAYPAL_PLUS_PLAN_ID="P-xxxxxxxxxxxxxxxxxxxxx"
PAYPAL_PRO_PLAN_ID="P-xxxxxxxxxxxxxxxxxxxxx"
PAYPAL_PREMIUM_PLAN_ID="P-xxxxxxxxxxxxxxxxxxxxx"
```

## 🔵 Line Pay 支付設定 (可選)

```env
# Line Pay Channel 憑證
# 取得方式: https://pay.line.me/documents/online_v3_zh_TW.html
# 需要申請 Line Pay 商家帳號
LINEPAY_CHANNEL_ID="your-linepay-channel-id"
LINEPAY_CHANNEL_SECRET="your-linepay-channel-secret"
```

## 📋 完整 .env 範例

複製以下內容到 `.env` 檔案：

```env
# ============================================
# 🔴 必需設定
# ============================================
DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here-minimum-32-characters-long"
GOOGLE_CLIENT_ID="your-google-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
RESEND_API_KEY="re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
EMAIL_FROM="AI Teaching Assistant <noreply@yourdomain.com>"

# ============================================
# 🟡 Stripe (如果使用)
# ============================================
STRIPE_SECRET_KEY="（於 Stripe Dashboard 貼上 sk_test_…）"
STRIPE_PUBLISHABLE_KEY="（於 Stripe Dashboard 貼上 pk_test_…）"
STRIPE_WEBHOOK_SECRET="whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
STRIPE_PLUS_PRICE_ID="price_xxxxxxxxxxxxxxxxxxxxx"
STRIPE_PRO_PRICE_ID="price_xxxxxxxxxxxxxxxxxxxxx"
STRIPE_PREMIUM_PRICE_ID="price_xxxxxxxxxxxxxxxxxxxxx"

# ============================================
# 🟢 PayPal (可選)
# ============================================
PAYPAL_CLIENT_ID="your-paypal-client-id"
PAYPAL_CLIENT_SECRET="your-paypal-client-secret"
PAYPAL_WEBHOOK_ID="your-paypal-webhook-id"
PAYPAL_PLUS_PLAN_ID="P-xxxxxxxxxxxxxxxxxxxxx"
PAYPAL_PRO_PLAN_ID="P-xxxxxxxxxxxxxxxxxxxxx"
PAYPAL_PREMIUM_PLAN_ID="P-xxxxxxxxxxxxxxxxxxxxx"

# ============================================
# 🔵 Line Pay (可選)
# ============================================
LINEPAY_CHANNEL_ID="your-linepay-channel-id"
LINEPAY_CHANNEL_SECRET="your-linepay-channel-secret"
```

## ✅ 檢查清單

### 最低需求 (基本功能)
- [ ] `DATABASE_URL` - 資料庫連接
- [ ] `NEXTAUTH_URL` - 應用程式 URL
- [ ] `NEXTAUTH_SECRET` - NextAuth 密鑰
- [ ] `GOOGLE_CLIENT_ID` - Google OAuth (如果使用 Google 登入)
- [ ] `GOOGLE_CLIENT_SECRET` - Google OAuth
- [ ] `RESEND_API_KEY` - Email 服務 (如果使用 Email 註冊)
- [ ] `EMAIL_FROM` - Email 發送者

### Stripe 支付 (如果使用)
- [ ] `STRIPE_SECRET_KEY` - Stripe API 密鑰
- [ ] `STRIPE_WEBHOOK_SECRET` - Webhook 驗證密鑰
- [ ] `STRIPE_PLUS_PRICE_ID` - Plus 方案價格 ID
- [ ] `STRIPE_PRO_PRICE_ID` - Pro 方案價格 ID
- [ ] `STRIPE_PREMIUM_PRICE_ID` - Premium 方案價格 ID

### PayPal 支付 (可選)
- [ ] `PAYPAL_CLIENT_ID` - PayPal 客戶端 ID
- [ ] `PAYPAL_CLIENT_SECRET` - PayPal 客戶端密鑰
- [ ] `PAYPAL_WEBHOOK_ID` - PayPal Webhook ID
- [ ] `PAYPAL_PLUS_PLAN_ID` - Plus 方案 ID
- [ ] `PAYPAL_PRO_PLAN_ID` - Pro 方案 ID
- [ ] `PAYPAL_PREMIUM_PLAN_ID` - Premium 方案 ID

### Line Pay 支付 (可選)
- [ ] `LINEPAY_CHANNEL_ID` - Line Pay Channel ID
- [ ] `LINEPAY_CHANNEL_SECRET` - Line Pay Channel Secret

## 🔗 快速連結

- **Supabase (免費 PostgreSQL)**: https://supabase.com
- **Google Cloud Console**: https://console.cloud.google.com
- **Resend (Email 服務)**: https://resend.com
- **Stripe Dashboard**: https://dashboard.stripe.com
- **PayPal Developer**: https://developer.paypal.com
- **Line Pay 文件**: https://pay.line.me/documents

## ⚠️ 安全注意事項

1. **永遠不要將 `.env` 檔案提交到 Git**
2. 確保 `.env` 在 `.gitignore` 中 (已包含)
3. 生產環境使用環境變數管理服務 (如 Vercel, Railway 等)
4. 定期輪換 API 密鑰和密碼
5. 使用不同的密鑰用於開發和生產環境
