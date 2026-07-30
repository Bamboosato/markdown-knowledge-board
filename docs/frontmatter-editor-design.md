# Markdown Knowledge Board Frontmatter表示・編集 詳細設計

作成日: 2026-07-30

状態: 実装前設計

関連要件: [Frontmatter表示・編集 要件定義](./frontmatter-editor-requirements.md)

## 1. 設計目的

現在の`Note`、frontmatter parse／export、Edit画面へCustom metadataを追加し、既存のTitle、Tags、Marp設定と衝突しない編集・保存・roundtripを実現する。

## 2. 画面構成

desktopのEdit画面を次の順序にする。

1. Title／Tags metadata row
2. Frontmatter accordion
3. Body

Editor内容領域が760px以上の場合、metadata rowはラベルを含む1行4要素とする。

```text
Title [ Basic design             ]  Tags [ architecture ][ phase2 ]
```

- grid列は`auto minmax(0, 2fr) auto minmax(0, 3fr)`を基本とする。
- 入力欄へ配分する幅はTitle約40%、Tags約60%とする。
- ラベルと入力欄は垂直中央を揃える。
- Tags chipはTags欄内で折り返し、metadata row外へ横overflowさせない。
- Editor内容領域が760px未満の場合はTitle行、Tags行の2行へ戻す。

collapsed時:

```text
› Frontmatter
```

expanded時:

```text
⌄ Frontmatter

Export preview (read-only)
┌────────────────────────────────────┐
│ id: ...                            │
│ title: Basic design                │
│ tags:                              │
│   - architecture                   │
│ author: Bamboo                     │
└────────────────────────────────────┘

Custom metadata
┌────────────────────────────────────┐
│ author: Bamboo                     │
└────────────────────────────────────┘
```

`max-width: 900px`ではaccordionをrenderしないか、CSS非表示だけに依存せず操作・focus対象から除外する。

## 3. コンポーネント設計

新規componentを`src/components/FrontmatterEditor.tsx`へ分離する。

```ts
type FrontmatterEditorProps = {
  managedMetadata: ManagedFrontmatter;
  customYaml: string;
  customMetadata: CustomMetadata;
  error: FrontmatterEditorError | null;
  onCustomYamlChange: (value: string) => void;
};
```

責務:

- accordionの開閉
- Export previewのread-only表示
- Custom metadata textarea
- parse／予約語errorの表示
- keyboardとARIA

`App.tsx`はdraft state、dirty、Save／Revert、ノート切替、mobile判定との接続を担当する。

## 4. データモデル

### 4.1 型

```ts
export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export type CustomMetadata = Record<string, FrontmatterValue>;

export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  updatedAt: number;
  marp?: MarpSettings;
  customMetadata?: CustomMetadata;
};
```

既存ノートで`customMetadata`がない場合は空objectとして扱う。IndexedDB schema versionは、object store構造やindexを変更しないため原則据え置く。

### 4.2 draft state

```ts
const [draftCustomYaml, setDraftCustomYaml] = useState("");
const [draftCustomMetadata, setDraftCustomMetadata] =
  useState<CustomMetadata>({});
const [customMetadataError, setCustomMetadataError] =
  useState<FrontmatterEditorError | null>(null);
```

- `draftCustomYaml`: ユーザー入力をそのまま保持する。
- `draftCustomMetadata`: 最後にparse成功した構造化値。Export previewの正本にする。
- `customMetadataError`: parse、root型、予約属性、安全性検証のerror。

ノート読込時は保存済み`customMetadata`を安定したYAMLへserializeし、両draftへ設定する。

## 5. frontmatter責務の拡張

`src/lib/frontmatter.ts`を次の責務へ拡張する。

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

追加する主な関数:

```ts
parseCustomMetadataYaml(text: string):
  | { ok: true; value: CustomMetadata }
  | { ok: false; error: FrontmatterEditorError };

serializeCustomMetadata(value: CustomMetadata): string;

buildFrontmatterRecord(noteLike: DraftNote): Record<string, unknown>;

buildFrontmatterPreview(noteLike: DraftNote): string;
```

`toMarkdownWithFrontmatter`も`buildFrontmatterRecord`を使用し、画面previewと実Exportで別々の統合ロジックを持たない。

## 6. parse・検証設計

### 6.1 parse手順

