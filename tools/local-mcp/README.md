# ローカルMCPからPWAのノートを操作する

## 標準手順：ローカルリポジトリからMCPクライアントへ直接登録する

Node.js 24以上を用意し、このPCのMKBリポジトリで次のコマンドを実行します。
`npm ci --prefix tools/local-mcp --omit=dev --ignore-scripts`

利用するMCPクライアントにstdioサーバーとして登録します。起動コマンドにはNode.js実行ファイルの絶対パス、引数にはこのリポジトリの `tools/local-mcp/server.mjs` の絶対パスを指定してください。登録後もこのフォルダーを同じ場所に置きます。

### Codex CLIでの登録例（PowerShell）

すでにMKBを使っている場合は、先に `codex mcp get mkb_local_prototype` で登録先を確認します。同じサーバーを登録済みなら初回登録は完了です。ZIP版など別の登録先を引き続き使う場合も、以下の登録操作は不要です。

新規登録は次の手順です。

```powershell
$nodeExe = (Get-Command node.exe).Source
$mkbServer = (Resolve-Path tools/local-mcp/server.mjs).Path
codex mcp add mkb_local_prototype -- $nodeExe $mkbServer
codex mcp get mkb_local_prototype
```

Codexを再起動し、新しいチャットで「MKBの初回接続コードを表示してください」と依頼します。下記の手順で保存先をペアリングします。登録はWindowsユーザー単位で一度です。

リポジトリを用意しないPCでは、[任意のWindowsセットアップZIP](windows/README.md)で同じMCPを登録できます。

## WindowsでMKBを自動で開く

ランタイム0.10.0以降では、初回接続コードの発行前に、実行中のサービスがプロファイルの検索・確認・登録に対応しているかを確認します。PCに対応版がある場合は既存のペアリングを使って切り替えます。旧サービスの自然終了を待つときは約40秒後に再確認します。保存中や接続中は先にその操作を終え、別の旧クライアントが起動を維持している場合だけ、それらを閉じて35秒後に再起動します。設定先に必要な機能がない場合はランタイムの更新が必要です。旧版のMCPクライアントプロセスにこの判定を読み込ませるには、導入後に一度クライアントを再起動します。

1. 保存先に使うChromeまたはEdgeでMKBを開き、アプリメニューの **Local MCP** を選びます。
2. **Use this profile for saves** を選びます。初回はローカルエージェントに「MKBの初回接続コードを表示してください」と依頼し、コードを入力します。接続情報を記憶済みなら、そのまま保存先を指定できます。
3. **Find profiles** を押します。使用中のChromeまたはEdgeの標準Windowsプロファイルが1件なら自動選択、複数なら現在のウィンドウの候補を選びます。**Register save destination** で確認用ウィンドウを開き、同じプロファイルで照合できたときに登録します。候補が分からない場合は `chrome://version` または `edge://version` の **Profile Path** の末尾を確認します。
4. MKBを閉じても、次の明示的な保存依頼でこのプロファイルを開きます。ブラウザ側に記憶した識別情報とOriginを確認してから本文を送ります。通常の状態照会では起動しません。別プロファイルや起動失敗は保存前に停止します。
5. **Pause automatic connection** で自動起動を休止し、同じプロファイルで **Resume automatic connection** すると再開します。保存先を変える場合は、新しいプロファイルで同じ手順を開き、現在の保存先と変更先を確認して **Change save destination** を押します。接続コードが必要なときは、元のプロファイルが接続中でもエージェントに表示を依頼できます。変更の確定までは元の登録が有効です。既存ノートは元のプロファイルに残ります。

エージェントは明示的な保存依頼の際、`ensure_connection` で準備した後に接続先を確認できます。`create_note` も必要に応じて起動を待ちます。保存応答が失われた場合は、従来どおり同一の保存先・引数・要求IDで照合してください。

自動起動の回帰試験は `npm run build` の後、`node tools/local-mcp/verify-auto-open.mjs` を実行します。Windowsの確認用ウィンドウと保存時の実際の起動は `--native-chrome` または `--native-edge`、両ブラウザ間の変更はさらに `--switch-browser` を付けて確認できます。試験は一時プロファイルで合成ノートを使います。

