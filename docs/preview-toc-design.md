# Markdown Knowledge Board Preview目次（TOC）詳細設計

作成日: 2026-07-30

状態: 実装済み

関連要件: [Preview目次（TOC）要件定義](./preview-toc-requirements.md)

## 1. 文書の目的

本書は、Preview目次（TOC）要件を現行のReact、TypeScript、`react-markdown`、レスポンシブレイアウトへ組み込むための詳細設計を定義する。

本機能はPreviewの表示補助として実装し、Note型、IndexedDB、Markdown本文、Import / Export / Backup形式を変更しない。

## 2. 現行構成との関係

### 2.1 利用する現行要素

| 現行要素 | 利用方法 |
| --- | --- |
| `activeTab` | TOCトリガーの表示条件と、Preview以外へ切り替えた際の自動クローズに使用する。 |
| `draftBody` | Preview再描画とTOC再抽出の変更検知に使用する。 |
| `selectedId` | ノート切替時のTOC再抽出と自動クローズに使用する。 |
| `previewRef` | 描画済みH1〜H3の取得、PCスクロール、移動先見出しの検索に使用する。 |
| `previewScrollTopRef` | TOC移動後のPC Previewスクロール位置を既存の位置保持処理へ同期する。 |
| `previewAnchorRef` | TOC移動先を既存のPreview再レイアウト時のanchorとして保持する。 |
| `.editor-tabs` | TOCトリガーとポップオーバーの配置先とする。 |
| `.mdPreview-scroll` | PCでスクロールを所有するPreviewコンテナとする。 |
| `.editor-header` | モバイル移動時の固定ヘッダーoffset計算に使用する。 |
| `.tooltip-button` | TOCトリガーのTooltip表示に再利用する。 |

### 2.2 変更しない領域

- `src/lib/types.ts`のNote型
- IndexedDB schemaとDB version
- Markdown parse、frontmatter、Export、Backup形式
- EditとSlidesの本文表示
- Preview内リンク遷移、task checkbox、Mermaid表示
- 既存のEdit／Previewスクロール位置保持仕様

## 3. ファイル構成

| ファイル | 変更内容 |
| --- | --- |
| `src/App.tsx` | TOC state、見出し抽出、開閉イベント、スクロール、フォーカス、React JSXを追加する。 |
| `src/App.css` | トリガー、ポップオーバー、階層、hover／focus、開閉アニメーション、レスポンシブ、reduced motionを追加する。 |
| `tests/e2e/phase2-ui-ux.spec.ts` | TOC抽出、開閉、スクロール、レスポンシブ、アクセシビリティのE2Eを追加する。 |
| `docs/design-spec.md` | 実装完了時に現行仕様としてTOCの確定動作を追記する。実装前には現行機能として記載しない。 |

初期実装ではロジックを`App.tsx`内に置く。抽出・位置計算が複雑化した場合は、純粋関数だけを`src/lib/previewToc.ts`へ分離する。

## 4. データ設計

### 4.1 型

```ts
type TocHeadingLevel = 1 | 2 | 3;

type TocItem = {
  key: string;
  index: number;
  level: TocHeadingLevel;
  text: string;
};

type TocVisibilityState = "closed" | "opening" | "open" | "closing";
```

| フィールド | 内容 |
| --- | --- |
| `key` | `selectedId`、見出しlevel、文書内indexを組み合わせたReact key。同名見出しを区別する。永続IDには使用しない。 |
| `index` | Preview内の対象見出し出現順。DOMの`data-toc-index`と対応させる。 |
| `level` | 描画された`h1`、`h2`、`h3`から取得する。 |
| `text` | 見出しDOMの`textContent`をtrimした可視文字列。 |

### 4.2 React stateとref

```ts
const [tocItems, setTocItems] = useState<TocItem[]>([]);
const [tocVisibility, setTocVisibility] =
  useState<TocVisibilityState>("closed");

const tocRootRef = useRef<HTMLDivElement | null>(null);
const tocButtonRef = useRef<HTMLButtonElement | null>(null);
const tocFirstItemRef = useRef<HTMLButtonElement | null>(null);
const tocCloseTimerRef = useRef<number | null>(null);
```

