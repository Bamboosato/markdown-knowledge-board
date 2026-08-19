# Markdown Import／表示中ノート更新 要件

- Status: Implemented and verified
- Updated: 2026-08-19

## 1. 目的と対象範囲

外部で更新したMarkdown／textファイルを、Draftまたは保存済みノートのEdit／Previewへドラッグ＆ドロップしたとき、利用者が次の処理を明示的に選べるようにする。

- 新しいノートとして取り込む。
- 表示中ノートのBodyを置き換える。
- 取込を中止する。

Sidebarの`Import Markdown`、Edit／Previewへのドラッグ＆ドロップ、JSON backup importの識別規則も合わせて明確化し、Titleの一致による暗黙の更新を廃止する。

対象ファイルは既存どおり`.md`、`.markdown`、`.txt`とする。JSON backupは既存の`Import Backup`導線だけで扱う。自動同期、ファイル監視、差分表示、履歴管理、Slidesへのドロップは対象外とする。

## 2. テスト設計

ケースを作成する前に、次の観点と優先度を固定する。

### 2.1 テスト観点

| 分類 | 主な確認事項 | 検証意図 | 最優先で防ぐ不具合 |
| --- | --- | --- | --- |
| 機能観点 | Edit／Preview、取込方法の選択、新規追加、表示中ノート更新、Cancel、結果表示 | 選択した処理だけが実行されることを保証する | 表示中ではないノートを更新する |
| 非機能観点 | 大きなファイル、連続drop、非同期read／save、IndexedDB失敗、keyboard、主要ブラウザー | タイミングや環境差があっても重複実行や操作不能を起こさない | 二重保存、古い選択ノートへの遅延更新 |
| データ観点 | ID、Body、Title、Tags、`updatedAt`、Pin、Marp、Custom metadata、frontmatter | 新規追加とBody置換で採用するデータを分離する | Body置換時に既存metadataを失う |
| UI観点 | dialog文言、対象ファイル／ノート表示、disabled、focus trap、Escape、focus復帰、drag表示 | 上書き対象と操作結果を実行前に理解できるようにする | 新規追加とBody置換の取り違え |

誤ったノートの更新、未保存変更の暗黙破棄、metadata消失を「重大」とし、最初に防ぐ。表示上の軽微なずれより、保存対象と永続化結果の正しさを優先する。

### 2.2 正常系／異常系／境界値／状態遷移

| 区分 | 主なケース | 検証意図 |
| --- | --- | --- |
| 正常系 | Edit／Previewから`Add as New Note`、`Replace Current Note Body`、`Cancel`を実行する | タブに依存せず、選択した経路だけが動作することを確認する |
| 異常系 | 未対応形式、空ファイル、file read失敗、parse失敗、IndexedDB save失敗 | 既存ノートとdraftを変更せず、原因を切り分けられる表示を確認する |
| 境界値 | 0件、1件、複数件、同名Title、同一ID／異なるID、同一Body、frontmatterのみ、長文 | Titleや件数に依存した誤更新、空Body、大容量処理の崩れを確認する |
| 状態遷移 | Draft／Saved／Unsaved、Save and Continue／Discard and Continue／Cancel、dialog中の再drop、処理中のノート切替 | 状態別の保存境界と非同期処理の順序を固定し、競合を防ぐ |

### 2.3 前提条件・証跡

- 対象種別（Draft／Saved／Unsaved）、ノートID、active tab、dirty状態、dropするファイル名／内容をケースごとに明示する。
- EditのE2Eでは外側のwrapperではなく、実際のCodeMirror content要素へdropし、エディタ標準のファイル挿入も抑止されることを確認する。
- 各ケースは独立したIndexedDBデータを準備し、実行順へ依存させない。
- 実行前後のNote全フィールド、選択ID、draft、dirty状態、結果dialogを証跡として取得する。
- 保存失敗ではIndexedDBと画面stateの両方を確認し、見た目だけ成功した状態を許容しない。
- 非同期ケースでは処理中の操作抑止、完了順、二重保存の有無を確認する。

### 2.4 E2E実行範囲

実装時は全件E2Eを既定とせず、次を実施する。

