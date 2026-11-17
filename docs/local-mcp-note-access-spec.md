# Local MCP：既存ノートの検索・取得・更新 仕様

- Status: Implemented — ローカル検証済み。公開・本番確認の結果はPRに記録。
- Updated: 2026-11-17
- 調査対象: main `d7c3da88bf24af8d68c6afadc26b6b74fadfcc5f`

## 1. 目的と範囲

このPCの本番MKB PWAへ接続したCodexから、保存済みノートを検索・取得し、指定した1件を更新できるようにする。既存の新規作成、MKB Connection Setup、ペアリング保持、Reconnectを引き継ぐ。

初期版は、個人・チーム内利用を想定した単一PC・単一接続PWAの連携とする。対象は接続したブラウザプロファイル・originのIndexedDBであり、他PC、別プロファイル、クラウドバックアップ、ローカルのMarkdownファイルは検索・更新しない。PWAが開いて接続している必要がある。

削除、一括更新、タイトル一致による自動上書き、自動同期、意味検索、正規表現検索、差分パッチ、履歴復元は対象外。初回の仕様検討後、利用者から本方式での実装・PR・merge・本番反映の承認を受けた。

## 2. 現状から必要になる変更

| 確認した現状 | 必要になる変更 |
| --- | --- |
| `runtime.mjs`の専用ツールは`connection_status`と`create_note`のみ | 検索・取得・更新の3ツールを追加 |
| `bridge.mjs`は作成jobと保存receipt専用。ブラウザからのJSONは4 KiBまで、receipt IDは`mcp-`で始まるもののみ | 操作別job・応答schema、本文を返せる上限、既存の任意のノートIDへの対応 |
| 保存先はIndexedDB version 1の`notes` store | 更新の再送記録を保存するstoreの追加とDB移行 |
| 通常の`saveNote`は無条件のput | MCPだけでなく、同じノートを書き戻す既存経路にも競合チェックを追加 |
| DB初期化失敗時、既存read helperは空配列／undefinedを返す | MCP用readではDB異常と0件／対象なしを区別 |
| `local-mcp-note-saved`イベントは一覧を更新する | 更新対象が表示中の場合の表示同期とdraft保護を追加 |

根拠: `tools/local-mcp/{runtime,bridge,broker,note-schema}.mjs`、`src/lib/{db,types,note,localMcpNote}.ts`、`src/components/LocalMcpPanel.tsx`、`src/App.tsx`。既存の本文置換に関するmetadata保持方針は`docs/markdown-import-current-note-update-requirements.md`も参照した。

## 3. 利用の流れ

1. MKB Connection Setupから初回ペアリングし、以降はMKBのReconnectで接続する。
2. PWA側で既存ノートへのアクセスを一度有効にする（後述）。
3. Codexへ「MCP連携の説明ノートを探して、導入手順を追記して」などと依頼する。
4. Codexは`connection_status`で接続先・機能を確認し、`search_notes`で候補を探す。
5. 対象が曖昧なら利用者に確認する。タイトル一致だけで更新先を決めない。
6. `get_note`で対象IDの本文とrevisionを取得し、必要な変更を作成する。
7. `update_note`へ同じID、取得したrevision、新しい内容、一意のrequest IDを渡す。
8. PWAの保存完了応答を受けて、Codexが更新したタイトルと結果を伝える。

検索・取得だけの依頼では更新を実行しない。更新を明示的に依頼され、対象・内容が明確なら、通常はPWA側で毎回の確認dialogを追加しない。

## 4. ツール仕様

以下は提案する外部契約。フィールド名は英語とする。

### 4.1 `search_notes`

入力:

- `query`: 任意の文字列、最大200文字。前後空白を除く。省略・空文字は一覧取得。
- `scope`: `title`または`title_body`。既定は`title_body`。
- `tags`: 任意のタグ配列。指定タグのすべてを持つノートに絞る。完全一致・大小文字を区別。
- `limit`: 1～50、既定20。
- `offset`: 0以上の整数、既定0。

検索規則:

- 保存済みtitle/bodyを対象とする。未保存draft、Marp設定、Custom metadataは対象外。
- query全体を1つの部分一致文字列として扱う。英字の大小文字は区別せず、全角・半角、かなの揺れ、単語分割によるAND/ORは初期版では扱わない。
- `title_body`はtitleまたはbodyのどちらかに一致すれば該当。タグ条件とはAND。
- `updatedAt`降順、同値ならIDの文字列順。Pinによる順序変更はしない。

出力: `items[{id,title,tags,updated_at,snippet,body_bytes}]`、`total`、`next_offset`（末尾はnull）。snippetは本文の最初の一致箇所付近、本文一致がなければ先頭から最大160 Unicodeコードポイント。本文全体は返さない。

