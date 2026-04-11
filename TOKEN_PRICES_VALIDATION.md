# 額外代幣價格 ID 驗證結果

## ✅ 驗證通過

所有額外代幣價格 ID 已成功驗證並更新到代碼中。

### 驗證結果

| 代幣數量 | 價格 ID | 金額 | 狀態 |
|---------|---------|------|------|
| 100K | `price_1Ss1C1L0dokOCEzmcPA75g84` | $4.00 USD | ✅ 有效 |
| 500K | `price_1Ss1CTL0dokOCEzmCcpgzDkB` | $17.50 USD | ✅ 有效 |
| 1M | `price_1Ss1CsL0dokOCEzmFii1AxN4` | $30.00 USD | ✅ 有效 |
| 2M | `price_1Ss1DEL0dokOCEzm1YaD8dck` | $50.00 USD | ✅ 有效 |

### 環境變數設定

以下環境變數已正確設定在 `.env` 檔案中：

```env
STRIPE_100ktokens_PRICE_ID="price_1Ss1C1L0dokOCEzmcPA75g84"
STRIPE_500ktokens_PRICE_ID="price_1Ss1CTL0dokOCEzmCcpgzDkB"
STRIPE_1mtokens_PRICE_ID="price_1Ss1CsL0dokOCEzmFii1AxN4"
STRIPE_2mtokens_PRICE_ID="price_1Ss1DEL0dokOCEzm1YaD8dck"
```

### 價格驗證

- ✅ 所有價格 ID 格式正確
- ✅ 所有價格為一次性付款（非訂閱）
- ✅ 所有價格已啟用
- ✅ 所有價格符合預期的折扣價格
- ✅ 所有價格與 Stripe 產品正確關聯

### 代碼更新

已更新 `lib/payments/stripe.ts` 以使用這些價格 ID：

1. **新增函數** `getTokenPriceId(tokens: number)` - 根據代幣數量獲取對應的價格 ID
2. **更新函數** `createTokenPurchaseSession()` - 優先使用預設的價格 ID，如果找不到則回退到動態創建價格

這樣的好處：
- 價格在 Stripe Dashboard 中統一管理
- 更容易追蹤和分析銷售數據
- 避免價格不一致的問題
- 更好的財務報告和審計追蹤

## 📝 下一步

1. **測試代幣購買流程**
   - 在應用程式中測試購買 100K、500K、1M、2M 代幣
   - 確認結帳流程正常運作
   - 確認價格顯示正確

2. **驗證 Webhook 處理**
   - 確認 Stripe Webhook 能正確處理代幣購買事件
   - 確認代幣正確添加到用戶帳戶
   - 確認付款記錄正確創建

3. **測試回退機制**
   - 如果環境變數未設定，系統會自動回退到動態創建價格
   - 這確保了向後兼容性

4. **監控和維護**
   - 定期檢查 Stripe Dashboard 中的價格狀態
   - 確保所有價格保持啟用狀態
   - 如有價格變更，更新環境變數

## 🔍 驗證腳本

可以使用以下腳本重新驗證價格 ID：

```bash
npx ts-node scripts/verify-token-prices.ts
```

## 📊 價格對照表

| 代幣數量 | 原價 | 折扣 | 折扣後價格 | 折扣率 |
|---------|------|------|-----------|--------|
| 100K | $5.00 | 20% off | $4.00 | 8折 |
| 500K | $25.00 | 30% off | $17.50 | 7折 |
| 1M | $50.00 | 40% off | $30.00 | 6折 |
| 2M | $100.00 | 50% off | $50.00 | 5折 |

所有價格已正確設定並驗證通過！🎉
