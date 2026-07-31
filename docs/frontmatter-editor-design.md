# Markdown Knowledge Board Metadataダイアログ 詳細設計

作成日: 2026-07-30

更新日: 2026-07-31

状態: 実装済み

関連要件: [Metadataダイアログ 要件定義](./frontmatter-editor-requirements.md)

## 1. 設計目的

既存Edit画面のレイアウトを変更せず、More actionsから開くmodal dialogでfrontmatterのcanonical orderを参照し、Custom metadataだけを編集できるようにする。

DialogのApplyは現在のNote draftへの反映とし、IndexedDBへの永続化は既存のメインSaveへ統合する。

## 2. 画面構成

### 2.1 導線

既存More actionsメニューを次の順にする。

```text
More actions
├─ Metadata
├─ Export
└─ Delete
```

`Metadata`選択でmenuを閉じ、Metadata dialogを開く。Edit画面には新しい入力欄、accordion、常設ボタンを追加しない。

### 2.2 Dialog

```text
Metadata
──────────────────────────────────────
ID          note-123                  Read-only
Title       Basic design              Read-only
Tags        architecture, phase2      Read-only
Updated at  2026-07-31T10:30:00.000Z  Read-only

Marp        true                      Read-only
Theme       default                   Read-only
Size        16:9                      Read-only
Paginate    true                      Read-only

Custom metadata
[ author ] [ Bamboo ]             [Delete]
[ status ] [ draft  ]             [Delete]

[ Add custom field ]
──────────────────────────────────────
                         [Cancel] [Apply]
```

- 項目はcanonical export orderで表示する。
- Marp属性は実Export対象のものだけ表示する。
- Custom metadataは保持順で表示し、新規行は末尾へ追加する。
- Dialog bodyだけをスクロールさせ、headerとfooterを操作可能な位置に維持する。

## 3. Component設計

新規component:

- `src/components/MetadataDialog.tsx`
- 必要に応じて`src/components/CustomMetadataRow.tsx`

```ts
type MetadataDialogProps = {
  isOpen: boolean;
  managedEntries: FrontmatterEntry[];
  customMetadata: CustomMetadataEntry[];
  onApply: (entries: CustomMetadataEntry[]) => void;
  onClose: () => void;
};
```

`MetadataDialog`の責務:

- modal、focus trap、responsive layout
- managed entryのread-only表示
- Custom fieldのlocal state
- 行追加、変更、削除
- validationとApply可否
- 未適用変更の破棄確認
- Apply／Cancel／keyboard shortcut

`App.tsx`の責務:

- More actionsへの導線
- dialog open時の現在draftからmanaged entries生成
- ApplyされたCustom metadataのdraft反映とdirty更新
- Save／Revert／未保存遷移
- open元へのfocus復帰

## 4. データモデル

### 4.1 Note

```ts
export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export type CustomMetadataEntry = {
  id: string; // UI row identity。Exportしない。
  key: string;
  value: FrontmatterValue;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
  marp?: MarpSettings;
  customMetadata?: Array<Omit<CustomMetadataEntry, "id">>;
};
```

Custom metadataを配列で保持し、明示的に順序を維持する。UI用`id`はdialog open時に生成し、Note／Exportへ保存しない。

既存Noteで`customMetadata`がない場合は空配列として扱う。IndexedDB object storeやindexは変えないためDB versionは原則据え置く。

### 4.2 Frontmatter entry

```ts
type FrontmatterEntry = {
  key: string;
  value: FrontmatterValue;
  source: "system" | "edit" | "slides" | "custom";
  includedInExport: boolean;
  editable: boolean;
};
```

DialogとExportはこの共通entry列を使用する。

## 5. Canonical order

`src/lib/frontmatter.ts`へ、順序を持つentry列を返す共通処理を追加する。

```ts
function buildFrontmatterEntries(note: NoteLike): FrontmatterEntry[];
```

生成順:

1. `id`
2. `title`
3. `tags`
4. `updatedAt`
5. `marp`
6. `theme`
7. `size`
8. `paginate`
9. `headingDivider`
10. Custom metadata

省略可能な属性は`includedInExport`で管理する。YAML exportは`true`のentryだけを順番にmappingへ追加する。Dialogで省略項目を表示する場合は、Exportされないことを明示する。

現行export実装のkey追加順と異なる場合は、後方互換性を保ったまま上記canonical orderへ統一する。YAML mappingの意味はkey順に依存しないが、snapshot／E2Eは新しい順序へ更新する。

## 6. Read-only表示

