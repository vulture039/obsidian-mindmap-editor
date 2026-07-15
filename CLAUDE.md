# CLAUDE.md

Obsidianプラグイン「Mindmap Editor」。Markdownの見出し・箇条書きを
マインドマップ表示し、マップ上での編集を.mdに書き戻す。

## 設計原則
- データの正はMarkdown本文。マップは常にパース結果の投影で、
  独自の保存形式を持たない(#の深さ+インデント=階層)
- 各ノードは行番号(`line`/`endLine`)を保持。書き込みopは実行前に
  `lineMatchesNode`で鮮度を検証し、ズレていればthrow→通知+再描画
- ノードはHTML要素、エッジはSVG。チェックボックスは本物の`<input>`

## 構成
```
src/
  main.ts          プラグイン本体。ビュー登録・コマンド・設定・openSplit
  mindmap-view.ts  ItemView。描画・選択・キー操作(矢印/Enter/Tab/F2/
                   Space/Shift+矢印/Del/Esc)・インライン編集・
                   D&D(中央=付け替え/上下端1/3=同階層挿入)・
                   右クリックメニュー・完了タスク折りたたみ
  parser.ts        Markdown→MindNodeツリー。lineMatchesNode、
                   LIST_MARKER_SRC(opsと共有するリスト記号regex)
  markdown-ops.ts  変更op群(setText/setCheckbox/add/delete/move/reorder)と
                   updateFileLines(エディタ有→replaceRange、無→vault.process)
  layout.ts        左→右ツリーレイアウト(実DOMのoffsetWidth/Heightで採寸)
  colors.ts        枝ごとの自動色+設定による上書き
  node-text.ts     ノードテキスト描画(wikilink/mdリンクをリンク化)
  settings.ts      設定タブ(followActiveFile / colorOverrides /
                   hideCompleted / splitDirection)
styles.css         全スタイル
```

## 要注意点(過去の不具合の再発防止)
- `render()`は世代カウンタ`renderSeq`で直列化。awaitをまたいで
  古くなったrenderはDOMに触らず破棄(並走すると二重描画・不整合)
- チェックボックスは「反転」ではなくDOMの実状態を書き込む
  (`writeCheckbox`。連打時の収束のため)
- `isInlineEditing`/`isDragging`中のrenderは`renderQueued`に退避。
  **フラグを立てたら必ず解除される経路を保証**(固着すると全操作が死ぬ)
- `startInlineEdit`は要素を`laidByLine`で現世代に引き直してから開始し、
  フォーカス取得に失敗したら中止。Escでの強制復帰フェイルセーフあり
- インライン編集はノードと同スタイルのcontenteditableスパン
  (寸法を変えないため)。編集要素内のpointerdown/click/dblclickは
  伝播を止める(バブルするとblurで即閉じる)
- hideCompleted中、チェック済みノードは描画されず`laidByLine`にも無い。
  選択・ナビゲーションは可視ノードだけを辿る(`isHiddenDone`)。
  「✓ n done」クリックは該当親のみ展開(`expandedDone`、親のlineがキー。
  ファイル切替・全体トグルでクリア)
- wikilink遷移は`leaf.setViewState`+setStateで`result.history = true`
  (navigation=true)。leaf履歴に載るのでObsidianネイティブの
  戻る/進む(マウスボタン・タブヘッダ矢印)が効く。独自のマウス
  イベント処理はしない(OS/ドライバ層で握られDOMに届かないことがある)。
  遷移時は`syncEditorTo`でエディタも同ファイルへ(map⇄md常に一致)
- 起動直後は復元されたMarkdownViewのeditorが未ロードで空を返しうる。
  `getFileText`は空エディタをvaultへフォールバック+onLayoutReadyで再描画
- 分割方向はAPI的にvertical=左右/horizontal=上下(直感と逆なので
  UIラベルに軸名を使わない)。layout-change時に実DOMのmod-vertical/
  mod-horizontalから自動保存(単独ペイン時は上書きしない)

## 検証
GUI挙動は実ブラウザで検証可: Obsidian APIスタブ+puppeteer-coreの
ハーネス(obsidian.tsスタブ・entry.ts・drive.mjsの3点構成、
esbuildで`--alias:obsidian=./obsidian.ts`)。
opsのロジックはNodeで単体実行可能。

以下ファイルを`<vault>/.obsidian/plugins/mindmap-editor`へ配置する。
manifest.json
./main.js
styles.css