- TOC stateは表示セッション内だけで保持し、永続化しない。
- HTMLElementそのものをReact stateへ保持しない。
- 移動時は`data-toc-index`から最新のDOMを再取得し、古いDOM参照を使用しない。

## 5. コンポーネント構造

### 5.1 editor tab row

```text
.editor-tabs
├─ Edit button
├─ Preview button
├─ Slides button
├─ Slides settings          activeTab=slidesのみ
└─ .preview-toc             activeTab=previewのみ
   ├─ TOC trigger button
   └─ TOC popover           opening/open/closingのみ
```

TOCはPreview選択時だけDOMへ追加する。TOC rootへ`margin-left: auto`を設定し、余白がある場合はtab row右端へ寄せる。狭幅でタブ行が折り返す場合はTOC rootもflex itemとして安全に折り返す。

### 5.2 JSX構造

```tsx
<div className="preview-toc" ref={tocRootRef}>
  <button
    ref={tocButtonRef}
    type="button"
    className="preview-toc-button tooltip-button"
    aria-label="Table of contents"
    data-tooltip={tocItems.length === 0 ? "No headings" : "Table of contents"}
    aria-expanded={isTocOpen}
    aria-controls="preview-toc-popover"
    disabled={tocItems.length === 0}
  >
    <ListTree aria-hidden="true" />
  </button>

  {isTocRendered ? (
    <nav
      id="preview-toc-popover"
      className="preview-toc-popover"
      data-state={tocVisibility}
      aria-label="Table of contents"
    >
      <div className="preview-toc-header">Table of contents</div>
      <ol className="preview-toc-list">
        {/* TocItem buttons */}
      </ol>
    </nav>
  ) : null}
</div>
```

- 第一候補アイコンは`lucide-react`の`ListTree`とする。使用中のversionに存在しない場合は`List`を使用する。
- ポップオーバーはmodalにせず、背景のPreviewやタブ操作を無効化しない。
- 項目はスクロール操作であるため、`button type="button"`を使用する。
- 各項目のaccessible nameは`Heading level {level}: {text}`とし、表示文字列は見出し本文だけとする。

## 6. 見出し抽出設計

### 6.1 抽出タイミング

`useLayoutEffect`を使用し、以下が変化してPreview DOMが確定した後に抽出する。

- `activeTab`
- `selectedId`
- `draftBody`
- Previewのmount対象

Preview以外では`tocItems`を空にし、TOCを閉じる。

### 6.2 抽出処理

```ts
function collectPreviewTocItems(root: HTMLElement, noteId: string): TocItem[] {
  return Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3"))
    .map((heading, index) => {
      const level = Number(heading.tagName.slice(1)) as TocHeadingLevel;
      const text = heading.textContent?.trim() ?? "";
      heading.dataset.tocIndex = String(index);
      heading.tabIndex = -1;
      return text
        ? { key: `${noteId}:${level}:${index}`, index, level, text }
        : null;
    })
    .filter((item): item is TocItem => item !== null);
}
```

実装時は空見出しを除外した後のindexと`data-toc-index`が一致するよう、DOM indexとTOC indexを別変数で管理する。上記コードは処理概要であり、そのまま転記しない。

### 6.3 抽出規則

- Markdown文字列を正規表現で直接解析しない。
- `react-markdown`が描画したH1〜H3だけを対象にする。
- fenced code block内の`#`はheading DOMにならないため除外される。
- inline code、強調、リンクを含む見出しは`textContent`へ正規化する。
- H4〜H6は抽出しない。
- 同名見出しはindexで区別する。
- 見出しDOMへ永続的なURL IDを付けず、URL hashも更新しない。

### 6.4 再描画とクリーンアップ

- `draftBody`または`selectedId`変更時はTOCを閉じ、次のlayout effectで再抽出する。
- React再描画前のHTMLElementをref配列として保持しない。
- Previewがunmountされた場合は`tocItems=[]`とする。
- TOC抽出で予期しないDOMがあっても例外をPreview全体へ伝播させず、その見出しを除外する。

## 7. 開閉設計

### 7.1 開く