- `id`はsystem管理としてread-only表示する。
- `title`と`tags`はdialog open時点の`draftTitle`とeffective draft tagsを表示する。
- `updatedAt`は現在のdraft値をISO 8601で表示する。実Save時に更新されることを補助表示する。
- Marp属性は現在のdraft Marp設定から生成し、Slides settingsで管理されることを示す。
- 値は選択・コピー可能なtextとして描画し、inputへしない。
- Tagsは順序を維持し、配列と認識できる表示にする。

## 7. Dialog local state

```ts
type EditableCustomRow = {
  rowId: string;
  keyText: string;
  valueText: string;
  parsedValue?: FrontmatterValue;
  errors: Array<"empty-key" | "duplicate-key" | "reserved-key" | "invalid-value" | "unsafe-key">;
};
```

open時:

1. 現在のdraft Custom metadataをcloneする。
2. 各valueを安定したYAML表現へserializeする。
3. `initialRows`と`rows`へ別cloneとして保持する。
4. `rows`と`initialRows`の構造比較でdialog dirtyを判定する。

Apply前は`App.tsx`のdraft Custom metadataを変更しない。

## 8. Value parse／serialize

### 8.1 入力

- Value欄のplain textはstringとして扱う。
- quoted string、number、boolean、null、flow sequence、flow mappingはYAML valueとしてparseする。
- Imported valueは型を失わない安定した1行YAML表現へ変換する。
- block scalarなど1行で安全に表せない値もflow形式またはquoted stringへ正規化する。

### 8.2 安全性

- `__proto__`、`prototype`、`constructor`を拒否する。
- parsed objectはplain dataへ再帰的に正規化する。
- 最大key長、value長、field件数、nest深度、serialized sizeを制限する。
- Dialog表示はReact text node／input valueを使用し、HTMLとして挿入しない。

### 8.3 予約key

```ts
const RESERVED_FRONTMATTER_KEYS = new Set([
  "id",
  "title",
  "tags",
  "updatedAt",
  "marp",
  "theme",
  "size",
  "paginate",
  "headingDivider",
]);
```

## 9. 行操作・validation

### 9.1 Add

- 空key／空valueのrowを末尾へ追加する。
- 新規Key入力へfocusする。
- 空keyのためApplyはdisabledになる。

### 9.2 Edit

- keyとvalueの変更をlocal rowsへ反映する。
- key変更ではrow位置とrowIdを維持する。
- 変更ごとに全rowの重複keyと対象rowのparseを再評価する。

### 9.3 Delete

- 対象rowをlocal rowsから除去する。
- 次のrow、なければAdd buttonへfocusを移す。
- Apply前はNote draftを変更しない。

### 9.4 Error

Errorはrow単位で表示し、Value errorにはparse可能な説明を使用する。1件以上のerrorがあればApplyをdisabledにする。error summaryをdialog上部またはfooter近辺へ設け、支援技術へ通知する。

## 10. Apply・Cancel・close

### 10.1 Apply

1. 全rowを再検証する。
2. errorがあれば適用せず、最初のerrorへfocusする。
3. row順を維持したCustom metadataへ変換する。
4. `onApply`でApp draftへ一括反映する。
5. 初期値と異なる場合だけ`markDirty()`する。
6. dialogを閉じ、More actions triggerへfocusを戻す。

`Ctrl+Enter`／`Command+Enter`はdialog内だけでApplyとして処理し、メインSave shortcutを発火させない。

### 10.2 Cancel／Escape／outside pointer

- dialog dirtyでなければ即時closeする。
- dialog dirtyなら`Discard metadata changes?`確認を開く。
- Discard確定でlocal rowsを破棄してcloseする。
- 確認CancelではMetadata dialogへ戻り、入力とfocus文脈を維持する。
- 背面pointer操作はclose判断以外へ伝播させない。

### 10.3 メインdirty状態

- dialog内編集だけではメインをdirtyにしない。
- Applyで値が変わった場合にメインをdirtyにする。
- メインSaveでIndexedDBへ保存する。
- Revert／DiscardはCustom metadataも保存済み状態へ戻す。
- Save and ContinueはCustom metadataを他のdraft fieldと同じtransactionへ含める。

## 11. Import／Export／Backup

### 11.1 Import

1. frontmatter mappingをkey順に走査する。
2. 標準／Marp属性を既存fieldへ取り込む。
3. 残りの安全なentryをCustom metadata配列へ順序付きで格納する。
4. 危険keyまたは上限超過はfile failureとして理由を返す。
5. Bodyはfrontmatter除去後の本文とする。

### 11.2 Export