## Custom metadata操作（runtime 0.7.0 / Windows Setup 1.4.0）

`preview_custom_metadata_changes`で条件に合うノートと差分を確認し、`apply_custom_metadata_changes`で確認済みplanを一括保存する。Addは欠落キーのみ追加、Updateは既存キーのみ更新、Upsertはキーがなければ追加・あれば更新。Removeは指定キーと値を削除し、キー欠落は正常なskipとする。Removeにvalueは指定しない。同値は変更しない。本文・タイトル・タグ等は保持する。

既存の読み取り・更新許可を使う。最大50ノート、planは10分有効。1件でも競合・編集中・保存失敗なら全件取り消し。再送には同じplan_idとrequest_idを使う。Removeの結果にはremoved_fieldsを返し、再送では後から再追加されたキーを削除しない。[要求・応答JSONと制限](../../docs/local-mcp-custom-metadata-spec.md)を参照。Setup 1.4.0へ更新し、MCPクライアントを再起動、PWAを更新してReconnectする。接続コードは継続利用できる。


## 既存ノートへのアクセス（runtime 0.5.0 / Windows Setup 1.2.0）

`search_notes`、`get_note`、`update_note`を追加。既存の接続コードを使い、MKBの **Local MCP → Note access → Allow reading and updating notes** を一度オンにする。Remember in this browserで接続を保存していれば許可も保持し、以後はReconnectだけで利用できる。初期値はオフ。Forget connectionや異なるコードへの変更では許可を引き継がない。

検索・取得した内容は利用中のエージェントへ渡され、チャット処理の入力になる。同じPCのこのMCPを利用するMCPクライアントが対象で、ノート別・チャット別の権限分離はない。オフへ戻すと検索・取得・更新を止めるが、新規作成は継続できる。未保存draftは取得しない。

- `search_notes`: title/bodyの部分一致、完全一致のANDタグ、最大50件のページ。query省略は一覧。ページ間のsnapshot固定はしない。
- `get_note`: ID指定で本文・metadata・revisionを取得。本文128 KiB UTF-8まで。大きい本文は切り詰めずエラー。
- `update_note`: ID、getで取得したexpected_revision、一意のrequest_idを指定。bodyは全文置換、title/tagsは任意。省略項目とPin/Marp/Custom metadataは保持。body先頭のfrontmatterも文字列として保存。
- `append_note`: 保存本文の末尾へtextをそのまま追記。改行は必要ならtextに含める。
- `replace_note_text`: 既定は完全一致1か所だけを置換。明示的なmode=allで1ノート内の非重複一致を全件置換し、replacement_countを返す。0件は更新しない。想定件数の指定は不要。どちらもgetのrevisionとrequest_idが必要。
- 競合時は再取得して変更を再判断する。未保存の対象ノートには書き込まない。別タブの古いdraftを保存しようとした場合も上書きを拒否し、draftを残す。
- 応答喪失時は**同じrequest_id・同じ入力**で再送する。receiptはブラウザDBに保持され、後続編集を巻き戻さない。サイトデータ消去・別ブラウザ移行後は再送保証の対象外。

例: 「MKBのMCP連携の説明ノートを検索して、Windows導入手順を追記してください」。候補が複数で対象が不明なら確認し、タイトル一致だけで更新先を決めない。

更新時は新版セットアップを実行してMCPクライアントを再起動し、MKBも最新版へ再読み込みする。旧brokerが残る場合は全MCPクライアント終了後35秒待つ。DB移行を他のMKB画面が妨げる場合は、未保存内容を保存してからそれらを閉じる。ペアリングは保持される。

要求・応答の定義、全7ツールのJSON例、エラー形式、再送・容量制限は[Local MCP API設計書（確定版）](../../docs/local-mcp-note-access-spec.md)を参照。隔離Chromiumの実MCP通し試験は`node tools/local-mcp/verify.mjs`。別PCや本番PWAの実動作確認とは区別する。

## 新規作成の本番確認記録（2026-11-16）

