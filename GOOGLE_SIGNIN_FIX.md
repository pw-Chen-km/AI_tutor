# Google Sign In 問題修復指南

## 🔴 當前問題

從錯誤日誌可以看到：

```
Can't reach database server at db.igzphedzrwvkqiijgijh.supabase.co
錯誤代碼: P1001
```

**問題分析：**
1. ✅ Google OAuth 認證成功（已收到用戶資料）
2. ❌ 資料庫連接失敗（無法查詢/創建用戶帳戶）

## ✅ 解決步驟

### 步驟 1：確認 Supabase 專案狀態

**這是最常見的原因！** Supabase 免費專案在 7 天不活動後會自動暫停。

1. **登入 Supabase Dashboard**
   ```
   https://supabase.com/dashboard
   ```

2. **檢查專案狀態**
   - 如果專案顯示為 "Paused"（暫停），點擊 "Resume" 恢復
   - 等待 1-2 分鐘讓專案完全啟動

3. **驗證專案資訊**
   - 確認專案 ID 與連接字串中的主機名稱一致
   - 檢查專案是否被刪除

### 步驟 2：獲取最新的連接字串

1. **前往資料庫設定**
   - Supabase Dashboard > 您的專案 > Settings > Database

2. **複製連接字串**
   - 在 "Connection string" 區塊
   - 選擇 "URI" 格式
   - 複製完整的連接字串

3. **更新 .env 檔案**
   ```env
   DATABASE_URL="從 Supabase 複製的最新連接字串"
   ```

### 步驟 3：處理密碼中的特殊字符

如果密碼包含特殊字符（如 `@`、`#`、`$` 等），需要進行 URL 編碼：

| 字符 | 編碼 |
|------|------|
| `@` | `%40` |
| `#` | `%23` |
| `$` | `%24` |
| `%` | `%25` |
| `&` | `%26` |
| `+` | `%2B` |
| `=` | `%3D` |
| `?` | `%3F` |
| `/` | `%2F` |
| `:` | `%3A` |
| ` ` (空格) | `%20` |

**範例：**
- 原始密碼：`690629@Cwlin`
- 編碼後：`690629%40Cwlin`
- 完整連接字串：`postgresql://postgres:690629%40Cwlin@db.xxxxx.supabase.co:5432/postgres?sslmode=require`

### 步驟 4：嘗試使用連接池（推薦）

Supabase 提供兩種連接方式：

**選項 A：直接連接（端口 5432）**
```
postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres?sslmode=require
```
- 用於：Prisma 遷移、直接查詢
- 限制：最多 4 個並發連接

**選項 B：連接池（端口 6543）** ⭐ 推薦
```
postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:6543/postgres?sslmode=require&pgbouncer=true
```
- 用於：應用程式連接
- 優點：支援更多並發連接、更好的性能

**建議：**
- 開發環境：使用連接池（端口 6543）
- 遷移時：使用直接連接（端口 5432）

### 步驟 5：測試資料庫連接

```bash
# 使用測試腳本
npx ts-node scripts/test-db-connection.ts
```

如果連接成功，您應該看到：
- ✅ 資料庫連接成功
- PostgreSQL 版本資訊
- 現有表列表

### 步驟 6：執行資料庫遷移

如果連接成功但表不存在，需要執行遷移：

```bash
# 生成 Prisma Client
npx prisma generate

# 推送資料庫結構（開發環境）
npx prisma db push

# 或執行遷移（生產環境推薦）
npx prisma migrate dev --name init
```

### 步驟 7：重新啟動開發伺服器

```bash
# 停止目前的伺服器（Ctrl+C）
# 然後重新啟動
npm run dev
```

## 🔍 常見問題排查

### Q1: ENOTFOUND - 主機名稱無法解析

**錯誤訊息：**
```
getaddrinfo ENOTFOUND db.xxxxx.supabase.co
```

**可能原因：**
1. Supabase 專案已暫停或刪除
2. 主機名稱輸入錯誤
3. 網路連接問題

**解決方法：**
1. 登入 Supabase Dashboard 確認專案狀態
2. 從 Dashboard 複製最新的連接字串
3. 檢查網路連接

### Q2: P1001 - 無法連接到資料庫伺服器

**錯誤訊息：**
```
Can't reach database server at db.xxxxx.supabase.co
```

**可能原因：**
1. Supabase 專案暫停
2. 連接字串格式錯誤
3. 防火牆阻擋

**解決方法：**
1. 確認 Supabase 專案狀態
2. 檢查連接字串格式
3. 嘗試使用連接池（端口 6543）

### Q3: 28P01 - 認證失敗

**錯誤訊息：**
```
password authentication failed
```

**可能原因：**
1. 密碼不正確
2. 密碼中的特殊字符未正確編碼

**解決方法：**
1. 在 Supabase Dashboard 重置密碼
2. 確保密碼中的特殊字符已進行 URL 編碼

### Q4: Google OAuth 成功但無法創建用戶

**問題：**
- Google OAuth 認證成功
- 但無法在資料庫中創建用戶帳戶

**可能原因：**
1. 資料庫連接失敗
2. 表結構不存在
3. Prisma Client 未生成

**解決方法：**
1. 確認資料庫連接正常
2. 執行 `npx prisma db push` 創建表
3. 重新生成 Prisma Client：`npx prisma generate`

## 📋 完整檢查清單

- [ ] Supabase 專案處於活動狀態（未暫停）
- [ ] 從 Supabase Dashboard 獲取最新的連接字串
- [ ] 密碼中的特殊字符已進行 URL 編碼
- [ ] `.env` 檔案中的 `DATABASE_URL` 已更新
- [ ] 已測試資料庫連接（使用測試腳本）
- [ ] 已執行 `npx prisma generate`
- [ ] 已執行 `npx prisma db push` 或 `npx prisma migrate dev`
- [ ] 表結構已創建（使用 `npx prisma studio` 驗證）
- [ ] 已重新啟動開發伺服器

## 🚀 快速修復命令序列

```bash
# 1. 測試資料庫連接
npx ts-node scripts/test-db-connection.ts

# 2. 生成 Prisma Client
npx prisma generate

# 3. 推送資料庫結構
npx prisma db push

# 4. 重新啟動開發伺服器
npm run dev
```

## 💡 預防措施

1. **定期檢查 Supabase 專案狀態**
   - 免費專案在 7 天不活動後會暫停
   - 定期使用專案可避免暫停

2. **使用連接池**
   - 生產環境使用連接池（端口 6543）
   - 可提供更好的性能和穩定性

3. **備份連接字串**
   - 將連接字串保存在安全的地方
   - 避免遺失後無法連接

---

**最後更新：** 2025-01-03