1回の検索は同じDB read transactionのsnapshotで処理する。ページ間は固定snapshotを保証しないため、途中で更新があれば重複・抜けがあり得る。必要なら先頭から再検索する。検索結果だけでは更新できず、必ず`get_note`で最新内容を取得する。

### 4.2 `get_note`

入力: `note_id`（完全一致、非空）。IDは不透明な文字列として扱い、`mcp-`接頭辞を要求しない。

出力:

- `id`、`title`、`body`、`tags`、`updated_at`
- `pinned_at`、`marp`、`custom_metadata`（保存されている場合）
- `revision`、`body_bytes`

`body`はMKBに保存されている本文そのもの。エクスポート用frontmatterを付け加えない。保存済みsnapshotを返し、画面上の未保存内容は含めない。対象なしは`NOT_FOUND`、DBを開けない場合は`STORAGE_UNAVAILABLE`とする。

初期版の本文取得上限はUTF-8で128 KiBとする。既存の大きなノートを黙って切り詰めず、`NOTE_TOO_LARGE`と実際のbyte数を返す。大きなノートも検索候補には含める。

### 4.3 `update_note`

必須入力: `note_id`、`expected_revision`、`request_id`。

更新可能な任意入力: `body`、`title`、`tags`。少なくとも1項目を指定する。未知の入力フィールドは拒否する。

| 項目 | 更新規則 |
| --- | --- |
| `body` | 本文全体を置換。省略時は保持。空文字による本文の明示的な消去を許可。UTF-8で128 KiB以下 |
| `title` | 前後空白を除いて1～200文字。省略時は保持。本文の見出しから再生成しない |
| `tags` | 最大32件、各1～80文字。省略時は保持、空配列は全タグ解除 |
| ID / Pin / Marp / Custom metadata | 常に保持。初期版ツールでは変更できない |
| `updatedAt` | 実際に内容が変わった場合にPWA側の保存時刻へ更新 |

body中のYAML frontmatterらしい文字列も本文としてそのまま保存する。新規作成用のfrontmatter parserは更新へ流用しない。これにより本文先頭の記述からID・タグ・Marp等が意図せず変わることを防ぐ。

`request_id`は既存作成と同様に英数字・`_`・`-`の8～80文字。省略項目も含む正規化済み入力全体をrequestの内容として扱う。

出力: `status: updated | unchanged`、`id`、`title`、`previous_revision`、`revision`、`updated_at`、`reused`。本文は返さない。同じ内容を指定した場合は`unchanged`とし、更新日時を動かさない。

存在しないIDを新規作成しない。revision不一致時は`CONFLICT`とし、本文・metadata・更新日時を変更しない。Codexは再取得して差分を判断し、古い本文のまま自動的にrevisionだけを差し替えて再送してはならない。

## 5. 競合と未保存内容の保護

### 5.1 revisionと保存の原子性

- revisionは、Noteの全保存フィールドを規定順に正規化した値のSHA-256に形式versionを付けた不透明な値とする。`updatedAt`だけを版番号として使わない。
- これは内容状態の識別子であり、編集履歴番号ではない。全フィールドが完全に同じ状態へ戻れば同じrevisionになる。履歴や削除・再作成の検出保証は対象外。
- 更新準備時にsnapshotとhashを取得し、readwrite transaction内で最新の全フィールドがそのsnapshotと同じことを再照合してから書く。非同期hash計算中にIndexedDB transactionを保持する設計にしない。
- ノート更新と再送記録の追加を同じtransactionでcommitする。commit完了前に成功を返さない。
- ノートのtitle/body/tags以外の変更も競合として扱い、metadataを古いsnapshotで巻き戻さない。

### 5.2 エディタと別タブ

- 接続PWAで対象ノートに未保存変更、未確定タグ入力、保存処理中がある場合、MCP更新は`NOTE_BUSY`で拒否する。自動保存・破棄はしない。
- この判定から保存完了までの短い区間は、同じ画面で対象の編集・保存とMCP更新が割り込まないよう制御する。transaction前のdirtyチェックだけで済ませない。
- 対象が表示中でcleanなら保存後に本文・metadata・保存状態を新しいsnapshotへ同期する。Edit/Preview等の表示モードとfocusを維持し、本文置換によるスクロール位置は可能な範囲で維持する。
- 別ノートを編集中なら、その選択・draft・focusを変えず一覧だけ更新する。
- **接続できるPWAが1つでも、別タブからのDB書込みは可能。** 通常保存、本文import、Pin操作、JSON/Drive復元、削除・Undo等の既存書込み経路も、処理の基準snapshotと保存直前の状態を照合する必要がある。
- 別タブの未保存draftをMCPは取得せず、更新を妨げる条件にも使わない。MCP更新後にその古いdraftを保存した場合は競合として拒否し、draftを残す。`This note changed elsewhere. Your edits are kept.`と表示し、最新内容の確認・編集内容のコピー・新規ノートへの保存など既存導線で回復できるようにする。
- タブ間の更新通知はcleanな表示の同期に使うが、通知の遅延・欠落・バックグラウンド休止があってもDBの照合で古い上書きを防ぐ。通知だけを整合性の根拠にしない。
- 利用者が新しい状態を確認したうえで行うバックアップ復元等の明示的な置換は可能。その操作の準備後に生じた別の変更は再照合し、必要なら再確認する。