Codexの専用MCPツールから、このPCで起動している本番PWAへの新規ノート作成・保存・再読み込み後の保持まで確認済み。本番PWA用の受信パネルを追加し、Codex接続の競合を修正した。

- 配布コミット: `da4f379502032f9c85ff1c0a2a39d43a8a1e05c4`（`codex/local-mcp-pwa`）。本番デプロイ: `dpl_E1bVeJNTzQKnsswAecFVAVUh2kU7`。`mkb.bamboosato.com`への割当てを確認。
- [CI](https://github.com/Bamboosato/markdown-knowledge-board/actions/runs/43813256917)のVerify、Dependency audit、Browser smoke、PWAがすべて成功。
- Chromeのインストール済みPWA（standalone表示）を更新し、接続前に既存99件の保持を確認。専用`connection_status`の`browserOrigin`は`https://mkb.bamboosato.com`。
- 専用`create_note`で「Codex専用MCPからの本番PWA保存確認」を作成。`status: saved`、`reused: false`を受領。ノート数100件、本文・タグ・Saved表示、再読み込み後の保持を画面確認した。手動SDKクライアントは使っていない。
- request_id: `codex-pwa-native-20261116-01`、note ID: `mcp-e34236e9a3a9a5de8a49db6ecde02314bb8ed6f099ae26199c3f40f62121080d`。
- 再読み込みの検証後、同じPWAを再接続した。これは上記コミットを先行配布した時点の検証記録。

## 構成と使い方

### 任意のデスクトップ補助ツール（標準ZIPの対象外）

デスクトップの **MKB Connection Setup** を開き、**Copy connection code** で初回設定用コードをコピーできる。**Open MKB** はインストール済みPWAのショートカットを起動するため、同じChromeプロファイル・ローカルノートを利用する。表示は英語の3ボタンと短い状態表示だけ。

セットアップツールは既存のPC側ペアリングを読み取り、未作成の場合だけ共通の`identity.mjs`で初期設定を作る。既存のトークンを再発行しない。コードは画面・ログ・URLへ出さず、Copyを押したときだけクリップボードへ置く。MCPサービスの起動・ノート保存には登録したMCPクライアントを起動する。

インストールはWindows PowerShellで`tools/local-mcp/install-connection-setup.ps1`を実行する。PWAのショートカットが自動検出できない場合は`-MkbShortcut`で指定する。`ConnectionSetup.cs`を小さなWindows GUI実行ファイルへビルドし、共通のコード取得処理とともに`%LOCALAPPDATA%/MarkdownKnowledgeBoard/ConnectionSetup`へ配置する。通常の起動ではPowerShellを経由せず、リポジトリのブランチ切り替えにも依存しない。更新時はツールを閉じて同じインストーラを再実行する。デスクトップのショートカットには秘密情報を含めない。PowerShellの実行ポリシーは変更しない。

### リポジトリを用意しないPC向けのZIP配布

MKB Windows Setup 1.5.0にはruntime 0.10.0が含まれます。[セットアップZIP](https://github.com/Bamboosato/markdown-knowledge-board/releases/download/mkb-windows-setup-v1.5.0/MKB-Windows-Setup.zip)・[SHA-256チェックサム](https://github.com/Bamboosato/markdown-knowledge-board/releases/download/mkb-windows-setup-v1.5.0/MKB-Windows-Setup.zip.sha256)・[リリース情報](https://github.com/Bamboosato/markdown-knowledge-board/releases/tag/mkb-windows-setup-v1.5.0)

導入先の利用者向け手順は [Windowsセットアップ手順](windows/README.md)。Node.js 24以上とCodexを準備し、ダウンロードしたZIPをすべて展開して`Setup.cmd`を実行する。依存の取得、MCP本体の配置とCodexへの登録を行い、同名の別MCP登録は自動で上書きしない。自動登録にはCodex CLIが必要。CLIを使わない登録と既存環境の移行にも対応する。

開発者はWindowsで次を実行すると、`output/windows-setup/build-*/`に配布ZIPとSHA-256ファイルを作成できる。本体と導入に必要なファイルとハッシュ一覧だけを収録するため、作業フォルダー内のノート・トークン・設定・依存の実体は入らない。依存は導入先でロックファイルから取得する。

```powershell
node tools/local-mcp/windows/build-kit.mjs
node tools/local-mcp/windows/verify-kit.mjs
```

検証には開発用のMCP依存とCodex CLIも必要。隔離した導入先・Codex設定・ペアリングを使い、ZIP展開、新規登録、実MCP起動、Codex登録先からの初回接続コード取得、再インストール、改変パッケージの停止、既存登録の衝突を確認する。証跡は`output/windows-setup/test-*/PC セットアップ/result.json`。Windows MCP setupワークフローも同じ試験を実行し、検証用ZIPを30日間のActions artifactとして保存する。この保持期間は、通常の配布先であるGitHub Releasesの添付ファイルには適用されない。

### PWAとの接続

**Manual connection** は自動接続が未設定のときに表示します。登録後は **Local MCP** の自動接続欄で現在の接続状態を確認し、一時停止・再開できます。

1. **Manual connection** を開き、**Connection code** に初回接続コードを貼り付けて **Connect local MCP** を選びます。
2. **Remember in this browser** を選ぶと、次回から **Manual connection → Reconnect** で再接続できます。
3. **Close** または Esc でパネルを閉じても接続は続きます。保存先を確認するにはMCPクライアントの `connection_status` を使います。
4. **Advanced settings** では接続コードの入れ直し（**Use a new code**）や登録解除（**Forget connection**）ができます。

```json
{
  "request_id": "trial-note-20261116-01",
  "title": "試作ノート",
  "markdown": "# 試作ノート\n\nMCP経由で保存します。",
  "tags": ["試作"]
}
```

- 本番用はViteを起動しない。OSユーザーごとに1つの共有サービスが保存済みのポートで待ち受け、複数のMCPプロセスはそのサービスへ接続する。インターネットやLAN向けには待ち受けない。MCPクライアントがすべて終了すると、最後の操作から約30〜35秒で共有サービスも終了する。次回のMCP起動時に同じ設定で自動起動する。
- PC側の設定はWindowsでは`%LOCALAPPDATA%/MarkdownKnowledgeBoard/mcp/identity.json`、他OSでは`~/.local/state/markdown-knowledge-board/mcp/identity.json`（`MKB_MCP_STATE_DIR`で分離可能）に保存する。初回のポート既定値は47831で、`MKB_MCP_PORT`は初回作成時だけ使用する。既存のペアリングを移行する場合は`loadIdentity({ seed: { port, browserToken } })`で既存値を引き継ぎ、返された値が一致することを確認する。移行後は旧MCPプロセスを終了して新実装を起動する。トークンをリポジトリへ保存・公開しない。
- 設定ファイルは完成した内容を原子的に配置し、同時起動時も同じ設定を共有する。ディレクトリは0700、ファイルは0600で作成し、WindowsではユーザープロファイルのACLも適用される。破損やポート競合で設定を自動再生成・変更しない。ファイルが破損した場合はバックアップから復旧する。意図的に再作成した場合のみPWA側の再ペアリングが必要になる。
- PWA用トークンとMCPクライアント制御用トークンは別々に保持する。制御APIは正確なHost、制御用トークン、JSON POSTを要求し、Origin付きリクエストを拒否する。PWA用トークンだけでは保存指示を発行できない。共有サービス障害時に保存指示を自動再送せず、結果不明として同じrequest_idでの明示再試行を案内する。
- 許可Originは`https://mkb.bamboosato.com`と`https://markdown-knowledge-board.vercel.app`だけ。正確なHost、Origin、Bearerトークン、JSON POSTを検証する。接続したOriginとタブに配送を限定する。
- 接続情報は通常PWAのメモリだけに保持。Rememberを選んだ場合のみ、成功したアドレス・トークンを同じOriginのlocalStorage（`mkb-local-mcp-connection-v1`）に保存する。クラウドバックアップには含めず、共有端末では記憶しない。保存できない場合も接続を維持し、パネルで通知する。読み出した情報も接続前にループバックURLとトークン形式を再検証する。
- 本文・トークン・接続コードをサーバーログへ記録しない。診断ファイル`output/local-mcp/startup-<PID>.json`には起動時刻・PID・段階・失敗理由だけを残す。
- `create_note`は新規保存専用で、既存ノートを上書きしない。既存ノートの変更は許可後の`update_note`で行う。一覧に追加するが編集中のノートを切り替えない。成功応答はIndexedDBトランザクション完了後。
- 新規作成は`request_id`からIDを決める。同一内容の再送は既存ノートを返す。別内容・編集後の衝突は拒否する。保存応答を失った場合は同じID・内容を再送する。
- 本文128 KiB（UTF-8）、タイトル200文字、タグ32件・各80文字。処理中の保存は1件、応答待ちは15秒。バックグラウンド抑制・スリープ中の到達は保証しない。
- ノートは接続したブラウザプロファイル・OriginのIndexedDBに保存される。ディスクの`.md`ファイル保存や他ブラウザへの同期は含まない。必要なら既存のMarkdownエクスポートを使う。

## 接続障害の切り分け

旧実装は各STDIO接続で固定ポート5186のViteを起動していた。同時接続試験で2つ目が`Port 5198 is already in use`となり初期接続がタイムアウトすることを再現した。一時的に接続ごとの動的ポートで解消したが、再起動時にコードが変わるため、現在は永続設定と共有受信サービスへ移行している。固定ポートを各MCPが直接取り合う構成ではない。

デスクトップ内蔵Codex `0.130.0-alpha.5`の公式app-server APIを隔離設定で使用し、変更前後ともツール一覧の取得に成功している。したがってSDKプロトコル全体の非互換ではない。元のチャット失敗ログ自体にはポート競合の直接証拠がなく、再現した構成上の不具合と、当該チャットでの復旧確認は区別する。npm版CLIは`0.169.0`へ更新済みで、内蔵版は変更していない。

修正後にCodexを完全終了・再起動した結果、この同じチャットへ`mcp__mkb_local_prototype__connection_status`と`mcp__mkb_local_prototype__create_note`が公開され、上記の本番保存に成功した。

以前に`chat-client.mjs`でChromeのlocalhostへ「CodexチャットからのMCP保存確認」を保存し再読み込みを確認したが、これは手動SDKクライアントによる開発Originの検証。専用ツール・本番PWAの成功証拠ではない。診断用`chat-client.mjs`は残してあるが通常運用には使わない。

## 検証

```powershell
node --test tools/local-mcp/bridge.test.mjs
node tools/local-mcp/concurrent-probe.mjs
npm run test:unit -- tests/unit/localMcpConnection.test.ts tests/unit/localMcpNote.test.ts tests/unit/db.test.ts
npm run lint
npm run build
```

開発用の通し試験は`node tools/local-mcp/verify.mjs`。隔離Chromiumと架空データを使い、`MKB_MCP_DEV=1`でViteを起動する。開発モードだけは一時ポート・トークンを使い、本番用の永続設定を参照しない。実PWA・本番HTTPSの確認とは区別する。

`concurrent-probe.mjs`は隔離設定と実際の本番用プロセスを使用し、同時起動、PWAと制御APIの認証分離、複数クライアントからの配送、保存処理中のサービス停止、全プロセス再起動後の元ペアリングでの接続、破損設定の保持、ポート競合時の設定保持を検証する。保存応答は模擬で、IndexedDB保存の実証はChromium試験が担当する。CIのVerifyでもこのライフサイクル試験を実行する。

先行配布版では、接続・CORS・タイムアウト等のNodeテスト6件、内蔵Codexのツール一覧取得、Vitest275件、セキュリティテスト83件、CI全4ジョブを確認した。これは冒頭の実PWA保存の検証記録と同じ時点の結果。最新の検証結果はCIと`output/local-mcp/lifecycle-result.json`、`output/playwright/local-mcp/result.json`を参照する。他OSの実PWA、他ブラウザ、スリープ中の到達、全ノート内容の比較は実施していない。

参考: [CodexのMCP設定](https://learn.chatgpt.com/docs/extend/mcp)、[Chrome Local Network Access](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)。