1. disabledでないTOCトリガーを押す。
2. close timerが残っていれば解除する。
3. `tocVisibility="opening"`としてポップオーバーをmountする。
4. 次のanimation frameで`open`へ変更する。
5. keyboard起動の場合は最初のTOC項目へフォーカスする。pointer起動ではトリガーへフォーカスを残す。

keyboard起動判定はclick eventの`detail === 0`を基本とし、Enter／Spaceでも同じopen処理を使用する。

### 7.2 閉じる

通常時は`closing`へ変更し、CSS transition完了相当の短いtimer後に`closed`としてunmountする。reduced motion時は即座に`closed`とする。

| close reason | フォーカス |
| --- | --- |
| ESC | TOCトリガーへ戻す。 |
| 項目選択 | 移動先見出しへ移す。 |
| 外側pointer選択 | pointer選択先の自然なフォーカスを妨げない。 |
| tab切替、ノート切替、本文変更 | フォーカスを強制移動しない。 |

### 7.3 外側pointerとESC

- open中だけ`window.pointerdown`と`window.keydown`を登録する。
- pointer targetが`tocRootRef.current`内なら閉じない。
- 外側pointerではイベントのdefault動作や伝播を止めずに閉じる。
- ESCでは`preventDefault()`して閉じ、close完了後にトリガーへフォーカスする。
- effect cleanupでlistenerとclose timerを解除する。

### 7.4 追加の自動クローズ

以下が変化した場合はアニメーションを待たず安全に閉じる。

- `activeTab`がPreview以外になった
- `selectedId`が変わった
- `draftBody`が変わった
- Previewがunmountされた

viewport変更時はCSSでviewport内に収める。収まらない環境差が検出された場合だけ閉じる。

## 8. スクロール設計

### 8.1 共通処理

1. 選択された`TocItem.index`で最新の`[data-toc-index]`をPreview内から検索する。
2. 要素がなければ例外を出さずTOCだけ閉じる。
3. `prefers-reduced-motion: reduce`を評価して`behavior`を決定する。
4. PCまたはモバイルのスクロール処理を実行する。
5. TOCを閉じる。
6. 見出しへ`focus({ preventScroll: true })`する。
7. TOC操作では`markDirty()`を呼ばない。

### 8.2 PC

PCは`.mdPreview-scroll`だけを移動する。

```ts
const previewRect = preview.getBoundingClientRect();
const headingRect = heading.getBoundingClientRect();
const offset = 12;
const top = Math.max(
  0,
  preview.scrollTop + headingRect.top - previewRect.top - offset
);

preview.scrollTo({ top, behavior });
previewScrollTopRef.current = top;
previewAnchorRef.current = { element: heading, offsetTop: offset };
```

- `window.scrollTo`と`document.documentElement.scrollTop`は変更しない。
- 既存のPreview位置保持処理が後から旧位置を復元しないよう、scroll refとanchor refを同じ移動先へ更新する。
- smooth中にPreviewが再描画された場合でも最終的に有効な範囲へ収まるようにする。

### 8.3 モバイル

モバイルはdocumentスクロールを移動する。

```ts
const header = document.querySelector<HTMLElement>(".editor-header");
const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
const offset = 12;
const top = Math.max(
  0,
  window.scrollY + heading.getBoundingClientRect().top - headerBottom - offset
);

window.scrollTo({ top, behavior });
```

- `.mdPreview-scroll`の`scrollTop`をモバイル移動の正本にしない。
- ヘッダーが複数行になっても実測`bottom`を使用する。
- CSSでも見出しへ安全な`scroll-margin-top`を設定し、browser差のfallbackとする。

### 8.4 reduced motion

```ts
const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;
const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";
```

開閉transitionも同じmedia queryに従い、reduce時はdurationを0とする。

## 9. CSS設計

### 9.1 トリガー

```css
.preview-toc {
  position: relative;
  margin-left: auto;
}

.preview-toc-button {
  /* compact icon controlの既存tokenを使用 */
}
```

- 高さと幅は既存compact icon controlと同じ36pxを基本とする。
- iconは18pxを基本とする。
- border radiusは共通control radiusの8pxを使用する。
- tab row内で縮小させず、必要なら行ごと折り返す。

