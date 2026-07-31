# Markdown Knowledge Board Metadataダイアログ 要件定義

作成日: 2026-07-30

更新日: 2026-07-31

状態: 実装済み

関連文書: [Metadataダイアログ 詳細設計](./frontmatter-editor-design.md)

## 1. 目的

既存のEdit画面を変更せず、Markdown Export時にfrontmatterへ出力されるmetadataをダイアログで参照し、Custom metadataを追加・変更・削除できるようにする。

Title、Tags、Marp設定など既存UIが管理する属性の編集経路は維持し、Metadataダイアログではread-onlyとする。

## 2. 基本方針

| 項目 | 方針 |
| --- | --- |
| 導線 | 既存のMore actionsメニューへ`Metadata`を追加する。 |
| Edit画面 | Title、Tags、Bodyを含む既存レイアウトを変更しない。 |
| 表示順 | ダイアログとMarkdown Exportで共通のcanonical orderを使用する。 |
| 標準属性 | `id`、`title`、`tags`、`updatedAt`、Marp属性はread-only表示する。 |
| Custom metadata | Key／Value行として追加・変更・削除できる。 |
| 確定 | `Apply`または`Ctrl+Enter`／`Command+Enter`で現在のdraftへ反映する。 |
| 永続化 | ダイアログのApplyではNoteを保存せず、メイン画面のSaveでIndexedDBへ保存する。 |
| Cancel | 未適用のダイアログ内変更を破棄する。 |

## 3. テスト観点

テストケース作成前に次の観点を列挙し、正常系、異常系、境界値、状態遷移へ詳細化する。

### 3.1 観点分類

| 分類 | 主な確認事項 |
| --- | --- |
| 機能観点 | 開閉、read-only表示、行追加・変更・削除、Apply、Cancel、keyboard shortcut、Import／Export／Backup |
| 非機能観点 | 多数行、長い値、モバイル、内部スクロール、focus管理、連続操作、応答性 |
| データ観点 | canonical order、値型、予約語、重複key、安全でないkey、未知属性のroundtrip |
| UI観点 | 既存Edit画面不変、項目順、read-onlyとeditableの識別、error、ボタン、responsive dialog |

### 3.2 系統分類

| 系統 | 主な確認事項 |
| --- | --- |
| 正常系 | 参照、Custom field追加・編集・削除、Apply、メインSave、再読込、Export |
| 異常系 | 空key、重複key、予約語、Value構文error、保存失敗、Import破損 |
| 境界値 | Custom field 0件／1件／多数、空文字、長いkey／value、900px境界、dialog最大高 |
| 状態遷移 | closed／open、clean／dirty、Apply／Cancel／Discard、ノート切替、Edit／Preview／Slides |

### 3.3 前提・タイミング・証跡

- viewport、選択ノート、active tab、メインのdirty状態、ダイアログ初期値を明示する。
- ダイアログ内のローカル変更とNote draftへの適用済み変更を区別する。
- Import／Export／Backupテストは独立したNoteデータを準備し、実行順に依存させない。
- 失敗時は表示順、各行のkey／value／error、Apply可否、メインdraft、保存Note、Export YAMLを取得する。
- 同一ブラウザでの連続open／closeによる古いlocal stateの残留を確認する。

## 4. 導線・ダイアログ要件

| ID | 要件 |
| --- | --- |
| MD-UI-001 | More actionsメニューへ`Metadata`メニュー項目を追加する。 |
| MD-UI-002 | `Metadata`選択時にmodal dialogを開き、More actionsメニューを閉じる。 |
| MD-UI-003 | dialogは`role="dialog"`、accessible name `Metadata`を持つ。 |
| MD-UI-004 | open時はdialog内の適切な最初の操作へfocusし、close時は`Metadata`を開いたメニュートリガーへ戻す。 |
| MD-UI-005 | dialog内でTab／Shift+Tabのfocusを循環させ、背面UIを操作させない。 |
| MD-UI-006 | dialog本文がviewportを超える場合はdialog内部だけを縦スクロール可能にする。 |
| MD-UI-007 | mobileでは安全な左右余白を保ったほぼ全幅表示とし、header／footer操作へ到達できる最大高を設定する。 |
| MD-UI-008 | Metadata機能の追加によって既存Edit画面へ入力欄、accordion、常設ボタンを追加しない。 |