- import識別とBody置換はunit testまたは純粋関数testで全分岐を確認する。
- Chromiumで新規追加、Body置換、未保存確認、失敗、複数ファイルを対象E2Eとして実施する。
- drag-and-drop、modal focus、Escapeはブラウザー差の影響があるため、同じ対象E2EをFirefox／WebKitでも実施する。
- 無関係なCloud、PWA、Print／PDFの全件E2Eは未実施とし、変更境界に関連する既存Markdown import回帰だけを併走する。

## 3. 識別・重複判定

| 経路 | IDの扱い | 一致時の動作 |
| --- | --- | --- |
| `Add as New Note` | source frontmatterの`id`をローカル識別子として採用せず、新しいIDを発行する | 常に新規追加する |
| `Replace Current Note Body` | dialogを開いた時点の対象種別と表示中ノートIDを保持する | Saved／UnsavedはそのIDだけを更新し、Draftは現在のdraft Bodyだけを更新する |
| JSON `Import Backup` | backup内のIDを使用する | ID一致なら更新、ID不一致なら追加する |

- Titleと`updatedAt`は識別子や重複判定に使用しない。
- 同じTitleでもIDが異なるノートは共存できる。
- Markdown／text importでは、source frontmatterのID一致による暗黙更新も行わない。
- JSON backupではIDだけを照合し、Title一致へのfallbackを設けない。

## 4. ドラッグ＆ドロップとdialog

### 4.1 表示条件

- Draft／Saved／Unsavedのいずれでも、EditまたはPreviewへ対応ファイルをdropした場合に同じ取込方法dialogを表示する。
- EditとPreviewは同じdialog stateと処理を使用する。
- Draftの`Add as New Note`はDraftを変更・保存せず、新しいIDのノートを追加する。
- Draftの`Replace Current Note Body`は追加の`Unsaved Changes` dialogを表示せず、DraftのBodyだけを置換する。
- Saved／Unsavedの処理は既存どおりとし、Unsavedでactionを続行する場合だけ既存の`Unsaved Changes` dialogを表示する。
- 複数ファイルの場合は`Replace Current Note Body`をdisabledにし、理由として`Available when one file is dropped.`を表示する。
- dialog表示中およびfile read／save処理中は追加dropを受け付けない。

### 4.2 英文UI copy

| 用途 | Copy |
| --- | --- |
| Dialog title | `Import Markdown File` |
| Description | `Choose how to import "{fileName}".` |
| Current target | `Current note: "{noteTitle}"` |
| 新規追加 | `Add as New Note` |
| 表示中ノート更新 | `Replace Current Note Body` |
| 中止 | `Cancel` |
| metadata説明 | `The current note's title, tags, Marp settings, custom metadata, and pinned state will be preserved.` |

複数ファイルの場合はtitleを`Import Markdown Files`、descriptionを`Choose how to import these files.`、新規追加actionを`Add as New Notes`とする。

### 4.3 FocusとCancel

- 初期focusは`Cancel`へ置き、Body置換を既定actionにしない。
- Escapeとbackdrop選択は`Cancel`と同じ扱いにする。
- dialog内へfocusを閉じ込め、close後は開始前のfocus targetへ戻す。開始前のtargetが失われた場合はactive tabへ戻す。
- Cancelではfile read、Note保存、draft変更、選択変更を行わない。
- 保存状態にかかわらず、Cancel後のBodyへdropしたファイル内容を挿入しない。

## 5. 処理フロー

1. dropされたファイル数と拡張子を確認する。
2. 対象種別（Draft／Saved／Unsaved）と表示中ノートIDをpending stateへ保持して取込方法dialogを開く。
3. Draftの`Add as New Note`は現在のDraftを維持したまま新規ノートを保存する。
4. Draftの`Replace Current Note Body`はfile read／parse成功後にBodyだけを変更し、Draft状態とその他のdraft項目を維持する。
5. Saved／Unsavedで未保存変更がある場合は、既存の`Unsaved Changes` dialogを表示する。
6. `Save and Continue`では現在のdraftを保存してから選択actionを続行する。
7. `Discard and Continue`では保存済み状態へ戻してから選択actionを続行する。
8. 未保存確認の`Cancel`では取込方法dialogで選んだactionも実行しない。
9. file readとparseが成功してから必要なIndexedDB保存を行う。
10. 保存成功後に一覧、選択ノート、draftを同じNoteへ同期し、active tabは維持する。
11. 成功／skip／失敗を結果dialogへ表示する。

処理開始後はpending stateに保持したIDを更新先とし、非同期処理中に別ノートを参照して更新先を再計算しない。保存直前に対象IDが存在することを再確認し、存在しない場合は失敗として扱う。

