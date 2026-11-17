# MKB Local MCP API設計書（確定版）

- 更新日：2026-11-17
- 状態：実装確定。要求・応答と制限を同梱実装に合わせて記載。
- 対象実装：runtime 0.5.0（末尾追記・単一置換・全件置換）。既存APIの基盤は[PR #72](https://github.com/Bamboosato/markdown-knowledge-board/pull/72)。
- MCPサーバー：`mkb-local-prototype` / runtime `0.5.0`。Codex登録名：`mkb_local_prototype`
- PWA連携プロトコル：`2`。Windows Setup：`1.2.0`

本書は従来の既存ノートアクセス仕様案を置き換える。文書のファイル名は既存リンクとの互換性のため維持する。利用手順は[ローカルMCP README](https://github.com/Bamboosato/markdown-knowledge-board/blob/main/tools/local-mcp/README.md)、配布物は[Windows Setup 1.2.0](https://github.com/Bamboosato/markdown-knowledge-board/releases/tag/mkb-windows-setup-v1.2.0)を参照する。

## 1. 目的・対象・構成

Codexから、このPCで接続中のMKB PWAへ新規ノートを保存し、許可された保存済みノートを検索・取得・更新する。対象は接続したブラウザプロファイルとOriginのIndexedDB。別PC、別プロファイル、クラウドバックアップ、任意フォルダーのMarkdownファイルにはアクセスしない。

```text
Codex → MCP STDIO server → 認証付きloopback HTTP → 共有broker
                                                   ↑ poll / ack
                                             接続中のMKB PWA
                                                   ↓
                                         IndexedDB（notes / mcpReceipts）
```

MCP serverとPWAは両方起動している必要がある。共有brokerは`127.0.0.1`だけで待ち受け、1つのPWA接続と全ツール共通の1件の処理枠を持つ。複数Codexチャットで同じ接続を共有する。待ち行列、削除ツール、一括更新、意味検索、正規表現検索、差分パッチ、履歴復元、自動同期は提供しない。

実装の対応箇所：

| 契約・処理 | 実装 |
| --- | --- |
| ツール登録・MCP応答の包装 | `tools/local-mcp/runtime.mjs` |
| 要求とPWA応答のZodスキーマ | `tools/local-mcp/note-schema.mjs` |
| 接続状態・配送・応答照合・制限 | `tools/local-mcp/bridge.mjs` |
| 共有サービス・クライアント | `tools/local-mcp/broker.mjs`, `broker-client.mjs` |
| PWAの検索・取得・更新 | `src/lib/localMcpAccess.ts` |
| 新規作成・frontmatter処理 | `src/lib/localMcpNote.ts`, `note.ts`, `frontmatter.ts` |
| revision・DB照合・再送記録 | `src/lib/noteRevision.ts`, `db.ts` |
| 許可・接続保持・画面同期 | `src/components/LocalMcpPanel.tsx`, `src/lib/localMcpConnection.ts`, `noteEvents.ts`, `src/App.tsx` |

## 2. MCP共通形式

### 2.1 呼び出しと応答の階層

初期化済みのMCP STDIO接続で`tools/list`から7ツールを取得し、`tools/call`で呼び出す。`protocolVersion: 2`はPWAとbrokerの独自プロトコル番号であり、MCP initializeで交渉するプロトコルバージョンとは別である。

JSON-RPC要求の完全な例：

<!-- api-example: envelope request -->
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "search_notes",
    "arguments": { "query": "not-present", "scope": "title" }
  }
}
```

正常応答の完全な例：

<!-- api-example: envelope success -->
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      { "type": "text", "text": "{\"items\":[],\"total\":0,\"next_offset\":null}" }
    ],
    "isError": false
  }
}
```

アプリケーションエラーもJSON-RPCの`result`内に返す例：

