# 資料庫設定與問題排查指南

## 🔴 當前問題：ECONNREFUSED

從錯誤日誌可以看到：
```
code: 'ECONNREFUSED'
Invalid `p.account.findUnique()` invocation
```

這表示 **資料庫連接被拒絕**，可能的原因：

1. ✅ Google OAuth 認證成功（已收到用戶資料）
2. ❌ 資料庫連接失敗（無法查詢/創建用戶帳戶）

## ✅ 解決步驟

### 步驟 1：確認資料庫服務運行中

**如果使用本地 PostgreSQL：**

```bash
# Windows (PowerShell)
Get-Service -Name postgresql*

# 如果服務未運行，啟動它：
Start-Service -Name postgresql-x64-XX  # 替換 XX 為您的版本號
```

**如果使用 Supabase 或其他雲端資料庫：**
- 確認資料庫服務已啟動
- 檢查連接字串是否正確

### 步驟 2：驗證資料庫連接

檢查 `.env` 檔案中的 `DATABASE_URL`：

```env
# 本地 PostgreSQL 範例
DATABASE_URL="postgresql://postgres:password@localhost:5432/ai_teaching_assistant?sslmode=disable"

# Supabase 範例
DATABASE_URL="postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres?sslmode=require"
```

**測試連接：**

```bash
# 使用 psql 測試（如果已安裝）
psql "postgresql://postgres:password@localhost:5432/ai_teaching_assistant?sslmode=disable"
```

### 步驟 3：執行 Prisma 遷移

如果資料庫連接正常，但表不存在，需要執行遷移：

```bash
# 生成 Prisma Client
npx prisma generate

# 執行資料庫遷移（創建表結構）
npx prisma migrate dev --name init

# 或者使用 push（適用於開發環境）
npx prisma db push
```

### 步驟 4：驗證表結構

遷移完成後，確認表已創建：

```bash
# 使用 Prisma Studio 查看資料庫
npx prisma studio
```

或使用 SQL 查詢：

```sql
-- 檢查表是否存在
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public';
```

應該看到以下表：
- `users`
- `accounts`
- `sessions`
- `verification_tokens`
- `subscriptions`
- `usage_logs`
- `payment_records`

### 步驟 5：重新啟動開發伺服器

```bash
# 停止目前的伺服器（Ctrl+C）
# 然後重新啟動
npm run dev
```

## 🔍 常見問題排查

### 問題 1：PostgreSQL 服務未運行

**Windows：**
```powershell
# 檢查服務狀態
Get-Service -Name postgresql*

# 啟動服務
Start-Service -Name postgresql-x64-XX
```

**macOS/Linux：**
```bash
# 檢查服務狀態
sudo systemctl status postgresql

# 啟動服務
sudo systemctl start postgresql
```

### 問題 2：資料庫不存在

如果連接字串中的資料庫名稱不存在，需要先創建：

```sql
-- 連接到 PostgreSQL（使用預設的 postgres 資料庫）
psql -U postgres

-- 創建資料庫
CREATE DATABASE ai_teaching_assistant;

-- 退出
\q
```

### 問題 3：連接字串格式錯誤

確保 `DATABASE_URL` 格式正確：

```
postgresql://[用戶名]:[密碼]@[主機]:[端口]/[資料庫名稱]?[參數]
```

範例：
```
postgresql://postgres:mypassword@localhost:5432/ai_teaching_assistant?sslmode=disable
```

### 問題 4：防火牆或網路問題

- 檢查防火牆是否阻擋了 PostgreSQL 端口（預設 5432）
- 如果使用雲端資料庫，確認 IP 白名單設定

### 問題 5：Prisma Client 未生成

如果修改了 `schema.prisma`，需要重新生成：

```bash
npx prisma generate
```

## 📋 完整檢查清單

- [ ] PostgreSQL 服務正在運行
- [ ] `.env` 檔案中的 `DATABASE_URL` 正確
- [ ] 資料庫已創建（如果使用本地 PostgreSQL）
- [ ] 已執行 `npx prisma generate`
- [ ] 已執行 `npx prisma migrate dev` 或 `npx prisma db push`
- [ ] 表結構已創建（使用 `npx prisma studio` 驗證）
- [ ] 已重新啟動開發伺服器

## 🚀 快速修復命令

```bash
# 1. 生成 Prisma Client
npx prisma generate

# 2. 推送資料庫結構（開發環境）
npx prisma db push

# 3. 或執行遷移（生產環境推薦）
npx prisma migrate dev --name init

# 4. 重新啟動伺服器
npm run dev
```

## 📞 需要幫助？

如果問題仍然存在，請檢查：

1. **終端機輸出**：查看完整的錯誤訊息
2. **資料庫日誌**：檢查 PostgreSQL 日誌檔案
3. **Prisma 日誌**：在 `lib/db/client.ts` 中已啟用開發環境日誌

---

**最後更新：** 2025-01-03