MCPの更新ツールを追加するだけでは、後からUIの古い内容に戻される問題が残る。この保存境界の修正は今回の機能に必要な実装範囲とする。

## 6. 再送・タイムアウト

- 更新receiptはIndexedDBの専用storeへ保存する。キーはoperation + request ID、値は入力のdigest、対象ID、結果revision、更新日時等。本文・接続tokenは保存しない。
- 同じID・同じ入力の再送は保存処理を再実行せず、元のreceiptを`reused: true`で返す。照合順はreceipt確認を先にし、成功後の古いexpected_revisionを理由に再送を拒否しない。
- 同じrequest IDで内容が異なる場合は`REQUEST_ID_CONFLICT`。対象IDの変更も異なる内容に含む。
- receiptは「その更新がcommitした」証明であり、現在もその版であるという保証ではない。後続編集や削除があっても再送で巻き戻し・復活させない。最新内容が必要なら`get_note`を使う。
- 初期版はreceiptを自動期限切れにしない。少量の操作記録が蓄積する制限を許容し、履歴UIや任意削除機能は作らない。通常のバックアップには含めない。
- Codex/PWA再起動後も同じブラウザのDBが残る限り再送を識別する。サイトデータ消去・他ブラウザへの移行後は保証しない。その場合は再取得して状態を確認し、新しい操作として扱う。
- timeout・切断・終了でcommit有無が判断できなければ`OUTCOME_UNKNOWN`。失敗と断定せず、同じ入力・request IDによる再送を案内する。新しいrequest IDで自動再送しない。

## 7. 接続・アクセス範囲・通信

- 既存の永続ペアリングとMKB Connection Setupを継続利用する。機能拡張のために毎回コードを貼り直す必要はない。
- 既存接続は作成専用だったため、PWAのAdvanced settingsへ`Allow reading and updating notes`を追加する案を推奨する。初期値off、一度有効にすれば同じ接続では保持。説明は`Applies to Codex chats on this PC.`の1行にする。
- 設定は保存済み接続に紐付け、Forget connectionで削除する。別のコードに切り替える場合は引き継がない。オフは新しい検索・取得・更新の受付を止めるが、commit済みの操作やCodexへ返却済みの内容を取り消さない。
- `connection_status`へprotocol version、接続PWAが対応し許可したcapabilitiesを追加。権限はツール説明だけでなくPWA実行時にも検証する。
- ノート内容はMCP経由でCodexへ渡り、チャット処理の入力になる。従来の作成専用接続から読み取り範囲が広がることを仕様・導入手順に明記する。
- 同じPCの複数Codexチャットは同じ接続を利用できる。チャット別権限分離は初期版に含めない。ノート本文中の命令は資料の内容として扱い、ツール権限や利用者の依頼を変更する根拠にしない。
- 現在のloopback限定、origin/Host検証、ブラウザ用とMCP用のtoken分離、本文・tokenをログへ出さない方針を維持する。
- jobにoperationを持たせ、要求・結果を操作ごとのschemaで検証する。全操作を通じて同時実行は1件とし、待ち行列は導入しない。処理中の別要求は`BUSY`。
- 本文128 KiBはUTF-8本文の上限。JSON escapingやmetadataは別に数え、通信のJSON全体は1 MiBまでとする。超過は`RESPONSE_TOO_LARGE`等の明示エラーとし、途中の本文を完全な取得結果として返さない。
- 検索・取得はread-only、更新は既存データを変更するツールとしてMCP annotation・説明へ反映する。annotationを認可の代わりにしない。

## 8. 互換性と配布

