# Google Sign In 設定完成檢查清單

## ✅ 已完成的步驟

### 1. 資料庫設定
- ✅ 資料庫連接成功
- ✅ 所有表已創建：
  - `users` - 用戶表
  - `accounts` - OAuth 帳戶表
  - `sessions` - 會話表
  - `verification_tokens` - 驗證令牌表
  - `subscriptions` - 訂閱表
  - `usage_logs` - 使用記錄表
  - `payment_records` - 支付記錄表

### 2. Prisma 設定
- ✅ Prisma Client 已生成
- ✅ 資料庫結構已同步

### 3. 環境變數設定
- ✅ `DATABASE_URL` - 已設定（使用 Pooler）
- ✅ `GOOGLE_CLIENT_ID` - 已設定
- ✅ `GOOGLE_CLIENT_SECRET` - 已設定
- ✅ `NEXTAUTH_URL` - 已設定
- ✅ `NEXTAUTH_SECRET` - 已設定

## 🔍 最後檢查項目

### 1. Google Cloud Console 設定

請確認以下設定：

1. **登入 Google Cloud Console**
   ```
   https://console.cloud.google.com/apis/credentials
   ```

2. **檢查 OAuth 2.0 客戶端 ID**
   - 確認客戶端 ID 與 `.env` 中的 `GOOGLE_CLIENT_ID` 一致
   - 確認客戶端密鑰與 `.env` 中的 `GOOGLE_CLIENT_SECRET` 一致

3. **確認重定向 URI**
   在 "已授權的重新導向 URI" 中，必須包含：
   ```
   http://localhost:3000/api/auth/callback/google
   ```
   
   **如果沒有，請添加：**
   - 點擊 OAuth 2.0 客戶端 ID
   - 在 "已授權的重新導向 URI" 區塊
   - 點擊 "新增 URI"
   - 輸入：`http://localhost:3000/api/auth/callback/google`
   - 點擊 "儲存"

### 2. 重新啟動開發伺服器

```bash
# 停止目前的伺服器（如果正在運行）
# 按 Ctrl+C

# 重新啟動
npm run dev
```

### 3. 測試 Google Sign In

1. **訪問登入頁面**
   ```
   http://localhost:3000/login
   ```

2. **點擊 "Sign in with Google" 按鈕**

3. **預期行為：**
   - 應該會跳轉到 Google 登入頁面
   - 登入成功後，應該會跳轉回應用程式
   - 應該會創建用戶帳戶和會話
   - 應該會自動創建免費訂閱

## 🐛 如果遇到問題

### 問題 1：redirect_uri_mismatch

**錯誤訊息：**
```
Error 400: redirect_uri_mismatch
```

**解決方法：**
1. 確認 Google Cloud Console 中的重定向 URI 與應用程式使用的完全一致
2. 確認 `NEXTAUTH_URL` 設定為 `http://localhost:3000`
3. 等待幾分鐘讓 Google 的設定生效

### 問題 2：資料庫連接失敗

**錯誤訊息：**
```
Can't reach database server
```

**解決方法：**
1. 確認 `.env` 中的 `DATABASE_URL` 正確
2. 確認 Supabase 專案處於活動狀態
3. 如果使用 Pooler，確認連接字串包含正確的參數

### 問題 3：用戶創建失敗

**錯誤訊息：**
```
Prisma error: ...
```

**解決方法：**
1. 確認所有資料庫表已創建
2. 執行 `npx prisma generate` 重新生成 Prisma Client
3. 檢查資料庫連接是否正常

## 📋 完整測試流程

1. ✅ 資料庫連接測試
   ```bash
   npx ts-node scripts/test-db-connection.ts
   ```

2. ✅ 環境變數檢查
   ```bash
   npm run check:env
   ```

3. ✅ 啟動開發伺服器
   ```bash
   npm run dev
   ```

4. ✅ 測試 Google Sign In
   - 訪問 http://localhost:3000/login
   - 點擊 "Sign in with Google"
   - 完成登入流程

## 🎉 成功標誌

如果一切正常，您應該能夠：
- ✅ 看到 Google 登入頁面
- ✅ 成功登入並跳轉回應用程式
- ✅ 在資料庫中看到新創建的用戶記錄
- ✅ 自動創建免費訂閱
- ✅ 能夠訪問 Dashboard

---

**狀態：** ✅ 準備就緒  
**下一步：** 重新啟動開發伺服器並測試 Google Sign In