### 9.2 ポップオーバー

```css
.preview-toc-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  width: min(320px, calc(100vw - 24px));
  max-height: min(320px, calc(100dvh - 120px));
  overflow: hidden;
}

.preview-toc-list {
  max-height: inherit;
  overflow-y: auto;
  overscroll-behavior: contain;
}
```

- headerは固定し、TOC項目部分だけをスクロールさせる。
- 横スクロールは発生させない。
- border、background、shadowは既存のMarp settings popoverと整合させる。
- viewport高が小さい場合は`320px`より利用可能高を優先する。

### 9.3 階層

```css
.preview-toc-item[data-level="1"] { padding-left: 12px; }
.preview-toc-item[data-level="2"] { padding-left: 28px; }
.preview-toc-item[data-level="3"] { padding-left: 44px; }
```

- インデントはlevelそのものから決定し、文書内の直前見出しへ依存させない。
- 項目は複数行表示を許可する。
- 文字列をellipsisで1行へ切り詰めない。

### 9.4 hover、focus、animation

- `:hover`と`:focus-visible`で背景色を変える。
- `:focus-visible`は既存UIと同等の3px outlineを表示する。
- open時はopacityと4〜6px程度のtranslateだけを160ms前後で変化させる。
- close時も同じプロパティを逆方向に変化させる。
- `prefers-reduced-motion: reduce`ではtransitionとtransformを無効化する。

### 9.5 モバイル

```css
@media (max-width: 900px) {
  .preview-toc {
    margin-left: auto;
  }

  .preview-toc-popover {
    position: fixed;
    right: 12px;
    left: 12px;
    width: auto;
  }
}
```

モバイルでfixed配置する場合、`top`はTOCトリガーまたはeditor tab rowの実測bottomをCSS custom propertyへ渡して決定する。単一の固定px値でヘッダー高を仮定しない。

## 10. アクセシビリティ設計

### 10.1 trigger semantics

- `button type="button"`
- `aria-label="Table of contents"`
- `aria-expanded={isTocOpen}`
- `aria-controls="preview-toc-popover"`
- disabled時もTooltipまたは同等の補足で`No headings`を示す。

### 10.2 popover semantics

- `nav aria-label="Table of contents"`を使用する。
- `role="dialog"`、`aria-modal="true"`は使用しない。
- 背景を覆うbackdropは作らない。
- 見出し一覧は`ol`、各操作は`button`を使用する。

### 10.3 focus management

- keyboardで開いた場合は最初の項目へフォーカスする。
- TabとShift+Tabはbrowser標準順序を使用し、focus trapは実装しない。
- ESCではtriggerへ戻す。
- 項目選択では対象headingへ移し、heading levelと文字列をスクリーンリーダーが読み上げられる状態にする。
- outside pointerではpointer選択先のfocusを奪わない。

## 11. エラー・競合設計

| 条件 | 挙動 |
| --- | --- |
| `previewRef.current`がない | TOC項目を空にして閉じる。Preview自体は維持する。 |
| 選択したheadingが再描画で消えた | 閉じて現在位置を維持する。エラー通知は表示しない。 |
| `textContent`が空 | 対象項目から除外する。 |
| 同名heading | indexで個別に移動する。 |
| TOC open中に本文変更 | 即時クローズし、再描画後に再抽出する。 |
| TOC open中にPreviewリンクで別ノートへ移動 | ノート切替処理により閉じ、移動先Previewから再抽出する。 |
| smooth scroll中にtab切替 | 既存tab切替を優先し、TOC由来のtimerやlistenerをcleanupする。 |
| TOCとMarp settings | 同時表示されないactive tab条件とし、popover同士を競合させない。 |

## 12. テスト設計

### 12.1 テストデータ

````markdown
# H1 First

## H2 Child

### H3 Grandchild

#### H4 Excluded

## Duplicate

### Duplicate

## **Formatted** `heading`

```text
# Not a heading
```
````

追加データ:

- 見出し0件
- H2から始まる文書
- 日本語と絵文字を含む見出し
- 1行を超える長い見出し
- 320px高を超える件数
- Preview内部スクロールが必要な長文

### 12.2 自動テスト構成

