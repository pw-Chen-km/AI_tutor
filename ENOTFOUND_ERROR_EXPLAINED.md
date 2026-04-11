# ENOTFOUND 錯誤說明與解決方案

## 🔴 錯誤訊息

```
getaddrinfo ENOTFOUND db.igzphedzrwvkqiijgijh.supabase.co
錯誤代碼: ENOTFOUND
```

## 📖 錯誤含義

**ENOTFOUND** 表示：
- DNS（域名系統）無法解析主機名稱
- 系統無法找到 `db.igzphedzrwvkqiijgijh.supabase.co` 對應的 IP 地址
- 這通常意味著該主機名稱不存在或無法訪問

## 🔍 可能的原因

### 1. Supabase 專案已暫停（最常見）⭐

**原因：**
- Supabase 免費專案在 **7 天不活動後會自動暫停**
- 暫停後，資料庫主機名稱會無法解析

**解決方法：**
1. 登入 Supabase Dashboard：https://supabase.com/dashboard
2. 找到專案 `igzphedzrwvkqiijgijh`
3. 如果顯示 "Paused"，點擊 "Resume" 恢復
4. 等待 1-2 分鐘讓專案完全啟動
5. 重新測試連接

### 2. 專案已被刪除

**原因：**
- 專案可能被手動刪除
- 或因為其他原因被移除

**解決方法：**
1. 登入 Supabase Dashboard
2. 確認專案是否存在
3. 如果不存在，需要創建新專案
4. 獲取新的連接字串

### 3. 主機名稱不正確

**原因：**
- 連接字串中的主機名稱可能已變更
- 或輸入錯誤

**解決方法：**
1. 登入 Supabase Dashboard
2. 前往：專案 > Settings > Database
3. 複製最新的 "Connection string" > "URI"
4. 更新 `.env` 檔案中的 `DATABASE_URL`

### 4. 網路連接問題

**原因：**
- DNS 伺服器問題
- 防火牆阻擋
- 網路連接中斷

**解決方法：**
1. 檢查網路連接
2. 嘗試訪問其他網站確認網路正常
3. 檢查防火牆設定
4. 嘗試使用不同的 DNS 伺服器（如 8.8.8.8）

## ✅ 診斷步驟

### 步驟 1：測試 DNS 解析

**Windows PowerShell：**
```powershell
Resolve-DnsName -Name "db.igzphedzrwvkqiijgijh.supabase.co"
```

**如果成功：**
- 會顯示 IP 地址
- 表示 DNS 解析正常，問題可能在應用層

**如果失敗：**
- 表示主機名稱無法解析
- 最可能是 Supabase 專案已暫停

### 步驟 2：檢查 Supabase 專案狀態

1. **登入 Dashboard**
   ```
   https://supabase.com/dashboard
   ```

2. **查找專案**
   - 專案 ID：`igzphedzrwvkqiijgijh`
   - 或根據專案名稱查找

3. **檢查狀態**
   - ✅ Active（活動）：專案正常運行
   - ⏸️ Paused（暫停）：需要恢復
   - ❌ Deleted（已刪除）：需要重新創建

### 步驟 3：獲取最新的連接字串

如果專案狀態正常，但連接仍失敗：

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

### 步驟 4：重新測試連接

```bash
npx ts-node scripts/test-db-connection.ts
```

## 🚀 快速修復

### 如果專案已暫停：

1. **恢復專案**
   - 登入 Supabase Dashboard
   - 點擊 "Resume" 按鈕
   - 等待專案啟動（1-2 分鐘）

2. **重新測試**
   ```bash
   npx ts-node scripts/test-db-connection.ts
   ```

### 如果專案不存在：

1. **創建新專案**
   - 在 Supabase Dashboard 創建新專案
   - 或恢復已刪除的專案（如果可能）

2. **獲取連接字串**
   - 從新專案複製連接字串
   - 更新 `.env` 檔案

3. **執行遷移**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

## 📋 檢查清單

- [ ] 已登入 Supabase Dashboard
- [ ] 確認專案存在
- [ ] 確認專案狀態（未暫停）
- [ ] 已獲取最新的連接字串
- [ ] 已更新 `.env` 檔案
- [ ] 已重新測試連接
- [ ] DNS 解析成功（如果專案已恢復）

## 💡 預防措施

1. **定期使用專案**
   - 免費專案在 7 天不活動後會暫停
   - 定期使用可避免暫停

2. **監控專案狀態**
   - 定期檢查 Supabase Dashboard
   - 設定提醒（如果可能）

3. **備份連接字串**
   - 將連接字串保存在安全的地方
   - 避免遺失後無法連接

---

**錯誤代碼：** ENOTFOUND  
**錯誤類型：** DNS 解析失敗  
**最可能原因：** Supabase 專案已暫停  
**解決方法：** 登入 Dashboard 恢復專案
