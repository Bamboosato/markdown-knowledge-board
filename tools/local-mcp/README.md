# ローカルMCPからPWAへ新規ノートを保存する

## 現在の状態（2026-11-16）

Codexの専用MCPツールから、このPCで起動している本番PWAへの新規ノート作成・保存・再読み込み後の保持まで確認済み。本番PWA用の受信パネルを追加し、Codex接続の競合を修正した。

- 配布コミット: `da4f379502032f9c85ff1c0a2a39d43a8a1e05c4`（`codex/local-mcp-pwa`）。本番デプロイ: `dpl_E1bVeJNTzQKnsswAecFVAVUh2kU7`。`mkb.bamboosato.com`への割当てを確認。
- [CI](https://github.com/Bamboosato/markdown-knowledge-board/actions/runs/43813256917)のVerify、Dependency audit、Browser smoke、PWAがすべて成功。
- Chromeのインストール済みPWA（standalone表示）を更新し、接続前に既存99件の保持を確認。専用`connection_status`の`browserOrigin`は`https://mkb.bamboosato.com`。
- 専用`create_note`で「Codex専用MCPからの本番PWA保存確認」を作成。`status: saved`、`reused: false`を受領。ノート数100件、本文・タグ・Saved表示、再読み込み後の保持を画面確認した。手動SDKクライアントは使っていない。
- request_id: `codex-pwa-native-20261116-01`、note ID: `mcp-e34236e9a3a9a5de8a49db6ecde02314bb8ed6f099ae26199c3f40f62121080d`。
- 再読み込みの検証後、同じPWAを再接続した。これは上記コミットを先行配布した時点の検証記録。

## 構成と使い方

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

3. 初回だけ専用MCPの`connection_status`が返す`pairingCode`を使う。コードは当該利用者の接続設定専用で、共有・公開しない。ペアリングはPC単位で保持し、同じOSユーザーで起動した複数のCodexチャットが、同じペアリング済みPWAを利用する。
4. 保存先のPWAでアプリメニュー → **Local MCP** を開き、**Connection code**へ1回貼り付け、**Connect local MCP**。従来の個別入力は **Enter address and token** から利用できる。ChromeがこのPCへの接続許可を求めた場合は利用者が許可する。
   初回の許可待ちは最大60秒。許可前にタイムアウトした場合は、許可後にもう一度 **Connect local MCP** を押す。
   個人用端末では **Remember in this browser** を選ぶと、成功した接続情報だけをこのブラウザに記憶する。次回はメニュー → Local MCP → **Reconnect**。自動接続はせず、通常のDisconnectでは記憶を残す。**Forget connection** は記憶だけを削除し、現在の接続は維持する。
5. `connection_status`の`browserOrigin`が意図した本番サイトであることを確認してから`create_note`を呼ぶ。
6. 接続成功時にパネルは自動で隠れ、ヘッダに緑の「MCP connected」を表示する。インジケータまたはアプリメニューからパネルを開き直せる。「Close」・Escでは接続を維持する。
7. 明示的な **Disconnect local MCP**、PWA再読み込み・終了、共有サービスの終了で接続が終了する。Codex/MCPやPCの再起動後も、Codexを起動してPWAの **Reconnect** を押すだけでよい。コードは変わらない。Codexを短時間で再起動し共有サービスが動き続けている場合は、既存の接続も維持する。
   **Use a new code** は別PCの設定や意図的にペアリングを作り直した場合だけ使用する。接続に失敗した場合はCodexの起動と他の接続中タブを確認し、Reconnectを再試行する。

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
- 新規保存だけを提供し、既存ノートを上書きしない。一覧に追加するが編集中のノートを切り替えない。成功応答はIndexedDBトランザクション完了後。
- `request_id`からIDを決める。同一内容の再送は既存ノートを返す。別内容・編集後の衝突は拒否する。保存応答を失った場合は同じID・内容を再送する。
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
