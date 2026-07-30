# Markdown Knowledge Board Frontmatter表示・編集 要件定義

作成日: 2026-07-30

状態: 要件定義済み・実装前

関連文書: [Frontmatter表示・編集 詳細設計](./frontmatter-editor-design.md)

## 1. 目的

Edit画面で、Markdown Export時に出力されるYAML frontmatterの完成形を確認しながら、アプリ標準属性以外の任意メタデータを編集できるようにする。

Title、Tags、Marp設定など既存UIが管理する属性の編集経路は維持し、Custom metadataと競合させない。機能はdesktop向けの高度な編集機能とし、mobileの編集画面は簡潔に保つ。

## 2. 基本方針

| 項目 | 方針 |
| --- | --- |
| 配置 | Edit画面のTagsとBodyの間に折りたたみ式の`Frontmatter`セクションを配置する。 |
| Export preview | Export時に出力されるfrontmatter全体をread-only YAMLとして表示する。 |
| Custom metadata | 任意属性だけをYAMLで編集する。 |
| 反映時期 | 有効なYAMLは入力中にExport previewへリアルタイム反映する。 |
| 保存 | YAMLが有効な場合だけ保存できる。不正な場合は保存を抑止する。 |
| mobile | `max-width: 900px`ではFrontmatterセクションを表示しない。既存metadataは保持する。 |
| Preview | Markdown Previewにはfrontmatterを表示しない。 |

## 3. テスト観点

テストケースを作成する前に、次の観点を満たすことを確認する。

### 3.1 観点分類

| 分類 | 主な確認事項 |
| --- | --- |
| 機能観点 | 開閉、リアルタイム生成、YAML検証、保存抑止、Import／Export／Backupのroundtrip |
| 非機能観点 | 入力応答性、長いYAML、スクロール、mobile非表示、再描画タイミング、アクセシビリティ |
| データ観点 | 標準属性と任意属性の統合、型、入れ子、配列、予約語衝突、未知属性の保持 |
| UI観点 | Title／Tagsの1行配置、配置切替、read-only表示、編集可能範囲、固定高、エラー表示、focus、折りたたみ状態 |

### 3.2 系統分類

| 系統 | 主な確認事項 |
| --- | --- |
| 正常系 | 有効なYAML追加、即時preview反映、保存、再読込、Export、Import |
| 異常系 | YAML構文エラー、rootがmapping以外、予約語入力、保存失敗、破損Import |
| 境界値 | 空metadata、1属性、多数属性、長い値、配列、入れ子、空文字、Editor領域760px境界、900px境界 |
| 状態遷移 | collapsed／expanded、有効／不正、saved／dirty、ノート切替、desktop／mobile切替 |

### 3.3 前提・環境・タイミング

- テスト開始時にviewport、選択ノート、保存状態、Frontmatter開閉状態を明示する。
- desktopとmobileで同じノートを開き、mobile保存後もCustom metadataが失われないことを確認する。
- YAML入力とExport preview再生成の非同期タイミングを考慮し、固定時間待機ではなく表示内容を待つ。
- Import／Export／Backupテストは前ケースのIndexedDBデータへ依存せず、テストデータを明示的に準備する。
- 失敗時はCustom metadata入力値、parse error、直前の有効値、Export preview、dirty状態を証跡として取得する。

## 4. UI要件

### 4.1 Frontmatterセクション

| ID | 要件 |
| --- | --- |
| FM-UI-001 | Edit画面のTagsとBodyの間に`Frontmatter`折りたたみトリガーを配置する。 |
| FM-UI-002 | 初期状態はcollapsedとし、ノート編集の通常動線を圧迫しない。 |
| FM-UI-003 | トリガーはbuttonとし、`aria-expanded`と`aria-controls`を持つ。 |
| FM-UI-004 | 展開状態は画面内の一時状態とし、ノートデータへ保存しない。 |
| FM-UI-005 | ノート切替時はcollapsedへ戻す。 |

### 4.2 Export preview

| ID | 要件 |
| --- | --- |
| FM-UI-006 | `Export preview`として、Exportされるfrontmatterの完成形をread-onlyで表示する。 |
| FM-UI-007 | `title`と`tags`を必ず確認可能にし、値がある標準属性、Marp属性、Custom metadataをExport順で表示する。 |
| FM-UI-008 | `id`と`updatedAt`はアプリ管理値として表示する。 |
| FM-UI-009 | 高さは160px固定とし、超過時は縦横それぞれ欄内でスクロールできるようにする。 |
| FM-UI-010 | Export preview内では値を編集できない。 |

### 4.3 Custom metadata

| ID | 要件 |
| --- | --- |
| FM-UI-011 | `Custom metadata`としてYAML編集欄を表示する。 |
| FM-UI-012 | 高さは160px固定とし、resizeは無効、超過時は欄内スクロールとする。 |
| FM-UI-013 | 空入力はCustom metadataなしとして有効扱いにする。 |
| FM-UI-014 | YAML errorは編集欄直下へ表示し、可能な範囲で原因を示す。 |
| FM-UI-015 | errorは色だけに依存せず、テキストと`aria-live`または同等の通知手段で識別できるようにする。 |

### 4.4 Responsive

| ID | 要件 |
| --- | --- |
| FM-UI-016 | 画面幅が900pxを超える場合だけFrontmatterセクションを表示する。 |
| FM-UI-017 | `max-width: 900px`ではトリガーを含めてFrontmatterセクション全体を非表示にする。 |
| FM-UI-018 | mobileでTitle、Tags、Bodyを保存しても、既存のCustom metadataを変更または削除しない。 |

### 4.5 Title／Tags配置

