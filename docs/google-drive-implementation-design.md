# Google Drive連携 実装設計・本番検証引き継ぎ

作成日: 2026-09-30。要件は[Google Drive連携・バックアップ・Markdown出力 要件定義](./google-drive-backup-requirements.md)を参照。

更新日: 2026-10-06。状態: PR #42〜#44、#46の実装を`main`へ取り込み済み。実Google認証・Picker・Drive操作の受入検証は開発側では未実施。

## 実装の構成

- `src/hooks/useGoogleDrive.ts`: Google Drive接続状態、期限切れ、接続終了、権限取消を管理する。アクセストークンはメモリーのみに保持する。
- `src/lib/googleIdentity.ts`: Google Identity Servicesのtoken modelで `drive.file` を要求し、Google Pickerで出力先フォルダーを選択する。
- `src/lib/googleDrive.ts`: Drive APIのアカウント確認、ファイル・フォルダー検索、作成、取得、更新を担当する。
- `src/lib/googleDriveOperations.ts`: 暗号化バックアップ、既存の差分復元、Markdown出力と更新先判定を担当する。
- `src/components/cloud/GoogleDriveSection.tsx`、`GoogleDriveDialog.tsx`: 既存GitHub区画に合わせた接続・操作UI。`src/App.tsx`から既存編集・メニュー状態へ接続する。

Application menuのGitHub／Google Driveは同じ`Cloud backup and account`補助ラベルを使う。接続終了は各サービスの`Disconnect`へ集約し、独立した`Sign out`項目は表示しない。Googleの解除確認は`Disconnect Google Drive`／`Cancel`を表示し、確認すると認可取消を試みる。公開情報ページへのリンクはクラウドカテゴリの下の区切り線に続けて表示する。

バックアップは `MKB Backups` のアプリ管理フォルダーへ、毎回新しい暗号化ファイルを作成する。フォルダーとファイルはDriveの `appProperties` で識別し、名前が同じだけのユーザーファイルを採用しない。過去世代は削除しない。バックアップ形式は既存の `BackupDocument` version 1と暗号化形式を再利用する。

Export Markdownは現在のノートの出力用スナップショットを使用する。毎回Google Pickerでフォルダーを選び、ノートIDを `appProperties` に付けた `.md` ファイルとして作成する。同じフォルダーとノートIDのファイルが1つ見つかれば更新する。前回出力時のMD5と差がある場合やローカル記録がない場合は上書き確認を行う。Driveのファイル名はノートの最新タイトルへ更新する。

Picker表示中は`Selecting a folder…`、送信中は`Uploading to Google Drive…`をスピナーとstatus通知で表示する。キャンセル／結果画面まで含めて二重操作を抑止し、Drive未接続・期限切れ・offlineではDrive出力を無効にする。バックアップ先の`MKB Backups`は自動管理し、Pickerで選ぶのはMarkdown出力先だけである。

## Google Cloud設定

本番ビルドに以下の公開環境変数を設定する。値はGoogle Cloud側で用意し、リポジトリへ実値を書き込まない。

| 変数 | 内容 |
| --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | WebアプリのOAuthクライアントID |
| `VITE_GOOGLE_API_KEY` | Google Picker用APIキー。対象サイトとAPIを制限する |
| `VITE_GOOGLE_APP_ID` | Google Cloudプロジェクト番号。Pickerの `setAppId` に渡す |

Drive APIとGoogle Picker APIを有効化する。OAuth同意画面に `https://www.googleapis.com/auth/drive.file` を登録する。Google連携の本番対象は独自ドメインの `https://mkb.bamboosato.com` とし、Webクライアントの承認済みJavaScript Originへ登録する。GIS token modelはJavaScriptのcallbackでトークンを受け取るため、承認済みリダイレクトURIは不要。ブランディングの承認済みドメインは `bamboosato.com` とする。Picker APIキーのウェブサイト制限には `https://mkb.bamboosato.com/*` と `https://docs.google.com/*` を登録し、API制限にはPicker APIとDrive APIを含める。OAuthクライアント、APIキー、プロジェクト番号は同一プロジェクトのものを使用する。設定後は再ビルド・再デプロイが必要。これらの変数が欠けたビルドではGoogle Driveメニューを表示しない。

