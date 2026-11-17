# ローカルMCPからPWAのノートを操作する


## 既存ノートへのアクセス（runtime 0.4.0 / Windows Setup 1.1.0）

`search_notes`、`get_note`、`update_note`を追加。既存の接続コードを使い、MKBの **Local MCP → Advanced settings → Allow reading and updating notes** を一度オンにする。Remember in this browserで接続を保存していれば許可も保持し、以後はReconnectだけで利用できる。初期値はオフ。Forget connectionや異なるコードへの変更では許可を引き継がない。

検索・取得した内容はCodexへ渡され、チャット処理の入力になる。同じPCのこのMCPを利用するCodexチャットが対象で、ノート別・チャット別の権限分離はない。オフへ戻すと検索・取得・更新を止めるが、新規作成は継続できる。未保存draftは取得しない。

- `search_notes`: title/bodyの部分一致、完全一致のANDタグ、最大50件のページ。query省略は一覧。ページ間のsnapshot固定はしない。
- `get_note`: ID指定で本文・metadata・revisionを取得。本文128 KiB UTF-8まで。大きい本文は切り詰めずエラー。
- `update_note`: ID、getで取得したexpected_revision、一意のrequest_idを指定。bodyは全文置換、title/tagsは任意。省略項目とPin/Marp/Custom metadataは保持。body先頭のfrontmatterも文字列として保存。
- 競合時は再取得して変更を再判断する。未保存の対象ノートには書き込まない。別タブの古いdraftを保存しようとした場合も上書きを拒否し、draftを残す。
- 応答喪失時は**同じrequest_id・同じ入力**で再送する。receiptはブラウザDBに保持され、後続編集を巻き戻さない。サイトデータ消去・別ブラウザ移行後は再送保証の対象外。

例: 「MKBのMCP連携の説明ノートを検索して、Windows導入手順を追記してください」。候補が複数で対象が不明なら確認し、タイトル一致だけで更新先を決めない。

更新時は新版セットアップを実行してCodexを再起動し、MKBも最新版へ再読み込みする。旧brokerが残る場合は全Codexクライアント終了後35秒待つ。DB移行を他のMKB画面が妨げる場合は、未保存内容を保存してからそれらを閉じる。ペアリングは保持される。

詳細は[既存ノートアクセス仕様](../../docs/local-mcp-note-access-spec.md)。隔離Chromiumの実MCP通し試験は`node tools/local-mcp/verify.mjs`。別PCや本番PWAの実動作確認とは区別する。

## 新規作成の本番確認記録（2026-11-16）

Codexの専用MCPツールから、このPCで起動している本番PWAへの新規ノート作成・保存・再読み込み後の保持まで確認済み。本番PWA用の受信パネルを追加し、Codex接続の競合を修正した。