- `buildFrontmatterEntries`から`includedInExport`のentryを順番にYAML mappingへ追加する。
- DialogとExportで別の並び順を持たない。
- Custom metadataの値型と順序を保持する。
- 標準属性とCustom metadataのkey衝突は保存前validationにより発生させない。

### 11.3 Backup／Restore

- JSON Note objectへ順序付きCustom metadataを含める。
- `markdown`にもcanonical orderの統合frontmatterを含める。
- Restore後のdialog、再Exportで順序と値型が維持されることを確認する。

## 12. Preview・TOC

- `ReactMarkdown`へ渡す値はBodyだけとする。
- frontmatterをBodyへ連結しない。
- TOCは描画済みBodyのH1〜H3だけを抽出する。
- Metadata ApplyではPreview本文とPreview scroll位置を変更しない。
- Bodyへ直接貼り付けた`---` blockの自動抽出は行わない。

## 13. Responsive・accessibility

### 13.1 Desktop

- dialog widthは内容を読みやすい上限を持ち、viewport左右へ安全余白を確保する。
- Key／Value／Deleteを1行gridで表示する。

### 13.2 Mobile

- dialog widthは`calc(100vw - 24px)`以下とする。
- Key／Value／Deleteは利用可能幅に応じてgridまたは複数行へ切り替える。
- dialog max-heightをviewport内に収め、bodyを内部スクロールする。
- footerのCancel／Applyへ常に到達できるようにする。

### 13.3 Accessibility

- `role="dialog"`、`aria-modal="true"`、dialog titleとの関連を設定する。
- focus trap、Escape、close後focus復帰を実装する。
- Deleteは対象keyを含むaccessible nameを持つ。
- read-only属性は視覚だけでなくtextで識別可能にする。
- validation errorは入力と関連付け、色だけに依存しない。

## 14. テスト設計

### 14.1 機能観点

- More actionsからのopen、Apply、Cancel、keyboard shortcut
- Custom field追加・変更・削除
- メインdirty、Save、Revert、未保存確認
- Import／Export／Backup roundtrip

### 14.2 非機能観点

- 多数row、長いkey／value、深い値でdialog操作を継続できること
- desktop／mobileでheader、body scroll、footer、focusが成立すること
- dialog連続openで古いlocal stateが残らないこと
- parseとvalidationの結果が新しい入力を古い処理で上書きしないこと

### 14.3 データ観点

- canonical orderとCustom metadata順序
- string、number、boolean、null、sequence、mapping
- 空key、重複key、予約key、危険key、不正Value
- 既存Noteとの後方互換

### 14.4 UI観点

- 既存Edit画面のgeometryが変わらないこと
- read-only項目とCustom rowの識別
- Exportとdialogの項目順一致
- responsive layout、内部scroll、error、focus-visible

### 14.5 正常・異常・境界・状態遷移

- 正常: open、参照、追加、Apply、メインSave、再open、Export
- 異常: validation error、Import error、IndexedDB error
- 境界: 0件、1件、最大件数、長い値、狭いviewport
- 状態遷移: clean open／close、dirty Apply、dirty Cancel／Discard、メインUnsaved／Saved

### 14.6 実行順序と証跡

- unitでparse、validate、order、serializeを先に固定する。
- component testでdialog local state、focus、discard確認を検証する。
- E2Eはdesktopとmobileを同一実機上で並列実行しない。
- 通し回帰で既存Edit、More actions、Save、Import、Export、Backup、Preview、TOCを確認する。
- failure時はdialog snapshot、active element、rows、errors、draft Note、export YAMLを保存する。

## 15. 要件トレース

| 要件 | 設計章 |
| --- | --- |
| MD-UI-001〜008 | 2、3、13 |
| MD-ORDER-001〜004 | 5、11 |
| MD-READ-001〜004 | 5、6 |
| MD-CUSTOM-001〜007 | 7〜9 |
| MD-VAL-001〜007 | 8、9 |
| MD-STATE-001〜009 | 7、10 |
| MD-DATA-001〜007 | 4、11 |
| MD-PREVIEW-001〜003 | 12 |
| MD-AC-001〜009 | 2〜14 |

## 16. 実装順序

1. canonical entry、Custom metadata型、parse／validation／serializeを実装する。
2. unit testでorder、型、予約key、安全制限、roundtripを固定する。
3. MetadataDialogとlocal stateを実装する。
4. More actions、Apply、main dirty／Save／Revertへ接続する。
5. mobile responsive、focus trap、discard確認を実装する。
6. Import／Export／Backup／Restoreを統合する。
7. E2Eと既存全回帰を実行する。
8. 実装結果を本設計と`design-spec.md`へ同期する。