ローカルではGit除外対象の `.env.local` に3つの値を設定する。Vercel Productionには同じ変数名で別途設定する必要があり、ローカルのファイルはデプロイ先へ自動反映されない。Preview・Developmentは必要なOriginを個別に登録するまでGoogle連携用の値を設定しない。APIキーはブラウザで使う公開値としてビルドに含まれるため、利用先とAPIの制限で管理する。

2026-10-01: 利用者からGoogle Cloud設定完了の報告と値の提供を受け、開発環境の `.env.local` と既存Vercelプロジェクト `markdown-knowledge-board` のProductionに3変数を設定した。ローカルで設定値の読み込みとビルド成功を確認した。Google Cloud側の設定内容と実認可・Picker動作は開発側では未確認。本番反映はPRのmainマージに伴うVercelの自動デプロイで行う。Preview・Developmentには値を設定していない。

2026-10-06の文書監査: 上記PRはマージ済み。両本番URLの配信JSにGoogle DriveのUI実装が含まれることをHTTP取得で確認した。これはOAuthクライアント／APIキーの有効性や実Drive操作の確認ではなく、未検証項目は引き続き下記のとおりである。

参考: [Google Picker Web設定](https://developers.google.com/workspace/drive/picker/guides/web-picker)、[Driveの権限スコープ](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)。

## 現時点での限界と本番確認項目

- Google実アカウントによるOAuth、Picker、Drive書き込みは開発側では実施していない。本番環境のテスト担当者が確認する。
- Googleのaccess tokenはページ更新で失われるため、再度接続操作が必要になる。接続表示はメモリー内の有効期限を反映する。
- Driveの既存Markdown更新は、事前にファイル情報を確認し、外部変更時に確認を求める。事前確認から更新までの端末間競合に対する原子的な排他保証はない。実APIで条件付き更新の可否を確認し、可能なら採用する。
- フォルダーの重複が見つかった場合は通常操作を止め、管理フォルダーを選ぶ復旧UIを表示する。選択後も対象IDが有効か再確認する。
- 保存応答の消失時、バックアップでは操作IDで結果を再照会する。Markdownの新規作成・更新では結果未確認を表示する可能性があるため、再試行前にDrive上の対象を確認する。
- 本番では `https://mkb.bamboosato.com` でOAuth接続を確認し、固定フォルダーの初回作成・改名後の追跡、別端末からの再検出、`.md`の同一ファイル更新、権限取消、期限切れ、429/403、狭い画面を受入条件に沿って検証する。
- Gemini Notebook等によるMarkdownの直接参照と更新追従は外部アプリ側の機能であり、本番テスト担当者が別に確認する。

## 開発側の検証

TypeScriptビルド、lint、Drive API層の単体テスト、既存の対象テスト、ローカル画面の未接続時操作を確認する。Google実サービスに接続しないテストと本番の実連携確認を区別して記録する。`docs/pwa-jump-list-feasibility.md` は無関係の既存ローカル資料として変更しない。

2026-09-30の開発側確認: `npm run build`、`npm run lint`、`npm run test:unit`（22ファイル・229件）、`git diff --check`が成功。ローカル画面でGoogle Driveメニュー、未接続時のExport Markdownの無効状態、390px幅の横スクロールなしを確認した。E2E範囲はこのローカルの対象操作のみで、実OAuth・Google Picker・Drive API・外部アプリ連携、実モバイル、クロスブラウザーは未実施。実Google連携は本番環境でテスト担当者が検証する。

2026-10-01のPR前確認: 設定済みビルド、lint、単体テスト229件、差分の空白チェックが成功。E2Eは修正リスクに応じて出力経路に限定し、オフライン中のLocal出力・再接続をChromium／Firefox／WebKitの各1件、取り込んだ独自メタデータのMarkdown出力をChromiumの1件で確認した（合計4件）。既存テストのメニュー名指定と取り込み確認操作を現行UIに合わせ、出力先ダイアログで未接続のDriveが無効になることを検証している。E2E全件、実Google認証・Picker・Drive API、実モバイルの検証は未実施。
