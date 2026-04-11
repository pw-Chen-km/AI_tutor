# IPv4 連接問題修復指南

## 🔴 問題確認

從 Supabase Dashboard 可以看到：
- ⚠️ **"Not IPv4 compatible"** 警告
- 💡 建議：**"Use Session Pooler if on a IPv4 network"**

## 📖 問題說明

**原因：**
- Supabase 專案的直接連接（端口 5432）只支援 IPv6
- 您的網路環境可能是 IPv4-only
- 這就是為什麼：
  - ✅ DNS 解析成功（解析到 IPv6 地址）
  - ❌ 但連接失敗（無法建立 IPv6 連接）

**解決方案：**
使用 **Session Pooler（連接池）**，它支援 IPv4 網路。

## ✅ 修復步驟

### 步驟 1：從 Supabase Dashboard 獲取連接池連接字串

1. **登入 Supabase Dashboard**
   ```
   https://supabase.com/dashboard
   ```

2. **前往連接設定**
   - 專案 > Settings > Database
   - 或點擊 "Connect to your project"

3. **選擇 Pooler settings**
   - 在 "Direct connection" 區塊下方
   - 點擊 **"Pooler settings"** 按鈕

4. **配置連接池**
   - **Mode（模式）**：選擇 **"Session"**
   - **Format（格式）**：選擇 **"URI"**
   - **Source（來源）**：選擇 **"Primary Database"**

5. **複製連接字串**
   - 複製顯示的完整連接字串
   - 應該類似：
     ```
     postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:6543/postgres?sslmode=require&pgbouncer=true
     ```

### 步驟 2：更新 .env 檔案

將複製的連接字串更新到 `.env` 檔案：

```env
DATABASE_URL="從 Dashboard 複製的連接池連接字串"
```

**重要：**
- 確保端口是 **6543**（連接池）
- 確保包含 `pgbouncer=true` 參數
- 確保密碼中的特殊字符已正確編碼

### 步驟 3：測試連接

```bash
npx ts-node scripts/test-db-connection.ts
```

如果連接成功，您應該看到：
- ✅ 資料庫連接成功
- PostgreSQL 版本資訊
- 現有表列表

### 步驟 4：執行資料庫遷移

**注意：** 連接池（端口 6543）**不支援** Prisma 遷移！

對於遷移，您需要：
1. **暫時使用直接連接（端口 5432）**
2. **執行遷移**
3. **改回連接池（端口 6543）用於應用程式**

**遷移步驟：**

```bash
# 1. 暫時更新 .env 為直接連接（端口 5432）
# 手動編輯 .env，將端口改為 5432，移除 pgbouncer=true

# 2. 執行遷移
npx prisma generate
npx prisma db push --accept-data-loss

# 3. 改回連接池（端口 6543）
# 手動編輯 .env，將端口改為 6543，添加 pgbouncer=true
```

### 步驟 5：重新啟動開發伺服器

```bash
npm run dev
```

## 🔍 連接池 vs 直接連接

| 特性 | 直接連接（5432） | 連接池（6543） |
|------|-----------------|---------------|
| IPv4 支援 | ❌ 否（只支援 IPv6） | ✅ 是 |
| 遷移支援 | ✅ 是 | ❌ 否 |
| 應用程式使用 | ⚠️ 可以但不推薦 | ✅ 推薦 |
| 並發連接 | 最多 4 個 | 更多 |
| 性能 | 一般 | 更好 |

## 📋 檢查清單

- [ ] 已從 Dashboard 的 Pooler settings 複製連接字串
- [ ] 連接字串使用端口 6543
- [ ] 連接字串包含 `pgbouncer=true` 參數
- [ ] 已更新 `.env` 檔案
- [ ] 已測試連接（成功）
- [ ] 已執行資料庫遷移（使用端口 5432）
- [ ] 遷移後已改回連接池（端口 6543）
- [ ] 已重新啟動開發伺服器

## 💡 替代方案

如果連接池仍然無法連接，可以考慮：

1. **購買 IPv4 add-on**
   - 在 Supabase Dashboard 中點擊 "IPv4 add-on"
   - 這會讓直接連接支援 IPv4

2. **使用 VPN 或代理**
   - 使用支援 IPv6 的 VPN
   - 或使用代理伺服器

3. **檢查網路設定**
   - 確認您的網路是否真的只支援 IPv4
   - 某些網路環境可能可以啟用 IPv6

---

**當前問題：** IPv4 網路無法連接 IPv6-only 的 Supabase 直接連接  
**解決方案：** 使用 Session Pooler（連接池，端口 6543）  
**注意：** 遷移時需要使用直接連接（端口 5432）