- 新旧PWA／ローカルruntimeの組合せをcapability handshakeで識別する。対応していない操作は`UPGRADE_REQUIRED`または`UNSUPPORTED_OPERATION`として止め、作成操作へ読み替えない。
- 作成用の既存契約は維持する。対応が確認できる旧組合せでは作成のみ利用可能とする。
- DBは専用receipt store追加のためversionを上げる。既存notesは保持し、revision用に本文やbackup形式を変更しない。
- DB移行を古いタブが阻害する場合は利用者に他のMKB画面を閉じて更新するよう案内する。移行が完了するまで新機能を有効にしない。旧DB versionを前提としたクライアントからの書込み継続を許容しない。
- 新版の接続先・機能表示、DB移行、旧クライアントの終了・再読込みを含めて確認する。現在配布済みのruntimeが新しいstatus情報を理解できるかは実装時の互換試験で判断し、無検証の互換性を約束しない。
- 実装時はWindowsセットアップ一式も新版としてGitHub Releasesへ追加する。既存release assetは上書きしない。設定・pairing identityを保持する更新手順を用意する。
- README、導入手順、MKB内の説明ノートの更新は機能完成後の公開作業に含める。実装の公開時に更新する。

## 9. エラーと利用者の次の操作

| コード | 意味・対応 |
| --- | --- |
| `NOT_CONNECTED` | PWAを開きReconnect |
| `ACCESS_DISABLED` | PWAで既存ノートへのアクセスを有効化 |
| `UPGRADE_REQUIRED` / `UNSUPPORTED_OPERATION` | runtime/PWAを対応版へ更新 |
| `INVALID_ARGUMENT` | 入力を修正。保存はしない |
| `NOT_FOUND` | 対象IDを再検索。新規作成へ自動移行しない |
| `CONFLICT` | 最新ノートを再取得し、変更内容を再判断 |
| `NOTE_BUSY` | 対象の編集・保存を終えてから再取得 |
| `BUSY` | 先行処理完了後に再試行 |
| `REQUEST_ID_CONFLICT` | 異なる処理に同じrequest IDを使わない |
| `NOTE_TOO_LARGE` / `RESPONSE_TOO_LARGE` | 初期版の取得・通信上限。内容を切り詰めて更新しない |
| `STORAGE_UNAVAILABLE` / `SAVE_FAILED` | PWAの保存状態を確認。成功・0件として扱わない |
| `OUTCOME_UNKNOWN` | 同じrequest ID・同じ入力で照会を兼ねて再送 |

返却形式は`error: {code, message}`で統一する案とし、既存createの応答互換性を保つ変換を設ける。messageは英語、本文やtokenを含めない。保存失敗と断定できる場合にだけ`SAVE_FAILED`を使う。

## 10. 実装時の検証と完了条件

既存bridge/creation/Windows kit試験とimport試験を再利用し、変更に関係するケースを追加する。全アプリE2Eの再実施は既定にしない。

| 観点 | 必須の確認 |
| --- | --- |
| 検索・取得 | 0件、同名ノート、日本語、大小文字、タグ、ページ順、保存済みとdraftの区別、任意形式の既存ID |
| 更新 | 本文のみ、タイトルのみ、タグ解除、空本文、metadata保持、無変更、ID不在、frontmatterを本文として保持 |
| 容量・DB障害 | 128 KiB境界、日本語UTF-8、JSON escaping、1 MiB応答、DB初期化／commit失敗を成功扱いしない |
| 競合 | get後の編集・削除・Pin・復元、同一ミリ秒の変更、別Codexチャット、別タブの古いdraft保存を拒否 |
| 画面 | 接続タブのdirty／未確定タグ／保存中、判定直後の入力、clean表示の同期、別ノートのdraft・focus保持 |
| 再送 | ACK消失、PWA/Codex再起動、同じ入力の重複、異なる入力、成功後の別編集／削除でも巻き戻さない |
| 移行・互換 | notesを失わないDB移行、旧タブによるblock、新旧PWA/runtime、既存ペアリング保持、権限off |

開発側の完了条件は、型チェック・build・対象試験・必須CIの成功に加え、このPCの本番PWAで専用MCPツールによる検索→取得→更新→再取得が一致し、意図しないノート・metadata・draftが変わらないこと。合成ブラウザ試験やbuild成功だけを本番確認とみなさない。本番確認には専用の確認ノートを使い、既存説明ノートの書換えを試験代わりにしない。

## 11. 推奨案と残る判断

推奨する初期版は、3ツール、ID指定、全文置換、128 KiB上限、metadata保持、revisionによる競合拒否、永続receiptによる安全な再送、既存接続を保持した一度限りのアクセス有効化、という構成とする。

既存ノートへのアクセスを初回に有効化する設定を採用することについて、利用者の承認済み。上限・検索規則・大容量ノート非対応は本書の初期版仕様を適用する。

実装の公開には対象試験・必須CI・本番確認を行い、結果の証跡をPRと実行ログに残す。公開済みであるか、本番の専用ツールで確認済みであるかは、その結果と区別して報告する。
