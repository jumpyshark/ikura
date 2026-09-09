# ReceiptLog

React Native + Expoで開発する、OCR中心の支出管理アプリです。紙のレシートと決済アプリのスクリーンショットを読み取り、保存前に必ず利用者が確認・修正します。AIは通常のOCRとルール解析で判別できない場合だけ補助的に利用します。

## Codespacesで開始

1. GitHubの **Code → Codespaces → Create codespace on main** を選ぶ
2. 依存関係のインストール完了後、ターミナルで `npm run web` を実行
3. 転送されたポート8081をブラウザで開く

モバイル実機では `npm start` を利用します。ネイティブOCRを追加した後はExpo Goではなくdevelopment buildを使用します。

## 現在の機能

- カメラ撮影または画像選択
- OCR処理の差し替え口（現在はモック）
- 認識結果の必須確認・修正
- 確認済み支出の端末内保存と履歴表示

## 次の段階

1. Google ML Kitによる日本語OCR
2. 店舗名・日付・合計金額のルール解析
3. 信頼度が低い場合のみAIへフォールバック
4. SQLite、カテゴリ集計、月別グラフ