<!-- api-example: envelope error -->
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      { "type": "text", "text": "{\"error\":{\"code\":\"ACCESS_DISABLED\",\"message\":\"Enable reading and updating notes in MKB Advanced settings.\"}}" }
    ],
    "isError": true
  }
}
```

**以下の各ツールの「要求」は`params`、「正常応答」「業務エラー」は`content[0].text`をJSON.parseした値を示す。** SDK由来のエラー例は例外として`result`全体を示す。JSON-RPC `id`は通信上の対応付け、後述の`request_id`は保存処理の再送識別子であり別物。

現在、ツール登録に`outputSchema`は指定しておらず、`structuredContent`は返さない。応答のZodスキーマはbrokerがPWAのACKを検証するための定義である。SDKが公開する入力JSON SchemaだけではUTF-8容量や「更新項目を1つ以上」といった全refinementを表現しきれないため、本書と実行時検証も適用する。

### 2.2 共通の型と規則

| 項目 | 定義 |
| --- | --- |
| 文字列長 | `.length`によるUTF-16コード単位数。UTF-8 byte上限は別途記載 |
| `note_id` / 応答`id` | 非空文字列。要求上限65,536コード単位。前後空白もIDの一部として完全一致。`mcp-`接頭辞は必須でない |
| `request_id` | `^[a-zA-Z0-9_-]{8,80}$`。要求ごとに一意な値を生成し、結果不明時は同じ値と同じ入力を再利用 |
| `revision` / `expected_revision` | `^v1-[a-f0-9]{64}$`。保存状態を表す不透明な値。クライアントはgetの戻り値を使う |
| `updated_at`, `pinned_at` | UNIX epochからのミリ秒。ISO日時文字列ではない |
| `tags`要求 | 最大32要素、各要素をtrimして1〜80コード単位。順序を保持し、重複を自動除去しない |
| 省略 / null | 任意項目は省略する。入力の`null`は許可しない。出力で明示的にnullを使うのは`browserOrigin`、`next_offset` |
| 未知の入力キー | `search_notes` / `get_note` / `update_note` / `append_note` / `replace_note_text`は拒否。`connection_status`と`create_note`の現行SDK/Zod処理は余分なキーを除去するが、送信しないこと |
| 例のデータ | 合成ノート・固定時刻・説明用のアドレス。実在の秘密情報は掲載しない。revision例も本番ノートへ流用しない |

保存済みノートのtitle・tagsは従来データも返すため、応答側には作成要求の文字数・件数制限をそのまま適用していない。

### 2.3 エラーの3形式

1. 既存ノート用5ツールの業務エラー：`{"error":{"code":"...","message":"..."}}`。
2. 既存`create_note`の業務エラー：`{"error":"..."}`。互換性維持のためコード付き形式へ変更していない。
3. SDKの入力検証エラー・ハンドラー例外：`isError: true`で`content[0].text`が**通常の文字列**。必ずしもJSONではない。

現在固定しているMCP SDK `1.32.2`は、入力スキーマ違反もツールエラーとして包装する。JSON-RPC自体の不正や通信切断では別途プロトコルエラー／クライアント例外となり、ツール応答がない場合もある。`isError`を先に確認し、エラーのtextを無条件にJSON.parseしない。messageは英語の説明で、分岐には既存ノート用5ツールの`code`を使う。SDKの検証メッセージ全文は安定した外部契約としない。

## 3. `connection_status` — 接続確認

読み取り専用。引数なし。新規作成や読み取りの前に`browserOrigin`を確認する。未接続は正常な状態でありエラーではない。

### 要求

<!-- api-example: connection_status request -->
```json
{ "name": "connection_status", "arguments": {} }
```

### 正常応答の定義

| フィールド | 型・意味 |
| --- | --- |
| `connected` | boolean。直近5秒以内にPWAから通信があった接続 |
| `busy` | boolean。brokerに未完了jobがある |
| `origin` | string。PC上のloopbackサービスのURL |
| `browserOrigin` | stringまたはnull。接続中PWAのOrigin。未接続ならnull |
| `protocolVersion` | number。現行brokerは2。古いbrokerでは省略され得る |
| `brokerCapabilities` | broker自体が対応する6操作。接続・許可状態とは独立。旧brokerでは欠落する |
| `capabilities` | string配列。brokerと接続PWAの対応操作・現在の許可の共通部分。未接続なら空。古いbrokerでは省略され得る |
| `persistentPairing` | boolean。本番の共有broker経由ではtrue。開発用直接bridgeでは省略 |
| `pairingToken` / `pairingCode` | string。未接続時だけ追加。tokenは64桁hex、codeは`MKB1\|origin\|token`。機密情報 |

`connection_status`自身はcapabilitiesに含めない。`tools/list`は7ツールの存在、capabilitiesは現在の接続先で実行可能な操作を表す。`busy: true`でもcapabilitiesは消えず、実行時にBUSYとなる場合がある。`brokerPid`は内部管理用でありMCP応答には含めない。

接続・アクセス許可済みの例：

<!-- api-example: connection_status success -->
```json
{
  "connected": true,
  "busy": false,
  "origin": "http://127.0.0.1:47831",
  "browserOrigin": "https://mkb.bamboosato.com",
  "protocolVersion": 2,
  "capabilities": ["create_note", "append_note", "replace_note_text", "search_notes", "get_note", "update_note"],
  "brokerCapabilities": ["create_note", "append_note", "replace_note_text", "search_notes", "get_note", "update_note"],
  "persistentPairing": true
}
```

未接続の例。以下のtoken/codeは実際に使えない伏字であり、64桁hexの正常値を示すものではない：

<!-- api-example: connection_status redacted -->
```json
{
  "connected": false,
  "busy": false,
  "origin": "http://127.0.0.1:47831",
  "browserOrigin": null,
  "protocolVersion": 2,
  "capabilities": [],
  "brokerCapabilities": ["create_note", "append_note", "replace_note_text", "search_notes", "get_note", "update_note"],
  "persistentPairing": true,
  "pairingToken": "<REDACTED>",
  "pairingCode": "MKB1|http://127.0.0.1:47831|<REDACTED>"
}
```

### エラー応答

サービス認証失敗などの例。これは**SDKのresult全体**で、textはJSONではない。起動前にidentityが不正などでプロセスが終了した場合は、この応答すら返せない。

<!-- api-example: connection_status sdk_error -->
```json
{
  "content": [
    { "type": "text", "text": "Local MCP service authentication failed or port is occupied." }
  ],
  "isError": true
}
```

## 4. `create_note` — 新規作成

書き込み。既存ノートアクセス許可は不要だがPWA接続は必要。既存ノートを上書きせず、選択中のエディタを切り替えない。

### 入力定義

| フィールド | 必須 | 型・制約 |
| --- | --- | --- |
| `request_id` | 必須 | 共通形式のstring |
| `title` | 必須 | string、trim後1〜200コード単位 |
| `markdown` | 必須 | 空白のみ不可。最大131,072コード単位かつUTF-8で131,072 bytes以下 |
| `tags` | 任意 | 共通形式のstring配列、既定`[]` |

### 要求・正常応答

<!-- api-example: create_note request -->
```json
{
  "name": "create_note",
  "arguments": {
    "request_id": "api-create-demo-001",
    "title": "Memo",
    "markdown": "# Memo\n",
    "tags": ["design"]
  }
}
```

<!-- api-example: create_note success -->
```json
{
  "status": "saved",
  "id": "mcp-31b0558f7c685fc67845fbae63fee785b088efe0d7eca5313af21d24c5ea3853",
  "title": "Memo",
  "reused": false
}
```

| 出力 | 定義 |
| --- | --- |
| `status` | 常に`"saved"`。IndexedDB commit後の応答 |
| `id` | `"mcp-" + SHA-256(request_idのUTF-8 bytes)` |
| `title` | 保存されたtitle |
| `reused` | 初回保存false、既存の同一内容を再利用した場合true |

作成はMarkdownのfrontmatter parserを通す。保存bodyはfrontmatter解析後の本文で、入力markdownと必ずしも同一ではない。ID・title・tags・updatedAtはMCP側の指定／生成値を優先し、Marp・Custom metadataはfrontmatterから取り込む。Pinはこのツールでは設定しない。

同じIDが存在するとtitle/body/tags/marp/customMetadataを比較し、一致なら再利用、不一致なら保存しない。updatedAtとPinはこの再利用比較に含めない。作成専用の永続receiptはないため、対象を削除した後に同じ要求を送ると再作成される。更新ツールの再送保証とは異なる。

### エラー応答

未接続の例：

<!-- api-example: create_note error -->
```json
{ "error": "No connected browser. Open the local app and connect first." }
```

PWAの保存失敗または同じrequest_idの内容衝突の例：

<!-- api-example: create_note error -->
```json
{ "error": "Browser could not save. Check the app; retry the same request_id." }
```

作成の衝突は`REQUEST_ID_CONFLICT`コードでは返らない。待ち時間超過・切断・サービス障害も文字列エラーになり、保存済みの場合がある。結果不明時は同じrequest_idと同じ入力で再送する。

## 5. `search_notes` — 検索・一覧

読み取り専用。既存ノートへのアクセス許可が必要。

### 入力定義

| フィールド | 必須 | 型・既定値・制約 |
| --- | --- | --- |
| `query` | 任意 | string、既定`""`、trim前で最大200コード単位。検索時にtrim・小文字化 |
| `scope` | 任意 | `"title"`または`"title_body"`、既定`"title_body"` |
| `tags` | 任意 | 共通形式のstring配列、既定`[]`。すべてのタグを含むノートに絞る |
| `limit` | 任意 | integer、1〜50、既定20 |
| `offset` | 任意 | integer、0〜9,007,199,254,740,991、既定0 |

query全体を1つの部分一致文字列として扱う。単語分割・AND/OR・全角半角やかなの正規化はしない。title/bodyは大小文字を区別しないが、タグはtrim後の完全一致で大小文字を区別する。空queryは一覧。未保存draft・Marp・Custom metadataは検索対象外。

updatedAt降順、同値ならIDの文字列比較順。Pinによる優先表示はしない。1回のDB readで検索対象snapshotを読むが、ページ間で固定しないため途中の変更で重複・抜けが生じ得る。

### 要求・正常応答

<!-- api-example: search_notes request -->
```json
{
  "name": "search_notes",
  "arguments": { "query": "Memo", "scope": "title_body", "tags": ["design"], "limit": 20, "offset": 0 }
}
```

<!-- api-example: search_notes success -->
```json
{
  "items": [
    {
      "id": "note-example-001",
      "title": "Memo",
      "tags": ["design"],
      "updated_at": 1794870000000,
      "snippet": "# Memo\n",
      "body_bytes": 7
    }
  ],
  "total": 1,
  "next_offset": null
}
```

| 出力 | 定義 |
| --- | --- |
| `items` | 最大limit件の要約配列。各要素は上記6フィールド |
| `total` | offset/limit適用前の一致件数 |
| `next_offset` | 続きがあればoffset+limit、末尾ならnull |
| `snippet` | 本文の一致箇所の40コード単位前から最大160 Unicodeコードポイント。本文一致なしなら先頭。titleのみ検索でも本文snippetを返す |
| `body_bytes` | 保存本文全体のUTF-8 byte数。snippetのサイズではない |

0件の例。offsetが末尾を超えた場合もitemsは空だが、totalは実際の一致件数のまま：

<!-- api-example: search_notes success -->
```json
{ "items": [], "total": 0, "next_offset": null }
```

128 KiB超の本文も検索候補に含める。検索結果には更新用revisionを返さない。更新前にget_noteを呼ぶ。

### エラー応答

<!-- api-example: search_notes error -->
```json
{
  "error": {
    "code": "ACCESS_DISABLED",
    "message": "Enable reading and updating notes in MKB Advanced settings."
  }
}
```

ほかにNOT_CONNECTED、UPGRADE_REQUIRED、BUSY、STORAGE_UNAVAILABLE、RESPONSE_TOO_LARGE等があり得る。0件とDB異常を混同しない。

## 6. `get_note` — 取得

読み取り専用。既存ノートへのアクセス許可が必要。

### 要求

必須入力は`note_id`のみ。IDは不透明な文字列としてそのまま渡す。

<!-- api-example: get_note request -->
```json
{ "name": "get_note", "arguments": { "note_id": "note-example-001" } }
```

### 正常応答

<!-- api-example: get_note success -->
```json
{
  "id": "note-example-001",
  "title": "Memo",
  "body": "# Memo\n",
  "tags": ["design"],
  "updated_at": 1794870000000,
  "pinned_at": 1794860000000,
  "marp": { "enabled": false, "theme": "default", "size": "16:9", "paginate": true, "headingDivider": false },
  "custom_metadata": [{ "key": "owner", "value": "example" }],
  "revision": "v1-73e77c13f03b8a526c08812e4fe0f80552963b2483ff1f6655974be458c734e2",
  "body_bytes": 7
}
```

| フィールド | 型・意味 |
| --- | --- |
| `id`, `title`, `body` | string。bodyは保存済み本文そのもの。エクスポート用frontmatterを追加しない |
| `tags` | string配列 |
| `updated_at` | 保存時刻のnumber |
| `pinned_at` | 任意number。保存されていなければ省略 |
| `marp` | 任意object。存在する場合は下記5フィールドをすべて返す |
| `custom_metadata` | 任意配列。要素は`{key: string, value: JSON値}`。空配列の場合もある |
| `revision` | 共通形式のstring。Noteの全保存フィールドから算出 |
| `body_bytes` | 非負integer。bodyのUTF-8 byte数 |

Marpは`enabled: boolean`、`theme: string`、`size: string`、`paginate: boolean`、`headingDivider: number | false`。応答Zodはtheme/sizeをenumに限定しない。通常のアプリ値はtheme=`default/gaia/uncover`、size=`16:9/4:3`、headingDivider=`1〜6/false`。Custom metadataのvalueの応答Zod型はunknownだが、通信上はJSONとしてシリアライズできる値を扱う。

getは保存済みsnapshotを返し、画面上の未保存内容は返さない。bodyが131,072 UTF-8 bytesを超えると切り詰めず拒否する。

### エラー応答

<!-- api-example: get_note error -->
```json
{ "error": { "code": "NOT_FOUND", "message": "Note not found." } }
```

大きいノートの例。実際のbyte数はmessageに含み、独立した`body_bytes`エラーフィールドは返さない：

<!-- api-example: get_note error -->
```json
{
  "error": {
    "code": "NOTE_TOO_LARGE",
    "message": "Body is 131073 bytes; limit is 131072 bytes."
  }
}
```

## 7. `update_note` — 既存ノート更新

書き込み。既存ノートへのアクセス許可が必要。存在しないIDを新規作成しない。

### 入力定義

| フィールド | 必須 | 型・制約 |
| --- | --- | --- |
| `note_id` | 必須 | 共通形式のstring |
| `expected_revision` | 必須 | get_noteで取得したrevision |
| `request_id` | 必須 | 共通形式のstring |
| `body` | 条件付き | string、最大131,072コード単位かつUTF-8で131,072 bytes以下。全文置換。空文字は本文の消去 |
| `title` | 条件付き | string、trim後1〜200コード単位 |
| `tags` | 条件付き | 共通形式のstring配列。`[]`は全タグ解除 |

body/title/tagsの少なくとも1つが必要。省略した項目は保持する。ID、Pin、Marp、Custom metadataは変更できず保持する。body中のfrontmatterも文字列としてそのまま保存する。新規作成のparserは通さない。

**更新前の保存本文にも128 KiB上限を適用する。** 既存本文が上限超なら、タイトルだけの更新や本文を短くする更新もNOTE_TOO_LARGEとなる。MCPから大きい既存ノートを縮小する経路は提供していない。

### 要求・正常応答

上のget例で取得したノートの本文だけを更新する例：

<!-- api-example: update_note request -->
```json
{
  "name": "update_note",
  "arguments": {
    "note_id": "note-example-001",
    "expected_revision": "v1-73e77c13f03b8a526c08812e4fe0f80552963b2483ff1f6655974be458c734e2",
    "request_id": "api-update-demo-001",
    "body": "# Memo\n\nUpdated.\n"
  }
}
```

<!-- api-example: update_note success -->
```json
{
  "status": "updated",
  "id": "note-example-001",
  "title": "Memo",
  "previous_revision": "v1-73e77c13f03b8a526c08812e4fe0f80552963b2483ff1f6655974be458c734e2",
  "revision": "v1-a97ab672346bc2daef9d1759649f6b773d67d7c63f1c2a5dca988a24d4e23f18",
  "updated_at": 1794870001000,
  "reused": false
}
```

| 出力 | 定義 |
| --- | --- |
| `status` | `"updated"`または`"unchanged"` |
| `id`, `title` | 対象ノートのIDと更新後title |
| `previous_revision`, `revision` | 更新前／後のrevision |
| `updated_at` | 更新後時刻。実際の変更がなければ元のまま |
| `reused` | 初回処理false。同じ要求の永続receiptを再利用した場合true |

本文は応答に含めない。変更なしの場合もreceiptを保存し、status=`unchanged`、previous_revision=revision、updated_atを維持する。同一要求の再送では元の応答の`reused`だけをtrueにする。

### エラー応答

取得後に内容が変わった場合：

<!-- api-example: update_note error -->
```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Note changed. Get the latest note before updating."
  }
}
```

接続PWAで対象を編集中の場合：

<!-- api-example: update_note error -->
```json
{
  "error": {
    "code": "NOTE_BUSY",
    "message": "Finish editing or saving this note, then get it again."
  }
}
```

receiptのあるrequest_idを別内容で使用した場合：

<!-- api-example: update_note error -->
```json
{
  "error": {
    "code": "REQUEST_ID_CONFLICT",
    "message": "Request ID already used for different input."
  }
}
```

ACKを待っている間に期限を超えた場合：

<!-- api-example: update_note error -->
```json
{
  "error": {
    "code": "OUTCOME_UNKNOWN",
    "message": "Receipt timed out. Retry exactly the same input and request_id for an update."
  }
}
```

CONFLICTではgetをやり直して変更内容を判断する。古い本文のままrevisionだけ差し替えて再送してはならない。OUTCOME_UNKNOWNでは同じrequest_id・同じ入力を使う。接続復旧前に新しいrequest_idを発行して繰り返さない。

## 7A. `append_note` — 末尾追記

### 入力・動作

| 引数 | 必須 | 定義 |
| --- | --- | --- |
| `note_id`, `expected_revision`, `request_id` | 必須 | 2.2節の共通形式。getで対象を取得してから送る |
| `text` | 必須 | 非空string、最大131,072 UTF-16コード単位かつUTF-8で131,072 bytes以下。空白・改行のみも許可 |

保存本文を`oldBody + text`にする。改行・空白を自動挿入せず、trimや改行変換もしない。既存本文が空でも追記できる。本文と変更時のupdatedAtだけを更新し、タイトル・タグ・Pin・Marp・Custom metadata等は保持する。本文取得は引き続き必要で、削減するのは更新要求の本文量である。

更新前・更新後の本文はともに128 KiB以下。初回成功のstatusはupdated。正常応答はupdate_noteと同形でreplacement_countを含めない。異なるrequest_idなら同じ文字列も再度追記する。再送は同じrequest_idと同じ入力を使う。

### 要求・正常応答

例は6節の合成ノートに続きの段落を追記する。

<!-- api-example: append_note request -->
```json
{
  "name": "append_note",
  "arguments": {
    "note_id": "note-example-001",
    "expected_revision": "v1-73e77c13f03b8a526c08812e4fe0f80552963b2483ff1f6655974be458c734e2",
    "request_id": "api-append-demo-001",
    "text": "\nMore.\n"
  }
}
```

<!-- api-example: append_note success -->
```json
{
  "status": "updated",
  "id": "note-example-001",
  "title": "Memo",
  "previous_revision": "v1-73e77c13f03b8a526c08812e4fe0f80552963b2483ff1f6655974be458c734e2",
  "revision": "v1-e53ed976dec25cbfd9fd6ff5f37aedf31a206b9f171058bbdf7c35ad8808b4a8",
  "updated_at": 1794870001000,
  "reused": false
}
```

### エラー応答

<!-- api-example: append_note error -->
```json
{
  "error": {
    "code": "RESULT_TOO_LARGE",
    "message": "Resulting body exceeds 128 KiB."
  }
}
```

<!-- api-example: append_note error -->
```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Note changed. Get the latest note before updating."
  }
}
```

共通エラーと8節の定義も適用する。失敗した追記を部分保存しない。

## 7B. `replace_note_text` — 単一置換・全件置換

### 入力・動作

| 引数 | 必須 | 定義 |
| --- | --- | --- |
| `note_id`, `expected_revision`, `request_id` | 必須 | 2.2節の共通形式。getで対象を取得してから送る |
| `search_text` | 必須 | 非空string、最大131,072 UTF-16コード単位かつUTF-8で131,072 bytes以下 |
| `replacement_text` | 必須 | string、同じ長さ・byte上限。空文字は該当部分を削除 |
| `mode` | 任意 | `single`（既定）または`all`。null不可 |

想定一致件数の引数は設けない。未知キーを拒否する。対象は指定1ノートの保存本文のみで、タイトル・タグ・その他metadataを保持する。

- 完全一致、大小文字・空白・改行・Unicodeを区別する。正規表現・正規化・Markdown構文解析は行わない。replacement_textの`$&`、`$1`、バックスラッシュもそのまま挿入する。
- singleは重なりも数えて一致が1か所だけなら実行する。0か所はTEXT_NOT_FOUND、2か所以上はMULTIPLE_MATCHESで更新しない。`aaa`から`aa`を探すと2か所なので拒否する。
- allは元の本文を左から右へ非重複で照合し、全件を1回のtransactionで置換する。`aaa`の`aa`→`X`は`Xa`（1件）、`aaaa`なら`XX`（2件）。挿入文字列や置換後に新しく生じる一致を再処理しない。0か所は更新しない。
- allは利用者が全件置換を明示したときだけ選ぶ。singleの複数一致エラーを理由に自動でallへ変更しない。
- 同一文字列への置換でも一致数を検証する。成功はunchanged、revision・updated_atを維持し、receiptを保存する。replacement_countは処理対象の一致数（1以上）であり、実際に本文が変わったかはstatusで判別する。
- 両modeとも成功時に`replacement_count`（正の整数）を必須で返す。その他はupdate_noteと同形。再送時も元の件数を返す。容量・競合・編集中拒否・再送保証は追記と共通。

### 単一置換の要求・正常応答

6節の合成ノートでMemoをManualへ置換する（他の例とは独立）。

<!-- api-example: replace_note_text request -->
```json
{
  "name": "replace_note_text",
  "arguments": {
    "note_id": "note-example-001",
    "expected_revision": "v1-73e77c13f03b8a526c08812e4fe0f80552963b2483ff1f6655974be458c734e2",
    "request_id": "api-replace-single-001",
    "search_text": "Memo",
    "replacement_text": "Manual"
  }
}
```

<!-- api-example: replace_note_text success -->
```json
{
  "status": "updated",
  "id": "note-example-001",
  "title": "Memo",
  "previous_revision": "v1-73e77c13f03b8a526c08812e4fe0f80552963b2483ff1f6655974be458c734e2",
  "revision": "v1-5f7f67ae3d493e184a0a53ab666ff5934c7bbcf743fbf544d5f32dcd3720bea0",
  "updated_at": 1794870001000,
  "reused": false,
  "replacement_count": 1
}
```

### 全件置換の要求・正常応答

同じ合成ノートの小文字mを大文字Mへ全件置換する。一致が1か所でもallを明示でき、想定件数は指定しない。複数一致の例は上記aaa/aaaaの規則に従う。

<!-- api-example: replace_note_text request -->
```json
{
  "name": "replace_note_text",
  "arguments": {
    "note_id": "note-example-001",
    "expected_revision": "v1-73e77c13f03b8a526c08812e4fe0f80552963b2483ff1f6655974be458c734e2",
    "request_id": "api-replace-all-001",
    "search_text": "m",
    "replacement_text": "M",
    "mode": "all"
  }
}
```

<!-- api-example: replace_note_text success -->
```json
{
  "status": "updated",
  "id": "note-example-001",
  "title": "Memo",
  "previous_revision": "v1-73e77c13f03b8a526c08812e4fe0f80552963b2483ff1f6655974be458c734e2",
  "revision": "v1-a3254ae0f2c3c3f26f90e91b8477a6e9c2b6db20d3e8915600a7c90284f67c21",
  "updated_at": 1794870001000,
  "reused": false,
  "replacement_count": 1
}
```

### エラー応答

<!-- api-example: replace_note_text error -->
```json
{
  "error": {
    "code": "TEXT_NOT_FOUND",
    "message": "Search text not found."
  }
}
```

<!-- api-example: replace_note_text error -->
```json
{
  "error": {
    "code": "MULTIPLE_MATCHES",
    "message": "More than one match. Narrow the search or explicitly choose all mode."
  }
}
```

<!-- api-example: replace_note_text error -->
```json
{
  "error": {
    "code": "RESULT_TOO_LARGE",
    "message": "Resulting body exceeds 128 KiB."
  }
}
```

いずれもNoteとreceiptを保存しない。共通のCONFLICT、NOTE_BUSY、REQUEST_ID_CONFLICT等は8節を参照。

## 8. エラー一覧と検証境界

### 8.1 既存ノート用5ツールの業務エラー

| code | 主な発生元・条件 | 対応 |
| --- | --- | --- |
| `NOT_CONNECTED` | brokerに新鮮なPWA接続がない | PWAを開きReconnect |
| `ACCESS_DISABLED` | broker/PWAで許可がoff | PWAのAdvanced settingsを確認 |
| `UPGRADE_REQUIRED` | 古い共有brokerまたはPWA | runtime/PWAを更新し再起動 |
| `UNSUPPORTED_OPERATION` | PWAに未知のoperationを配送 | 対応版へ更新。公開ツール名は固定 |
| `INVALID_ARGUMENT` | bridge/PWAの入力再検証 | 入力を修正。SDKで先に拒否される場合は別形式 |
| `NOT_FOUND` | get/更新対象が存在しない | 再検索。自動新規作成しない |
| `BUSY` | 共通処理枠が使用中 | 先行処理終了後に再試行 |
| `NOTE_BUSY` | 更新対象の未保存編集、タグ入力、保存中等 | 編集・保存を終えてから再取得 |
| `CONFLICT` | revision不一致／DB commit直前のsnapshot不一致 | 最新内容を取得して再判断 |
| `REQUEST_ID_CONFLICT` | 同じ更新request_idで入力digestが異なる | 別操作なら新しいID。結果不明の再送は元の入力 |
| `NOTE_TOO_LARGE` | get/更新対象の保存本文が131,072 bytes超 | MCPでの取得・更新対象外。MKB UI等で扱う |
| `TEXT_NOT_FOUND` | 置換対象が0件 | 最新本文を確認して検索文字列を修正。更新なし |
| `MULTIPLE_MATCHES` | singleで重なりも含め2件以上 | 検索文字列を絞る。全件置換への変更は利用者の明示意図に従う |
| `RESULT_TOO_LARGE` | 追記・置換後の本文が131,072 bytes超 | 入力を見直す。部分更新・receipt保存はしない |
| `RESPONSE_TOO_LARGE` | search/get結果のJSONが1,000,000 bytes超 | searchは件数を減らす。本文やmetadataを切り詰めて成功扱いしない |
| `STORAGE_UNAVAILABLE` | IndexedDBを利用できない | PWAの保存状態・他タブの更新状況を確認 |
| `SAVE_FAILED` | 上記専用エラーでないPWA処理例外 | 保存結果を確認。現行コードでは読み取り中の未分類例外にも使う |
| `OUTCOME_UNKNOWN` | ACK timeout、配送中切断、broker RPC障害等 | 更新は同じ要求で再送。読み取りは接続復旧後に再取得 |

PWAのACKで受理するエラーコードは`accessError`に定義される。NOT_CONNECTED / BUSY / UPGRADE_REQUIRED / OUTCOME_UNKNOWNはbridgeまたはbroker-clientが生成するため、そのACK用enumには含まれない。brokerのHTTPエラーをbroker-clientが捕捉した場合もOUTCOME_UNKNOWNになるため、全ての不正入力が同じ形式で返るとは限らない。

### 8.2 SDK入力検証エラー

以下の要求は未知のキーを含むため、handler/PWAへ届く前に拒否される。

<!-- api-example: get_note invalid_request -->
```json
{ "name": "get_note", "arguments": { "note_id": "note-example-001", "extra": true } }
```

現行SDKでのresultの例（text内の改行・詳細はSDK/Zod更新で変化し得る）：

<!-- api-example: get_note sdk_error -->
```json
{
  "content": [
    { "type": "text", "text": "MCP error -32602: Input validation error: Invalid arguments for tool get_note: Unrecognized key: \"extra\"" }
  ],
  "isError": true
}
```

必須項目欠落、不正な型・長さ・enum・revision、updateの変更項目なし、入力本文の上限超過もSDK検証対象。入力本文の上限超過はNOTE_TOO_LARGEではなくSDKエラーになり得る。NOTE_TOO_LARGEは保存済み本文を読んだ後の判定である。

## 9. 更新整合性・再送記録・画面

### 9.1 revisionと原子的な更新

revisionは保存Noteの全フィールドを再帰的にキー順へ正規化したJSONのSHA-256に`v1-`を付ける。オブジェクトのundefined属性は除外し、配列順は保持する。updatedAtだけの比較ではなく、metadataやPinの変更も検出する。同じ全保存状態に戻ると同じrevisionになるため、履歴番号や削除・再作成の検出保証ではない。

更新は次の順で行う：

1. 許可と入力を検証し、`mcpReceipts`の同一request_idを確認。
2. receiptがあれば入力digestを照合して元の結果を返す。現在のrevision照合より先に行う。
3. 対象snapshotを取得し、容量・expected_revisionを確認して次の内容とrevisionを準備。
4. 接続画面の更新可否を確認し、短いcommit区間のユーザー入力を抑止。
5. `notes`と`mcpReceipts`の同じreadwrite transaction内でreceiptを再確認し、現在Noteと準備元snapshotを再照合。
6. 変更があればNoteを書き、receiptを追加し、commit完了後だけ成功を返す。

非同期hash計算の間にDB transactionを保持しない。commit直前の比較で競合した場合もCONFLICTになる。保存後の権限解除で確定済みcommitを取り消さない。

### 9.2 永続receipt

IndexedDB `markdown-knowledge-board` version 2に`notes`と`mcpReceipts`を置く。version 1からの移行はnotesを保持してstoreを追加する。

| receipt項目 | 内容 |
| --- | --- |
| `key` | updateは`update:`、appendは`append:`、replaceは`replace:` + request_id |
| `digest` | updateは従来の正規化済み入力のSHA-256を維持。append/replaceは`{operation,input}`のSHA-256。expected_revisionとnote_idも含む |
| `result` | 元の成功応答。replaceはreplacement_countも保存。本文や接続tokenは含まない |

replaceのmode省略はsingleへ正規化するため、明示singleとの再送は同一入力。singleとallの変更は1か所だけの置換でもREQUEST_ID_CONFLICT。最終本文からdigestを作らず、元の操作引数から作る。receipt照合は現在本文・revision・一致件数・編集状態の確認より先に行い、再送で件数を再計算しない。エラー時はNoteもreceiptも保存せず、unchanged成功時はreceiptを保存する。DB versionは2のまま、既存update receiptも有効。

同じ要求の再送ではNoteを書き直さず、更新時刻も動かさない。後続編集や削除があっても巻き戻し・復活させない。receiptは「その更新が確定した」証拠であり、現在の内容の証明ではない。最新状態はgetで確認する。

receiptは自動期限切れにせず、通常のノートバックアップには含めない。同じブラウザDBの残るPWA/Codex再起動後は継続するが、サイトデータ削除・別ブラウザ移行後は再送保証の対象外。その場合は現在の内容を確認して新しい操作として判断する。

### 9.3 画面と他の保存経路

- 接続PWAの対象ノートに未保存本文・未確定タグ・保存中・metadata編集等がある場合、MCP更新はNOTE_BUSYで停止する。自動保存や破棄はしない。
- 対象が表示中で未編集なら、commit後に本文・metadata・保存状態を同期する。別ノートの選択とdraftは維持する。Edit/Previewを切り替えず、focus・scrollは可能な範囲で維持する。
- 別タブの未保存draftは読み取らず、MCP更新の事前禁止条件にも使わない。別タブが古いsnapshotから保存しようとすると拒否し、draftを残す。
- 通常Save、本文import、Pin、削除・Undo、JSON/Drive復元も書き込み対象の基準snapshotを照合する。復元の比較対象は書き込むIDであり、無関係なノートの編集までは競合扱いしない。
- BroadcastChannel等の通知は画面同期に使う。通知の遅延・欠落時もDB照合で古い書き戻しを防ぐ。

## 10. アクセス許可・機密情報・接続保持

既存のペアリングを継続利用する。PWAの**Local MCP → Advanced settings → Allow reading and updating notes**は初期off。Remember in this browserで同じ接続を保存している場合、許可も保持する。Rememberを使わない接続では接続中の許可のみで、次回は再設定が必要。

許可はノート全体・同じPCの当該MCPを使うチャットに共通。検索snippetや取得本文はCodexへ渡りチャット処理の入力になる。本文中の命令は資料として扱い、利用者の依頼や権限を変更する根拠にしない。

- offにすると新しい検索・取得・更新の受付を止め、新規作成は維持する。処理途中もPWAで再検証するが、commit済みの更新や返却済みの内容は取り消せない。
- Forget connectionはブラウザの接続記憶と読み取り・更新許可を削除する。PC側identityと現在の新規作成用接続は維持する。異なる接続コードへ許可を引き継がない。
- Close/Escはパネルだけを閉じ、接続は維持する。Disconnectは通信を止め、記憶は保持する。再起動後はReconnectを使い、自動接続はしない。
- PC側identityは`%LOCALAPPDATA%/MarkdownKnowledgeBoard/mcp/identity.json`。ブラウザ用tokenと管理API用tokenを分離する。tokenはログ・公開資料・ノートへ保存しない。
- 本番の許可Originは`https://mkb.bamboosato.com`と`https://markdown-knowledge-board.vercel.app`。Host・Origin・Bearer token・Content-Typeを確認する。別Originは別のノート保存先である。

