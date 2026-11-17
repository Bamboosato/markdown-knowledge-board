# MKB Local MCP：Custom metadataの条件付きAdd / Update / Upsert / Remove仕様

- 更新日：2026-11-17
- 状態：実装確定。runtime 0.7.0 / Windows Setup 1.4.0の追加仕様。
- 基盤：`817b95316a032b5b61a5acc542e40f08dbd89748`（runtime 0.5.0）。追加実装は`src/lib/localMcpMetadata.ts`、要求・応答のschemaは`tools/local-mcp/metadata-schema.mjs`。
- 現行契約：[Local MCP API設計書](./local-mcp-note-access-spec.md)

1〜11節は共通契約、12節はRemoveの詳細と旧版との互換性を定義する。MCPツールは計9個を維持する。

## 1. 目的・範囲

条件に合う保存済みノートを選び、**Custom metadataだけ**を追加・更新・削除する。タイトル・本文・タグ・ID・Pin・Marp等は変更しない。実際に変更したノートの`updatedAt`は、保存管理上の更新として進める。利用者からupdatedAtを指定する機能は設けない。値が同じなら更新日時とrevisionを維持する。

対象は現在接続したPWA・Origin・ブラウザプロファイルのIndexedDB。未保存draft・外部Markdown・バックアップ・別PCは対象外。キー名変更・ネスト内の部分更新・配列要素への追記・複数ノートへの別々の値の自動計算は対象外。配列やオブジェクトは、指定キーの値全体として置き換える。

現行実装では`get_note`が`custom_metadata`を返すが、`update_note`はtitle/body/tagsのみ受け付ける。本文中のfrontmatterを書き換えて代用せず、保存Noteの`customMetadata`を専用操作で更新する。

## 2. 操作手順とツール

| ツール | 入力の役割 | ノートへの書き込み |
| --- | --- | --- |
| `preview_custom_metadata_changes` | ノート条件とAdd / Update / Upsert / Remove内容を指定し、対象・差分・除外理由を取得 | なし。短命の実行計画を作る |
| `apply_custom_metadata_changes` | 確認済み`plan_id`と再送用`request_id`を指定 | 固定した対象だけを一括更新 |

1. 利用者の依頼から条件と変更内容を組み立てる。
2. previewで対象件数、対象ID・タイトル、変更するキー、変更前後の値、変更しない理由を確認する。
3. 対象が曖昧・想定外なら条件を見直す。権限を広げたり、追加を更新へ自動変更したりしない。
4. applyで保存し、成功件数と再送状態を報告する。

利用者が「条件Xに合うノートをYへ更新」と具体的に指示済みで、previewもその範囲内なら、毎回の追加質問は必須にしない。「まず対象だけ確認」「検討のみ」ならpreviewまで。previewは対象確認とrevision固定のために常に実行する。

全件を扱う場合は利用者の明示的な全件指定が必要。無条件の空filterを全件と解釈しない。接続パネルに新たな権限やボタンを設けず、既存の`Allow reading and updating notes`を使う。previewで返す変更前後のCustom metadataもCodexへ渡る。

## 3. ノートの選択条件

`filter`は必須object。下記を組み合わせ、**すべてAND**で評価する。OR・正規表現・任意スクリプトは初版対象外。

| 条件 | 意味・初版の上限 |
| --- | --- |
| `note_ids` | ID完全一致。1〜50件の集合。複数IDのいずれかに一致し、他条件ともAND |
| `query`, `scope` | 現行searchと同じ部分一致。queryはtrim後の非空文字列・200コード単位まで。scopeはtitle / title_body、既定title_body。英字大小文字を区別しない |
| `tags` | 非空配列、最大32件。trim後の完全一致AND。各1〜80コード単位 |
| `updated_at` | `{gte?, lt?}`。UNIXミリ秒の安全な整数（Number.isSafeInteger）による下限以上・上限未満。少なくとも片方必須。両方ならgte < lt |
| `custom_metadata` | 最大20件の条件配列。各条件は下記のトップレベルキーに対する検査。条件間AND |
| `all_notes: true` | 明示的な全ノート指定。他の絞り込み条件と併用しない |

有効な絞り込みが1つ以上、またはall_notes=trueを必要とする。空配列・空query・scopeだけ・未知キー・不正nullはINVALID_ARGUMENT。明示したnote_idsが存在しなければNOT_FOUNDとして、指定ミスを黙って落とさない。

Custom metadata条件：

