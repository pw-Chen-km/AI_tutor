# Supabase 資料庫連接問題修復指南

## 🔴 當前問題

連接測試結果：`ENOTFOUND` - 主機名稱無法解析

## ✅ 解決步驟

### 步驟 1：修正連接字串格式

您的原始連接字串有格式問題：

**❌ 錯誤格式：**
```
postgresql://postgres:690629@Cwlin@db.igzphedzrwvkqiijgijh.supabase.co:5432/postgres
```

**✅ 正確格式（密碼中的 @ 需要編碼為 %40）：**
```
postgresql://postgres:690629%40Cwlin@db.igzphedzrwvkqiijgijh.supabase.co:5432/postgres
```

### 步驟 2：確認 Supabase 專案狀態

1. **登入 Supabase Dashboard**
   - 訪問：https://supabase.com/dashboard
   - 確認專案是否存在且處於活動狀態

2. **檢查專案狀態**
   - 如果專案顯示為 "Paused"，需要恢復它
   - 免費專案在 7 天不活動後會自動暫停

3. **獲取正確的連接字串**
   - 前往：Supabase Dashboard > 您的專案 > Settings > Database
   - 複製 "Connection string" 下的 "URI" 格式
   - 確保使用最新的連接字串

### 步驟 3：驗證連接資訊

在 Supabase Dashboard 中確認：

1. **Database Host**
   - 應該類似：`db.xxxxx.supabase.co`
   - 確認與您的連接字串中的主機名稱一致

2. **Database Password**
   - 如果忘記密碼，可以在 Settings > Database > Database password 中重置
   - 重置後會生成新的連接字串

3. **Connection Pooling**
   - Supabase 提供兩種連接方式：
     - **Direct connection**（端口 5432）：用於遷移和直接查詢
     - **Connection pooling**（端口 6543）：用於應用程式連接（推薦）

### 步驟 4：使用正確的連接字串格式

**選項 A：直接連接（用於 Prisma 遷移）**
```
postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres?sslmode=require
```

**選項 B：連接池（推薦用於應用程式）**
```
postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:6543/postgres?sslmode=require&pgbouncer=true
```

### 步驟 5：處理密碼中的特殊字符

如果密碼包含特殊字符，需要進行 URL 編碼：

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
- 密碼：`690629@Cwlin`
- 編碼後：`690629%40Cwlin`

### 步驟 6：測試連接

使用我們提供的測試腳本：

```bash
# 設定環境變數（使用正確的連接字串）
$env:DATABASE_URL="postgresql://postgres:690629%40Cwlin@db.igzphedzrwvkqiijgijh.supabase.co:5432/postgres?sslmode=require"

# 執行測試
npx ts-node scripts/test-db-connection.ts
```

## 🔍 常見問題

### Q1: 主機名稱無法解析（ENOTFOUND）

**可能原因：**
- Supabase 專案已暫停或刪除
- 主機名稱輸入錯誤
- 網路連接問題

**解決方法：**
1. 確認 Supabase 專案狀態
2. 從 Supabase Dashboard 複製最新的連接字串
3. 檢查網路連接

### Q2: 認證失敗（28P01）

**可能原因：**
- 密碼不正確
- 密碼中的特殊字符未正確編碼

**解決方法：**
1. 在 Supabase Dashboard 重置密碼
2. 確保特殊字符已進行 URL 編碼

### Q3: 連接超時（ETIMEDOUT）

**可能原因：**
- 防火牆阻擋
- Supabase 專案暫停

**解決方法：**
1. 檢查防火牆設定
2. 確認 Supabase 專案狀態
3. 嘗試使用連接池端口（6543）

## 📋 檢查清單

- [ ] Supabase 專案處於活動狀態（未暫停）
- [ ] 從 Supabase Dashboard 獲取最新的連接字串
- [ ] 密碼中的特殊字符已進行 URL 編碼
- [ ] 連接字串格式正確
- [ ] 已測試連接（使用測試腳本）
- [ ] `.env` 檔案中的 `DATABASE_URL` 已更新

## 🚀 快速修復

1. **登入 Supabase Dashboard**
   ```
   https://supabase.com/dashboard
   ```

2. **獲取連接字串**
   - 專案 > Settings > Database
   - 複製 "Connection string" > "URI"

3. **更新 .env 檔案**
   ```env
   DATABASE_URL="從 Supabase 複製的連接字串"
   ```

4. **測試連接**
   ```bash
   npx ts-node scripts/test-db-connection.ts
   ```

5. **執行 Prisma 遷移**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

---

**最後更新：** 2025-01-03