## 11. 内部HTTP配送と制限

この節は保守用の内部プロトコル。Codexからは上記MCPツールを使い、PWAのIndexedDBを直接操作しない。全エンドポイントはPOST、JSON、認証必須。ブラウザ側だけCORS preflightのOPTIONSを受理する。

| 区間 / endpoint | 要求body | 応答bodyの要点 |
| --- | --- | --- |
| PWA `/__local_mcp/connect` | `{clientId, protocolVersion:2, noteAccess:boolean, supportedOperations:string[]}` | `{connected:true, protocolVersion:2}` |
| PWA `/__local_mcp/poll` | `{clientId, protocolVersion:2, noteAccess:boolean, supportedOperations:string[]}` | `{job:null}`または`{job:{deliveryId, operation, input}}` |
| PWA `/__local_mcp/permissions` | `{clientId, noteAccess:boolean}` | `{updated:true}` |
| PWA `/__local_mcp/ack` | `{clientId, deliveryId, result}` | `{acknowledged:true}` |
| PWA `/__local_mcp/disconnect` | `{clientId}` | `{connected:false}` |
| MCP側 `/__local_mcp_admin/status` | `{}` | `{service:"mkb-local-broker-v1", value:status}`。内部だけbrokerPidを含む |
| MCP側 `/__local_mcp_admin/create` | createのarguments | 同じservice包装でvalueに作成結果 |
| MCP側 `/__local_mcp_admin/execute` | `{operation, input}` | 同じservice包装でvalueに追加ツール結果 |

