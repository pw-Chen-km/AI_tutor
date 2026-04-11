# Stripe 訂閱功能設置指南

## ✅ 當前狀態

根據測試結果：
- ✅ Stripe SDK 已安裝 (`stripe@20.2.0`)
- ✅ Stripe API 連接成功
- ✅ 已找到產品：Plus Plan, Pro Plan, Premium Plan
- ⚠️ **需要更新 Price ID**：目前使用的是佔位符，需要在 Stripe Dashboard 中獲取實際的 Price ID

---

## 📋 第一步：在 Stripe Dashboard 中獲取 Price ID

### 1.1 登入 Stripe Dashboard

1. 前往 [Stripe Dashboard](https://dashboard.stripe.com)
2. 確保切換到 **Test mode**（測試模式）

### 1.2 獲取每個方案的 Price ID

測試腳本顯示您已經有這些產品：
- ✅ Plus Plan (prod_TpgSgjDGF8uxeJ)
- ✅ Pro Plan (prod_TpgT33ftT3ltXW)
- ✅ Premium Plan (prod_TpgU19yES7hPhy)

**獲取 Price ID 的步驟：**

1. 在 Stripe Dashboard 中，前往 **Products**
2. 點擊 **Plus Plan** 產品
3. 在產品詳情頁面，找到 **Pricing** 區塊
4. 複製 **Price ID**（格式：`price_xxxxxxxxxxxxxxxxxxxxx`）
5. 重複步驟 2-4 獲取 Pro 和 Premium 的 Price ID

**或者：**

1. 前往 **Products** → 點擊產品名稱
2. 在右側面板找到 **Pricing** 區塊
3. 點擊價格旁邊的 **⋯** 選單 → **View API ID**
4. 複製 Price ID

---

## 🔧 第二步：更新環境變數

### 2.1 更新 `.env` 文件

打開專案根目錄的 `.env` 文件，更新以下變數：

```env
# Stripe API Keys (從 Stripe Dashboard → Developers → API keys 取得)
STRIPE_SECRET_KEY=sk_test_<從_Stripe_Dashboard_複製>
STRIPE_PUBLISHABLE_KEY=pk_test_<從_Stripe_Dashboard_複製>

# Stripe Price IDs (從 Stripe Dashboard → Products 取得)
STRIPE_PLUS_PRICE_ID=price_xxxxxxxxxxxxxxxxxxxxx    # ← 替換為實際的 Plus Plan Price ID
STRIPE_PRO_PRICE_ID=price_xxxxxxxxxxxxxxxxxxxxx      # ← 替換為實際的 Pro Plan Price ID
STRIPE_PREMIUM_PRICE_ID=price_xxxxxxxxxxxxxxxxxxxxx  # ← 替換為實際的 Premium Plan Price ID

# Stripe Webhook Secret (開發環境使用 Stripe CLI，見下方說明)
STRIPE_WEBHOOK_SECRET=whsec_xxxx...xxxx
```

### 2.2 驗證設置

更新 `.env` 後，運行測試腳本驗證：

```bash
npm run test:stripe
```

應該看到所有 Price ID 驗證成功 ✅

---

## 🔗 第三步：設置 Webhook

### 3.1 開發環境（本地測試）

使用 Stripe CLI 轉發 webhook 到本地開發伺服器：

```bash
# 安裝 Stripe CLI (如果還沒安裝)
# Windows: 下載 https://github.com/stripe/stripe-cli/releases
# 或使用: scoop install stripe

# 登入 Stripe
stripe login

# 轉發 webhook 到本地伺服器
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

**重要：** 運行上述命令後，會顯示一個新的 `whsec_...` secret，**複製這個 secret 並更新到 `.env` 文件的 `STRIPE_WEBHOOK_SECRET`**。

### 3.2 生產環境（Vercel 部署後）

1. 部署應用到 Vercel 後，取得生產環境 URL（例如：`https://your-app.vercel.app`）

2. 在 Stripe Dashboard：
   - 前往 **Developers** → **Webhooks**
   - 點擊 **Add endpoint**
   - **Endpoint URL**: `https://your-app.vercel.app/api/webhooks/stripe`
   - **Events to send**: 選擇以下事件：
     - `checkout.session.completed`
     - `invoice.paid`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
   - 點擊 **Add endpoint**
   - 複製 **Signing secret**（`whsec_...`）→ 這是生產環境的 `STRIPE_WEBHOOK_SECRET`

3. 在 Vercel Dashboard 中更新環境變數：
   - 前往專案 → **Settings** → **Environment Variables**
   - 更新 `STRIPE_WEBHOOK_SECRET` 為生產環境的 webhook secret

---

## 🚀 第四步：部署到 Vercel

### 4.1 準備部署

確保以下文件已提交到 Git：
- ✅ `lib/payments/stripe.ts`
- ✅ `app/api/subscription/checkout/route.ts`
- ✅ `app/api/webhooks/stripe/route.ts`
- ✅ `app/api/subscription/portal/route.ts`
- ✅ `.env` 文件**不要**提交（已在 `.gitignore` 中）

### 4.2 設置 Vercel 環境變數

在 Vercel Dashboard 中設置所有環境變數：

**必需變數：**
```
DATABASE_URL=postgresql://...
NEXTAUTH_URL=https://your-app.vercel.app
NEXTAUTH_SECRET=your-secret-key
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
RESEND_API_KEY=...
EMAIL_FROM=...
```

**Stripe 變數（測試環境）：**
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_... (從 Stripe CLI 或 Dashboard 取得)
STRIPE_PLUS_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_PREMIUM_PRICE_ID=price_...
```

### 4.3 部署

```bash
# 使用 Vercel CLI
npm i -g vercel
vercel login
vercel --prod

# 或使用 GitHub 集成
# 1. 推送代碼到 GitHub
# 2. 在 Vercel Dashboard 連接 repository
# 3. 設置環境變數
# 4. 點擊 Deploy
```

---

## 🧪 第五步：測試訂閱流程

### 5.1 本地測試

1. **啟動開發伺服器：**
   ```bash
   npm run dev
   ```

2. **在另一個終端啟動 Stripe Webhook 轉發：**
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```

3. **測試訂閱：**
   - 登入應用
   - 前往 `/billing`
   - 選擇方案（Plus/Pro/Premium）
   - 點擊 **Upgrade**
   - 使用 Stripe 測試卡：
     - **卡號**: `4242 4242 4242 4242`
     - **到期日**: 任何未來日期（例如：12/25）
     - **CVC**: 任何 3 位數（例如：123）
     - **郵編**: 任何 5 位數（例如：12345）
   - 完成付款
   - 檢查 webhook 終端是否收到事件
   - 檢查資料庫中的 `Subscription` 和 `PaymentRecord` 記錄

### 5.2 驗證資料庫記錄

使用 Prisma Studio 檢查：

```bash
npm run db:studio
```

檢查：
- ✅ `Subscription` 表中有新記錄
- ✅ `plan` 欄位正確
- ✅ `status` 為 `active`
- ✅ `stripeCustomerId` 和 `stripeSubscriptionId` 已設置
- ✅ `PaymentRecord` 表中有付款記錄

---

## 🔄 切換到生產環境

### 6.1 在 Stripe 中切換到 Live Mode

1. Stripe Dashboard → 切換到 **Live mode**
2. 創建生產環境的產品和價格（與測試環境相同）
3. 取得 Live API keys：
   - `sk_live_...`
   - `pk_live_...`
4. 設置生產環境 Webhook（見第三步）
5. 更新 Vercel 環境變數為 Live keys

### 6.2 更新 Vercel 環境變數

在 Vercel Dashboard 中：
- 將 `STRIPE_SECRET_KEY` 更新為 `sk_live_...`
- 將 `STRIPE_PUBLISHABLE_KEY` 更新為 `pk_live_...`
- 將 `STRIPE_WEBHOOK_SECRET` 更新為生產環境的 webhook secret
- 將所有 `STRIPE_*_PRICE_ID` 更新為生產環境的 Price ID

---

## 📝 檢查清單

### 開發環境
- [ ] Stripe 產品和價格已創建
- [ ] 已取得所有 Price ID
- [ ] `.env` 文件已更新所有 Stripe 變數
- [ ] `npm run test:stripe` 測試通過
- [ ] Stripe CLI webhook 轉發已設置
- [ ] 本地測試訂閱流程成功

### 生產環境
- [ ] 應用已部署到 Vercel
- [ ] Vercel 環境變數已設置
- [ ] Stripe Webhook endpoint 已設置
- [ ] 生產環境 Price ID 已更新
- [ ] Live mode API keys 已設置
- [ ] 生產環境訂閱流程測試成功

---

## 🆘 常見問題

### Q: Price ID 驗證失敗
**A:** 確保：
- Price ID 是從正確的 Stripe 帳號取得
- 測試環境使用 test Price ID，生產環境使用 live Price ID
- Price ID 格式正確（`price_...`）

### Q: Webhook 沒有收到事件
**A:** 檢查：
- Webhook URL 是否正確
- Stripe CLI 是否正在運行（開發環境）
- Webhook secret 是否正確
- 檢查 Stripe Dashboard → Webhooks → 查看事件日誌

### Q: 訂閱創建但資料庫沒有記錄
**A:** 檢查：
- Webhook 是否正確設置
- Webhook handler 是否有錯誤（查看 Vercel logs）
- 資料庫連接是否正常

---

## 🔗 快速連結

- **Stripe Dashboard**: https://dashboard.stripe.com
- **Stripe API 文件**: https://stripe.com/docs/api
- **Stripe CLI 下載**: https://github.com/stripe/stripe-cli/releases
- **Vercel Dashboard**: https://vercel.com/dashboard

---

**最後更新**: 2025-01-XX