```json
{
  "custom_metadata": [
    { "key": "status", "op": "equals", "value": "draft" },
    { "key": "reviewed_by", "op": "missing" }
  ]
}
```

- `exists`：キーが存在する。null・空文字も存在扱い。valueは指定不可。
- `missing`：キーがない。valueは指定不可。
- `equals`：value必須。JSONの型を区別し、数値1と文字列"1"は別。配列は順序を区別、オブジェクトはプロパティ順を無視する深い一致。nullとの一致はキーが存在して値がnullの場合だけ。
- `contains`：valueは非空string。保存値もstringの場合に限り、大小文字を区別した文字列部分一致。配列所属検索やオブジェクトの文字列化検索には使わない。

キーは大小文字を区別する。`owner.name`はその名前のトップレベルキーであり、パス指定ではない。条件用キーは1〜100コード単位の保存キーを完全一致で扱い、黙ってtrimしない。containsのvalueは最大10,000コード単位。note_idsの各IDは1〜65,536コード単位。query/tagsの文字数上限はtrim前にも適用する。add/update/upsert/removeに使うキーの制約は5節に従う。

ノート条件は更新前の保存snapshotへ適用する。例えば「MKBタグがあり、status=draftのノートをstatus=reviewedにする」なら、tagsとmetadataのequalsを指定する。

## 4. Add・Update・Upsert・Removeの区別

`changes`は1〜20件。Add / Update / Upsertは`{action, key, value}`、Removeは`{action: "remove", key}`。Removeのvalueはnullも含めて指定不可。同一要求内で同じkeyを複数回指定できない。各選択ノートに同じchangesを適用する。

| action | 対象キーの状態 | 動作 |
| --- | --- | --- |
| `add` | 存在しない | 新規entryを末尾へ追加 |
| `add` | 存在する（同値も含む） | 上書きせず、`key_exists`としてその変更項目をskip |
| `update` | 存在し値が違う | そのentryの値全体を更新。位置とキー名を保持 |
| `update` | 存在し値が同じ | `same_value`。書き換えなし |
| `update` | 存在しない | 作成せず、`key_missing`としてその変更項目をskip |
| `upsert` | 存在しない | 新規entryを末尾へ追加。`added` |
| `upsert` | 存在し値が違う | そのentryの値全体を更新。位置とキー名を保持。`updated` |
| `upsert` | 存在し値が同じ | `same_value`。書き換えなし |
| `remove` | 存在する | entry全体を削除。`removed` |
| `remove` | 存在しない | `key_missing`としてskip。失敗ではない |

skipは事前に定義した非対象で、処理エラーではない。例えば2キー指定で1キーだけ既存なら、previewに片方の追加と片方のskipを表示する。既存キーだけを上書きする場合はupdate、キーがなければ作成し、あれば上書きする場合はupsertを明示する。actionに既定値はなく、addを自動的にupsertへ変更しない。

更新対象のメタデータ値を絞る条件はfilterへ書く。例：`status = draft`かつ`owner = team-a`のノートに対し、changesでstatusだけを更新する。操作ごとに異なる条件を組み合わせる複雑なルールは別planへ分ける。

キー削除の代わりにnullを使わない。nullは値として保存し、空文字・false・0・空配列も独立した値として扱う。

## 5. 値・キー・容量の検証

- 値はJSON値（string / 有限number / boolean / null / array / object）。YAML文字列をAPIに渡して再parseしない。型を保持する。
- 追加・更新・削除用キーは前後空白なし、1〜100 UTF-16コード単位。非正規キーを黙ってtrimして別キーへ更新しない。キー名の大小文字は区別する。
- アプリ管理キー`id/title/tags/updatedAt/marp/theme/size/paginate/headingDivider`はCustom操作の対象外。`pinnedAt`も管理属性と誤認させないため追加・更新・削除用キーでは拒否する（現行予約集合への追加とは別のMCP入力制約）。
- 危険キー`__proto__/prototype/constructor`はトップレベル・ネスト内とも拒否する。
- 結果のCustom metadataは1ノート最大100項目。既存UIと同じserializerによる1値のYAML表現を10,000コード単位以内に収める。JSON文字数とYAML入力欄の長さを同一視しない。
- 現行の値深度20、配列・object各1,000要素、全体展開10,000値／1,000,000文字の検証を共用する。更新後のCustom metadata全体に適用する。
- 初版は現行MCPと同じく本文128 KiB以下のノートを対象とする。本文自体は変更・返却しない。
- 不正な既存Custom metadata（重複キー等）を自動修復・削除しない。条件評価や更新を一意に決められない対象はINVALID_METADATAで拒否する。
- 未指定のCustom metadata entryと順序を維持する。追加する複数キーはchanges順。同値判定ではオブジェクトのキー順を無視し、意味が同じ値を再シリアライズして書き直さない。