clientId/deliveryIdは配送用UUIDでありrequest_idと別。PWA側clientIdは36文字のhex・ハイフン形式を検証する。追加操作のACKはoperation別スキーマと対象IDを照合し、期限切れdeliveryIdや別ノートのreceiptを拒否する。作成ACKは`{id,title,reused}`または`{error:"SAVE_FAILED"}`で、brokerがMCP向けの`status:"saved"`や文字列エラーへ変換する。

PWA用tokenでは管理APIを呼べない。管理APIはOriginヘッダのある要求を拒否し、CORSを付与しない。HTTP 400（不正JSON・入力・ACK）、403（接続拒否）、409（接続競合・期限切れ配送）、413（サイズ超過）、404（未知の操作）とMCPの業務エラーは別の層である。

| 制限 | 現行値・意味 |
| --- | --- |
| 本文 | 131,072 UTF-8 bytes（128 KiB）。要求文字数上限も別に適用 |
| search/getのPWA結果JSON | UTF-8で1,000,000 bytes以下。超過はRESPONSE_TOO_LARGE。messageに「1 MiB」とあるが判定定数は1,000,000 |
| PWA→broker ACKのHTTP body | 1,048,576 bytes以下。clientId/deliveryId等の包装を含む |
| MCP側→broker HTTP body | 1,048,576 bytes以下 |
| その他PWA→broker HTTP body | 4,096 bytes以下 |
| 同時処理 | create/search/get/update/append/replaceを通じて1件。statusは処理枠を使わない |
| brokerのACK待ち | 15,000 ms。期限切れは保存取り消しではない |
| MCP側RPC待ち | status通常2,000 ms、create/execute 20,000 ms |
| PWA poll | 処理完了後400 ms間隔、poll要求timeout 5,000 ms |
| 接続鮮度 | 最終PWA通信から5,000 ms未満 |
| PWA初回connect timeout | 60,000 ms。通常requestの既定10,000 msとは別 |
| 共有broker終了 | MCP側活動が30秒超なく、jobなしなら5秒間隔の確認で終了。PWA pollだけでは延命しない |

