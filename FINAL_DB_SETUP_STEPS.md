# 資料庫表建立 - 最終步驟

## 🔍 當前狀態

- ✅ `.env` 檔案已設定（端口 5432）
- ✅ Prisma Client 已生成
- ❌ 資料庫連接失敗（P1001）
- ❌ 資料庫表尚未創建

## 📋 完整解決步驟

### 步驟 1：確認 Supabase 專案狀態

1. **登入 Supabase Dashboard**
   ```
   https://supabase.com/dashboard
   ```

2. **檢查專案**
   - 專案 ID：`igzphedzrwvkqiijgijh`
   - 確認狀態為 "Active"（活動）
   - 如果顯示 "Paused"，點擊 "Resume" 並等待 2-3 分鐘

3. **驗證連接**
   - Dashboard 顯示有連接請求（您已經看到）
   - 這表示專案應該在運行

### 步驟 2：從 Dashboard 獲取最新的連接字串

1. **前往資料庫設定**
   - Supabase Dashboard > 您的專案 > Settings > Database

2. **複製連接字串**
   - 在 "Connection string" 區塊
   - 選擇 "URI" 格式
   - **重要：使用 "Direct connection"（端口 5432）進行遷移**
   - 點擊 "Copy" 複製

3. **更新 .env 檔案**
   ```env
   DATABASE_URL="從 Supabase 複製的最新連接字串（端口 5432）"
   ```

### 步驟 3：測試連接

```bash
npx ts-node scripts/test-db-connection.ts
```

如果連接成功，您應該看到：
- ✅ 資料庫連接成功
- PostgreSQL 版本資訊

### 步驟 4：執行資料庫遷移

```bash
# 生成 Prisma Client（如果還沒執行）
npx prisma generate

# 推送資料庫結構（創建表）
npx prisma db push --accept-data-loss
```

**預期輸出：**
```
✔ Generated Prisma Client
✔ The database is now in sync with your Prisma schema.
```

### 步驟 5：驗證表已創建

```bash
# 打開 Prisma Studio 查看表
npx prisma studio
```

應該看到以下表：
- `users`
- `accounts`
- `sessions`
- `verification_tokens`
- `subscriptions`
- `usage_logs`
- `payment_records`

### 步驟 6：遷移完成後，可改用連接池（可選）

遷移完成後，可以將 `.env` 中的連接字串改為使用連接池（端口 6543），以獲得更好的性能：

```env
# 用於應用程式（連接池，性能更好）
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:6543/postgres?sslmode=require&pgbouncer=true"
```

**注意：**
- 遷移時必須使用端口 5432（直接連接）
- 應用程式運行時可以使用端口 6543（連接池）

## 🔍 如果仍然無法連接

### 檢查清單

- [ ] Supabase 專案狀態為 "Active"
- [ ] 已從 Dashboard 複製最新的連接字串
- [ ] 連接字串使用端口 5432（遷移時）
- [ ] 密碼中的特殊字符已正確編碼
- [ ] 已等待 2-3 分鐘讓專案完全啟動（如果剛恢復）

### 常見問題

**Q: Dashboard 顯示有連接，但應用程式無法連接？**

A: 這可能是因為：
1. 專案剛恢復，需要等待
2. 連接字串需要更新
3. 網路延遲

**解決方法：**
1. 等待 2-3 分鐘
2. 從 Dashboard 重新複製連接字串
3. 更新 `.env` 檔案
4. 重新測試

**Q: 遷移時應該使用哪個端口？**

A: 
- **遷移時**：使用端口 **5432**（直接連接）
- **應用程式運行時**：可以使用端口 **6543**（連接池，推薦）

## 🚀 快速命令序列

```bash
# 1. 從 Supabase Dashboard 複製最新連接字串（端口 5432）
# 2. 更新 .env 檔案

# 3. 生成 Prisma Client
npx prisma generate

# 4. 推送資料庫結構
npx prisma db push --accept-data-loss

# 5. 驗證表已創建
npx prisma studio

# 6. 重新啟動開發伺服器
npm run dev
```

---

**當前問題：** 資料庫連接失敗（P1001）  
**解決方法：** 從 Supabase Dashboard 獲取最新連接字串並更新 `.env`