| テスト | 意図 |
| --- | --- |
| H1〜H3抽出 | 描画見出しだけを文書順に抽出し、H4とcode blockを除外する。 |
| 同名見出し | 同名でも出現順ごとの異なる位置へ移動する。 |
| PCスクロール | documentを動かさずPreview内部だけを移動する。 |
| モバイルスクロール | documentを移動し、固定ヘッダー下にheadingを表示する。 |
| 自動クローズ | 項目選択、outside pointer、ESC、tab／note／body変更を個別に検証する。 |
| focus | keyboard open、ESC、項目選択後のactive elementを検証する。 |
| viewport境界 | 320px幅と低いviewportでpopoverが画面外へ出ないことを検証する。 |
| reduced motion | animationとsmoothを使用せず、最終位置が通常時と一致することを検証する。 |
| dirty不変 | TOC操作前後で本文と`Status: Saved`が変化しないことを検証する。 |
| 通し回帰 | Preview task、Mermaid、内部ノートリンク、scroll位置保持と併用して競合しないことを検証する。 |

### 12.3 失敗時の証跡

E2E失敗時は以下を取得する。

- viewport幅・高さとmedia query結果
- TOC itemのindex、level、text
- 対象headingの`data-toc-index`とbounding box
- `.mdPreview-scroll`のclientHeight、scrollHeight、scrollTop
- `window.scrollY`とdocument scrollHeight
- `.editor-header`と対象headingのbottom／top
- `document.activeElement`
- TOCの`aria-expanded`と`data-state`

## 13. 要件トレーサビリティ

| 要件群 | 設計章 |
| --- | --- |
| TOC-UI-001〜006 | 5、9.1 |
| TOC-UI-007〜013 | 5.2、9.2、9.3 |
| TOC-UI-014〜015 | 7、9.4 |
| TOC-FUNC-001〜006 | 6 |
| TOC-SCROLL-001〜007 | 8 |
| TOC-STATE-001〜008 | 7 |
| TOC-A11Y-001〜008 | 10 |
| TOC-RESP-001〜004 | 9.2、9.5 |
| TOC-NFR-001〜005 | 4、6、7、11 |
| TOC-AC-001〜010 | 12 |

## 14. 実装順序

1. `TocItem`型、見出し抽出、再抽出effectを追加する。
2. Preview時だけ表示するTOCトリガーとdisabled状態を追加する。
3. ポップオーバーと階層リストを追加する。
4. open／close state、outside pointer、ESC、tab／note／body変更を接続する。
5. PC Preview内部スクロールと既存位置保持ref同期を実装する。
6. モバイルdocumentスクロールと固定ヘッダーoffsetを実装する。
7. focus管理、ARIA、keyboard操作、reduced motionを実装する。
8. E2Eを観点単位で追加し、既存Preview回帰を実行する。
9. 実装結果を`docs/design-spec.md`へ現行仕様として反映する。

## 15. 完了条件

- TOC要件のTOC-AC-001〜010をすべて満たす。
- lint、TypeScript build、対象E2E、既存Preview回帰が成功する。
- PCとモバイルの実ブラウザでスクロール所有者と見出し位置を確認する。
- keyboardだけでopen、項目移動、ESC closeを完了できる。
- reduced motionで不要なanimationとsmooth scrollが発生しない。
- TOC操作による保存データ、dirty状態、Import / Export / Backupへの影響がない。

## 16. 実装・検証結果

- `src/App.tsx`にH1〜H3抽出、TOC状態管理、開閉、focus管理、PC／mobile別スクロールを実装した。
- `src/App.css`にトリガー、階層リスト、最大高、内部スクロール、responsive、reduced motionの表示仕様を実装した。
- `tests/e2e/phase2-ui-ux.spec.ts`に正常系、対象外・空状態、重複見出し、状態遷移、PC／mobile、keyboard、reduced motion、dirty不変のE2Eを追加した。
- 2026-07-30にlint、production build、対象E2E 3件、全E2E 49件を実行し、すべて成功した。
- Chromium実画面で1280×800と390×844を確認し、ポップオーバーの重なり、viewport内配置、H1〜H3の左揃えと階層インデントを確認した。