## 6. previewと固定された対象

**1回最大50ノート、plan有効期間10分**。50件を超えた場合、先頭50件だけを暗黙実行せずTOO_MANY_MATCHESとして条件を絞り直す。現行の1件配送枠と15秒ACK待ちは維持する。

previewは1回の保存snapshotから候補を選び、次を返す。

- `plan_id`（推測困難なランダムID）、`expires_at`。
- `matched_notes`、`changed_notes`、`unchanged_notes`、`skipped_notes`。
- ID・タイトル・期待revision、キーごとのbefore/afterとresult。before/afterは`{exists:false}`または`{exists:true,value:...}`で、欠落とnullを区別する。
- 各ノートの分類は、1項目以上変更ならchanged、変更なしでsame_valueがあればunchanged、それ以外はskipped。件数合計はmatched_notes。

0件なら正常な`status: no_matches`、plan_id=null、全件数0、items=[]。全項目skip／同値なら`status: no_changes`、plan_id=nullでapply不要。planを発行する場合だけ`status: ready`とexpires_atを返す。

planはPWAのメモリで管理し、選択ID・全Noteのrevision・変更内容・差分を固定する。読み取り中の全本文をCodexへ返さない。権限解除、接続先変更、切断、PWA再読み込みでplanを破棄する。1接続で最大5plan（実行済みも期限まで含む）、1plan最大8 MiB、合計16 MiB。容量は差分と変更後metadataのJSON UTF-8サイズで数え、JavaScriptヒープ全体の計測値ではない。上限超過はPLAN_LIMIT_EXCEEDED。新preview時に期限切れplanを解放する。期限切れでもメモリに残っていればPLAN_EXPIRED、解放後はPLAN_NOT_FOUND。

preview後に条件に合うノートが追加されても、このplanには含めない。保存時に検索をやり直して対象を広げない。固定対象が変更・削除された場合は競合として全体を拒否する（skip/unchangedに分類した選択ノートも含む）。したがって「実行時点で条件に合う全件」を保証する検索ロックではない。

preview応答は現行search/getと同じ1,000,000 UTF-8 bytes以下。超過時に差分を切り詰めたplanを発行しない。本文や無関係のmetadataを返さず、それでも超える場合はRESPONSE_TOO_LARGEで対象を絞る。

## 7. 要求・応答例

Upsert：タグMKBのノートで、review_statusがなければ追加、あれば値をreviewedへ更新する。同値は変更しない。以下は`preview_custom_metadata_changes`のarguments。

```json
{
  "filter": { "tags": ["MKB"] },
  "changes": [
    { "action": "upsert", "key": "review_status", "value": "reviewed" }
  ]
}
```

追加：タグMKBのノートにreview_statusを追加。すでに存在するノートはそのキーをskip。

```json
{
  "name": "preview_custom_metadata_changes",
  "arguments": {
    "filter": { "tags": ["MKB"] },
    "changes": [{ "action": "add", "key": "review_status", "value": "pending" }]
  }
}
```

更新：タグMKB、review_status=pendingのノートの値だけをreviewedへ変更。

```json
{
  "name": "preview_custom_metadata_changes",
  "arguments": {
    "filter": {
      "tags": ["MKB"],
      "custom_metadata": [{ "key": "review_status", "op": "equals", "value": "pending" }]
    },
    "changes": [{ "action": "update", "key": "review_status", "value": "reviewed" }]
  }
}
```

上の更新要求が1件に一致した場合のpreview。revisionとIDは形式説明用の架空値。

```json
{
  "status": "ready",
  "plan_id": "cmdp_74b59b69-6a71-4fa6-9abc-9a9fb5452001",
  "expires_at": 1794884400000,
  "matched_notes": 1,
  "changed_notes": 1,
  "unchanged_notes": 0,
  "skipped_notes": 0,
  "items": [{
    "id": "example-note-001",
    "title": "MKB導入手順",
    "expected_revision": "v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "status": "changed",
    "changes": [{
      "action": "update",
      "key": "review_status",
      "result": "updated",
      "before": { "exists": true, "value": "pending" },
      "after": { "exists": true, "value": "reviewed" }
    }]
  }]
}
```