バックグラウンド抑制・スリープ時の到達は保証しない。要求が受け付けられた後のtimeout・切断はcommit有無が不明になり得る。上限超過やACK拒否で応答が届かなかったときも、更新を失敗と断定して別IDで再実行しない。

## 12. 互換性・配布・検証記録

プロトコル番号は2を維持し、対応操作を明示して互換性を判定する。

- 新PWAはconnect/pollでsupportedOperationsに6操作を送る。brokerは既知操作との共通部分を保持する。未知名は無視、配列以外・非文字列要素はHTTP 400。明示空配列は対応なし。
- フィールド欠落時、PWA v2は従来4操作（create/search/get/update）、v1はcreateのみと解釈する。
- capabilitiesはbroker対応・PWA対応・noteAccessの共通部分。create以外はv2かつnoteAccess=trueが必要。
- 新runtimeはappend/replaceの配送前にbrokerCapabilitiesを検査する。旧brokerで欠落または未対応ならUPGRADE_REQUIREDで止め、HTTP executeを送らない。
- 新brokerと旧PWAは従来4操作を維持し、新操作はUPGRADE_REQUIRED。旧brokerと新PWAは追加フィールドを無視して従来操作を継続する。旧runtimeに新ツールは現れない。
- createの応答契約と既存updateのfingerprint・receiptは維持する。

