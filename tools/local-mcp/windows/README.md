# MKB Windows Setup

別のWindows PCに、MKBのローカルMCPと **MKB Connection Setup** を導入するセットです。
このZIPにはアプリのソース・インストーラー・依存のロックファイルだけを含み、接続コード、PC固有の設定、ノート、Codexの認証情報は含みません。管理者権限は不要です。

## セットアップ一式の入手

通常は[GitHub Releases：MKB Windows Setup v1.0.0](https://github.com/Bamboosato/markdown-knowledge-board/releases/tag/mkb-windows-setup-v1.0.0)のAssetsから、次のファイルをダウンロードしてください。

- [MKB-Windows-Setup.zip](https://github.com/Bamboosato/markdown-knowledge-board/releases/download/mkb-windows-setup-v1.0.0/MKB-Windows-Setup.zip)：セットアップ一式
- [MKB-Windows-Setup.zip.sha256](https://github.com/Bamboosato/markdown-knowledge-board/releases/download/mkb-windows-setup-v1.0.0/MKB-Windows-Setup.zip.sha256)：対応するZIPのSHA-256チェックサム

Releaseの添付ファイルは30日で自動失効しません。GitHub Actionsの検証用Artifactsに設定された30日間の保持期間とは別です。公開中のReleaseから同じリンクで取得できます。

ダウンロードしたセットアップZIPを一度「すべて展開」すると、`MKB-Windows-Setup`フォルダー内に`README.md`と`Setup.cmd`があります。以下の準備・インストール手順に進んでください。今後の更新版は[Releases一覧](https://github.com/Bamboosato/markdown-knowledge-board/releases)で **MKB Windows Setup** を確認します。セットアップ一式とMKB Webアプリのバージョンは別管理です。

## 1. 導入先PCで準備するもの

- Windowsと **Windows PowerShell 5.1**（Windows標準の `powershell.exe`）。PowerShell 7ではインストーラーを実行しません。
- **Node.js 24以上とnpm**。Node.js公式配布のWindowsインストーラーを使い、インストール後にターミナルを開き直してください。
- **Codexアプリ**。自動MCP登録を使う場合は、同じWindowsユーザーで **Codex CLI** の `codex` コマンドも利用できるようにします。CLIがない場合は `npm install -g @openai/codex`。通常はCLIとアプリが同じ `%USERPROFILE%\.codex` 設定を使用します。`CODEX_HOME` を独自指定している場合は、アプリとCLIが同じ設定先を使うことを確認してください。
- **Google ChromeにインストールしたMKB PWA**。Chromeで `https://mkb.bamboosato.com/` を開いてアプリとしてインストールします。使いたいChromeプロファイルを選んでください。
- npmレジストリへ接続できるインターネット環境。依存ライブラリは導入時にロックファイルに従って取得し、インストールスクリプトは実行しません。

次のコマンドが動くことを確認します。

```powershell
node --version
npm --version
codex --version
```

## 2. インストール

1. 上記のReleasesから導入先PCへZIPをダウンロードするか、入手済みのZIPをコピーします。インターネット経由で入手したZIPは、入手元を確認したうえでプロパティの「許可する／ブロックの解除」を行ってから展開してください。
2. **すべて展開**し、展開した `MKB-Windows-Setup` フォルダーを開きます。ZIPの中から直接実行しないでください。
3. **Setup.cmd** をダブルクリックします。案内・設定ツールの表示は英語です。
4. `Setup complete.` を確認します。デスクトップに **MKB Connection Setup** が作成され、Codexに `mkb_local_prototype` が登録されます。
5. Codexを終了・再起動して登録を読み込みます。

セットアップは実行ポリシーやブラウザの許可を変更しません。組織の実行制限でブロックされる場合は管理者に確認してください。

### PWAのショートカットを選ぶ場合

スタートメニュー内の `Markdown Knowledge Board.lnk` を探します。見つからない場合や複数のプロファイルにインストールされている場合は、使うPWAのショートカットを明示してください。以下は展開フォルダーで実行します。

```powershell
powershell.exe -NoProfile -File .\Install.ps1 -MkbShortcut 'C:\Users\YOUR_NAME\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Chrome アプリ\Markdown Knowledge Board.lnk'
```

パスはそのPCの実際の場所に置き換えてください。Open MKBはこのショートカットを使い、同じChromeプロファイルのPWAを開きます。

### Codex CLIを使わず登録する場合／既存登録を移行する場合

```powershell
powershell.exe -NoProfile -File .\Install.ps1 -SkipMcpRegistration
```

必要なら `-MkbShortcut` も付けます。インストール後、`%LOCALAPPDATA%\MarkdownKnowledgeBoard\codex-mcp.toml` を開き、その内容をCodexの `config.toml` に反映します。既存設定を丸ごと置き換えず、`mcp_servers.mkb_local_prototype` の節だけを追加・変更します。同名の節を重複させないでください。Codexを再起動します。

通常のセットアップは、同名MCPが別のインストール先を指している場合に停止します。このPCで以前使っていたリポジトリ直結の登録などは、上の手順で明示的に切り替えてください。既存のPC側ペアリングは引き継がれるので、削除しません。

## 3. 初回の接続

1. Codexを起動します。
2. デスクトップの **MKB Connection Setup** を開きます。
3. **Copy connection code** を押し、`Copied.` を確認します。
4. **Open MKB** を押します。すでに開いているMKBを使っても構いません。
5. MKBのアプリメニュー → **AI Integration → Local MCP** を開きます。
6. **Connection code** に貼り付け、個人用端末なら **Remember in this browser** を選びます。
7. **Connect local MCP** を押します。ChromeがこのPCへの接続許可を求めた場合は利用者が許可します。許可待ちでタイムアウトしたら、許可後にもう一度接続します。
8. ヘッダの保存状態の右側に **MCP connected** が出たら完了です。設定ツールは閉じて構いません。

Codexで「MKBにタイトル『接続確認』、本文『このPCからの保存確認です。』の新規ノートを作成してください」と依頼し、意図したPWAの一覧と本文に表示されることを確認してください。

別PCのコードや `identity.json` はコピーしません。導入先で初めてコードを取得するかMCPを起動したとき、そのPC用のペアリングを作ります。既存設定があれば再利用します。

## 4. 普段の使い方

- CodexとMKBを起動し、MKBの **Local MCP → Reconnect**。再起動ごとのコード貼り付けは不要です。自動接続はしません。
- **Close / Esc** はパネルを閉じるだけ。**Disconnect local MCP** は接続を切り、記憶は残します。
- **Advanced settings → Forget connection** はブラウザの記憶だけを削除し、現在の接続やPC側ペアリングは維持します。
- **Advanced settings → Use a new code** は未接続時に接続情報を入れ直す操作です。新しいコードを発行する操作ではありません。
- Setupツールはコード取得とPWA起動を担当します。MCPサービスの起動にはCodexが必要です。
- この連携はそのPCのPWAに**新規ノート**を保存します。既存ノートはMKBの編集画面で更新します。

## 5. 保存場所・更新・削除

標準インストール先は `%LOCALAPPDATA%\MarkdownKnowledgeBoard` です。

| 場所 | 内容 |
| --- | --- |
| `ConnectionSetup` | 設定アプリとPCに合わせた起動設定 |
| `start-mcp.mjs` | Codexが起動する固定パスのMCPランチャー |
| `start-mcp.previous.mjs` | 更新直前のランチャーの控え。初回は存在しない |
| `runtimes` | 導入時のMCPサーバーと依存ライブラリ |
| `mcp\identity.json` | PC側の秘密のペアリング情報。共有・公開しない |
| `codex-mcp.toml` | 手動登録用の設定例。トークンは含まない |

`MKB_MCP_STATE_DIR` を明示して導入した場合、PC側ペアリングはその場所を使用し、設定アプリとMCPの両方に同じ場所を設定します。

更新はCodexとMKB Connection Setupを終了してから、新しいZIPのSetup.cmdを実行します。既存の登録とペアリングを保持し、ランチャーを新しいランタイムへ切り替えます。失敗したランタイムや以前のランタイムは自動削除しません。更新成功後、古い `runtimes` の各フォルダーは `start-mcp.mjs` が参照していないことを確認して削除できます。

利用をやめる場合は、MKBで切断し、Codexの `mkb_local_prototype` 登録を削除してCodexと設定ツールを終了します。その後、デスクトップのショートカットと、上記のインストールフォルダーを削除できます。ペアリングを再利用したい場合は `mcp` を残してください。

**ノートはブラウザプロファイル・サイトごとのIndexedDBに保存されます。** セットアップは他PCのノートを移行・同期しません。必要なら既存のバックアップ・復元機能を使い、ブラウザのサイトデータを削除する前にバックアップしてください。

## 6. うまく動かない場合

- `codex` / `node` が見つからない：インストールとPATHを確認し、ターミナルを開き直します。CLIなしなら上記の手動登録を使います。
- `mkb_local_prototype already points to another installation`：既存登録を確認し、手動登録の節を使います。自動で上書きしません。
- 設定ツールの更新に失敗：開いているMKB Connection Setupを閉じて再実行します。
- `Reconnect` に失敗：Codexの起動、MCP登録、Chromeのローカル接続許可、別のMKBタブが接続していないかを確認します。
- ポート競合・設定破損：ペアリングを勝手に削除・再作成しません。競合するプロセスの調査または設定バックアップからの復旧が必要です。
- 保存の応答が不明：既に保存済みの場合があるため、Codexに同じ `request_id`・同じ内容での再試行を依頼します。

このセットはWindows向けです。別PCでの実機受入は、手順3の新規ノート保存までを完了条件としてください。開発元のWindowsでの隔離導入試験と、別PCでの実機確認は区別します。