## 6. データ規則

### 6.1 新規追加

- `.md`、`.markdown`、`.txt`はfrontmatterをparseし、Bodyからfrontmatterを除外する。
- Titleはfrontmatterの`title`、ファイル名の順で決定し、本文中のH1はTitle決定に使わずBodyへ残す。
- Tags、`updatedAt`、Marp属性、Custom metadataは既存の安全なparse規則で取り込む。
- source frontmatterの`id`は採用せず、新しいIDを発行する。
- 新規ノートは未固定とする。

### 6.2 表示中ノートのBody置換

- fileのfrontmatterをparseし、frontmatter除去後のBodyだけを置換に使用する。
- source fileの`id`、Title、Tags、`updatedAt`、Marp属性、Custom metadataは表示中ノートへ反映しない。
- 表示中ノートの`id`、Title、Tags、Pin、Marp設定、Custom metadataを維持する。
- DraftではTitle、Tags、Marp設定、Custom metadata、選択状態を維持し、Bodyだけをdraft state上で置換する。IndexedDBへDraftを保存せず、statusは`Draft`を維持する。
- Draftの`Add as New Note`ではDrop前のDraft全体を維持し、取込ファイルだけを新しいIDでIndexedDBへ保存する。
- Draftでは`Unsaved Changes` dialogを追加表示しない。保存済みノートに未保存変更があるUnsavedの場合だけ表示する。
- Bodyが変わる場合だけ`updatedAt`を現在時刻へ更新する。
- 置換後Bodyが既存Bodyと同じ場合は保存せず`skipped`とし、既存`updatedAt`を維持する。
- file全体が空の場合は失敗とし、既存Bodyを空へ置換しない。
- file全体は空でないがfrontmatter除去後のBodyが空になる場合は、明示的なBody置換として許可する。

### 6.3 JSON backup

- backup metadataとfrontmatterを既存規則で復元する。
- ID一致だけを重複判定に使用する。
- 同一IDかつ同一内容なら`skipped`、差分があれば`updated`、ID不一致なら`added`とする。
- 同名Titleの別IDノートを統合しない。

## 7. Errorと結果表示

- file read、形式検証、parse、対象ノート消失、IndexedDB saveの失敗理由を区別する。
- 失敗時は対象ノート、draft、選択IDを変更しない。
- `Import Complete`では`Added`、`Updated`、`Skipped`、`Failed`を表示する。
- `Add as New Note`成功時は`Added = 1`、Body置換成功時は`Updated = 1`とする。
- 複数ファイルの新規追加では成功分を保存し、失敗ファイルはファイル名と理由を表示する。
- Body置換は単一Noteの1回保存とし、部分成功状態を作らない。

## 8. 受入条件

| ID | 受入条件 |
| --- | --- |
| MIU-AC-001 | Draft／Saved／UnsavedのEdit／Previewへの単一ファイルdropで同じ取込方法dialogが開く。 |
| MIU-AC-002 | `Add as New Note`はsource IDやTitle一致に関係なく新IDのノートを追加する。 |
| MIU-AC-003 | `Replace Current Note Body`はdialog表示時の表示中ノートIDだけを更新する。 |
| MIU-AC-004 | Body置換で既存Title、Tags、Pin、Marp設定、Custom metadataを維持し、source metadataを反映しない。 |
| MIU-AC-005 | Titleと`updatedAt`の一致だけではMarkdown／text／JSON backupの既存ノートを更新しない。 |
| MIU-AC-006 | JSON backupはID一致だけを更新し、同名Titleの別IDノートを維持する。 |
| MIU-AC-007 | dirty状態のSave／Discard／Cancel後に、保存、破棄、中止の選択どおりのデータが残る。 |
| MIU-AC-008 | 複数ファイルではBody置換を選択できず、各ファイルを新IDで追加できる。 |
| MIU-AC-009 | file read／parse／save失敗時に既存ノートとdraftを変更せず、原因を表示する。 |
| MIU-AC-010 | dialogの初期focus、Tab循環、Escape、Cancel、focus復帰がEdit／Previewと主要3ブラウザーで成立する。 |
| MIU-AC-011 | Draftの`Add as New Note`は現在のDraftを維持して新規追加し、`Replace Current Note Body`は追加確認なしでBodyだけを置換してDraft状態を維持する。 |