## 5. 項目と表示順

### 5.1 Canonical order

ダイアログとMarkdown Exportは次の共通順序を使用する。

1. `id`
2. `title`
3. `tags`
4. `updatedAt`
5. Marp属性（Export対象の場合のみ）
   1. `marp`
   2. `theme`
   3. `size`
   4. `paginate`
   5. `headingDivider`（Export対象の場合のみ）
6. Custom metadata（保持している順序）

| ID | 要件 |
| --- | --- |
| MD-ORDER-001 | ダイアログとExportは同じfrontmatter項目生成処理を使用し、別々に並び順を定義しない。 |
| MD-ORDER-002 | Export対象外の省略可能属性はYAMLへ出力しない。ダイアログで表示する場合は`Not included in export`相当と識別できるようにする。 |
| MD-ORDER-003 | Custom metadataの既存順序を維持し、新規fieldは末尾へ追加する。 |
| MD-ORDER-004 | key変更では行位置を維持し、削除後に同じkeyを再追加した場合は末尾へ配置する。 |

### 5.2 Read-only項目

| 項目 | 表示 | 編集経路 |
| --- | --- | --- |
| `id` | read-only | アプリ管理 |
| `title` | read-only | Edit画面のTitle入力欄 |
| `tags` | read-only | Edit画面のTags入力欄 |
| `updatedAt` | read-only | Note保存時に自動更新 |
| Marp属性 | read-only | Slides settings |

| ID | 要件 |
| --- | --- |
| MD-READ-001 | read-only項目は選択・コピー可能だがdialog内で編集できない。 |
| MD-READ-002 | TitleとTagsはMetadata dialogを開いた時点の現在のdraft値を表示する。 |
| MD-READ-003 | Tagsは配列であることを認識できる表示とし、順序を維持する。 |
| MD-READ-004 | `updatedAt`のcanonical keyは既存互換のため`updatedAt`を維持する。 |

## 6. Custom metadata操作

| ID | 要件 |
| --- | --- |
| MD-CUSTOM-001 | 各行を`Key入力欄`、`Value入力欄`、`Delete`アイコンボタンで構成する。 |
| MD-CUSTOM-002 | KeyとValueはdialog内で直接変更できる。 |
| MD-CUSTOM-003 | `Add custom field`で空の新規行を一覧末尾へ追加する。 |
| MD-CUSTOM-004 | Delete選択時はdialogのlocal stateから対象行を即時除去する。Apply前はNote draftを変更しない。 |
| MD-CUSTOM-005 | ValueはYAML valueとして解釈し、string、number、boolean、null、sequence、mappingを保持できる。 |
| MD-CUSTOM-006 | plain textはstringとして扱い、配列・mappingなど構文を必要とする値は有効なYAML表現を要求する。 |
| MD-CUSTOM-007 | 複雑な値も1つのValue欄に安全なYAML表現で表示し、Apply／再openで型を失わない。 |

## 7. バリデーション

次のkeyはCustom metadataで使用できない。

- `id`
- `title`
- `tags`
- `updatedAt`
- `marp`
- `theme`
- `size`
- `paginate`
- `headingDivider`
- `__proto__`
- `prototype`
- `constructor`

| ID | 要件 |
| --- | --- |
| MD-VAL-001 | trim後の空keyを不正とする。 |
| MD-VAL-002 | Custom metadata内の重複keyを不正とする。YAMLのkeyと同様に大文字小文字を区別する。 |
| MD-VAL-003 | 予約keyと安全でないkeyを不正とする。 |
| MD-VAL-004 | Valueを安全なYAML valueとしてparseできない場合は対象行へerrorを表示する。 |
| MD-VAL-005 | 1件以上のerrorがある場合はApplyをdisabledにする。 |
| MD-VAL-006 | errorは色だけに依存せず、行と原因をテキストおよび支援技術へ通知する。 |
| MD-VAL-007 | key／valueの最大長、Custom field件数、nest深度、serialized sizeへ実装上の安全上限を設ける。 |

## 8. Apply・Cancel・未適用変更