applyは条件・変更値を再指定しない。previewとの取り違えや再検索による対象変更を防ぐ。

```json
{
  "name": "apply_custom_metadata_changes",
  "arguments": {
    "plan_id": "cmdp_74b59b69-6a71-4fa6-9abc-9a9fb5452001",
    "request_id": "metadata-review-20261117-001"
  }
}
```

```json
{
  "status": "applied",
  "plan_id": "cmdp_74b59b69-6a71-4fa6-9abc-9a9fb5452001",
  "matched_notes": 1,
  "updated_notes": 1,
  "unchanged_notes": 0,
  "skipped_notes": 0,
  "added_fields": 0,
  "updated_fields": 1,
  "reused": false,
  "items": [{
    "id": "example-note-001",
    "status": "updated",
    "previous_revision": "v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "revision": "v1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "updated_at": 1794883800000
  }]
}
```

applyのitemsは固定対象全件を含み、状態はupdated/unchanged/skipped。unchanged/skippedのrevision・updated_atは維持。added_fields/updated_fieldsは全対象を通じて実際に変更したentry数で、same_valueやskipを含めない。

`plan_id`は`cmdp_`にUUIDを続けた文字列、`request_id`は8〜80文字の英数字・`_`・`-`。applyの入力はこの2項目のみ。応答はMCP共通の`content[0].text`内のJSONであり、業務エラー時は`isError: true`も返す（SDK入力検証エラーは共通API設計書参照）。以下はapplyの競合エラー例。

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "A selected note changed. No notes were updated. Preview again."
  }
}
```

## 8. 一括保存・競合・再送

**全件成功または全件取り消し**。1件でも競合・編集中・保存失敗なら、変更可能なノートだけを先行保存しない。正常なskipは4節の予定された非対象であり、このエラーとは別。

1. 現行のアクセス許可と入力形式を検証する。
2. 永続receiptをrequest_idで照合。同一入力なら元の結果をreused=trueで返す。planの存在・期限確認より先に行う。
3. receiptがなければplanの所有接続・期限・未実行状態を確認する。
4. 全固定対象の保存状態とplanのrevisionを照合。変更後snapshotとrevision、容量内の応答をtransaction外で準備する。
5. 対象の編集・保存状態を検査し、commit区間の入力を抑止。既存の未保存本文やmetadataダイアログを勝手に閉じない。
6. `notes`と`mcpReceipts`の1つのreadwrite transactionでreceipt・権限・全snapshotを再照合し、変更ノートと一括receiptを保存する。
7. commit後のみ成功応答を返し、画面・他タブへ通知する。途中の例外は全件rollbackし、取得した入力ロックをすべて解除する。

revisionは従来と同じ全Noteのハッシュ。metadata以外の本文・タグ・Pin等が変わってもCONFLICTとなる。メタデータだけのrevisionへ弱めない。他タブの古い保存も既存CASで拒否する。

再送キーは`custom-metadata:` + request_id。digestは`{operation, plan_id}`、plan内容は発行後不変。同じrequest_idで異なるplan_idならREQUEST_ID_CONFLICT。一括receiptには件数と各ノートの元の結果を保持し、本文や全metadataを入れない。既存のcreate/update/append/replaceのreceipt契約は維持する。

成功済みplanを別request_idで実行しようとした場合はPLAN_ALREADY_APPLIEDで拒否する。同一request_idの再送はplanが失効・消失した後もreceiptから回答する。PWA再読み込み後、receiptがなくplanもなければPLAN_NOT_FOUNDで書き込まない。OUTCOME_UNKNOWN時はまず同一要求を再送し、確認せず新しいplanで繰り返さない。

planは永続化せず、DB version 2を維持する。既存`UpdateReceipt`と新`MetadataReceipt`のunionを同じmcpReceipts storeに保存し、既存receiptを読み替えたり削除したりしない。

## 9. エラー・互換性・権限

既存のNOT_CONNECTED / ACCESS_DISABLED / BUSY / INVALID_ARGUMENT / STORAGE_UNAVAILABLE / CONFLICT / NOTE_BUSY / REQUEST_ID_CONFLICT / SAVE_FAILED / OUTCOME_UNKNOWN / UPGRADE_REQUIRED / NOTE_TOO_LARGE / RESPONSE_TOO_LARGEを用途に合わせて継承する。

追加コード：

| code | 条件 |
| --- | --- |
| TOO_MANY_MATCHES | 上限50ノートを超える |
| INVALID_METADATA | 既存データの重複キー等で安全に条件評価・変更できない |
| METADATA_LIMIT_EXCEEDED | 更新結果の項目数・サイズ・深度等が上限を超える |
| PLAN_NOT_FOUND | planが存在しない、接続変更やPWA再起動で消失 |
| PLAN_EXPIRED | 有効期間を超えている |
| PLAN_ALREADY_APPLIED | 成功済みplanへ別request_idで再実行 |
| PLAN_LIMIT_EXCEEDED | 保持plan数またはJSON容量の上限を超える |

未知キーや入力の危険キーはINVALID_ARGUMENT。既存のACKエラーschemaとbrokerCapabilities / PWA supportedOperationsへ新2操作を追加する。旧broker・旧PWAへ新操作を配送せずUPGRADE_REQUIRED。既存7ツールの入力契約は変更せず、対応版のみ計9ツールとなる。

読み取り・更新の許可は既存設定を継承するが、previewで返す変更前metadataもCodexへ渡ることを説明ノートへ明記する。plan_idはそのPWA接続に束縛する。現行どおり同じPCのペアリング済みMCP利用者間でのチャット別権限分離は設けない。

## 10. 検証対象とUIの型保持

- filterのAND、存在とnull、型付きequals、文字列contains、0件・50件・51件。空条件から全件へ広がらないこと。
- add既存キー／update欠落キーのskip、upsertの追加・更新・同値、複数changes、entry順と本文・管理属性の保持。
- preview後の編集・削除・条件に合うノートの新規作成。固定対象を広げないこと。
- 1件の競合・編集中・権限解除・quota failureで全件rollback。別タブの古い保存と二重実行の競合。
- ACK喪失・PWA再読み込み・plan期限後の同一要求再送、異なるplanで同一request_id、成功済みplanの別ID再実行。
- 旧版との能力交渉、応答上限、metadata編集／export／importの型の往復。

`MetadataDialog.tsx`の`parsedValue ?? ""`をundefinedだけのフォールバックへ変更し、nullをそのまま保存する。MCP保存後のMetadata → Apply → Saveは隔離Chromiumの通し試験対象。画面の配置や操作手順は変えない。

また、現行の100項目上限は主にUIの追加ボタン制御であり、インポート済み全データがこの件数以内とは限らない。MCPの検証をUI制御だけに依存させない。範囲外の既存値・重複キーは黙って正規化せず拒否する。

### Add / Update / Upsert公開時の検証結果（2026-11-17、runtime 0.6.0）

- 関連単体試験84件：`localMcpMetadata`、`localMcpAccess`、`frontmatter`、`backup`。50件成功・51件拒否、型保持、競合、全件rollback、権限解除、期限、並行再送を含む。
- `node --test tools/local-mcp/bridge.test.mjs`：12件成功。入力・応答schemaと旧PWAへの配送防止。
- `node tools/local-mcp/verify.mjs`：実MCP STDIO＋隔離Chromiumで28項目成功。新3操作、編集中の全件拒否、ACK喪失・再読み込み後の再送、権限再有効化後の旧plan拒否、Metadata画面でのnull保持を確認。
- `node tools/local-mcp/concurrent-probe.mjs`：8項目成功。共有接続、再起動、旧brokerへの新操作配送防止。`windows/verify-kit.mjs`：6群成功、新schemaの同梱と導入後9ツールの起動を確認。
- 型チェックを含む`npm run build`、`npm run lint`、`git diff --check`成功。本文例を除く要求・応答JSONは実schemaと照合。依存追加なし。
- 本番PWA、別PC、全E2Eの実行は含まない。50件の容量境界は単体試験で確認したもので、全端末で15秒以内の処理を保証する負荷試験ではない。

通し試験の初回は、新metadata操作に入る前の既存「未保存本文を保持」チェックで、保存済み本文が表示される失敗が1回あった。同じ箇所は後続2回成功し、再現条件は未確定。今回のmetadata処理が原因とは確認できておらず、既存経路の継続観察事項として残す。別の権限再有効化チェックでは開いたAdvanced settingsを試験が閉じていたため、開閉状態を確認する手順へ修正して完走した。

## 11. 提供状態

### Remove追加時の検証（2026-11-17、runtime 0.7.0）

- `localMcpMetadata`・`localMcpAccess`の関連単体70件、bridge 14件成功。削除対象の厳密な検証、値型・残存順序、最後のキー、混在操作、全件rollback、旧receipt、キー再追加後の再送を確認。
- 実MCP STDIO＋隔離Chromiumで31項目成功。削除件数、欠落skip、競合時の全件拒否、ACK喪失・再読み込み後の元の削除結果の再送、新PWAによる旧broker応答の検出を確認。
- ライフサイクル試験9項目、Windows配布試験6群成功。旧brokerへのRemove配送防止と既存3操作の維持、ZIP導入後の9ツール起動、再インストール時のペアリング保持を確認。
- 型チェックを含むbuild、lint、差分チェック、本文のJSON例のschema照合を実施。依存追加・DB移行なし。
- 新旧混在試験で、旧brokerのACKがUPGRADE_REQUIREDを受理しないことを検出。内部では旧版対応のUNSUPPORTED_OPERATIONを使い、新runtimeで変換するよう修正して成功。旧版応答は隔離環境で再現し、本番データへの障害注入は行っていない。
- この記録はローカル検証であり、本番PWAでのRemove実行、他PCでの実PWA、全E2Eの成功を示すものではない。

### 利用バージョン

条件はAND、操作はadd/update/upsert/removeを明示、既存キーへのaddと欠落キーへのupdateはskip、preview必須、対象固定、最大50ノート、一括transaction、既存のrevision・再送保証を継承する。rename・複雑な条件式・ノート自体の削除は含めない。

本仕様はruntime 0.7.0と対応PWAを対象とする。[Windows Setup 1.4.0](https://github.com/Bamboosato/markdown-knowledge-board/releases/tag/mkb-windows-setup-v1.4.0)へ更新し、Codex再起動とPWA更新・Reconnectで利用する。旧Setup 1.3.0（runtime 0.6.0）はAdd / Update / Upsertまでで、Removeには対応しない。接続コードの再発行は不要。ローカル検証と本番確認の範囲は分けて扱う。

## 12. Remove：Custom metadataのキー削除

runtime 0.7.0 / Windows Setup 1.4.0で追加。既存のpreview / applyへ統合し、新たな権限や画面操作は追加しない。

### 12.1 対象とAPI

既存の`preview_custom_metadata_changes`と`apply_custom_metadata_changes`を拡張し、`changes`へ`action: "remove"`を追加する。新しいMCPツールは増やさず、計9ツールを維持する。Removeは指定したトップレベルCustom metadataキーとその値を削除する操作であり、ノート自体は削除しない。

- removeの入力は`{action: "remove", key}`。`value`は指定不可。`value: null`もINVALID_ARGUMENT。Add / Update / Upsertでは従来どおりvalue必須。
- キーは大文字小文字を区別する完全一致。前後空白なし・1〜100 UTF-16コード単位、既存の管理キー・危険キーの禁止を継承する。
- `owner.name`はその名前のトップレベルキー。ネスト内の部分削除、キーのワイルドカード、全Custom metadataの無条件消去、ノート削除、キー名変更は対象外。
- filter、AND条件、note_ids、tags、更新日時、metadata条件、明示的なall_notesは既存契約のまま。条件は削除前の保存snapshotへ適用する。
- changesは合計1〜20件。同じkeyを複数回指定することは、異なるactionの組み合わせでもINVALID_ARGUMENT。異なるキーならAdd / Update / Upsert / Removeを同一planへ混在できる。ただし利用者が依頼した操作だけを含める。

### 12.2 存在・欠落と保存結果

| キーの状態 | result | 動作 |
| --- | --- | --- |
| 存在する | `removed` | entryを削除。値がnull・空文字・false・0でも削除する |
| 存在しない | `key_missing` | 正常なスキップ。新規entryを作らず、失敗扱いにしない |

`upsert`でnullを保存する動作は変更しない。nullは値であり、キー削除の省略記法にはしない。

1項目以上added / updated / removedがあればノートはchanged、変更がなくsame_valueがあればunchanged、それ以外はskipped。全件欠落なら`status: "no_changes"`、plan_id=nullでapply不要。0件一致は従来のno_matches。

削除しないentryの値と順序、本文・タイトル・タグ・ID・Pin・Marp・その他の属性を維持する。最後のentryを削除した場合は`customMetadata: []`として保存する。実際に変更したノートだけupdatedAtとrevisionを更新し、欠落キーをスキップしただけのノートは両方を維持する。

不正な既存metadata（重複キー、禁止キー、不正値等）を削除機能で修復しない。INVALID_METADATAとして拒否する。既存の入力値検証と変更後metadataの項目数・容量・展開上限を継承する。本文128 KiB、最大50ノート、応答1,000,000 UTF-8 bytesの上限も変更しない。

### 12.3 previewと実行の意思

previewは必須。対象ID・タイトル・件数に加え、削除するキーと削除前の値を返す。削除前の値もCodexへ渡るため、既存の読み取り・更新許可を使う。

削除予定は`before: {exists: true, value: ...}`、`after: {exists: false}`、`result: "removed"`。欠落によるスキップはbefore/afterとも`{exists: false}`、resultはkey_missing。

「条件XのノートからキーYを削除して」と明示され、previewがその範囲に一致する場合は、その依頼をapplyの許可として扱う。「削除できるか」「まず対象を確認」「仕様を検討」ではapplyしない。previewが依頼範囲を超えた場合は条件を見直し、必要な確認を行う。削除専用の恒常的な追加権限や、毎回必須の再確認ダイアログは設けない。

### 12.4 要求・応答例

タグMKBを持ち、review_statusがreviewedのノートからreview_statusを削除するpreviewのarguments：

```json
{
  "filter": {
    "tags": ["MKB"],
    "custom_metadata": [{ "key": "review_status", "op": "equals", "value": "reviewed" }]
  },
  "changes": [{ "action": "remove", "key": "review_status" }]
}
```

previewの正常応答。ID・revision・時刻は説明用の架空値。

```json
{
  "status": "ready",
  "plan_id": "cmdp_b930f35f-5f96-43cb-a89e-08fa4384d4d1",
  "expires_at": 1794884400000,
  "matched_notes": 1,
  "changed_notes": 1,
  "unchanged_notes": 0,
  "skipped_notes": 0,
  "items": [
    {
      "id": "example-note-001",
      "title": "MKB導入手順",
      "expected_revision": "v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "status": "changed",
      "changes": [
        {
          "action": "remove",
          "key": "review_status",
          "result": "removed",
          "before": {
            "exists": true,
            "value": "reviewed"
          },
          "after": {
            "exists": false
          }
        }
      ]
    }
  ]
}
```

applyの入力は従来どおりplan_idとrequest_idだけ。

```json
{
  "plan_id": "cmdp_b930f35f-5f96-43cb-a89e-08fa4384d4d1",
  "request_id": "metadata-remove-example-001"
}
```

1件のノートからキーを1個削除した正常応答：

```json
{
  "status": "applied",
  "plan_id": "cmdp_b930f35f-5f96-43cb-a89e-08fa4384d4d1",
  "matched_notes": 1,
  "updated_notes": 1,
  "unchanged_notes": 0,
  "skipped_notes": 0,
  "added_fields": 0,
  "updated_fields": 0,
  "removed_fields": 1,
  "reused": false,
  "items": [
    {
      "id": "example-note-001",
      "status": "updated",
      "previous_revision": "v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "revision": "v1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "updated_at": 1794883800000
    }
  ]
}
```

brokerが削除未対応の場合のエラー応答（content[0].text内）。ノートは更新しない。MCP包装はisError: true。

```json
{
  "error": {
    "code": "UPGRADE_REQUIRED",
    "message": "Update the local MCP service to remove Custom metadata or replay a removal."
  }
}
```

preview後に固定対象が変わった場合は8節のCONFLICT。removeにvalueを指定した要求はSDK入力検証で拒否する。内部配送で直接受けた不正要求はINVALID_ARGUMENTとなる。キー欠落はエラーではなくkey_missingを返す。

removed_fieldsは全対象で実際に削除したentry数。欠落によるskipは含めない。ノートの保存結果は引き続きupdatedであり、ノート削除を意味するdeletedにはしない。itemsには固定対象全件のID・状態・前後revision・更新日時を返す。

### 12.5 一括保存・競合・再送

既存の10分のplan、保持上限、セッション束縛、全Note revision、同一transactionによるnotesとreceiptの保存を継承する。

- preview後に新しく条件へ一致したノートを追加しない。固定対象が本文編集・キー追加・値変更・キー削除・ノート削除等で変われば、skip予定ノートも含めてCONFLICT。実行時に「もう消えているので成功」と読み替えない。
- 1件でも競合・編集中・保存失敗なら全件を取り消す。部分成功は返さない。
- 同じplan_id/request_idを再送した場合は、planの存在・期限・現在のノート状態より先に永続receiptを照合し、元の削除件数をreused:trueで返す。後から同じキーが追加されていても再削除しない。
- 異なるplan_idで同じrequest_idはREQUEST_ID_CONFLICT。成功済みplanに別request_idを使う場合やplan失効の扱いも既存契約のまま。
- receiptへ削除前の値を新たに永続保存しない。自動Undo・復元専用APIは今回追加しない。既存バックアップ機能とは別の操作として扱う。

### 12.6 旧版との互換性

各版の実装はactionとACK応答を厳密に検証している。特に旧brokerは未知のremoved_fieldsを拒否するため、単にenumや件数項目を追加するだけでは、保存後にACKを受け取れない組み合わせを作ってしまう。

互換性契約は次のとおり。全体のPWA protocolVersion=2、ツール名、接続コード、DB version 2は維持する。

1. ツール名の対応有無に加え、metadataのactionを交渉する。内部connect/pollでPWAの`supportedMetadataActions`、connect / poll応答とstatusで`brokerMetadataActions`を通知し、connection_statusの`metadataActions`は両者が対応し、許可もあるactionだけを返す。削除対応版はadd/update/upsert/removeを通知する。
2. action情報がない現行0.6.0は、metadataツール自体の対応が確認できる場合に限りadd/update/upsert対応と解釈する。remove対応とは推測しない。未接続・未許可では実行可能actionは空。
3. removeを含むpreviewはruntime・broker・PWAの対応を確認し、未対応なら配送・保存の前にUPGRADE_REQUIRED。新PWAもbrokerの対応を確認し、未確認のままremoveを実行しない。
4. planにはremoveを含むかどうかを固定する。applyの入力にはactionがないため、PWAはplanまたは既存receiptからremoveの有無を判定する。removeのplan実行・receipt返却時はbrokerの対応を確認し、未対応ならUPGRADE_REQUIREDで保存しない。接続変更時のplan破棄も維持する。
5. **removed_fieldsはremoveを含むplanのapply結果にだけ返す**（実削除0件なら0）。Add / Update / Upsertだけのplanと旧receiptは従来の応答形式を維持する。受信側ではremoved_fieldsの省略を0件として扱う。旧receiptを書き換えたり、再送のために新しいplanを強制したりしない。
6. 新brokerは新旧両形式のACKを検証する。removeのdiffとremoved_fieldsを認識する。PWAは実行結果を同じ形式でreceiptへ保存する。新PWAと旧brokerの組み合わせでは、remove結果返却でタイムアウトさせず、対応不足を先に検出する。
7. PWAからbrokerへ対応不足を返す内部ACKは、0.6.0も受理する`UNSUPPORTED_OPERATION`を使う。0.7.0 runtimeはmetadataツールのこの応答を公開エラー`UPGRADE_REQUIRED`へ変換する。旧runtimeは`UNSUPPORTED_OPERATION`と更新案内をそのまま返す。これは保存前の拒否であり、`OUTCOME_UNKNOWN`にはしない。

現行0.6.0と削除対応版の混在ではAdd / Update / Upsertを維持し、Removeだけを対応版どうしに限定する。runtime→broker、PWA→brokerの両方向と、更新後の旧receipt再送を試験する。

PWAとbrokerを両方とも未改修の0.6.0へ戻した場合、削除receiptの再送互換性は保証できない。旧コードに対応判定がなく、未知のremoved_fieldsをACKで拒否するためである。削除の結果を照合する場合は削除対応版へ戻して、元のplan_id/request_idで再送する。ダウングレード対応のために永続receiptを削除・変換したり、新しい要求として再実行したりしない。

### 12.7 Removeの検証観点

- 既存キー削除、欠落skip、最後の1項目の削除、null等の値の削除、他のentryの値・順序と本文・管理属性の保持。
- filterのANDと削除前評価、複数キー、異なるactionとの混在、同一キーの重複拒否、value指定の拒否、管理キー・危険キーの拒否。
- 0件・全skip・一部skip、removed_fieldsの実件数、no_changes時の更新日時とrevisionの維持。
- preview後の変更・削除・キー再追加、全件rollback、再送後に再追加されたキーを消さないこと、古いreceiptの再利用。
- 新旧runtime／broker／PWAの組み合わせで、既存3操作の互換性とRemoveの事前拒否。ACK喪失・PWA再読み込み後も元の削除件数を返すこと。
- 対象試験とAPI設計書・配布手順の整合を確認する。本番でのRemove実行結果はローカル検証と区別し、Codex再起動・PWA更新後に確認する。