- 配布コミット: `da4f379502032f9c85ff1c0a2a39d43a8a1e05c4`（`codex/local-mcp-pwa`）。本番デプロイ: `dpl_E1bVeJNTzQKnsswAecFVAVUh2kU7`。`mkb.bamboosato.com`への割当てを確認。
- [CI](https://github.com/Bamboosato/markdown-knowledge-board/actions/runs/43813256917)のVerify、Dependency audit、Browser smoke、PWAがすべて成功。
- Chromeのインストール済みPWA（standalone表示）を更新し、接続前に既存99件の保持を確認。専用`connection_status`の`browserOrigin`は`https://mkb.bamboosato.com`。
- 専用`create_note`で「Codex専用MCPからの本番PWA保存確認」を作成。`status: saved`、`reused: false`を受領。ノート数100件、本文・タグ・Saved表示、再読み込み後の保持を画面確認した。手動SDKクライアントは使っていない。
- request_id: `codex-pwa-native-20261116-01`、note ID: `mcp-e34236e9a3a9a5de8a49db6ecde02314bb8ed6f099ae26199c3f40f62121080d`。
- 再読み込みの検証後、同じPWAを再接続した。これは上記コミットを先行配布した時点の検証記録。

## 構成と使い方

### MKB Connection Setup（Windows）

デスクトップの **MKB Connection Setup** を開き、**Copy connection code** で初回設定用コードをコピーできる。Codexへの質問は不要。**Open MKB** はインストール済みPWAのショートカットを起動するため、同じChromeプロファイル・ローカルノートを利用する。表示は英語の3ボタンと短い状態表示だけ。

セットアップツールは既存のPC側ペアリングを読み取り、未作成の場合だけ共通の`identity.mjs`で初期設定を作る。既存のトークンを再発行しない。コードは画面・ログ・URLへ出さず、Copyを押したときだけクリップボードへ置く。MCPサービスの起動・ノート保存には従来どおりCodexを起動する。

インストールはWindows PowerShellで`tools/local-mcp/install-connection-setup.ps1`を実行する。PWAのショートカットが自動検出できない場合は`-MkbShortcut`で指定する。`ConnectionSetup.cs`を小さなWindows GUI実行ファイルへビルドし、共通のコード取得処理とともに`%LOCALAPPDATA%/MarkdownKnowledgeBoard/ConnectionSetup`へ配置する。通常の起動ではPowerShellを経由せず、リポジトリのブランチ切り替えにも依存しない。更新時はツールを閉じて同じインストーラを再実行する。デスクトップのショートカットには秘密情報を含めない。PowerShellの実行ポリシーは変更しない。

### 他のWindows PCへ配布する

通常の配布先は[GitHub Releases：MKB Windows Setup v1.1.0](https://github.com/Bamboosato/markdown-knowledge-board/releases/tag/mkb-windows-setup-v1.1.0)。[セットアップZIP](https://github.com/Bamboosato/markdown-knowledge-board/releases/download/mkb-windows-setup-v1.1.0/MKB-Windows-Setup.zip)と[SHA-256チェックサム](https://github.com/Bamboosato/markdown-knowledge-board/releases/download/mkb-windows-setup-v1.1.0/MKB-Windows-Setup.zip.sha256)を取得でき、Releaseの添付ファイルは30日で自動失効しない。

導入先の利用者向け手順は [Windowsセットアップ手順](windows/README.md)。Node.js 24以上、Codex、ChromeのMKB PWAを準備し、ダウンロードしたZIPをすべて展開して`Setup.cmd`を実行する。依存の取得、MCPの配置・登録、設定ツールの作成を行い、同名の別MCP登録は自動で上書きしない。自動登録にはCodex CLIが必要。CLIを使わない登録と既存環境の移行にも対応する。

開発者はWindowsで次を実行すると、`output/windows-setup/build-*/`に配布ZIPとSHA-256ファイルを作成できる。明示した16ファイルとハッシュ一覧だけを収録するため、作業フォルダー内のノート・トークン・設定・依存の実体は入らない。依存は導入先でロックファイルから取得する。

```powershell
node tools/local-mcp/windows/build-kit.mjs
node tools/local-mcp/windows/verify-kit.mjs
```

検証には開発用のMCP依存とCodex CLIも必要。隔離した導入先・デスクトップ・Codex設定・ペアリングを使い、ZIP展開、新規登録、実MCP起動、設定ツールとのペアリング共有、再インストール、改変パッケージの停止、既存登録の衝突を確認する。PWAショートカットは模擬で、別PCでの実PWA保存試験ではない。証跡は`output/windows-setup/test-*/PC セットアップ/result.json`。Windows MCP setupワークフローも同じ試験を実行し、検証用ZIPを30日間のActions artifactとして保存する。この保持期間は、通常の配布先であるGitHub Releasesの添付ファイルには適用されない。

### PWAとの接続

以下はヘッダの接続インジケータを使用する手順。メニューは「Data & Backup」と「AI Integration」に分け、Local MCPは「AI Integration」に配置する。メニュー・接続表示は英語で統一し、説明は必要時のみ表示する。上記の本番検証記録は大きな接続パネルを表示する旧UIで行った結果。
隔離Chromiumの通し試験は、接続成功時のパネル自動非表示、再表示・Esc後の接続維持とフォーカス復帰、非表示中の実保存、390px幅の表示、明示切断・通信エラー・再接続を含む。接続コード、記憶への同意、再読み込み後のボタン再接続、古い情報からの復帰、記憶の削除、ストレージ保存失敗も検証する。表示証跡は`output/playwright/local-mcp/`の`saved.png`、`indicator-mobile.png`、`reconnect.png`。

`Codex専用MCPツール → STDIOクライアント → このPCの共有受信サービス → 本番PWA → IndexedDB → 保存結果`

1. `npm ci --prefix tools/local-mcp --ignore-scripts`で専用依存を準備する。本体の依存・DBスキーマは変更しない。
2. Codexのユーザー設定へ次のMCPを登録する。このPCでは登録済み。

```toml
[mcp_servers.mkb_local_prototype]
command = "C:/Program Files/nodejs/node.exe"
args = ["D:/work_codex/markdown-knowledge-board/tools/local-mcp/server.mjs"]
cwd = "D:/work_codex/markdown-knowledge-board"
startup_timeout_sec = 60
tool_timeout_sec = 30
enabled = true
```

3. 初回だけMKB Connection Setupの**Copy connection code**でコードを取得する。専用MCPの`connection_status`が返す`pairingCode`も使える。コードは当該利用者の接続設定専用で、共有・公開しない。ペアリングはPC単位で保持し、同じOSユーザーで起動した複数のCodexチャットが、同じペアリング済みPWAを利用する。
4. 保存先のPWAでアプリメニュー → **Local MCP** を開き、**Connection code**へ1回貼り付け、**Connect local MCP**。従来の個別入力は **Enter address and token** から利用できる。ChromeがこのPCへの接続許可を求めた場合は利用者が許可する。
   初回の許可待ちは最大60秒。許可前にタイムアウトした場合は、許可後にもう一度 **Connect local MCP** を押す。
   個人用端末では **Remember in this browser** を選ぶと、成功した接続情報だけをこのブラウザに記憶する。次回はメニュー → Local MCP → **Reconnect**。自動接続はせず、通常のDisconnectでは記憶を残す。**Forget connection** は記憶だけを削除し、現在の接続は維持する。
5. `connection_status`の`browserOrigin`が意図した本番サイトであることを確認してから`create_note`を呼ぶ。
6. 接続成功時にパネルは自動で隠れ、ヘッダに緑の「MCP connected」を表示する。インジケータまたはアプリメニューからパネルを開き直せる。「Close」・Escでは接続を維持する。
7. 明示的な **Disconnect local MCP**、PWA再読み込み・終了、共有サービスの終了で接続が終了する。Codex/MCPやPCの再起動後も、Codexを起動してPWAの **Reconnect** を押すだけでよい。コードは変わらない。Codexを短時間で再起動し共有サービスが動き続けている場合は、既存の接続も維持する。
   **Forget connection**と**Use a new code**は**Advanced settings**内に配置する。Use a new codeは未接続時に接続情報を入れ直す操作で、コードの生成ではない。接続に失敗した場合はCodexの起動と他の接続中タブを確認し、Reconnectを再試行する。ヘッダのMCP表示はNo note / Savedなどの保存状態の右側に表示する。

```json
{
  "request_id": "trial-note-20261116-01",
  "title": "試作ノート",
  "markdown": "# 試作ノート\n\nMCP経由で保存します。",
  "tags": ["試作"]
}
```

- 本番用はViteを起動しない。OSユーザーごとに1つの共有サービスが保存済みのポートで待ち受け、複数のMCPプロセスはそのサービスへ接続する。インターネットやLAN向けには待ち受けない。Codexクライアントがすべて終了すると、最後の操作から約30〜35秒で共有サービスも終了する。次回のMCP起動時に同じ設定で自動起動する。
- PC側の設定はWindowsでは`%LOCALAPPDATA%/MarkdownKnowledgeBoard/mcp/identity.json`、他OSでは`~/.local/state/markdown-knowledge-board/mcp/identity.json`（`MKB_MCP_STATE_DIR`で分離可能）に保存する。初回のポート既定値は47831で、`MKB_MCP_PORT`は初回作成時だけ使用する。既存のペアリングを移行する場合は`loadIdentity({ seed: { port, browserToken } })`で既存値を引き継ぎ、返された値が一致することを確認する。移行後は旧MCPプロセスを終了して新実装を起動する。トークンをリポジトリへ保存・公開しない。
- 設定ファイルは完成した内容を原子的に配置し、同時起動時も同じ設定を共有する。ディレクトリは0700、ファイルは0600で作成し、WindowsではユーザープロファイルのACLも適用される。破損やポート競合で設定を自動再生成・変更しない。ファイルが破損した場合はバックアップから復旧する。意図的に再作成した場合のみPWA側の再ペアリングが必要になる。
- PWA用トークンとCodex制御用トークンは別々に保持する。制御APIは正確なHost、制御用トークン、JSON POSTを要求し、Origin付きリクエストを拒否する。PWA用トークンだけでは保存指示を発行できない。共有サービス障害時に保存指示を自動再送せず、結果不明として同じrequest_idでの明示再試行を案内する。
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