1. 空白だけなら空objectを返す。
2. `js-yaml`でparseする。
3. rootがplain mappingであることを確認する。
4. keyがstringであることを確認する。
5. 予約属性の存在を確認する。
6. 許可する値型だけで再帰的に構成されることを確認する。
7. 危険なkey、過剰な深さ、循環参照相当を拒否する。
8. 成功時のみ`draftCustomMetadata`を更新する。

### 6.2 安全性制限

- `__proto__`、`prototype`、`constructor`をkeyとして許可しない。
- objectは`Object.getPrototypeOf(value)`を確認し、plain objectだけを許可する。
- 最大nest深度は20を目安とする。
- YAML aliasによる過剰展開を抑止できるparse optionを使用し、変換後のnode数またはserialized sizeへ上限を設ける。
- HTMLやscript文字列はデータとして保持するが、Export previewはtextとして描画し、HTML挿入しない。

### 6.3 error型

```ts
type FrontmatterEditorError = {
  kind: "syntax" | "root" | "reserved" | "unsafe" | "too-large";
  message: string;
  line?: number;
  column?: number;
};
```

内部例外文をそのまま表示せず、入力修正に必要な範囲へ正規化する。

## 7. Export preview生成

### 7.1 統合順序

frontmatter recordは次の順で組み立てる。

1. `id`
2. `title`（空でなければ）
3. `tags`（1件以上なら）
4. `updatedAt`
5. Marp属性（有効なものだけ）
6. Custom metadata

Custom metadataは予約属性を含められないため、標準属性の上書きは発生しない。

### 7.2 リアルタイム更新

- Title、Tags、Marp draftまたは`draftCustomMetadata`が変わるたびに`useMemo`でYAMLを再生成する。
- Custom YAMLのparseは入力eventごとに行う。通常規模のYAMLではdebounceしない。
- 性能計測で必要になった場合のみ短いdebounceを追加し、テストは非同期更新を待つ。
- parse失敗時は`draftCustomMetadata`を変更しないため、Export previewは最後の有効状態を維持する。
- `updatedAt`は入力のたびに現在時刻へ変化させず、draftがSaveされた場合に出力される値を安定して表示する。Save実行時の確定値との差異を仕様上許容する場合は補足表示する。

### 7.3 表示

- `pre`と`code`またはread-only textareaを使用する。
- 高さ160px、`overflow: auto`、`white-space: pre`とする。
- accessible nameを`Export preview`とする。
- 選択・コピーは可能、編集は不可とする。

## 8. Custom metadata編集

- textareaの高さは160px、resizeは`none`、overflowは`auto`とする。
- monospace fontを使用する。
- accessible nameを`Custom metadata`とする。
- 変更時に`markDirty()`を呼ぶ。
- error領域は入力欄と`aria-describedby`で関連付ける。
- error領域は`role="status"`または適切な`aria-live`を持つ。
- Tabキーの扱いは初期実装ではbrowser標準とし、YAML用Tab挿入は対象外とする。

## 9. 保存・遷移

### 9.1 Save

1. `customMetadataError`を確認する。
2. errorがあればSaveを中止する。
3. Frontmatter accordionを展開する。
4. Custom metadata入力へfocusし、errorを通知する。
5. errorがなければ`draftCustomMetadata`をNoteへ含めて保存する。

### 9.2 Revert／ノート切替

- Revertは保存済みCustom metadataからYAMLを再生成する。
- 未保存確認のDiscardも同じreset処理を使用する。
- Save and Continueは通常Saveと同じ検証を通す。
- ノート切替完了時にaccordionをcollapsedへ戻す。
- Cancelでは入力、error、accordion状態を維持する。

### 9.3 mobile

- mobileでは編集componentをrenderしない。
- `draftCustomMetadata`は選択ノートから通常どおり読み込む。
- mobile SaveでもNoteへ既存値を含める。
- mobileでTitle、Tags、Body、Marp設定を変更してもCustom metadataを空objectで上書きしない。

## 10. Import／Export／Backup

### 10.1 Import

`parseMarkdownWithFrontmatter`は対応済み標準属性を取り出した後、残りのkeyを`customMetadata`へ格納する。

- 予約属性の型が不正な場合は既存fallback方針に従う。
- 未知属性は値型が安全なら保持する。
- 危険なkeyまたは安全に保持できない値があるファイルはfailedとして理由を表示する。
- bodyは従来どおりfrontmatter除去後の本文とする。

