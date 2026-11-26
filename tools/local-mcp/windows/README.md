# MKB Windows Setup

WindowsにMKBのローカルMCP本体を導入し、Codexに登録するためのセットです。
このZIPにはアプリのソース・インストーラー・依存のロックファイルだけを含み、接続コード、PC固有の設定、ノート、Codexの認証情報は含みません。管理者権限は不要です。

## セットアップ一式の入手

この手順はruntime 0.8.0の本体のみを含むZIPに対応します。以前の[公開版 v1.4.0](https://github.com/Bamboosato/markdown-knowledge-board/releases/tag/mkb-windows-setup-v1.4.0)は、デスクトップの設定アプリもインストールします。

ダウンロードしたセットアップZIPを一度「すべて展開」すると、`MKB-Windows-Setup`フォルダー内に`README.md`と`Setup.cmd`があります。以下の準備・インストール手順に進んでください。今後の更新版は[Releases一覧](https://github.com/Bamboosato/markdown-knowledge-board/releases)で **MKB Windows Setup** を確認します。セットアップ一式とMKB Webアプリのバージョンは別管理です。

## 1. 導入先PCで準備するもの

- Windowsと **Windows PowerShell 5.1**（Windows標準の `powershell.exe`）。PowerShell 7ではインストーラーを実行しません。
- **Node.js 24以上とnpm**。Node.js公式配布のWindowsインストーラーを使い、インストール後にターミナルを開き直してください。
- **Codexアプリ**。自動MCP登録を使う場合は、同じWindowsユーザーで **Codex CLI** の `codex` コマンドも利用できるようにします。CLIがない場合は `npm install -g @openai/codex`。通常はCLIとアプリが同じ `%USERPROFILE%\.codex` 設定を使用します。`CODEX_HOME` を独自指定している場合は、アプリとCLIが同じ設定先を使うことを確認してください。
- 初回接続に使う **ChromeまたはEdge**。保存先にしたいプロファイルで [MKB](https://mkb.bamboosato.com/) を開きます。
- npmレジストリへ接続できるインターネット環境。依存ライブラリは導入時にロックファイルに従って取得し、インストールスクリプトは実行しません。

次のコマンドが動くことを確認します。

```powershell
node --version
npm --version
codex --version
```

## 2. インストール

1. 導入先PCに本体のみのセットアップZIPを用意します。インターネット経由で入手したZIPは、入手元を確認したうえでプロパティの「許可する／ブロックの解除」を行ってから展開してください。
2. **すべて展開**し、展開した `MKB-Windows-Setup` フォルダーを開きます。ZIPの中から直接実行しないでください。
3. **Setup.cmd** をダブルクリックします。案内は英語です。
4. `Setup complete.` を確認します。Codexに `mkb_local_prototype` が登録されます。
5. Codexを終了・再起動して登録を読み込みます。

セットアップは実行ポリシーやブラウザの許可を変更しません。組織の実行制限でブロックされる場合は管理者に確認してください。

### Codex CLIを使わず登録する場合／既存登録を移行する場合

```powershell
powershell.exe -NoProfile -File .\Install.ps1 -SkipMcpRegistration
```

インストール後、`%LOCALAPPDATA%\MarkdownKnowledgeBoard\codex-mcp.toml` を開き、その内容をCodexの `config.toml` に反映します。既存設定を丸ごと置き換えず、`mcp_servers.mkb_local_prototype` の節だけを追加・変更します。同名の節を重複させないでください。Codexを再起動します。

通常のセットアップは、同名MCPが別のインストール先を指している場合に停止します。このPCで以前使っていたリポジトリ直結の登録などは、上の手順で明示的に切り替えてください。既存のPC側ペアリングは引き継がれるので、削除しません。

## 3. 初回の接続

1. 再起動したCodexのチャットで「MKBの初回接続コードを表示してください」と依頼します。未接続時の `connection_status` が返す `MKB1|` から始まるコードをコピーします。すでに接続済みならコードの再入力は不要です。
2. 保存先のブラウザプロファイルでMKBを開き、アプリメニューの **Local MCP → Connection code** にコードを貼り付けます。
3. 個人用PCで自動起動を使う場合は **Remember in this browser** と **Open this profile automatically for save requests** を選びます。ChromeまたはEdgeを選び、そのブラウザの `chrome://version` または `edge://version` の **Profile Path** の最後のフォルダー名（例 `Default`）を入力します。
4. **Connect local MCP** を押します。ブラウザからこのPCへの接続許可を求められた場合は許可し、ヘッダの **MCP connected** を確認します。ペアリング済みの場合は接続後の **Advanced settings → Enable automatic opening** からも登録できます。

Codexで「MKBにタイトル『接続確認』、本文『このPCからの保存確認です。』の新規ノートを作成してください」と依頼し、意図したPWAの一覧と本文に表示されることを確認してください。

別PCのコードや `identity.json` はコピーしません。導入先で初めてコードを取得するかMCPを起動したとき、そのPC用のペアリングを作ります。既存設定があれば再利用します。

## 4. 普段の使い方

- 自動起動を有効にすると、MKBを閉じていても保存依頼時に登録先が開きます。手動接続を選んだ場合は **Local MCP → Reconnect** で接続します。
- **Close / Esc** はパネルを閉じます。**Disconnect local MCP** で自動起動を休止し、同じプロファイルの **Reconnect** で再開します。
- 自動起動の保存先を変える場合は、元のプロファイルの **Advanced settings → Forget connection** で登録を解除します。
- **Advanced settings → Use a new code** は未接続時に接続情報を入れ直す操作です。新しいコードを発行する操作ではありません。
- 新規ノートの保存に加え、明示的な許可後は保存済みノートの検索・取得・更新ができます。対象は接続したPWAのブラウザ内データです。

### 既存ノートを検索・更新する

1. MKBのLocal MCPを開き、Advanced settingsの **Allow reading and updating notes** をオンにします。
2. 接続をRemember in this browserで保存していれば、許可も保持されます。次回はReconnectだけで接続します。
3. Codexへ「MKBの○○というノートを探して、△△を追記してください」と依頼します。

既存ノートの本文はCodexへ渡ります。同じPCのこのMCPを使うチャットが対象です。設定はいつでもオフに戻せます。本文は128 KiB UTF-8まで。未保存の対象ノートや取得後に変更されたノートは更新を拒否します。競合時は最新の内容を再取得してください。保存応答が失われた場合は同じrequest_id・同じ内容で再送し、新しい要求として繰り返さないでください。

旧版からの更新では、全Codexクライアントを終了して35秒待ち、新版のSetup.cmdを実行して再起動します。MKBも再読み込みしてください。他のMKB画面がDB更新を妨げる場合は、未保存内容を保存してから閉じます。既存のペアリング・ノートは保持されます。

### Custom metadataをまとめて変更する

削除例：「タグMKBのノートからCustom metadataのreview_statusキーを削除してください」。削除にはruntime 0.7.0と対応PWAの両方が必要です。

例：「タグMKBのノートで、Custom metadataのreview_statusをreviewedへUpsertしてください」。Addはキーがない場合だけ追加、Updateは既存キーだけ更新、Upsertはなければ追加・あれば更新します。Removeは指定したCustom metadataキーと値を削除します。キーがなければ正常なスキップです。同じ値は書き換えません。本文・タイトル・タグ・Pin・Marpは維持します。

Codexはpreviewで対象と差分を確認し、10分以内に確認済みplanをapplyします。最大50ノートで、1件でも競合・編集中・保存失敗なら全件を取り消します。変更前後のCustom metadataはCodexへ渡ります。正常なスキップは失敗ではありません。切断・権限解除・PWA再読み込み後は未実行planを作り直します。保存応答が失われた場合は、まず同じplan_id/request_idで再送します。

## 5. 保存場所・更新・削除

標準インストール先は `%LOCALAPPDATA%\MarkdownKnowledgeBoard` です。

| 場所 | 内容 |
| --- | --- |
| `start-mcp.mjs` | Codexが起動する固定パスのMCPランチャー |
| `start-mcp.previous.mjs` | 更新直前のランチャーの控え。初回は存在しない |
| `runtimes` | 導入時のMCPサーバーと依存ライブラリ |
| `mcp\identity.json` | PC側の秘密のペアリング情報。共有・公開しない |
| `codex-mcp.toml` | 手動登録用の設定例。トークンは含まない |

`MKB_MCP_STATE_DIR` を明示して導入した場合、PC側ペアリングはその場所を使用し、MCPランチャーにその場所を設定します。

旧版の設定アプリを導入済みの場合、本体の更新時にそのアプリやショートカットを自動削除しません。更新はCodexを終了してから、新しいZIPのSetup.cmdを実行します。既存の登録とペアリングを保持し、ランチャーを新しいランタイムへ切り替えます。失敗したランタイムや以前のランタイムは自動削除しません。更新成功後、古い `runtimes` の各フォルダーは `start-mcp.mjs` が参照していないことを確認して削除できます。

利用をやめる場合は、MKBで切断し、Codexの `mkb_local_prototype` 登録を削除してCodexを終了します。その後、上記のインストールフォルダーを削除できます。ペアリングを再利用したい場合は `mcp` を残してください。

**ノートはブラウザプロファイル・サイトごとのIndexedDBに保存されます。** セットアップは他PCのノートを移行・同期しません。必要なら既存のバックアップ・復元機能を使い、ブラウザのサイトデータを削除する前にバックアップしてください。

## 6. うまく動かない場合

- `codex` / `node` が見つからない：インストールとPATHを確認し、ターミナルを開き直します。CLIなしなら上記の手動登録を使います。
- `mkb_local_prototype already points to another installation`：既存登録を確認し、手動登録の節を使います。自動で上書きしません。
- `Reconnect` に失敗：Codexの起動、MCP登録、Chromeのローカル接続許可、別のMKBタブが接続していないかを確認します。
- ポート競合・設定破損：ペアリングを勝手に削除・再作成しません。競合するプロセスの調査または設定バックアップからの復旧が必要です。
- 保存の応答が不明：既に保存済みの場合があるため、Codexに同じ `request_id`・同じ内容での再試行を依頼します。

このセットはWindows向けです。別PCでの実機受入は、手順3の新規ノート保存までを完了条件としてください。開発元のWindowsでの隔離導入試験と、別PCでの実機確認は区別します。