| ID | 要件 |
| --- | --- |
| FM-UI-019 | 十分な横幅があるEdit画面では、`Title`ラベル、Title入力欄、`Tags`ラベル、Tags入力欄を同じ1行へ配置する。 |
| FM-UI-020 | 1行内の順序は`Title [入力欄] Tags [入力欄]`とする。 |
| FM-UI-021 | ラベルと各入力欄は垂直中央を揃える。 |
| FM-UI-022 | 入力欄へ配分する利用可能幅はTitle側を約40%、Tags側を約60%とし、Tagsの複数chip表示を優先する。 |
| FM-UI-023 | Editor内容領域が760px未満の場合は、Title行とTags行を分ける従来の縦配置へ戻す。viewport全体の幅だけで判定しない。 |
| FM-UI-024 | Tagsが入力欄幅を超える場合はTags欄内で折り返し、ページ全体の横スクロールを発生させない。 |

## 5. 機能要件

### 5.1 Export preview生成

| ID | 要件 |
| --- | --- |
| FM-FUNC-001 | Export previewは現在のdraftの標準属性と、最後にparse成功したCustom metadataを統合して生成する。 |
| FM-FUNC-002 | Custom metadataが有効な場合、入力に応じてSave前でもリアルタイム更新する。 |
| FM-FUNC-003 | Custom metadataが不正になった場合、Export previewは最後に有効だった内容を維持する。 |
| FM-FUNC-004 | Preview生成はノートの保存を実行せず、生成だけでdirty状態を追加変更しない。 |
| FM-FUNC-005 | Title、Tags、Marp設定のdraft変更もExport previewへリアルタイム反映する。 |

### 5.2 YAML検証

| ID | 要件 |
| --- | --- |
| FM-FUNC-006 | Custom metadataはYAML mappingをrootとする。scalar、sequence、null rootは不正とする。 |
| FM-FUNC-007 | string、number、boolean、null、配列、入れ子mappingを値として許可する。 |
| FM-FUNC-008 | 重複key、YAML parse error、循環参照相当など安全に保存できない構造を拒否する。 |
| FM-FUNC-009 | prototype汚染につながるkeyや実装上危険なkeyは拒否する。 |

### 5.3 予約属性

次の属性は既存UIまたはアプリが管理する予約属性とし、Custom metadataでは使用できない。

- `id`
- `title`
- `tags`
- `updatedAt`
- `marp`
- `theme`
- `size`
- `paginate`
- `headingDivider`

予約属性がCustom metadataに含まれる場合はYAML errorと同等に扱い、重複出力や暗黙の上書きを行わない。

### 5.4 保存・未保存状態

| ID | 要件 |
| --- | --- |
| FM-SAVE-001 | Custom metadataを変更した時点でノートをdirtyにする。 |
| FM-SAVE-002 | 有効なCustom metadataはSave時にノートデータへ保存する。 |
| FM-SAVE-003 | YAML errorまたは予約属性衝突がある場合はSaveを実行せず、Frontmatterセクションを展開してerrorへ誘導する。 |
| FM-SAVE-004 | Revert changesはCustom metadataも最後に保存した状態へ戻す。 |
| FM-SAVE-005 | 未保存確認のSave and Continueでも同じ検証を行い、不正なmetadataを保存しない。 |

## 6. データ要件

| ID | 要件 |
| --- | --- |
| FM-DATA-001 | NoteへCustom metadataを構造化データとして保持する。BodyへYAML文字列を混在させない。 |
| FM-DATA-002 | 既存ノートはCustom metadataなしとして後方互換で読み込める。 |
| FM-DATA-003 | Import時に未知のfrontmatter属性をCustom metadataとして保持する。 |
| FM-DATA-004 | Export時に標準属性、Marp属性、Custom metadataを1つのfrontmatter mappingへ統合する。 |
| FM-DATA-005 | Backup／RestoreでもCustom metadataを欠落させない。 |
| FM-DATA-006 | mobileでは編集UIを表示しないが、保存処理はCustom metadataをそのまま維持する。 |

## 7. Preview要件

| ID | 要件 |
| --- | --- |
| FM-PREVIEW-001 | 通常のMarkdown Previewにはfrontmatterを表示しない。 |
| FM-PREVIEW-002 | Frontmatter属性はTOC抽出対象にしない。 |
| FM-PREVIEW-003 | Custom metadata変更だけではMarkdown Preview本文を変更しない。 |

## 8. 対象外

- mobileでのFrontmatter表示・編集
- Custom metadataから専用フォームを自動生成する機能
- Bodyへ直接貼り付けたfrontmatterの自動抽出
- schema定義、入力補完、外部schema検証
- Custom metadataを検索・Filter条件として利用する機能

## 9. 受入条件

| ID | 受入条件 |
| --- | --- |
| FM-AC-001 | desktop Edit画面でFrontmatterを開き、Export previewにTitle、Tagsを含む完成形を確認できる。 |
| FM-AC-002 | 有効なCustom metadata入力がSave前にExport previewへ反映される。 |
| FM-AC-003 | 不正YAMLではerrorを表示し、最後の有効なExport previewを維持してSaveを抑止する。 |
| FM-AC-004 | 保存・再読込・Export・Import・Backup／RestoreでCustom metadataが保持される。 |
| FM-AC-005 | 予約属性をCustom metadataへ入力しても標準属性を上書きできない。 |
| FM-AC-006 | 900px以下ではFrontmatter UIが表示されず、mobile保存後もmetadataが保持される。 |
| FM-AC-007 | Markdown PreviewとTOCにfrontmatterが表示されない。 |
| FM-AC-008 | Export previewとCustom metadataは各160px固定で、長い内容へ欄内スクロールで到達できる。 |
| FM-AC-009 | Editor内容領域760px以上ではTitleとTagsがラベルを含めて1行に並び、760px未満では2行へ戻る。 |