### 10.2 Export

- `buildFrontmatterRecord`を使用する。
- 1つの`---` blockへ標準、Marp、Custom metadataを統合する。
- Export previewと同じkey順・serialize optionを使用する。

### 10.3 Backup／Restore

- JSON Note objectへ`customMetadata`を含める。
- backup内のMarkdownにも統合済みfrontmatterを含める。
- RestoreはCustom metadata欠落を既存ノートの空値による削除として扱わない。

## 11. Markdown Preview・TOC

- `ReactMarkdown`へ渡す値は従来どおりbodyだけとする。
- frontmatterをbodyへ連結しない。
- TOC抽出は描画済みbody内のH1〜H3だけを対象とするため、metadataは対象外になる。
- Bodyへ直接入力された`---` blockの自動抽出は行わず、Markdown本文として扱う。Custom metadataの編集は専用欄、外部ファイルはImportを使用する。

## 12. Responsive・CSS

想定class:

```css
.editor-metadata-layout {
  container-type: inline-size;
}

.editor-metadata-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

@container (min-width: 760px) {
  .editor-metadata-row {
    grid-template-columns: auto minmax(0, 2fr) auto minmax(0, 3fr);
    align-items: center;
  }
}

.frontmatter-editor { }
.frontmatter-toggle { }
.frontmatter-panel { }
.frontmatter-export-preview { height: 160px; overflow: auto; }
.frontmatter-custom-input { height: 160px; resize: none; overflow: auto; }
.frontmatter-error { }

@media (max-width: 900px) {
  .frontmatter-editor { display: none; }
}
```

実装ではCSS非表示だけでなく、mobile時に不要なtextareaをfocus順へ含めないことを確認する。

## 13. テスト設計

### 13.1 機能観点

- accordion開閉とノート切替時reset
- Title／Tags／Marp／Custom metadataの即時preview反映
- 有効YAMLの保存、Revert、再読込
- error時のSave抑止とfocus誘導
- Import／Export／Backup roundtrip

### 13.2 非機能観点

- 多数属性、長い値、深い入れ子でUIが操作可能であること
- previewとtextareaが各160pxで内部スクロールすること
- parse中の連続入力で古い結果が新しい結果を上書きしないこと
- desktop／mobile切替後もデータを失わないこと

### 13.3 データ観点

- string、number、boolean、null、配列、mapping
- 空metadata、Unicode、改行文字列
- 予約属性、危険なkey、root sequence、syntax error
- 既存Noteとの後方互換

### 13.4 UI観点

- TagsとBodyの間の配置
- collapsed初期状態
- read-onlyとeditableの識別
- error、focus-visible、ARIA
- 900px超で表示、900px以下で非表示
- Editor内容領域760px以上でTitle／Tagsがラベルを含む1行4要素となり、未満で2行へ戻ること
- Title／Tagsのラベル、入力欄の垂直中央揃え、Tags chip折り返し、横overflow非発生

### 13.5 実行順序と証跡

- unitでparse、validate、merge、serializeを先に検証する。
- E2Eは新規Note、保存済みNote、Import Note、mobile保持の順に独立データで実行する。
- 通し回帰では既存Import、Export、Backup、Marp、Preview、TOCテストを実行する。
- 失敗時は入力YAML、error kind、preview YAML、保存Note、export fileを取得する。

## 14. 要件トレース

| 要件 | 設計章 |
| --- | --- |
| FM-UI-001〜024 | 2、3、7、8、12 |
| FM-FUNC-001〜009 | 5、6、7 |
| FM-SAVE-001〜005 | 4、8、9 |
| FM-DATA-001〜006 | 4、10 |
| FM-PREVIEW-001〜003 | 11 |
| FM-AC-001〜009 | 2、7〜13 |

## 15. 実装順序

1. `Note`型とfrontmatter parse／validate／merge／serializeを拡張する。
2. unit testで未知属性、予約語、危険key、roundtripを固定する。
3. draft stateとSave／Revert／遷移へCustom metadataを接続する。
4. desktop FrontmatterEditorを追加する。
5. mobile非表示とmetadata保持を追加する。
6. Export／Backup／Restoreを同期する。
7. E2Eと既存全回帰を実行する。
8. 実装結果を本設計と`design-spec.md`へ同期する。
