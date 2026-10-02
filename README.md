# ReceiptLog

React Native + Expoで開発する、OCR中心の支出管理アプリです。紙のレシートと決済アプリのスクリーンショットを読み取り、保存前に必ず利用者が確認・修正します。AIは通常のOCRとルール解析で判別できない場合だけ補助的に利用します。

## Codespacesで開始

1. GitHubの **Code → Codespaces → Create codespace on main** を選ぶ
2. 依存関係のインストール完了後、ターミナルで `npm run web` を実行
3. 転送されたポート8081をブラウザで開く

モバイル実機では `npm start` を利用します。ネイティブOCRを追加した後はExpo Goではなくdevelopment buildを使用します。

## 現在の機能

- カメラ撮影または画像選択
- Android: Google ML Kit日本語OCR / iOS: Apple Vision OCR
- 合計・日付・店舗名のルール解析と信頼度表示
- 認識結果の必須確認・修正
- 手入力、編集、削除、検索、カテゴリ絞り込み
- 月別履歴、月間予算、残額、カテゴリ別グラフ
- カテゴリ追加・削除と端末内保存
- 低信頼度時だけ利用できる任意AIフォールバック

## Webと実機

Web版では全画面、手入力、履歴、集計を確認できます。OCRはネイティブ機能のためExpo Goでは動かず、development buildが必要です。

```sh
npm install
npm run web

# 実機OCR用（Expoアカウントが必要）
npx eas-cli login
npx eas-cli build --profile development --platform android

# APKファイルのビルド（プレビュー・インストール用）
npm run build:apk
# または: npx eas-cli build --profile preview --platform android
```

## AIフォールバック

AIは初期状態で無効です。APIキーをアプリへ埋め込まず、認証付きサーバーを用意して`.env`の`EXPO_PUBLIC_AI_FALLBACK_URL`へURLだけを設定します。信頼度75%未満のOCR結果だけが対象になり、AI利用後も確認画面を必ず通ります。

## GitHub Actionsとリリース

APK/IPAのビルドはプルリクエストや`main`へのマージでは自動実行されません。必要なときだけGitHubのActions画面から個別のビルドを手動実行できます。

ダウンロード可能な配布物は、Actions画面から次のいずれかを手動実行して作成できます。

- **Publish Android release (APK only)**: Androidだけをビルドし、`ReceiptLog.apk`を公開します。
- **Publish iOS release (unsigned IPA only)**: iOSだけをビルドし、`ReceiptLog-unsigned.ipa`を公開します。
- **Publish mobile release (APK + IPA)**: 両方をビルドしてまとめて公開します。

各ワークフローで`v1.0.0`のようなリリースタグを入力します。APKとIPAを別々に実行するときも同じタグを指定すれば、同じGitHub Releaseへ両方のファイルを追加できます。同じプラットフォームを同じタグで再実行すると、その添付ファイルだけが置き換わります。

IPAは未署名です。そのままApp Store経由でインストールすることはできず、別途署名または対応したサイドロード手順が必要です。

### Androidビルドの警告を確認する

`Deprecated Gradle features were used in this build, making it incompatible with Gradle 10`は、Gradle 9が依存プラグインの将来の非互換性を知らせる警告であり、それ自体はビルド失敗の原因ではありません。Androidワークフローは`--warning-mode all`と`--stacktrace`を使用し、実際に失敗した処理と個別の非推奨警告をログへ出力します。失敗時にはActions実行画面のArtifactsから`android-gradle-build-log`をダウンロードできます。ログ内で最初に現れる`FAILURE:`または`What went wrong:`の内容を確認してください。

## 今後の改善

1. 実レシートのテストデータ追加と抽出ルール改善
2. CSVエクスポート
3. SQLiteへの保存層移行
4. AIフォールバック用サーバー実装
