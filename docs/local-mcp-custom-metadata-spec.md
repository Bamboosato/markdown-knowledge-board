# MKB Local MCP：Custom metadataの条件付き追加・更新・Upsert仕様

- 更新日：2026-11-17
- 状態：実装確定。runtime 0.6.0 / Windows Setup 1.3.0の追加仕様。
- 基盤：`817b95316a032b5b61a5acc542e40f08dbd89748`（runtime 0.5.0）。追加実装は`src/lib/localMcpMetadata.ts`、要求・応答のschemaは`tools/local-mcp/metadata-schema.mjs`。
- 現行契約：[Local MCP API設計書](./local-mcp-note-access-spec.md)

## 1. 目的・範囲

条件に合う保存済みノートを選び、**Custom metadataだけ**を追加・更新する。タイトル・本文・タグ・ID・Pin・Marp等は変更しない。実際に変更したノートの`updatedAt`は、保存管理上の更新として進める。利用者からupdatedAtを指定する機能は設けない。値が同じなら更新日時とrevisionを維持する。

対象は現在接続したPWA・Origin・ブラウザプロファイルのIndexedDB。未保存draft・外部Markdown・バックアップ・別PCは対象外。今回の案にはキー削除・キー名変更・ネスト内の部分更新・配列要素への追記・複数ノートへの別々の値の自動計算を含めない。配列やオブジェクトは、指定キーの値全体として置き換える。

現行実装では`get_note`が`custom_metadata`を返すが、`update_note`はtitle/body/tagsのみ受け付ける。本文中のfrontmatterを書き換えて代用せず、保存Noteの`customMetadata`を専用操作で更新する。

## 2. 操作手順とツール

| ツール | 入力の役割 | ノートへの書き込み |
| --- | --- | --- |
| `preview_custom_metadata_changes` | ノート条件と追加・更新・Upsert内容を指定し、対象・差分・除外理由を取得 | なし。短命の実行計画を作る |
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

キーは大小文字を区別する。`owner.name`はその名前のトップレベルキーであり、パス指定ではない。条件用キーは1〜100コード単位の保存キーを完全一致で扱い、黙ってtrimしない。containsのvalueは最大10,000コード単位。note_idsの各IDは1〜65,536コード単位。query/tagsの文字数上限はtrim前にも適用する。add/update/upsertに使うキーの制約は5節に従う。

ノート条件は更新前の保存snapshotへ適用する。例えば「MKBタグがあり、status=draftのノートをstatus=reviewedにする」なら、tagsとmetadataのequalsを指定する。

## 4. Add・Update・Upsertの区別

`changes`は1〜20件。各項目は`{action, key, value}`。同一要求内で同じkeyを複数回指定できない。各選択ノートに同じchangesを適用する。

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

skipは事前に定義した非対象で、処理エラーではない。例えば2キー指定で1キーだけ既存なら、previewに片方の追加と片方のskipを表示する。既存キーだけを上書きする場合はupdate、キーがなければ作成し、あれば上書きする場合はupsertを明示する。actionに既定値はなく、addを自動的にupsertへ変更しない。

更新対象のメタデータ値を絞る条件はfilterへ書く。例：`status = draft`かつ`owner = team-a`のノートに対し、changesでstatusだけを更新する。操作ごとに異なる条件を組み合わせる複雑なルールは別planへ分ける。

キー削除の代わりにnullを使わない。nullは値として保存し、空文字・false・0・空配列も独立した値として扱う。

## 5. 値・キー・容量の検証

- 値はJSON値（string / 有限number / boolean / null / array / object）。YAML文字列をAPIに渡して再parseしない。型を保持する。
- 追加・更新用キーは前後空白なし、1〜100 UTF-16コード単位。非正規キーを黙ってtrimして別キーへ更新しない。キー名の大小文字は区別する。
- アプリ管理キー`id/title/tags/updatedAt/marp/theme/size/paginate/headingDivider`はCustom操作の対象外。`pinnedAt`も管理属性と誤認させないため追加・更新用キーでは拒否する（現行予約集合への追加とは別のMCP入力制約）。
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

### ローカル検証結果（2026-11-17）

- 関連単体試験84件：`localMcpMetadata`、`localMcpAccess`、`frontmatter`、`backup`。50件成功・51件拒否、型保持、競合、全件rollback、権限解除、期限、並行再送を含む。
- `node --test tools/local-mcp/bridge.test.mjs`：12件成功。入力・応答schemaと旧PWAへの配送防止。
- `node tools/local-mcp/verify.mjs`：実MCP STDIO＋隔離Chromiumで28項目成功。新3操作、編集中の全件拒否、ACK喪失・再読み込み後の再送、権限再有効化後の旧plan拒否、Metadata画面でのnull保持を確認。
- `node tools/local-mcp/concurrent-probe.mjs`：8項目成功。共有接続、再起動、旧brokerへの新操作配送防止。`windows/verify-kit.mjs`：6群成功、新schemaの同梱と導入後9ツールの起動を確認。
- 型チェックを含む`npm run build`、`npm run lint`、`git diff --check`成功。本文例を除く要求・応答JSONは実schemaと照合。依存追加なし。
- 本番PWA、別PC、全E2Eの実行は含まない。50件の容量境界は単体試験で確認したもので、全端末で15秒以内の処理を保証する負荷試験ではない。

通し試験の初回は、新metadata操作に入る前の既存「未保存本文を保持」チェックで、保存済み本文が表示される失敗が1回あった。同じ箇所は後続2回成功し、再現条件は未確定。今回のmetadata処理が原因とは確認できておらず、既存経路の継続観察事項として残す。別の権限再有効化チェックでは開いたAdvanced settingsを試験が閉じていたため、開閉状態を確認する手順へ修正して完走した。

## 11. 提供状態

条件はAND、操作はadd/update/upsertを明示、既存キーへのaddと欠落キーへのupdateはskip、preview必須、対象固定、最大50ノート、一括transaction、既存のrevision・再送保証を継承する。キー削除・rename・複雑な条件式は今回含めない。

本仕様はruntime 0.6.0と対応PWAを対象とする。[Windows Setup 1.3.0](https://github.com/Bamboosato/markdown-knowledge-board/releases/tag/mkb-windows-setup-v1.3.0)へ更新し、Codex再起動とPWA更新・Reconnectで利用する。旧Setup 1.2.0（runtime 0.5.0）には含まれない。接続コードの再発行は不要。ローカル検証と本番確認の範囲は分けて扱う。
