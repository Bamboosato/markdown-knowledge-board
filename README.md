# Markdown Knowledge Board

Local-first Markdown knowledge board built with React + Vite + TypeScript, with optional GitHub Gist and Google Drive backups.

ノートの正本はブラウザ内のIndexedDBです。ログインなしで編集・保存でき、クラウド連携は利用者の明示操作で使います。以下は2026-10-06時点の`main`の実装に対応します。

## 起動方法

依存関係のインストール:

```bash
npm install
```

開発サーバー起動:

```bash
npm run dev
```

ビルド:

```bash
npm run build
```

## 使い方

- `New Note`で作成し、`Save`で保存します。保存済みノートを選ぶと`Preview`を表示し、`Edit`でタイトル・タグ・本文を編集できます。新規ノートは保存までDraftです。
- 左ペインの`Import Markdown`から`.md`、`.markdown`、`.txt`を複数選択できます。EditのBodyまたはPreviewへのドロップでも取り込めます。
- 単一ファイルのドロップでは`Add as New Note`／`Replace Current Note Body`を選びます。本文置換ではタイトル・タグ・メタデータを維持します。新規Draftでは本文を変更して`Save`を待ち、保存済みノートでは未保存確認後に置換内容を保存します。新規追加は元ファイルのIDが同じでも別ノートとして登録します。
- 新規取り込みの開始時・完了時とも未保存変更や未確定タグ入力がなく、保存中でもなく、処理中に選択・編集操作がなければ、最初に保存成功したノートを自動選択します。検索・タグ条件と現在のタブは維持します。
- `Filter`でタイトル・本文の部分一致検索とタグ条件を組み合わせます。`Clear`で条件を解除できます。
- ノートカードのメニューから`Pin to top`／`Unpin`で一覧上部への固定を切り替えられます。
- More actionsの`Export Markdown`で現在のdraftを`.md`として出力します。出力先は`Local`／`Google Drive`から選び、Drive未設定・未接続時は`Local`を使います。ノートの保存状態は変更しません。
- More actions の `Print / PDF` で、選択中ノートのPreview本文全体をブラウザの印刷プレビューへ渡せます。PDFとして保存する場合は、ブラウザ／OSの印刷画面で保存先を選択します。
- More actionsの`Export Styled HTML / PDF…`で、色・デザイン・文字サイズ・タグ表示を設定し、`Download HTML`または`Print / PDF`を実行できます。設定と画像の対応付けはその出力画面だけで有効です。
- Styled Exportは画像を埋め込んだ単一HTMLを生成します。HTTPS画像は`Load HTTPS images`で明示的に取得し、取得不能な画像はファイルを対応付けます。画像未解決時は出力を止め、ローカルリンクの警告には`Continue without local links`で続行できます。
- Delete時は確認ダイアログを表示し、削除直後には`Undo`で戻せます。未保存のノートから移動するときは`Save and Continue`／`Discard and Continue`／`Cancel`を選びます。
- YAML frontmatterのタイトル・タグ・Marp設定・独自メタデータをImport／Exportで扱います。独自属性はMore actionsの`Metadata`で編集できます。
- `Preview`の目次からH1〜H3へ移動できます。相対`.md`／`.markdown`リンクは、ファイル名と同名の保存済みノートを開きます。同名が複数ある場合は通知して移動しません。
- Mermaidコードブロックは図とコードを切り替えられます。Marpを有効にしたノートは`Slides`で表示し、テーマ・サイズ・ページ番号・見出し分割を設定できます。
- Preview は本文（body）をそのままMarkdown表示するため、タイトルは二重表示しません。
- EditタブのBody上部にMarkdownツールバーがあり、選択範囲やカーソル位置に記法を挿入できます。
- タスクのチェックは本文の該当行（- [ ] / - [x]）を更新します。ASTの行番号を使うため、同じテキストが複数あっても行位置ベースで切り替わります。
- 保存はWindows／Linuxの`Ctrl+S`、macOSの`Command+S`、新規作成は`Alt+N`でも行えます。PCのEdit／Preview本文上では`Ctrl`＋マウスホイールで表示倍率を80%〜180%に変更できます。
- Application menuには`About / アプリについて`、`Privacy Policy / プライバシーポリシー`、`Terms of Use / 利用規約`へのリンクがあります。

## データ保存先

- ブラウザの IndexedDB（DB名: `markdown-knowledge-board`）に保存します。
- Application menuの`Local Data` → `Backup All Notes`で保存済みノートをJSONへ出力し、`Import Backup`で取り込みます。同じIDのノートは内容が異なれば更新します。クラウド復元のsafe mergeとは異なる経路です。
- ドメイン・ブラウザ・プロファイルごとにローカルデータは独立します。別アドレスを開いてもノートは自動移行されません。
- PWAをアンインストールした場合やブラウザのsite dataを消去した場合に、ローカルノートが保持されるかはOS／ブラウザに依存します。重要なノートは事前に`Backup All Notes`でJSONへ保存してください。

## PWA・オフライン利用

- ProductionではApplication menuの`Install App`からインストールできます。iPhone Safariでは`Install Help`に従ってホーム画面へ追加します。
- 初回オンライン起動でoffline準備が完了した後は、ブラウザやインストール済みアプリを閉じてもofflineで再起動できます。
- offline中もIndexedDBのノート編集、保存、Preview、Mermaid、Slides、ローカルimport／exportを利用できます。外部画像の新規取得、GitHub認証、Google接続、クラウドBackup／Restore、DriveへのMarkdown出力には接続が必要です。
- 新版は自動reloadせず、`Update available`から`Restart to update`を選んだときだけ適用します。未保存変更があれば、保存成功後に更新します。
- 通常の`npm run dev`と`npm run build`ではService Workerを生成・登録しません。PWA専用のローカル確認は次を使用します。

