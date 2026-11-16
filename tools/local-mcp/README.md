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

以下はヘッダの接続インジケータを使用する手順。メニューは「データ管理・バックアップ」と「AI連携」に分け、Local MCPは「AI連携」に配置する。上記の本番検証記録は大きな接続パネルを表示する旧UIで行った結果。
改善版では隔離Chromiumの通し試験13項目を確認済み。接続成功時のパネル自動非表示、再表示・Esc後の接続維持とフォーカス復帰、非表示中の実保存、390px幅のインジケータ表示、明示切断・通信エラー・再接続を含む。表示証跡は`output/playwright/local-mcp/saved.png`と`indicator-mobile.png`。

`Codex専用MCPツール → STDIOサーバー → 127.0.0.1のHTTP → 本番PWA → IndexedDB → 保存結果`

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

3. 専用MCPの`connection_status`を呼ぶ。未接続の場合に返る`origin`と`pairingToken`を使う。トークンは共有・公開しない。
4. 保存先のPWAでアプリメニュー → **Local MCP** を開き、**Server address** と **Pairing token** を入力して **Connect local MCP**。ChromeがこのPCへの接続許可を求めた場合は利用者が許可する。
   初回の許可待ちは最大60秒。許可前にタイムアウトした場合は、許可後にもう一度 **Connect local MCP** を押す。
5. `connection_status`の`browserOrigin`が意図した本番サイトであることを確認してから`create_note`を呼ぶ。
6. 接続成功時にパネルは自動で隠れ、ヘッダに緑の「MCP接続中」を表示する。インジケータまたはアプリメニューからパネルを開き直せる。「閉じる」・Escでは接続を維持する。
7. 明示的な **Disconnect local MCP**、再読み込み、アプリ終了、MCP終了で接続が終了する。接続切れはヘッダの「MCP接続エラー」で確認できる。再接続時はそのチャットの最新のアドレス・トークンを使う。

```json
{
  "request_id": "trial-note-20261116-01",
  "title": "試作ノート",
  "markdown": "# 試作ノート\n\nMCP経由で保存します。",
  "tags": ["試作"]
}
```

- 本番用はViteを起動せず、OSが割り当てた空きポートで待ち受ける。別チャットや一覧取得用の接続と競合しない。インターネットやLAN向けには待ち受けない。
- 許可Originは`https://mkb.bamboosato.com`と`https://markdown-knowledge-board.vercel.app`だけ。正確なHost、Origin、Bearerトークン、JSON POSTを検証する。接続したOriginとタブに配送を限定する。
- 接続情報はPWAのメモリだけに保持。本文・トークンをサーバーログへ記録しない。診断ファイル`output/local-mcp/startup-<PID>.json`には起動時刻・PID・段階・失敗理由だけを残す。
- 新規保存だけを提供し、既存ノートを上書きしない。一覧に追加するが編集中のノートを切り替えない。成功応答はIndexedDBトランザクション完了後。
- `request_id`からIDを決める。同一内容の再送は既存ノートを返す。別内容・編集後の衝突は拒否する。保存応答を失った場合は同じID・内容を再送する。
- 本文128 KiB（UTF-8）、タイトル200文字、タグ32件・各80文字。処理中の保存は1件、応答待ちは15秒。バックグラウンド抑制・スリープ中の到達は保証しない。
- ノートは接続したブラウザプロファイル・OriginのIndexedDBに保存される。ディスクの`.md`ファイル保存や他ブラウザへの同期は含まない。必要なら既存のMarkdownエクスポートを使う。

## 接続障害の切り分け

旧実装は各STDIO接続で固定ポート5186のViteを起動していた。同時接続試験で2つ目が`Port 5198 is already in use`となり初期接続がタイムアウトすることを再現した。空きポート・本番用の軽量HTTPサーバーへ変更後は2接続が同時に成功した。

デスクトップ内蔵Codex `0.130.0-alpha.5`の公式app-server APIを隔離設定で使用し、変更前後ともツール一覧の取得に成功している。したがってSDKプロトコル全体の非互換ではない。元のチャット失敗ログ自体にはポート競合の直接証拠がなく、再現した構成上の不具合と、当該チャットでの復旧確認は区別する。npm版CLIは`0.169.0`へ更新済みで、内蔵版は変更していない。

修正後にCodexを完全終了・再起動した結果、この同じチャットへ`mcp__mkb_local_prototype__connection_status`と`mcp__mkb_local_prototype__create_note`が公開され、上記の本番保存に成功した。

以前に`chat-client.mjs`でChromeのlocalhostへ「CodexチャットからのMCP保存確認」を保存し再読み込みを確認したが、これは手動SDKクライアントによる開発Originの検証。専用ツール・本番PWAの成功証拠ではない。診断用`chat-client.mjs`は残してあるが通常運用には使わない。

## 検証

```powershell
node --test tools/local-mcp/bridge.test.mjs
node tools/local-mcp/concurrent-probe.mjs
npm run test:unit -- tests/unit/localMcpNote.test.ts tests/unit/db.test.ts
npm run lint
npm run build
```

開発用の通し試験は`node tools/local-mcp/verify.mjs`。隔離Chromiumと架空データを使い、`MKB_MCP_DEV=1`でViteを起動する。実PWA・本番HTTPSの確認とは区別する。前版で11観点（保存、日本語、再送、衝突、未保存編集保護、保存失敗、再読み込み、応答喪失等）を確認済み。

今回、接続・CORS・タイムアウト等のNodeテスト6件、2クライアント同時接続と内蔵Codexのツール一覧取得を確認した。ローカルの全Vitest275件（保存関連7件を含む）、セキュリティテスト83件、lint、型チェック・buildも成功。CIの全4ジョブに加え、上記の実PWAでブラウザ権限・専用ツール公開・実保存・再読み込みまで確認した。他OS、他ブラウザ、スリープ中の到達、全ノート内容の比較は実施していない。

参考: [CodexのMCP設定](https://learn.chatgpt.com/docs/extend/mcp)、[Chrome Local Network Access](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access)。