| ID | 要件 |
| --- | --- |
| MD-STATE-001 | dialog open時に現在のCustom metadataをlocal stateへ複製する。 |
| MD-STATE-002 | 入力、追加、削除はApplyまでdialog local stateだけを変更する。 |
| MD-STATE-003 | `Apply`またはWindows／Linuxの`Ctrl+Enter`、macOSの`Command+Enter`で有効なCustom metadataをNote draftへ一括反映する。 |
| MD-STATE-004 | Apply後はdialogを閉じ、変更がある場合はメイン画面をUnsavedにする。ApplyだけではIndexedDBへ保存しない。 |
| MD-STATE-005 | `Cancel`はlocal stateを破棄し、メインdraftを変更せず閉じる。 |
| MD-STATE-006 | 変更なしではEscapeまたはdialog外pointer選択で閉じる。 |
| MD-STATE-007 | 未適用変更がある状態でCancel、Escape、dialog外pointer選択を行った場合は`Discard metadata changes?`確認を表示する。 |
| MD-STATE-008 | Discard確定時だけlocal stateを破棄する。確認のCancelではMetadata dialogへ戻り入力を維持する。 |
| MD-STATE-009 | メイン画面のSave、Save and Continue、Revert、Discardは適用済みCustom metadataを既存のdirty遷移へ含める。 |

## 9. データ・Import／Export／Backup

| ID | 要件 |
| --- | --- |
| MD-DATA-001 | NoteへCustom metadataを構造化データとして保持し、Bodyへfrontmatter文字列を混在させない。 |
| MD-DATA-002 | 既存NoteはCustom metadataなしとして後方互換で読み込む。 |
| MD-DATA-003 | Import時は対応済み標準／Marp属性以外の安全な属性をCustom metadataとして順序と型を保って取り込む。 |
| MD-DATA-004 | Export時はcanonical orderで1つのfrontmatter mappingへ統合する。 |
| MD-DATA-005 | Backup／RestoreでもCustom metadataの順序と値型を保持する。 |
| MD-DATA-006 | Apply済みでメインSave前のCustom metadataは他のdraft項目と同じ未保存確認対象にする。 |
| MD-DATA-007 | dialogを開かずにTitle、Tags、Bodyを保存しても既存Custom metadataを失わない。 |

## 10. Markdown Preview・TOC

| ID | 要件 |
| --- | --- |
| MD-PREVIEW-001 | Markdown Previewへfrontmatterを表示しない。 |
| MD-PREVIEW-002 | frontmatter属性をTOC抽出対象にしない。 |
| MD-PREVIEW-003 | Custom metadataのApplyだけではPreview本文を変更しない。 |

## 11. 対象外

- Edit画面へのFrontmatter accordionまたは常設metadata入力欄
- Title／Tags／Marp属性のMetadata dialog内編集
- Custom metadataを検索、Filter、TOCへ使用する機能
- Bodyへ直接貼り付けたfrontmatterの自動抽出
- Custom fieldのdrag-and-drop並べ替え
- 外部YAML schema、入力補完、schema由来フォーム

## 12. 受入条件

| ID | 受入条件 |
| --- | --- |
| MD-AC-001 | 既存Edit画面の配置を変えずMore actionsからMetadata dialogを開ける。 |
| MD-AC-002 | `id`、`title`、`tags`、`updatedAt`、対象Marp属性、Custom metadataがExportと同じ順序で表示される。 |
| MD-AC-003 | TitleとTagsが現在のdraft値でread-only表示される。 |
| MD-AC-004 | Custom fieldを追加・変更・削除し、Apply後にメイン画面がUnsavedになる。 |
| MD-AC-005 | CancelまたはDiscardで未適用変更をメインdraftへ反映しない。 |
| MD-AC-006 | 空、重複、予約keyまたは不正Valueがある場合はApplyできない。 |
| MD-AC-007 | メインSave、再読込、Export、Import、Backup／RestoreでCustom metadataの順序と型が保持される。 |
| MD-AC-008 | PCとmobileの両方でdialog操作、内部スクロール、footer操作、focus復帰が成立する。 |
| MD-AC-009 | Markdown PreviewとTOCにfrontmatterが表示されない。 |
