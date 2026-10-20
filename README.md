# Framehush

在 Chrome 中即時降低影片人聲的背景雜音。音訊只在本機處理，不錄音、不上傳。

## 安裝

使用需要 Chrome 116 以上。從原始碼建置需要 Node.js 20 以上。

1. 在專案目錄執行 `npm ci`。
2. 執行 `npm run build`，產生 `dist` 資料夾。
3. 開啟 `chrome://extensions`，啟用「開發人員模式」。
4. 選擇「載入未封裝項目」，選取本專案的 `dist` 資料夾。
5. 播放影片，開啟 Framehush 並按「啟用降噪」。

若已有建置完成的 `dist`，可直接從步驟 3 開始。

關閉面板後仍會繼續處理。再次開啟面板即可停止。可用 `Alt+Shift+N` 開啟面板。若快捷鍵衝突，在 `chrome://extensions/shortcuts` 調整。

一次只處理一個分頁的所有音訊。若要換分頁，先停止目前的降噪。其他分頁也能開啟面板並停止。

## 驗證

修改與重建需要 Node.js 20 以上。在專案目錄執行 `npm ci` 與 `npm run build`，再於 Chrome 的擴充功能頁面重新載入。

執行 `npm test`，檢查實際 RNNoise WASM、音訊分幀與啟動及清理行為。

執行 `npm run test:browser` 可檢查未封裝擴充功能。此選用檢查需要 Playwright 與支援 `Extensions.triggerAction` 的新版 Chromium。本次使用 Playwright 1.62.1 與 Chrome for Testing 151。
可用 `PLAYWRIGHT_MODULE_PATH` 指向已安裝的 Playwright 模組，`CHROME_PATH` 指向 Chrome for Testing 執行檔。測試使用獨立設定檔，不修改日常 Chrome。
瀏覽器測試會在 `verification` 產生執行結果與實際面板截圖。這些產物不納入版本控制。瀏覽器測試確認音訊圖輸出與擷取釋放，不代表已經用喇叭人工聆聽。

## 使用限制

RNNoise 針對人聲降噪，無法保證移除配樂、重疊說話聲或強烈雜音。音樂與音效可能改變。若聲音不自然，按「停止降噪」即可結束分頁音訊擷取。

處理需要 48 kHz AudioContext，瀏覽器負責裝置取樣率轉換。音訊分幀增加 480 個取樣點的緩衝，模型與裝置另有延遲。影片口型可能與聲音略有差異。

Chrome 內部頁面與部分受保護內容不允許擷取。分頁關閉或音訊處理中斷時，Framehush 會停止擷取並保留錯誤訊息。網頁暫停播放不會停用降噪。

## 權限與來源

`activeTab` 與 `tabCapture` 允許使用者啟用目前分頁的音訊擷取。`offscreen` 讓面板關閉後仍能處理音訊。沒有主機存取、麥克風、儲存、遙測或遠端程式碼權限。

建置只複製原生 ES modules 與固定版本的 Jitsi RNNoise，不使用 bundler。模型與 WASM 都包含在 `dist/vendor`。第三方授權見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Chrome 擷取行為與最低版本依據 [tabCapture 官方文件](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)。背景音訊頁面依 [Chrome 官方範例](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture) 使用 `USER_MEDIA`。