```bash
npm run build:pwa:test
npm run verify:pwa
npm run test:e2e:pwa
```

## 設計ドキュメント

- [現行設計仕様](./docs/design-spec.md)
- [実装・文書整合監査と確認範囲](./docs/documentation-consistency-audit.md)
- [Markdown Import／表示中ノート更新 要件（実装済み）](./docs/markdown-import-current-note-update-requirements.md)
- [Markdown／text新規登録後の自動選択](./docs/markdown-import-auto-activation-requirements.md)
- [Editツールバーメニュー](./docs/edit-toolbar-menu-design.md)
- [Edit Markdown記号アシスト](./docs/edit-markdown-assist-design.md)
- [Metadataダイアログ](./docs/frontmatter-editor-design.md)
- [Preview目次（TOC）](./docs/preview-toc-design.md)
- [Styled Export要件 v0.3](./docs/markdown-knowledge-board-styled-export-requirements-v0.3.md)
- [Styled Export詳細設計](./docs/markdown-knowledge-board-styled-export-design.md)
- [Google Drive連携要件](./docs/google-drive-backup-requirements.md)
- [Google Drive実装設計・本番検証引き継ぎ](./docs/google-drive-implementation-design.md)
- [フェーズ2 認証・クラウドバックアップ要件定義](./docs/phase2-auth-cloud-backup-requirements.md)
- [フェーズ2 認証・クラウドバックアップ基本設計](./docs/phase2-auth-cloud-backup-architecture.md)
- [フェーズ2 API・認証詳細設計](./docs/phase2-auth-cloud-backup-api-design.md)
- [フェーズ2 フロントエンド詳細設計](./docs/phase2-auth-cloud-backup-frontend-design.md)
- [フェーズ2 実装計画・ゲート・PR分割](./docs/phase2-auth-cloud-backup-implementation-plan.md)
- [フェーズ3 PWA要件定義](./docs/phase3-pwa-requirements.md)
- [フェーズ3 PWA基本・詳細設計](./docs/phase3-pwa-design.md)
- [フェーズ3 PWA実装計画](./docs/phase3-pwa-implementation-plan.md)
- [フェーズ3 PWA実機手動チェックリスト](./docs/phase3-pwa-device-checklist.md)

## 任意のクラウド連携

- Application menuの`GitHub`／`Google Drive`は、どちらも補助ラベル`Cloud backup and account`で表示します。バックアップは保存済みノートを対象にし、未保存変更があれば保存確認を行います。自動同期・自動バックアップは行いません。
- GitHubは任意ログイン後、手動でsecret Gistに暗号化バックアップを作成・更新できます。`Restore from Cloud`では復号と差分確認の後にsafe mergeを適用し、ローカルだけのノートや競合するノートを保持します。接続確認失敗時は`Reset GitHub session`で認証Cookieをリセットできます。
- Google Driveは`drive.file`権限で接続し、アプリ管理フォルダー`MKB Backups`へ毎回新しい暗号化バックアップを保存します。過去世代を選んでsafe merge復元できます。アクセストークンはメモリーだけに保持するため、ページ再読込後は再接続します。
- Driveへの`Export Markdown`は非暗号化の1ノート出力です。毎回Pickerでフォルダーを選び、同じフォルダー・同じノートは既存ファイルを更新します。外部変更や前回出力記録がない場合は上書き確認を行います。
- 両サービスの`Disconnect`はローカルノートとクラウドファイルを削除しません。暗号化パスフレーズは保存・送信されず、紛失した場合は復元できません。

GitHubの実OAuth・Gist作成／更新／復元は過去の本番検証記録があります。Google Driveの実OAuth・Picker・書き込みは開発側では未検証です。Google公開環境変数の設定記録と未検証項目は[Google Drive実装設計](./docs/google-drive-implementation-design.md)を参照してください。2026-10-06のHTTP確認では両本番URLの配信JS、manifest、Service Workerを確認しました。実認証や実機動作の再検証は行っていません。

## 制限事項

- GitHub認証・Gistクラウド機能はVercel Productionの`https://mkb.bamboosato.com/`と`https://markdown-knowledge-board.vercel.app/`だけで提供します。Preview環境と通常のlocalhostではローカル機能だけを利用できます。Google Driveは公開環境変数を設定したビルドで表示します。
- 実Gistの初回作成、復元、既存Gistを重複作成しない更新は過去のProduction検証記録があります。
- 4,500,000 bytes成功／4,500,001 bytes拒否はunitテストで固定済みです。Productionでの実上限サイズ試験は追加品質確認として未実施です。
- Cloud Backup／Restore開始時のGist再検出と復号ダイアログの横スクロール修正は`main`へ取り込み済みです。今回の文書監査では本番での操作再検証は実施していません。
- Styled Exportの画像上限は1件5 MiB、合計20 MiB、HTTPS取得タイムアウトは15秒です。外部画像の取得可否はCORS・認証・ネットワークに依存します。
- 印刷のページ余白欄はブラウザ対応に依存します。対応環境では右下に`page / pages`を表示し、Styled Exportでは上中央に文書タイトルを表示します。ブラウザ標準のヘッダー／フッター設定は利用者が調整します。
- Slides専用のHTML／PDF／PPTX出力はありません。通常の`Print / PDF`はPreview本文、Styled Exportはノート本文からの文書出力です。
- ブラウザのストレージ容量の制限に依存します。
- PWAはProduction環境変数`VITE_PWA_ENABLED=true`を設定したbuildだけで有効になります。Preview deploymentと通常localhostではService Workerを登録しません。
- Android Chrome／iPhone Safariの最終実機確認は[実機手動チェックリスト](./docs/phase3-pwa-device-checklist.md)に従って実施します。