更新時は全Codexクライアントを終了して35秒待ち、必要に応じ新版Setup.cmdを実行してCodexを再起動する。PWAも再読み込みし、Update availableがあればRestart to updateを使う。通常のReconnectでコードを再発行しない。DB移行が他タブに妨げられたら、未保存内容を保存してそのタブを閉じる。DB version 2移行後、version 1を指定する古いクライアントはVersionErrorとなる。

基盤runtime 0.4.0の過去の確認済み範囲（詳細・結果は[PR #72](https://github.com/Bamboosato/markdown-knowledge-board/pull/72)）：

- 単体287件、bridge 8件、実MCP＋隔離Chromium 22項目、対象インポート・復元E2E 40件、Windowsセットアップ6項目。必須CI成功。
- 本番PWAで既存102件を保持し、専用確認ノートを1件追加。検索・取得・更新・再取得・同一更新の再送、Saved表示と本文同期を確認。
- PWA再読み込みで許可を保持し、Codex完全終了・再起動後もコードの再入力なしでReconnect。このチャットの専用MCP5ツールを確認し、追加3ツールで本番ノートを検索・取得・更新・再取得。
- Windows Setup 1.1.0公開ZIPのダウンロードとSHA-256一致を確認。既存のRelease assetは変更していない。

PC自体の再起動、他PCの本番PWA接続・保存はこの確認に含めない。合成試験やbuild成功を実機検証の代用としない。runtime 0.5.0では追記・置換の単体試験、bridge能力交渉、旧brokerへの配送防止、実MCP＋隔離Chromiumでの編集中拒否・ACK喪失再送を追加する。今回の実行結果と公開状況は対応PRの検証欄を参照する。
