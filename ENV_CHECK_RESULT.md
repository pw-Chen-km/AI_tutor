# .env 檔案檢查結果

## ✅ 連接字串格式檢查

您的 `DATABASE_URL` 設定：

```
postgresql://postgres:690629%40Cwlin@db.igzphedzrwvkqiijgijh.supabase.co:5432/postgres?sslmode=require
```

### 格式分析

| 項目 | 值 | 狀態 |
|------|-----|------|
| 用戶名 | `postgres` | ✅ 正確 |
| 密碼編碼 | `690629%40Cwlin` | ✅ 正確（@ 已編碼為 %40） |
| 主機 | `db.igzphedzrwvkqiijgijh.supabase.co` | ⚠️ 無法解析 |
| 端口 | `5432` | ✅ 正確 |
| 資料庫 | `postgres` | ✅ 正確 |
| SSL 模式 | `require` | ✅ 正確 |

## ❌ 連接測試結果

**錯誤訊息：** `getaddrinfo ENOTFOUND db.igzphedzrwvkqiijgijh.supabase.co`

**錯誤代碼：** `ENOTFOUND`

**問題：** 主機名稱無法解析，無法連接到資料庫伺服器

## 🔍 可能的原因

### 1. Supabase 專案已暫停（最可能）

Supabase 免費專案在 **7 天不活動後會自動暫停**。

**解決方法：**
1. 登入 Supabase Dashboard：https://supabase.com/dashboard
2. 檢查專案狀態
3. 如果顯示 "Paused"，點擊 "Resume" 恢復
4. 等待 1-2 分鐘讓專案完全啟動

### 2. 主機名稱不正確

可能 Supabase 專案的主機名稱已變更。

**解決方法：**
1. 登入 Supabase Dashboard
2. 前往：專案 > Settings > Database
3. 複製最新的 "Connection string" > "URI"
4. 更新 `.env` 檔案中的 `DATABASE_URL`

### 3. 網路連接問題

**解決方法：**
1. 檢查網路連接
2. 嘗試使用瀏覽器訪問 Supabase Dashboard
3. 檢查防火牆設定

## ✅ 建議的修復步驟

### 步驟 1：確認 Supabase 專案狀態

1. **登入 Supabase Dashboard**
   ```
   https://supabase.com/dashboard
   ```

2. **檢查專案**
   - 確認專案 `igzphedzrwvkqiijgijh` 是否存在
   - 檢查專案狀態（是否暫停）

3. **如果專案暫停**
   - 點擊 "Resume" 按鈕恢復專案
   - 等待專案完全啟動（通常 1-2 分鐘）

### 步驟 2：獲取最新的連接字串

1. **前往資料庫設定**
   - Supabase Dashboard > 您的專案 > Settings > Database

2. **複製連接字串**
   - 在 "Connection string" 區塊
   - 選擇 "URI" 格式
   - 點擊 "Copy" 複製

3. **更新 .env 檔案**
   ```env
   DATABASE_URL="從 Supabase 複製的最新連接字串"
   ```

### 步驟 3：重新測試連接

```bash
npx ts-node scripts/test-db-connection.ts
```

如果連接成功，您應該看到：
- ✅ 資料庫連接成功
- PostgreSQL 版本資訊
- 現有表列表

### 步驟 4：執行資料庫遷移

如果連接成功但表不存在：

```bash
# 生成 Prisma Client
npx prisma generate

# 推送資料庫結構
npx prisma db push
```

### 步驟 5：重新啟動開發伺服器

```bash
npm run dev
```

## 📋 檢查清單

- [ ] 已登入 Supabase Dashboard
- [ ] 確認專案狀態（未暫停）
- [ ] 已獲取最新的連接字串
- [ ] 已更新 `.env` 檔案
- [ ] 已測試連接（成功）
- [ ] 已執行 `npx prisma generate`
- [ ] 已執行 `npx prisma db push`
- [ ] 已重新啟動開發伺服器

## 💡 預防措施

1. **定期使用 Supabase 專案**
   - 免費專案在 7 天不活動後會暫停
   - 定期使用可避免暫停

2. **備份連接字串**
   - 將連接字串保存在安全的地方
   - 避免遺失後無法連接

3. **使用連接池（生產環境）**
   - 考慮使用連接池端口（6543）
   - 可提供更好的性能和穩定性

---

**檢查時間：** 2025-01-03
**連接字串格式：** ✅ 正確
**連接測試：** ❌ 失敗（ENOTFOUND）
