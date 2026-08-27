import {
  debounce,
  ItemView,
  MarkdownView,
  Menu,
  Modifier,
  Notice,
  Scope,
  TAbstractFile,
  TFile,
  ViewStateResult,
  WorkspaceLeaf,
} from 'obsidian';
import type MindmapPlugin from '../../main';
import {
  findByLine,
  findEnclosing,
  MindNode,
  parseMarkdown,
} from '../../core/parse/parser';
import { relocateNode } from '../../core/write/relocate';
import {
  branchTargets,
  collapsedFromFolds,
  FoldKind,
  FoldRange,
  foldsKey,
  mergeFolds,
  pruneLines,
  sameLines,
  textTargets,
} from '../../core/folds';
import {
  applyEditorFolds,
  foldPreviewHeadings,
  FoldWrite,
  loadStoredFolds,
  readEditorFolds,
} from '../markdown/folds';
import { LaidNode, layoutTree, makeLaid } from '../../core/render/layout';
import { MAX_ZOOM } from '../../core/render/zoom';
import {
  NodeColor,
  nodeColorFor,
  parsePalette,
  rungBelow,
} from '../../core/render/colors';
import { renderNodeText } from './node-text';
import { canDrop } from '../../core/render/drag';
import { singleLineValue } from '../../core/write/edit-value';
import { DRAGGING_SELECTOR, setupNodeDrag } from './drag';
import { EditorPane } from '../markdown/editor-pane';
import { blockOf, clearPreviewLine } from '../markdown/preview-line';
import { caretAtEnd, EditSession, runEditor } from './inline-edit';
import { MapViewport } from './viewport';
import {
  addChildOp,
  addSiblingOp,
  deleteNodeOp,
  InsertResult,
  moveNodeOp,
  reorderSiblingOp,
  setCheckboxOp,
  setTextOp,
  toggleTaskOp,
} from '../../core/write/ops';
import {
  findEditingView,
  updateFileLines,
  WroteToDisk,
} from '../markdown/file-io';

export const VIEW_TYPE_MINDMAP = 'mindmap-editor';

/**
 * Gap (px) between a node's right edge and its collapse handle. Short, because
 * the edges fan out from that right edge: a handle further along would stand
 * between two of them rather than on the joint they share.
 */
const COLLAPSE_HANDLE_GAP = 4;

/**
 * Edge thickness by the level the edge arrives at, matched to that level's
 * border. Siblings share a level, so no edge changes width along its length.
 */
const EDGE_WIDTHS = [2.5, 2, 1.75, 1.5, 1.25, 1];

/** Run left for an edge once the collapse handle has taken its share. */
const EDGE_MIN_RUN = 12;

/** How far out of the parent the bend is spent, at most. */
const BEND_LEAD = 60;
const BEND_SETTLE = 110;

/**
 * Out of the parent, across to the child's row early, then all but straight in.
 * Both control points sit near the parent, which parts the siblings a few
 * pixels out and leaves the rest of a long edge running straight.
 */
function branchCurve(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y2 - y1) < 1) {
    return `M ${x1} ${y1} H ${x2}`;
  }
  const run = x2 - x1;
  const lead = Math.min(run * 0.25, BEND_LEAD);
  const settle = Math.min(run * 0.45, BEND_SETTLE);

  return (
    `M ${x1} ${y1} C ${x1 + lead} ${y1}, ` + `${x1 + settle} ${y2}, ${x2} ${y2}`
  );
}

/** Classes the view both writes and looks for again. */
const EDIT_INPUT = 'mindmap-edit-input';
const HEAD = 'mindmap-node-head';
const BODY = 'mindmap-node-body';
const BODY_LINE = 'mindmap-node-body-line';

/** Just enough scrolling to bring something into view, and no more. */
const KEEP_IN_VIEW: ScrollIntoViewOptions = {
  block: 'nearest',
  inline: 'nearest',
};

/** One word for one thing: the tab menu, the command and this all say link. */
const LINK_LABEL = 'Link this map to its note';

/** How long the map waits before redrawing after a change to the file. */
const RENDER_DELAY = 250;

/** How long after a click or key it looks for a fold the user just made. */
const FOLD_CHECK_DELAY = 120;

/** How long an inline edit may grow before the map is laid out again. */
const REFLOW_DELAY = 60;

/** A completed task node ('- [x]'), the unit hidden by hideCompleted. */
function isCompletedTask(node: MindNode): boolean {
  return node.type === 'list' && node.checked === true;
}

/** Placeholder MindNode for "✓ n done" summary pills; never written back. */
const SUMMARY_NODE: MindNode = {
  type: 'list',
  text: '',
  line: -2,
  endLine: -2,
  body: [],
  level: 0,
  indent: '',
  marker: '',
  checked: null,
  children: [],
  parent: null,
};

export class MindmapView extends ItemView {
  private readonly plugin: MindmapPlugin;
  private file: TFile | null = null;
  private root: MindNode | null = null;
  private scrollerEl!: HTMLElement;
  private canvasEl!: HTMLElement;
  private selectedLine: number | null = null;
  /** File line the editor's caret was last seen on; re-marked after a render. */
  private cursorLine: number | null = null;
  /** A just-added node, to select and open for naming after the render. */
  private insertedLine: number | null = null;
  /** The last write the map made with no editor pane to remember it. */
  private undoable: (WroteToDisk & { path: string }) | null = null;
  /** Ends the edit on screen, for when the map is asked for its keyboard back. */
  private closeEdit: (() => void) | null = null;
  private isInlineEditing = false;
  private isDragging = false;
  private renderQueued = false;
  private renderSeq = 0;
  private laidByLine = new Map<number, LaidNode>();
  /** Last built tree, so an edit can re-lay it out without rebuilding it. */
  private laidRoot: LaidNode | null = null;
  private hideCompletedActionEl: HTMLElement | null = null;
  private bodyTextActionEl: HTMLElement | null = null;
  private linkActionEl: HTMLElement | null = null;
  private viewport!: MapViewport;
  /** Restored before the viewport DOM exists during workspace startup. */
  private savedZoom = 1;
  /** How many `pointEditorAtFile` calls this map has in flight. */
  private pointing = 0;
  /** The two bulk-fold buttons in the header, by what each one folds. */
  private foldAllActionEls = new Map<FoldKind, HTMLElement>();
  /**
   * Parents (by line) whose completed tasks are shown despite
   * hideCompleted, via a click on their "✓ n done" pill.
   */
  private expandedDone = new Set<number>();
  /** Nodes whose children are folded away, by line. */
  private collapsedBranches = new Set<number>();
  /** Nodes whose own text is folded away, by line. */
  private foldedText = new Set<number>();
  /** Folds last read from or written to the editor, to spot user folds. */
  private lastEditorFoldsKey: string | null = null;
  /**
   * Set once folding the editor fails (the API is not public). Sync then stops
   * both ways: reading alone would let the next render undo the map's folds.
   */
  private foldSyncOff = false;
  /** Everything that talks to the Markdown pane; see ./editor-pane.ts. */
  private readonly editor: EditorPane;

  /**
   * The two the header can flip. Per pane, not settings: with maps side by
   * side, one header button must not redraw every other map. The settings
   * they start from are the defaults for a map being opened, nothing more,
   * and the workspace remembers what each pane was left showing.
   */
  private hideCompleted: boolean;
  private showBodyText: boolean;

  /** Whether collapsed branches and the editor's folds track each other. */
  private get syncFolds(): boolean {
    return this.plugin.settings.syncFolds && !this.foldSyncOff;
  }

  /**
   * Whether an inline edit or drag is in progress; render() defers while one
   * is. A flag whose element is gone is stale — clearing it unfreezes the map.
   */
  private isBusy(): boolean {
    if (
      this.isInlineEditing &&
      !this.canvasEl.querySelector(`.${EDIT_INPUT}`)
    ) {
      this.isInlineEditing = false;
    }
    if (this.isDragging && !this.canvasEl.querySelector(DRAGGING_SELECTOR)) {
      this.isDragging = false;
    }

    return this.isInlineEditing || this.isDragging;
  }

  private readonly reflow = debounce(
    () => this.applyLayout(),
    REFLOW_DELAY,
    false,
  );

  private readonly requestRender = debounce(
    () => {
      void this.render();
    },
    RENDER_DELAY,
    true,
  );

  constructor(leaf: WorkspaceLeaf, plugin: MindmapPlugin) {
    super(leaf);
    this.plugin = plugin;
    // The settings are where a map starts; setState has the last word for one
    // the workspace is restoring.
    this.hideCompleted = plugin.settings.hideCompleted;
    this.showBodyText = plugin.settings.showBodyText;
    this.editor = new EditorPane({
      app: this.app,
      leaf,
      file: () => this.file,
      openSplit: (near) => plugin.openSplit(near ?? leaf),
      // This map's own document: in a window of its own, the main window's
      // active element is never anything of ours.
      hasFocus: () =>
        this.containerEl.contains(this.containerEl.doc.activeElement),
      focusMap: () => this.scrollerEl.focus({ preventScroll: true }),
    });
    // This view navigates between files (wikilink follows), so it takes
    // part in Obsidian's per-leaf navigation history: back/forward via
    // the tab-header arrows, mouse buttons, and the built-in hotkeys.
    this.navigation = true;
    if (!this.plugin.isMobile) {
      this.declineOpens();
    }
    this.registerShortcuts();
  }

  /**
   * Says no to "open the file here", which a search result took the map's tab
   * for. Not through `navigation`: the back/forward commands read that too.
   */
  private declineOpens(): void {
    const leaf = this.leaf as WorkspaceLeaf & { canNavigate?: () => boolean };

    if (typeof leaf.canNavigate !== 'function') {
      return;
    }
    const own = Object.getOwnPropertyDescriptor(leaf, 'canNavigate');

    leaf.canNavigate = (): boolean => false;
    this.register(() => {
      if (own) {
        Object.defineProperty(leaf, 'canNavigate', own);
      } else {
        delete leaf.canNavigate;
      }
    });
  }

  /**
   * Registers the view-scoped keyboard shortcuts. A view scope receives keys
   * whenever this leaf is active, without depending on which inner element
   * has DOM focus.
   */
  /**
   * Claims a key for the map, standing aside while an inline edit is on
   * screen. Obsidian's keymap sees a keystroke before the page does, so a
   * Backspace meant for the text being typed would otherwise reach the map
   * and take the line out from under it. The edit registers what it needs of
   * its own, and those are not registered through here.
   */
  private onKey(mods: Modifier[], key: string, run: () => boolean): void {
    this.scope?.register(mods, key, () => {
      const input = this.canvasEl.querySelector(`.${EDIT_INPUT}`);

      // Only while the edit has the keyboard. An editor left open with the
      // focus elsewhere is not who the key is for - and taking every key for
      // it would leave the map with none.
      return input && input.doc.activeElement === input ? true : run();
    });
  }

  private registerShortcuts(): void {
    this.scope = new Scope(this.app.scope);
    this.onKey([], 'Enter', () => {
      const node = this.selectedNode();

      if (!node) {
        return true;
      }
      void (node.type === 'root'
        ? this.addChildNode(node)
        : this.addSiblingNode(node));

      return false;
    });
    this.onKey([], 'Tab', () => {
      const node = this.selectedNode();

      if (!node) {
        return true;
      }
      void this.addChildNode(node);

      return false;
    });
    for (const key of ['Delete', 'Backspace']) {
      this.onKey([], key, () => {
        const node = this.selectedNode();

        if (!node || node.type === 'root') {
          return true;
        }
        this.selectedLine = null;
        void this.applyToNodes([node], (lines, [target]) =>
          deleteNodeOp(lines, target!),
        );

        return false;
      });
    }
    this.onKey([], 'F2', () => {
      const node = this.selectedNode();

      if (!node) {
        return true;
      }
      const laid = this.laidByLine.get(node.line);

      if (laid) {
        this.startInlineEdit(node, laid.el);
      }

      return false;
    });
    const sibling = (n: MindNode, delta: number): MindNode | null => {
      if (!n.parent) {
        return null;
      }
      const sibs = this.visibleChildren(n.parent);

      return sibs[sibs.indexOf(n) + delta] ?? null;
    };
    const nav: [string, (n: MindNode) => MindNode | null][] = [
      ['ArrowLeft', (n) => n.parent],
      ['ArrowRight', (n) => this.visibleChildren(n)[0] ?? null],
      ['ArrowUp', (n) => sibling(n, -1)],
      ['ArrowDown', (n) => sibling(n, 1)],
    ];

    for (const [key, move] of nav) {
      const step = key === 'ArrowUp' ? -1 : 1;

      this.onKey([], key, () => {
        if (this.isInlineEditing) {
          return true;
        }
        // With a body line picked out, up and down walk the text; the ends of
        // it hand the keys back to the nodes.
        if (
          (key === 'ArrowUp' || key === 'ArrowDown') &&
          this.stepBodyLine(step)
        ) {
          return false;
        }
        const node = this.selectedNode();

        if (!node) {
          if (this.root) {
            this.selectByNode(this.root);
          }

          return false;
        }
        const next = move(node);

        if (next) {
          this.selectByNode(next);
        }

        return false;
      });
    }
    // Shift+Up/Down reorders the selected node among its siblings.
    for (const [key, delta] of [
      ['ArrowUp', -1],
      ['ArrowDown', 1],
    ] as const) {
      this.onKey(['Shift'], key, () => {
        const node = this.selectedNode();

        if (!node || node.type === 'root') {
          return true;
        }
        void this.reorderNode(node, delta);

        return false;
      });
    }
    // Mod+Left/Right fold the selection; plain arrows stay navigation.
    for (const [key, collapse] of [
      ['ArrowLeft', true],
      ['ArrowRight', false],
    ] as const) {
      this.onKey(['Mod'], key, () => {
        const node = this.selectedNode();

        if (!node) {
          return true;
        }
        if (node.children.length > 0) {
          if (this.collapsedBranches.has(node.line) !== collapse) {
            this.toggleCollapse(node);
          }

          return false;
        }
        if (!this.hasTextToggle(node)) {
          return true;
        }
        if (this.foldedText.has(node.line) !== collapse) {
          this.toggleTextFold(node);
        }

        return false;
      });
    }
    // The map's edits are written through the editor, so its history is the
    // map's history too - undo on this side steps the same one.
    for (const [mods, key, back] of [
      [['Mod'], 'Z', true],
      [['Mod', 'Shift'], 'Z', false],
      [['Mod'], 'Y', false],
    ] as const) {
      this.onKey([...mods], key, () => {
        if (this.editor.stepHistory(back)) {
          this.requestRender();
        } else if (!back || !this.undoLastWrite()) {
          new Notice(
            'Mind map: open this note in a pane to undo what the map wrote.',
          );
        }

        return false;
      });
    }
    // Obsidian passes KeyboardEvent.key through, so space is ' '.
    this.onKey([], ' ', () => this.toggleSelectedCheckbox());
    this.onKey([], 'Escape', () => {
      // A flag left set with no editor on screen: the edit is over, and this
      // is what unfreezes the map. An editor that is still there kept the key
      // to itself, and never reached here.
      if (this.isInlineEditing) {
        this.isInlineEditing = false;
        void this.render();

        return false;
      }
      if (this.selectedLine === null) {
        return true;
      }
      this.selectedLine = null;
      this.clearSelectionClass();

      return false;
    });
  }

  /** Selects a node found by tree navigation and keeps it in view. */
  private selectByNode(node: MindNode): void {
    const laid = this.laidByLine.get(node.line);

    if (!laid) {
      return;
    }
    this.selectNode(node, laid.el);
    laid.el.scrollIntoView(KEEP_IN_VIEW);
  }

  /**
   * Selects the node the editor's caret sits in, the mirror of
   * EditorPane.goToLine. Never takes focus: the user is typing over there.
   */
  private followEditorCursor(): void {
    if (this.isBusy() || !this.root || !this.file) {
      return;
    }
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (mdView?.file?.path !== this.file.path) {
      return;
    }
    const cursorLine = mdView.editor.getCursor().line;

    // Before the node work below, which returns early on an unchanged node -
    // the caret moving between two lines of the same body still moves.
    this.markCursorLine(cursorLine);
    const node = findEnclosing(this.root, cursorLine);
    // Inside a collapsed branch, the branch stands in for the caret's node.
    const shown = node && (this.collapsedAncestor(node) ?? node);
    const laid = shown && this.laidByLine.get(shown.line);

    if (!laid) {
      if (node?.parent && this.isHiddenDone(node.parent, node)) {
        this.markDonePill(node.parent);
      }

      return;
    }
    // Same node: nothing to do, and skipping the write is what keeps this
    // from bouncing against EditorPane.goToLine.
    if (laid.node.line === this.selectedLine) {
      return;
    }
    this.clearSelectionClass();
    laid.el.addClass('is-selected');
    this.selectedLine = laid.node.line;
    laid.el.scrollIntoView(KEEP_IN_VIEW);
  }

  /**
   * Marks the drawn body line the editor's caret sits on. Node selection is
   * as fine as the map gets otherwise, and a node's whole description reads
   * the same whichever of its lines you are on.
   */
  private markCursorLine(line: number): void {
    const moved = line !== this.cursorLine;

    this.cursorLine = line;
    // All of them: a mark left behind on another line reads as a second
    // caret, and only the editor's is real.
    this.canvasEl
      .querySelectorAll(`.${BODY_LINE}.is-cursor-line`)
      .forEach((stale) => stale.removeClass('is-cursor-line'));
    const el = this.canvasEl.querySelector<HTMLElement>(
      `.${BODY_LINE}[data-line="${line}"]`,
    );

    el?.addClass('is-cursor-line');
    if (moved) {
      el?.scrollIntoView(KEEP_IN_VIEW);
    }
  }

  /**
   * The caret is on a task hideCompleted folded away, so point at the pill
   * that stands for it rather than unfolding. Nothing is selected: the pill
   * is not a node, and the task itself is not on screen to act on.
   */
  private markDonePill(parent: MindNode): void {
    const pill = this.canvasEl.querySelector<HTMLElement>(
      `.mindmap-node-summary[data-parent-line="${parent.line}"]`,
    );

    this.clearSelectionClass();
    this.selectedLine = null;
    pill?.addClass('is-selected');
    pill?.scrollIntoView(KEEP_IN_VIEW);
  }

  /**
   * The adjacent sibling a reorder would swap with. Same-type only: a
   * list item hopping over a sub-heading would reparse under it.
   */
  private reorderTarget(node: MindNode, delta: -1 | 1): MindNode | null {
    const sibs = node.parent?.children ?? [];
    const other = sibs[sibs.indexOf(node) + delta];

    return other && other.type === node.type ? other : null;
  }

  /**
   * Moves the node up/down within its siblings by swapping whole blocks;
   * the selection follows the node to its new line.
   */
  private async reorderNode(node: MindNode, delta: -1 | 1): Promise<void> {
    const other = this.reorderTarget(node, delta);

    if (!other) {
      return;
    }
    this.selectedLine =
      delta < 0 ? other.line : node.line + (other.endLine - node.endLine);
    await this.applyToNodes([node, other], (lines, [a, b]) =>
      reorderSiblingOp(lines, a!, b!),
    );
  }

  /**
   * Writes the checkbox's own DOM state (not a flip of the parsed one) so
   * rapid toggles before a re-render converge on what the user sees.
   */
  private writeCheckbox(
    node: MindNode,
    el: HTMLElement,
    cb: HTMLInputElement,
  ): void {
    el.toggleClass('is-done', cb.checked);
    void this.applyToNodes([node], (lines, [target]) =>
      setCheckboxOp(lines, target!, cb.checked),
    );
  }

  /** Space on a task node: flip the real checkbox and persist that state. */
  private toggleSelectedCheckbox(): boolean {
    const node = this.selectedNode();

    if (!node || node.checked === null) {
      return true;
    }
    const laid = this.laidByLine.get(node.line);
    const cb = laid?.el.querySelector<HTMLInputElement>('.mindmap-checkbox');

    if (!laid || !cb) {
      return true;
    }
    cb.checked = !cb.checked;
    this.writeCheckbox(node, laid.el, cb);

    return false;
  }

  private selectedNode(): MindNode | null {
    if (this.isInlineEditing || !this.root || this.selectedLine === null) {
      return null;
    }

    return findByLine(this.root, this.selectedLine);
  }

  getViewType(): string {
    return VIEW_TYPE_MINDMAP;
  }

  getDisplayText(): string {
    return this.file ? `Mind map: ${this.file.basename}` : 'Mind map';
  }

  /** The file this map is showing, so the plugin can find the map for one. */
  get currentFile(): TFile | null {
    return this.file;
  }

  getIcon(): string {
    return 'git-fork';
  }

  /**
   * Whether `child` is hidden under `parent` (checked task, hide mode on,
   * and the parent has not been expanded via its "✓ n done" pill).
   */
  private isHiddenDone(parent: MindNode, child: MindNode): boolean {
    return (
      this.hideCompleted &&
      !this.expandedDone.has(parent.line) &&
      isCompletedTask(child)
    );
  }

  /**
   * The children a node draws: none while collapsed, no checked tasks under
   * hideCompleted. Navigation walks this too, or the selection strands.
   */
  private visibleChildren(node: MindNode): MindNode[] {
    if (this.collapsedBranches.has(node.line)) {
      return [];
    }

    return node.children.filter((c) => !this.isHiddenDone(node, c));
  }

  /** The body line the map is showing as picked, if there is one. */
  private markedBodyLine(): { node: MindNode; line: number } | null {
    const el = this.canvasEl.querySelector<HTMLElement>(
      `.${BODY_LINE}.is-cursor-line`,
    );
    const line = Number(el?.dataset.line ?? NaN);
    const node =
      this.root && !Number.isNaN(line) ? findEnclosing(this.root, line) : null;

    return node ? { node, line } : null;
  }

  /**
   * Moves the pick to the body line above or below. False when there is none
   * that way - the caller then moves between nodes, as it always did.
   */
  private stepBodyLine(delta: -1 | 1): boolean {
    const marked = this.markedBodyLine();

    if (!marked) {
      return false;
    }
    const lines = this.bodyLineEls(marked.node);
    const at = lines.findIndex((el) => el.dataset.line === String(marked.line));
    const line = Number(lines[at + delta]?.dataset.line ?? NaN);

    if (at < 0 || Number.isNaN(line)) {
      return false;
    }
    this.markCursorLine(line);
    void this.editor.goToLine(line, blockOf(marked.node, line));

    return true;
  }

  /** The drawn lines of a node's own text, in the order they are drawn. */
  private bodyLineEls(node: MindNode): HTMLElement[] {
    const el = this.laidByLine.get(node.line)?.el;

    return el
      ? Array.from(el.querySelectorAll<HTMLElement>(`.${BODY_LINE}`))
      : [];
  }

  /**
   * Whether the node's own text is folded away. Its branch being folded does
   * not count: the two handles are two separate things, and putting children
   * out of the way is no reason to take the node's description with them.
   */
  private isTextFolded(node: MindNode): boolean {
    return this.foldedText.has(node.line);
  }

  /**
   * Folds a node's own text. Always the same state, whatever the node looks
   * like - mergeFolds is what knows which of these the editor can hold.
   */
  private toggleTextFold(node: MindNode): void {
    if (!this.foldedText.delete(node.line)) {
      this.foldedText.add(node.line);
    }
    this.syncCollapseToEditor();
    void this.render();
  }

  /** The outermost collapsed ancestor - the one still on screen. */
  private collapsedAncestor(node: MindNode): MindNode | null {
    let outermost: MindNode | null = null;

    for (let cur = node.parent; cur; cur = cur.parent) {
      if (this.collapsedBranches.has(cur.line)) {
        outermost = cur;
      }
    }

    return outermost;
  }

  /** Moves a selection that just folded away up to the node standing in. */
  private keepSelectionVisible(): void {
    const selected = this.selectedNode();
    const standIn = selected && this.collapsedAncestor(selected);

    if (standIn) {
      this.selectedLine = standIn.line;
    }
  }

  /** Collapses or expands `node`'s branch, and folds the editor to match. */
  private toggleCollapse(node: MindNode): void {
    if (!node.children.length) {
      return;
    }
    if (this.collapsedBranches.has(node.line)) {
      this.collapsedBranches.delete(node.line);
    } else {
      this.collapsedBranches.add(node.line);
      this.keepSelectionVisible();
    }
    this.syncCollapseToEditor();
    void this.render();
  }

  /**
   * Folds every handle of one kind, and unfolds them once all are folded.
   * Mixed state folds the rest, so the first click always tidies up.
   */
  private toggleAllCollapse(kind: FoldKind): void {
    this.setAllCollapsed(kind, !this.allFolded(kind));
  }

  /**
   * What a bulk fold acts on. Folding text takes in the nodes whose handle is
   * a "≡" and the ones carrying text beside a branch handle, so one button
   * still means "all of it".
   */
  private bulkTargets(kind: FoldKind): { branch: number[]; text: number[] } {
    if (!this.root) {
      return { branch: [], text: [] };
    }

    if (kind === FoldKind.Text) {
      return {
        branch: [],
        text: this.showBodyText ? textTargets(this.root) : [],
      };
    }

    // Not the note itself: folding that leaves one pill on the canvas, which
    // is not what the Markdown pane shows with everything folded, and not
    // what "collapse all" is asking for. Its own handle still folds it.
    return {
      branch: branchTargets(this.root).filter((line) => line >= 0),
      text: [],
    };
  }

  /** Whether every handle of one kind is already folded. */
  private allFolded(kind: FoldKind): boolean {
    const { branch, text } = this.bulkTargets(kind);

    return (
      branch.length + text.length > 0 &&
      branch.every((line) => this.collapsedBranches.has(line)) &&
      text.every((line) => this.foldedText.has(line))
    );
  }

  /** Folds or unfolds every handle of one kind; what the commands call. */
  setAllCollapsed(kind: FoldKind, collapse: boolean): void {
    if (kind === FoldKind.Text && !this.showBodyText) {
      new Notice('Mind map: the map is not drawing node text right now.');

      return;
    }
    const targets = this.bulkTargets(kind);

    if (!targets.branch.length && !targets.text.length) {
      return;
    }
    const apply = (lines: number[], set: Set<number>): void => {
      for (const line of lines) {
        if (collapse) {
          set.add(line);
        } else {
          set.delete(line);
        }
      }
    };

    apply(targets.branch, this.collapsedBranches);
    apply(targets.text, this.foldedText);
    if (collapse) {
      this.keepSelectionVisible();
    }
    this.syncCollapseToEditor();
    void this.render();
  }

  /** Lights up a bulk-fold button while everything it folds is folded. */
  private updateFoldActions(): void {
    for (const [kind, el] of this.foldAllActionEls) {
      el.toggleClass('is-active', this.allFolded(kind));
    }
  }

  /** Adopts `folds`; true if the collapse state changed. */
  private adoptFolds(root: MindNode, folds: FoldRange[]): boolean {
    this.lastEditorFoldsKey = foldsKey(folds);
    const next = collapsedFromFolds(root, folds);
    const changed =
      !sameLines(next.branches, this.collapsedBranches) ||
      !sameLines(next.text, this.foldedText);

    this.collapsedBranches = next.branches;
    this.foldedText = next.text;

    return changed;
  }

  /**
   * Adopts the editor's folds, unless they are the set last seen - so the map
   * never reads back its own write, while an edit, which does move them, keeps
   * the collapsed lines on the text.
   */
  private pullEditorFolds(root: MindNode): boolean {
    const folds =
      this.syncFolds && this.file ? readEditorFolds(this.app, this.file) : null;

    if (!folds || foldsKey(folds) === this.lastEditorFoldsKey) {
      return false;
    }

    return this.adoptFolds(root, folds);
  }

  /**
   * Obsidian fires no fold event, so this runs after what can fold. It only
   * spots the change and re-renders: adopting here would land the editor's
   * lines, already moved by the edit, on the parse from before it.
   */
  private syncCollapseFromEditor(): void {
    const folds =
      this.syncFolds && this.file && !this.isBusy()
        ? readEditorFolds(this.app, this.file)
        : null;

    if (folds && foldsKey(folds) !== this.lastEditorFoldsKey) {
      void this.render();
    }
  }

  /** Folds the Markdown pane to match the map, in whichever mode it is in. */
  private syncCollapseToEditor(): void {
    if (!this.syncFolds || !this.root || !this.file) {
      return;
    }
    const current = readEditorFolds(this.app, this.file);

    if (!current) {
      return;
    }
    const folds = mergeFolds(
      this.root,
      this.collapsedBranches,
      this.foldedText,
      current,
    );

    // A fold the editor cannot hold (a node's text with children under it)
    // leaves this set unchanged; writing it anyway would re-fold the whole
    // document for nothing.
    if (foldsKey(folds) === foldsKey(current)) {
      return;
    }
    // A reading pane takes no fold state; its headings have handles instead.
    void foldPreviewHeadings(this.app, this.file, this.collapsedBranches);
    const wrote = applyEditorFolds(this.app, this.file, folds);

    if (wrote !== FoldWrite.Applied) {
      // No editing pane is not a broken API: keep reading, write next time.
      this.foldSyncOff = wrote === FoldWrite.Failed;

      return;
    }
    // What the editor took, not what we asked for: Obsidian drops a fold it
    // will not make (a list fold with "Fold indent" off), and reading our own
    // ask back as the user's would expand the branch again.
    this.lastEditorFoldsKey = foldsKey(
      readEditorFolds(this.app, this.file) ?? folds,
    );
  }

  /**
   * Seeds a just-opened file from Obsidian's stored folds. Only when no pane
   * has it: render() already takes a live editor's, which are newer.
   */
  private async loadStoredCollapse(): Promise<void> {
    if (!this.syncFolds || !this.file || readEditorFolds(this.app, this.file)) {
      return;
    }
    const file = this.file;
    const folds = await loadStoredFolds(this.app, file);

    if (!folds || !this.root || this.file?.path !== file.path) {
      return;
    }
    if (this.adoptFolds(this.root, folds)) {
      await this.render();
    }
  }

  private setHideCompleted(value: boolean): void {
    if (this.hideCompleted === value) {
      return;
    }
    this.hideCompleted = value;
    this.app.workspace.requestSaveLayout();
    this.expandedDone.clear();
    this.syncToggleActions();
    void this.render();
  }

  /** Flips whether this map draws a node's own text; the `¶` button. */
  toggleBodyText(): void {
    this.showBodyText = !this.showBodyText;
    this.app.workspace.requestSaveLayout();
    this.syncToggleActions();
    void this.render();
  }

  /**
   * Links this map to its note's tab, or hands it back to the active file.
   * The header's way of saying what the linked-open command does, since a
   * shortcut nobody can see is a shortcut nobody uses.
   */
  private toggleLink(): void {
    if (this.editor.linkedLeaf()) {
      // Obsidian's own Unlink; not in the typings, like `group` beside it.
      (
        this.leaf as WorkspaceLeaf & { setGroup(g: string | null): void }
      ).setGroup(null);

      return;
    }
    void this.linkToEditor();
  }

  /** Lights up the header buttons that stand for what this map is showing. */
  private syncToggleActions(): void {
    const text = this.showBodyText;
    const linked = !!this.editor.linkedLeaf();

    this.linkActionEl?.toggleClass('is-active', linked);
    this.linkActionEl?.setAttribute(
      'aria-label',
      linked ? 'Unlink this map, so it follows the active file' : LINK_LABEL,
    );
    this.hideCompletedActionEl?.toggleClass('is-active', this.hideCompleted);
    this.bodyTextActionEl?.toggleClass('is-active', text);
    // Nothing to fold while the map draws no text, and the map only folds
    // what it draws.
    this.foldAllActionEls.get(FoldKind.Text)?.toggleClass('is-hidden', !text);
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('mindmap-view');
    this.hideCompletedActionEl = this.addAction(
      'check-check',
      'Hide/show completed tasks',
      () => this.setHideCompleted(!this.hideCompleted),
    );
    this.bodyTextActionEl = this.addAction(
      'pilcrow',
      'Show/hide node text on the map',
      () => this.toggleBodyText(),
    );
    this.linkActionEl = this.addAction('link', LINK_LABEL, () =>
      this.toggleLink(),
    );
    this.syncToggleActions();
    this.foldAllActionEls.set(
      FoldKind.Branches,
      this.addAction(
        'chevrons-down-up',
        'Collapse or expand all branches',
        () => this.toggleAllCollapse(FoldKind.Branches),
      ),
    );
    this.foldAllActionEls.set(
      FoldKind.Text,
      this.addAction('align-justify', 'Fold or unfold all text', () =>
        this.toggleAllCollapse(FoldKind.Text),
      ),
    );
    this.addAction('refresh-cw', 'Refresh from the Markdown', () => {
      void this.forceRefresh();
    });
    this.addAction('focus', 'Center mind map', () => this.viewport.center());
    const zoomOutAction = this.addAction('zoom-out', 'Zoom out (100%)', () =>
      this.viewport.zoomOut(),
    );
    const zoomInAction = this.addAction('zoom-in', 'Zoom in (100%)', () =>
      this.viewport.zoomIn(),
    );

    this.scrollerEl = this.contentEl.createDiv({
      cls: 'mindmap-scroller',
      attr: { tabindex: '0' },
    });
    const surfaceEl = this.scrollerEl.createDiv({ cls: 'mindmap-surface' });

    this.canvasEl = surfaceEl.createDiv({ cls: 'mindmap-canvas' });
    this.viewport = new MapViewport(
      this.scrollerEl,
      surfaceEl,
      this.canvasEl,
      this.savedZoom,
    );
    this.viewport.bindActions(zoomOutAction, zoomInAction);
    // The map asking for the keyboard back is the end of any edit still open:
    // an edit left behind when the focus went elsewhere must not keep the keys
    // it is no longer typing into.
    this.scrollerEl.addEventListener('focus', () => this.closeEdit?.());

    this.registerWorkspaceEvents();
    // During workspace restore, renders can run before files and editors
    // are fully loaded; one more render after layout-ready fills in the
    // real content (runs immediately when the layout is already ready).
    this.app.workspace.onLayoutReady(() => this.requestRender());
    await this.render();
  }

  /** Left up by a map that is gone, the mark quiets the pane's next flash. */
  async onClose(): Promise<void> {
    this.viewport?.destroy();
    clearPreviewLine();
  }

  /**
   * Wires the vault/workspace events that keep the map in sync: re-render on
   * edits, track the last-focused Markdown pane, follow the active file, pan
   * on background drag, and remember the split direction.
   */
  private registerWorkspaceEvents(): void {
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (this.isCurrentFile(file)) {
          this.requestRender();
        }
      }),
    );
    this.registerEvent(
      this.app.workspace.on('editor-change', (_editor, info) => {
        if (this.isCurrentFile(info.file)) {
          this.requestRender();
        }
      }),
    );
    // The note's name is what its own pill says, and it can be renamed from
    // anywhere - the map's pill, the file explorer, another window.
    this.registerEvent(
      this.app.vault.on('rename', (file) => {
        if (this.isCurrentFile(file)) {
          this.requestRender();
        }
      }),
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        this.editor.noteActiveLeaf(leaf);
        // Clicking a map points the Markdown side at its note: with maps side
        // by side, the one just picked is the note being worked on. The
        // keyboard goes back where the click put it.
        if (leaf === this.leaf && !this.plugin.isMobile) {
          void this.pointEditorAtFile();
        }
      }),
    );
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => this.followFile(file)),
    );
    // Unlinking hands the pane back to the active file, and no file-open
    // follows it: the note the user wants is the one already open.
    this.registerEvent(
      this.leaf.on('group-change', () => {
        this.syncToggleActions();
        this.followFile(this.app.workspace.getActiveFile());
      }),
    );
    this.registerDomEvent(this.scrollerEl, 'pointerdown', (e) =>
      this.onBackgroundPointerDown(e),
    );
    // The caret moving in an editor fires no workspace event, but it does
    // move the document selection, which does.
    this.everyDocument(['selectionchange'], () => this.followEditorCursor());
    // Nothing fires on a fold, so check once clicks and keys settle.
    const checkFolds = debounce(
      () => this.syncCollapseFromEditor(),
      FOLD_CHECK_DELAY,
    );

    this.everyDocument(['click', 'keyup'], () => checkFolds());
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => checkFolds()),
    );
  }

  /**
   * A listener in every window's document: a caret moves and a fold handle is
   * clicked in the editor's, and a popout has one of its own.
   */
  private everyDocument<K extends keyof DocumentEventMap>(
    types: readonly K[],
    run: () => void,
  ): void {
    const listening = new Set<Document>();
    const listen = (doc: Document): void => {
      if (listening.has(doc)) {
        return;
      }
      listening.add(doc);
      for (const type of types) {
        this.registerDomEvent(doc, type, run);
      }
    };
    const everywhere = (): void => {
      listen(this.containerEl.doc);
      this.app.workspace.iterateAllLeaves((leaf) =>
        listen(leaf.getContainer().doc),
      );
    };

    everywhere();
    // Again on every move: a map split into a popout opens before it is put
    // there, so right now its own window is still the main one.
    this.registerEvent(this.app.workspace.on('layout-change', everywhere));
    this.registerEvent(
      this.app.workspace.on('window-open', (win) => listen(win.doc)),
    );
  }

  getState(): Record<string, unknown> {
    return {
      file: this.file?.path ?? null,
      hideCompleted: this.hideCompleted,
      showBodyText: this.showBodyText,
      zoom: this.viewport?.value ?? this.savedZoom,
    };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    // What this pane was left drawing, which is its own and not the settings'.
    const shown = (state ?? {}) as Record<string, unknown>;

    if (typeof shown.hideCompleted === 'boolean') {
      this.hideCompleted = shown.hideCompleted;
    }
    if (typeof shown.showBodyText === 'boolean') {
      this.showBodyText = shown.showBodyText;
    }
    if (typeof shown.zoom === 'number' && Number.isFinite(shown.zoom)) {
      this.savedZoom = shown.zoom;
      this.viewport?.restore(shown.zoom);
    }
    this.syncToggleActions();
    if (
      state &&
      typeof state === 'object' &&
      'file' in state &&
      typeof state.file === 'string'
    ) {
      const af = this.app.vault.getAbstractFileByPath(state.file);

      if (af instanceof TFile && !this.isCurrentFile(af)) {
        // Switching between files (following a wikilink, or walking
        // history back/forward) is a navigation step: flag it so
        // Obsidian records it in the leaf history, and switch the
        // editor pane too so map and Markdown stay on the same file.
        if (this.file) {
          result.history = true;
          void this.editor.showFile(af);
        }
        await this.setFile(af);
      }
    }
    await super.setState(state, result);
  }

  async setFile(file: TFile): Promise<void> {
    this.file = file;
    this.selectedLine = null;
    this.cursorLine = null;
    this.expandedDone.clear();
    this.collapsedBranches.clear();
    this.foldedText.clear();
    this.lastEditorFoldsKey = null;
    await this.render(true);
    void this.loadStoredCollapse();
    const leaf = this.leaf as WorkspaceLeaf & {
      updateHeader?: () => void;
    };

    leaf.updateHeader?.();
  }

  refresh(): void {
    this.syncToggleActions();
    this.requestRender();
  }

  /**
   * Manual Markdown → map resync: skips the debounce and clears a stuck
   * interaction flag, the state it exists to recover from. Notifies even
   * when nothing changes — an up-to-date map redraws identically.
   */
  async forceRefresh(): Promise<void> {
    this.requestRender.cancel();
    this.isInlineEditing = false;
    this.isDragging = false;
    this.syncToggleActions();
    await this.render();
    new Notice('Mind map refreshed.');
  }

  /**
   * Picks up the render skipped while the pane was hidden, straight to
   * render() — the debounce would leave the stale map up for its delay.
   */
  onResize(): void {
    if (this.renderQueued && this.contentEl.offsetHeight > 0) {
      void this.render();
    }
  }

  /**
   * Whether `file` is the one this map shows. By path, not identity: the
   * vault can hand out a new TFile for the same path (a save that renames a
   * temp file over the original), which identity would stop matching.
   */
  private isCurrentFile(file: TAbstractFile | null): boolean {
    return !!file && file.path === this.file?.path;
  }

  /**
   * The Markdown to project. `switched` skips the editor: a MarkdownView
   * takes its new file before its editor swaps documents, so right after a
   * switch it can still hand out the previous note's text.
   */
  private async getFileText(switched: boolean): Promise<string> {
    if (!this.file) {
      return '';
    }
    if (switched) {
      return this.app.vault.cachedRead(this.file);
    }
    // Only an editing pane's text leads the file; a reading pane's editor is
    // not where the user types. A workspace-restored view can also exist
    // before its editor loaded, so an empty one falls back to the vault too.
    const editorText = findEditingView(this.app, this.file)?.editor.getValue();

    return editorText || this.app.vault.cachedRead(this.file);
  }

  private async render(switched = false): Promise<void> {
    if (this.isBusy()) {
      this.renderQueued = true;

      return;
    }
    // A hidden pane measures every node as 0×0, and redrawing after it is
    // shown can't beat the paint. Keep the last good layout for onResize.
    if (this.contentEl.offsetHeight === 0) {
      this.renderQueued = true;

      return;
    }
    this.renderQueued = false;
    const seq = ++this.renderSeq;

    if (!this.file) {
      this.canvasEl.empty();
      this.laidByLine.clear();
      this.canvasEl.createDiv({
        cls: 'mindmap-empty',
        text: 'Open a Markdown file, then run "Open mind map for the active file".',
      });
      this.viewport.sizeSurface(
        this.scrollerEl.clientWidth,
        this.scrollerEl.clientHeight,
      );

      return;
    }

    const text = await this.getFileText(switched);

    // Renders can overlap across the await above (an op's render plus the
    // debounced editor-change render). Only the newest may touch the DOM;
    // an interleaved rebuild duplicates nodes and desyncs laidByLine.
    if (seq !== this.renderSeq) {
      return;
    }
    if (this.isBusy()) {
      this.renderQueued = true;

      return;
    }

    const restoreViewport = this.viewport.isInitialized;
    const scrollLeft = this.scrollerEl.scrollLeft;
    const scrollTop = this.scrollerEl.scrollTop;

    this.canvasEl.empty();
    this.laidByLine.clear();
    this.root = parseMarkdown(text, this.file.basename);
    // Keyed by line, so re-derive: the editor's folds, else prune.
    if (!this.pullEditorFolds(this.root)) {
      this.collapsedBranches = pruneLines(
        this.collapsedBranches,
        branchTargets(this.root),
      );
      this.foldedText = pruneLines(this.foldedText, textTargets(this.root));
    }
    this.updateFoldActions();

    this.canvasEl.createSvg('svg', { cls: 'mindmap-edges' });
    const palette = parsePalette(this.plugin.settings.palette);

    this.laidRoot = this.buildNode(this.root, palette);
    this.applyLayout();
    if (restoreViewport) {
      this.scrollerEl.scrollLeft = scrollLeft;
      this.scrollerEl.scrollTop = scrollTop;
    }

    if (this.cursorLine !== null) {
      // The rebuild dropped the mark, and no caret move is coming to redo
      // it. Same line as before, so this re-marks without scrolling - a
      // render must not yank a map the user just panned somewhere else.
      this.markCursorLine(this.cursorLine);
    }

    if (this.insertedLine !== null) {
      const laid = this.laidByLine.get(this.insertedLine);

      this.insertedLine = null;
      if (laid) {
        this.selectNode(laid.node, laid.el);
        this.startInlineEdit(laid.node, laid.el);
      }
    } else if (this.selectedLine !== null) {
      const laid = this.laidByLine.get(this.selectedLine);

      if (laid) {
        laid.el.addClass('is-selected');
      } else {
        this.selectedLine = null;
      }
    }
  }

  private buildNode(node: MindNode, palette: string[]): LaidNode {
    const el = this.canvasEl.createDiv({
      cls: ['mindmap-node', `mindmap-node-${node.type}`],
    });

    el.dataset.line = String(node.line);

    const own = nodeColorFor(node, palette);

    if (own.color) {
      el.setCssProps({ '--branch-color': own.color });
      // An attribute rather than a variable: the ladder it picks is uneven,
      // which is a rule per level, not an expression.
      el.dataset.depth = String(own.depth);
    }

    // The checkbox and the label share a row of their own, so body text below
    // them is a block under it rather than another item on the same line.
    const head = el.createDiv({ cls: HEAD });

    if (node.checked !== null) {
      const cb = head.createEl('input', {
        cls: 'mindmap-checkbox',
        type: 'checkbox',
      });

      cb.checked = node.checked;
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => this.writeCheckbox(node, el, cb));
      el.toggleClass('is-done', node.checked);
    }
    const textTag = node.checked ? 's' : 'span';
    const textEl = head.createEl(textTag, { cls: 'mindmap-node-text' });

    if (node.text.length) {
      this.renderText(textEl, node.text);
    } else {
      textEl.setText(' ');
    }
    this.addBodyText(node, el);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectNode(node, el);
    });
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.startInlineEdit(node, el);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.selectNode(node, el);
      this.showNodeMenu(node, el, e);
    });
    this.setupDrag(node, el);

    const laid = makeLaid(node, el, own.color);

    this.laidByLine.set(node.line, laid);
    this.buildChildNodes(node, laid, own, palette);

    return laid;
  }

  /** Node text with its links clickable, following them on the map. */
  private renderText(el: HTMLElement, text: string): void {
    renderNodeText(
      el,
      text,
      this.app,
      this.file?.path ?? '',
      (target, evt) => void this.openInternalLink(target, evt),
    );
  }

  /**
   * Draws the node's own text inside it, one element per source line so a
   * click can name the line it hit.
   */
  private addBodyText(node: MindNode, el: HTMLElement): void {
    if (!this.showBodyText || !node.body.length) {
      return;
    }
    if (this.isTextFolded(node)) {
      return;
    }
    const bodyEl = el.createDiv({ cls: BODY });

    el.addClass('has-body');

    let previous = -1;

    for (const { line, text } of node.body) {
      const lineEl = bodyEl.createDiv({ cls: BODY_LINE });

      lineEl.dataset.line = String(line);
      // A gap in the line numbers is a child node standing between two runs
      // of text. They are written back separately, so they read separately.
      lineEl.toggleClass('is-run-start', previous >= 0 && line > previous + 1);
      previous = line;
      this.renderText(lineEl, text);
    }
    // Which line the pointer hit; the gaps around them answer with the first,
    // so a click near a line never turns into a click on nothing.
    const lineAt = (target: EventTarget | null): number => {
      const lineEl =
        target instanceof HTMLElement
          ? target.closest<HTMLElement>(`.${BODY_LINE}`)
          : null;
      const line = Number(lineEl?.dataset.line ?? NaN);

      return Number.isNaN(line) ? (node.body[0]?.line ?? node.line) : line;
    };

    // Selecting from the body still selects the node, but the editor's cursor
    // goes to the line under the pointer rather than the node's own.
    bodyEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectNode(node, el, lineAt(e.target));
    });
    // The map draws this text; the editor is where it is written. A
    // double-click opens the line there, with the caret on it.
    bodyEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      void this.editor.editLine(lineAt(e.target));
    });
  }

  private collapseLabel(collapsed: boolean): string {
    return collapsed ? 'Expand branch' : 'Collapse branch';
  }

  private textFoldLabel(folded: boolean): string {
    return folded ? 'Unfold the text' : 'Fold the text';
  }

  /** Whether the node gets a "≡": it has text of its own the map can fold. */
  private hasTextToggle(node: MindNode): boolean {
    return this.showBodyText && node.body.length > 0;
  }

  /**
   * Hangs the handles outside every node that has them, and answers where each
   * branch handle ends - the point the edges below it fan out from, so the
   * handle sits on a straight run of wire rather than in the white space
   * between two curves. Widths are read in one pass, after every placement.
   */
  private addCollapseToggles(laid: LaidNode): Map<LaidNode, number> {
    const branches: [LaidNode, HTMLElement][] = [];
    const visit = (l: LaidNode): void => {
      if (l.node.children.length > 0) {
        branches.push([l, this.addBranchToggle(l)]);
      }
      if (this.hasTextToggle(l.node)) {
        this.addTextToggle(l);
      }
      for (const child of l.children) {
        visit(child);
      }
    };

    visit(laid);
    const outlets = new Map<LaidNode, number>();

    for (const [l, el] of branches) {
      outlets.set(l, l.x + l.w + COLLAPSE_HANDLE_GAP + el.offsetWidth);
    }

    return outlets;
  }

  /** "−"/"+n" beside the node: folds the branch, and the editor with it. */
  private addBranchToggle(laid: LaidNode): HTMLElement {
    const node = laid.node;
    const collapsed = this.collapsedBranches.has(node.line);
    const toggle = this.makeToggle(
      laid,
      collapsed ? `+${node.children.length}` : '−',
      this.collapseLabel(collapsed),
      collapsed,
    );

    // Clear of the node's edge; CSS does the vertical half, so no measuring.
    toggle.setCssStyles({
      left: `${laid.x + laid.w + COLLAPSE_HANDLE_GAP}px`,
      top: `${laid.y + laid.h / 2}px`,
    });
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      // Moves the editor like a click on the node. Selecting last, so the
      // fold write's scroll restore cannot race the jump.
      this.toggleCollapse(node);
      this.selectNode(node, laid.el);
    });

    return toggle;
  }

  /**
   * "≡" on the node's top corner: folds the node's own text. The corner, not
   * the side, so a node that also has a branch handle can carry both.
   */
  private addTextToggle(laid: LaidNode): void {
    const node = laid.node;
    const folded = this.isTextFolded(node);
    const toggle = this.makeToggle(
      laid,
      '≡',
      this.textFoldLabel(folded),
      folded,
    );

    toggle.addClass('is-body');
    // Centred on the node's top-right corner. The branch handle's own gap
    // keeps the two apart, and z-order gives it any pixel they share.
    toggle.setCssStyles({
      left: `${laid.x + laid.w}px`,
      top: `${laid.y}px`,
    });
    // Out of sight until the node is pointed at, so a map full of text does
    // not carry a second chip on every node. Both elements answer: the handle
    // sits outside the node's box, so reaching for it leaves the node.
    const reveal = (on: boolean): void => {
      toggle.toggleClass('is-visible', on);
    };

    for (const el of [laid.el, toggle]) {
      el.addEventListener('pointerenter', () => reveal(true));
      el.addEventListener('pointerleave', () => reveal(false));
    }
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleTextFold(node);
      this.selectNode(node, laid.el);
    });
  }

  private makeToggle(
    laid: LaidNode,
    text: string,
    label: string,
    collapsed: boolean,
  ): HTMLElement {
    const toggle = this.canvasEl.createDiv({
      cls: 'mindmap-collapse',
      text,
      attr: { 'aria-label': label },
    });

    if (laid.color) {
      toggle.setCssProps({ '--branch-color': laid.color });
    }
    toggle.toggleClass('is-collapsed', collapsed);
    // The handle sits on the canvas: an escaping press would pan the map.
    for (const type of ['pointerdown', 'dblclick'] as const) {
      toggle.addEventListener(type, (e) => e.stopPropagation());
    }

    return toggle;
  }

  /**
   * Builds the visible children under `laid`: none while the branch is
   * collapsed. With hideCompleted on, checked tasks are skipped and collapsed
   * into one "✓ n done" pill per parent (or a "− hide done" pill when the
   * parent is currently expanded).
   */
  private buildChildNodes(
    node: MindNode,
    laid: LaidNode,
    own: NodeColor,
    palette: string[],
  ): void {
    if (this.collapsedBranches.has(node.line)) {
      return;
    }
    let hiddenDone = 0;
    let shownDone = 0;

    for (const child of node.children) {
      if (this.isHiddenDone(node, child)) {
        hiddenDone++;
        continue;
      }
      if (isCompletedTask(child)) {
        shownDone++;
      }
      laid.children.push(this.buildNode(child, palette));
    }
    if (hiddenDone > 0) {
      laid.children.push(this.buildDonePill(node, hiddenDone, own));
    } else if (this.hideCompleted && shownDone > 0) {
      laid.children.push(this.buildDonePill(node, 0, own));
    }
  }

  /**
   * Read-only stand-in under `parent`: "✓ n done" reveals that parent's
   * completed tasks, "− hide done" puts them back. Kept out of laidByLine, so
   * it cannot be selected, edited, dragged or dropped on.
   */
  private buildDonePill(
    parent: MindNode,
    hiddenCount: number,
    own: NodeColor,
  ): LaidNode {
    const expand = hiddenCount > 0;
    const el = this.canvasEl.createDiv({
      cls: 'mindmap-node mindmap-node-summary',
    });

    // How followEditorCursor finds the pill: the tasks behind it have no
    // element of their own.
    el.dataset.parentLine = String(parent.line);

    if (own.color) {
      el.setCssProps({ '--branch-color': own.color });
      // A level in from the parent it stands under, like the tasks it hides.
      el.dataset.depth = String(rungBelow(own.depth));
    }
    el.createSpan({
      cls: 'mindmap-node-text',
      text: expand ? `✓ ${hiddenCount} done` : '− hide done',
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (expand) {
        this.expandedDone.add(parent.line);
      } else {
        this.expandedDone.delete(parent.line);
      }
      void this.render();
    });

    return makeLaid(SUMMARY_NODE, el, own.color);
  }

  /**
   * Measures and places the nodes already on the canvas, leaving the elements
   * alone - which is what lets an open edit reflow the map as it grows.
   */
  private applyLayout(): void {
    const svg = this.canvasEl.querySelector<SVGSVGElement>('svg.mindmap-edges');

    if (!this.laidRoot || !svg) {
      return;
    }
    this.canvasEl
      .querySelectorAll('.mindmap-collapse')
      .forEach((handle) => handle.remove());
    svg.empty();
    const { width, height } = layoutTree(this.laidRoot);

    this.applyPositions(this.laidRoot);
    this.drawEdges(svg, this.laidRoot, this.addCollapseToggles(this.laidRoot));
    this.canvasEl.setCssStyles({ width: `${width}px`, height: `${height}px` });
    this.viewport.sizeSurface(width * MAX_ZOOM, height * MAX_ZOOM);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
  }

  private applyPositions(laid: LaidNode): void {
    laid.el.setCssStyles({ left: `${laid.x}px`, top: `${laid.y}px` });
    for (const c of laid.children) {
      this.applyPositions(c);
    }
  }

  /**
   * Draws the branch curves. They leave from the far side of the collapse
   * handle, with a stub carrying the wire out to it, so the handle reads as the
   * joint the branch hangs from; `EDGE_MIN_RUN` keeps that start short of the
   * children. `level` is the rung they land on, which the thickness comes from.
   * The stub is one of their bundle, so it takes their color, not the parent's:
   * at the root, which has none, a grey stub would meet a colored curve.
   */
  private drawEdges(
    svg: SVGSVGElement,
    laid: LaidNode,
    outlets: Map<LaidNode, number>,
    level = 0,
  ): void {
    const y1 = laid.y + laid.h / 2;
    const right = laid.x + laid.w;
    const stroke = (color: string): string => color || 'var(--text-faint)';
    const width = String(EDGE_WIDTHS[Math.min(level, EDGE_WIDTHS.length - 1)]!);
    const line = (d: string, color: string): void => {
      svg.createSvg('path', {
        attr: { d, stroke: stroke(color), fill: 'none', 'stroke-width': width },
      });
    };
    const outlet = outlets.get(laid);
    const childX = laid.children[0]?.x;
    const x1 =
      outlet === undefined
        ? right
        : Math.max(right, Math.min(outlet, (childX ?? outlet) - EDGE_MIN_RUN));

    if (laid.node.children.length > 0) {
      line(`M ${right} ${y1} H ${x1}`, laid.children[0]?.color ?? laid.color);
    }
    for (const child of laid.children) {
      line(branchCurve(x1, y1, child.x, child.y + child.h / 2), child.color);
      this.drawEdges(svg, child, outlets, level + 1);
    }
  }

  /** `line` overrides which line the editor follows to (a body line). */
  private selectNode(node: MindNode, el: HTMLElement, line?: number): void {
    this.clearSelectionClass();
    el.addClass('is-selected');
    this.selectedLine = node.line;
    this.scrollerEl.focus({ preventScroll: true });
    // Here rather than from the editor's own event: with the map holding
    // focus that event may never come, leaving the last mark standing.
    this.markCursorLine(line ?? node.line);
    // Mobile has one visible leaf: showing Markdown here would replace the
    // map merely because a node was selected, with no map pane to return to.
    if (this.plugin.isMobile) {
      return;
    }
    // Picking a node is asking to read that note, so it goes to the front
    // first - and the cursor only once it is there. Both open the note when
    // no pane has it, and side by side that is two tabs of the same file.
    // The editor always follows the current selection, whether it came from
    // a click or from arrow-key navigation.
    void this.pointEditorAtFile().then(() =>
      this.editor.goToLine(line ?? node.line, blockOf(node, line ?? node.line)),
    );
  }

  private clearSelectionClass(): void {
    this.canvasEl
      .querySelector('.mindmap-node.is-selected')
      ?.removeClass('is-selected');
  }

  /**
   * Moves this map onto `file` if it is the map's to follow. A map tracks the
   * active file, like Obsidian's own outline; one linked to a tab tracks that
   * tab instead, which is how a map is kept on one note.
   */
  private followFile(file: TFile | null): void {
    if (this.editor.linkedLeaf()) {
      this.followLinkedLeaf();

      return;
    }
    const shouldFollow =
      this.plugin.mapDrivenOpen !== file?.path &&
      file &&
      file.extension === 'md' &&
      !this.isCurrentFile(file);

    if (shouldFollow) {
      void this.setFile(file);
    }
  }

  /**
   * Brings this map's note to the front of the Markdown side - picking a node
   * is asking to read it there, and a tab behind another one answers nothing.
   * The note it shows becomes the active file, so it is flagged on the way:
   * without that, working in one map drags every other one onto its note.
   */
  private async pointEditorAtFile(): Promise<void> {
    if (!this.file) {
      return;
    }
    const had = this.containerEl.contains(this.containerEl.doc.activeElement);

    // Counted, because clicking a node calls this twice - once for the leaf
    // going active, once for the node. The second finds the tab already up and
    // returns at once; clearing the flag there would leave the first one
    // revealing unguarded, which is the whole window it exists to cover.
    this.pointing++;
    this.plugin.mapDrivenOpen = this.file.path;
    try {
      // Only the focus we took is given back: grabbing it unasked makes this
      // map the active leaf, and Obsidian then has no active file at all -
      // the next note the user opens goes nowhere.
      if ((await this.editor.showFile(this.file)) && had) {
        this.scrollerEl.focus({ preventScroll: true });
      }
    } finally {
      if (--this.pointing === 0) {
        this.plugin.mapDrivenOpen = null;
      }
    }
  }

  /**
   * Ties this map to the tab its note is in - Obsidian's own "Link with tab",
   * so the pairing shows in its tab menu and comes undone there. This is what
   * keeps a map on one note: it now tracks that tab rather than the active
   * file, and the two move together from either side.
   */
  async linkToEditor(): Promise<void> {
    if (this.file) {
      this.leaf.setGroupMember(await this.editor.tabFor(this.file));
    }
  }

  /** Follows the tab this map is linked to onto its file. */
  private followLinkedLeaf(): void {
    const file = this.editor.linkedFile();

    if (file && file.path !== this.file?.path) {
      void this.setFile(file);
    }
  }

  /** Focuses the Markdown pane; the map half of the toggle-focus command. */
  async focusEditor(): Promise<void> {
    await this.editor.focus();
  }

  /**
   * Switches the map to `dest` via the leaf's view state, so setState
   * flags the change (`result.history`) and Obsidian records it in the
   * leaf's navigation history.
   */
  private async followTo(from: TFile, dest: TFile): Promise<void> {
    if (dest.path === from.path) {
      return;
    }
    await this.leaf.setViewState({
      type: VIEW_TYPE_MINDMAP,
      active: true,
      state: { file: dest.path },
    });
  }

  /** Follows a [[wikilink]] on the map and in the editor pane. */
  private async openInternalLink(
    target: string,
    evt: MouseEvent,
  ): Promise<void> {
    const from = this.file;

    if (from) {
      await this.editor.openLink(target, evt, (dest) =>
        this.followTo(from, dest),
      );
    }
  }

  private showNodeMenu(node: MindNode, el: HTMLElement, e: MouseEvent): void {
    const menu = new Menu();
    const add = (title: string, icon: string, onClick: () => void): void => {
      menu.addItem((item) =>
        item.setTitle(title).setIcon(icon).onClick(onClick),
      );
    };

    if (node.children.length > 0) {
      const collapsed = this.collapsedBranches.has(node.line);

      add(
        this.collapseLabel(collapsed),
        collapsed ? 'chevron-down' : 'chevron-right',
        () => this.toggleCollapse(node),
      );
    }
    if (this.hasTextToggle(node)) {
      add(this.textFoldLabel(this.isTextFolded(node)), 'align-justify', () =>
        this.toggleTextFold(node),
      );
    }
    add('Add child', 'plus', () => void this.addChildNode(node));
    // A forced task child is always a list item, so skip it only where a
    // child cannot be one: the root once it already has heading children.
    const rootWithHeadings =
      node.type === 'root' && node.children.some((c) => c.type === 'heading');

    if (!rootWithHeadings) {
      add(
        'Add child task',
        'check-square',
        () => void this.addChildNode(node, true),
      );
    }
    if (node.type !== 'root') {
      add(
        'Add sibling',
        'corner-down-right',
        () => void this.addSiblingNode(node),
      );
      if (node.type === 'list') {
        add(
          'Add sibling task',
          'check-square',
          () => void this.addSiblingNode(node, true),
        );
      }
      add('Rename', 'pencil', () => this.startInlineEdit(node, el));
      if (this.reorderTarget(node, -1)) {
        add('Move up', 'arrow-up', () => void this.reorderNode(node, -1));
      }
      if (this.reorderTarget(node, 1)) {
        add('Move down', 'arrow-down', () => void this.reorderNode(node, 1));
      }
      if (node.type === 'list') {
        add(
          node.checked === null ? 'Add checkbox' : 'Remove checkbox',
          'check-square',
          () =>
            void this.applyToNodes([node], (lines, [target]) =>
              toggleTaskOp(lines, target!),
            ),
        );
      }
      menu.addSeparator();
      add('Delete', 'trash', () => {
        this.selectedLine = null;
        void this.applyToNodes([node], (lines, [target]) =>
          deleteNodeOp(lines, target!),
        );
      });
    }
    menu.showAtMouseEvent(e);
  }

  private async addSiblingNode(node: MindNode, task?: boolean): Promise<void> {
    await this.applyInsert(node, (lines, target) =>
      addSiblingOp(lines, target, task),
    );
  }

  private async addChildNode(node: MindNode, task?: boolean): Promise<void> {
    await this.applyInsert(node, (lines, target) =>
      addChildOp(lines, target, task),
    );
  }

  private async applyInsert(
    node: MindNode,
    mutate: (lines: string[], found: MindNode) => InsertResult,
  ): Promise<void> {
    if (!this.file) {
      return;
    }
    const file = this.file;

    try {
      await this.writeFile(file, (lines) => {
        const fresh = parseMarkdown(lines.join('\n'), file.basename);
        const target = relocateNode(fresh, node);

        if (!target) {
          throw new Error(`Mindmap: "${node.text}" is no longer in the file`);
        }
        const result = mutate(lines, target);

        this.insertedLine = result.insertedLine;

        return result.lines;
      });
    } catch (err) {
      this.insertedLine = null;
      this.reportOpError(err);
    }
    await this.render();
  }

  /**
   * Runs an op against the file as it is now, on the node found again in it.
   * The map's line numbers are from its last render, and a render is debounced
   * behind an edit in the Markdown pane - so by the time a click reaches an op,
   * the file may already be a few lines off.
   */
  private async applyToNodes(
    nodes: (MindNode | null)[],
    mutate: (lines: string[], found: MindNode[]) => string[],
  ): Promise<void> {
    await this.applyOp((lines) => {
      const fresh = parseMarkdown(lines.join('\n'), this.file?.basename ?? '');
      const found = nodes.map((n) => (n ? relocateNode(fresh, n) : null));
      const lost = nodes.find((n, i) => n && !found[i]);

      if (lost) {
        throw new Error(`Mindmap: "${lost.text}" is no longer in the file`);
      }

      return mutate(lines, found as MindNode[]);
    });
  }

  /**
   * Every write the map makes goes through here. One with no editor pane
   * behind it has no history to step, so the map keeps that one step itself.
   */
  private async writeFile(
    file: TFile,
    mutate: (lines: string[]) => string[],
  ): Promise<void> {
    const wrote = await updateFileLines(this.app, file, mutate);

    this.undoable = wrote ? { path: file.path, ...wrote } : null;
  }

  /**
   * Puts back the last write the map made straight to the file, which happens
   * when the note is only open in a reading pane - Obsidian keeps no history
   * for those, and a delete from the map would otherwise be final.
   *
   * Only while the file still says what that write left, so it can never undo
   * over something changed since, and only once: what was put back is what the
   * map now shows, and the step is spent.
   */
  private undoLastWrite(): boolean {
    const kept = this.undoable;
    const file = this.file;

    if (!kept || !file || file.path !== kept.path) {
      return false;
    }
    void (async () => {
      if ((await this.app.vault.read(file)) !== kept.after) {
        new Notice('Mind map: the file has changed since, so it was left be.');
        this.undoable = null;

        return;
      }
      await this.app.vault.modify(file, kept.before);
      this.undoable = null;
      new Notice('Mind map: undid the last change.');
      await this.render();
    })();

    return true;
  }

  private async applyOp(mutate: (lines: string[]) => string[]): Promise<void> {
    if (!this.file) {
      return;
    }
    try {
      await this.writeFile(this.file, mutate);
    } catch (err) {
      this.reportOpError(err);
    }
    // Render unconditionally so a failed edit never leaves the map
    // showing stale nodes (whose line numbers no longer match the file).
    await this.render();
  }

  private reportOpError(err: unknown): void {
    console.error('Mindmap: failed to update the file', err);
    new Notice(
      'Mind map: the file changed while editing; the map was refreshed. Please retry.',
    );
  }

  private startInlineEdit(node: MindNode, el: HTMLElement): void {
    if (this.isBusy() || !this.file) {
      return;
    }
    // The note's own pill says the file's name, which is no line in it: there
    // is nothing for a write to aim at, so an editor here would take text the
    // file never sees. The menu already leaves the root out; this is the same
    // rule for a double-click and for F2.
    if (node.type === 'root') {
      return;
    }
    const file = this.file;
    // The caller's node/el may be stale: closures from a context menu or
    // dblclick outlive re-renders. Remap to the current DOM element, and
    // never start on a detached one — its input can't take focus, so
    // blur would never fire and isInlineEditing would stick, freezing
    // the map (no renders, no drag, no further edits).
    const laid = this.laidByLine.get(node.line);

    if (laid) {
      node = laid.node;
      el = laid.el;
    }
    if (!el.isConnected) {
      return;
    }
    const textEl = el.querySelector<HTMLElement>('.mindmap-node-text');

    if (!textEl) {
      return;
    }
    // Edit in a span carrying the same text styles as the label it
    // replaces, so the node keeps the same size while editing and after
    // confirming (an <input> has a fixed width and cannot wrap).
    const input = el.createSpan({
      cls: `mindmap-node-text ${EDIT_INPUT}`,
    });

    let label = node.text;

    input.textContent = node.text;
    // Exactly the label's place, so the node's contents do not shift.
    textEl.after(input);
    textEl.hide();
    this.closeEdit = runEditor({
      ...this.editSession(),
      input,
      value: () => singleLineValue(input.innerText),
      placeCaret: () => caretAtEnd(input),
      restore: () => {
        this.closeEdit = null;
        input.remove();
        textEl.show();
      },
      // What the file says this node is called, kept up as it is typed: the
      // next write has to find the node by the name the last one gave it.
      write: (value) => {
        if (value === label || !value) {
          return;
        }
        const named = { ...node, text: label };

        void this.writeEdit(file, (lines, fresh) => {
          const target = relocateNode(fresh, named);

          if (!target) {
            throw new Error(`Mindmap: "${label}" is no longer in the file`);
          }

          return setTextOp(lines, target, value);
        }).then((ok) => {
          if (ok) {
            label = value;
          }
        });
      },
    });
  }

  /**
   * Writes what an editor is holding. Renders are held off while editing, so
   * the map's line numbers are from when it opened and the file may have moved
   * on - every `mutate` is handed a fresh parse to aim itself at. False when
   * the file no longer has what the edit was made against, which is a conflict
   * rather than a mistake: the text goes to the clipboard and the map catches
   * up with the file.
   */
  private async writeEdit(
    file: TFile,
    mutate: (lines: string[], fresh: MindNode) => string[],
  ): Promise<boolean> {
    try {
      await this.writeFile(file, (lines) =>
        mutate(lines, parseMarkdown(lines.join('\n'), file.basename)),
      );
    } catch (err) {
      console.error('Mindmap: failed to write the edit', err);

      return false;
    }
    await this.render();

    return true;
  }

  /** The half of an inline edit every editor shares; see ./inline-edit.ts. */
  private editSession(): Pick<EditSession, 'setEditing' | 'reflow' | 'settle'> {
    return {
      setEditing: (editing) => {
        this.isInlineEditing = editing;
      },
      reflow: () => this.reflow(),
      settle: () => {
        if (!this.renderQueued) {
          return false;
        }
        void this.render();

        return true;
      },
    };
  }

  private async moveNode(
    source: MindNode,
    target: MindNode,
    before: MindNode | null = null,
  ): Promise<void> {
    if (!canDrop(source, target)) {
      new Notice('This node cannot be dropped there.');

      return;
    }
    this.selectedLine = null;
    await this.applyToNodes([source, target, before], (lines, found) =>
      moveNodeOp(lines, found[0]!, found[1]!, found[2] ?? null),
    );
  }

  /** The pointer handling for a node drag lives in ./drag.ts. */
  private setupDrag(node: MindNode, el: HTMLElement): void {
    setupNodeDrag(
      {
        canvasEl: this.canvasEl,
        nodes: this.laidByLine,
        isEditing: () => this.isInlineEditing,
        setDragging: (dragging) => {
          this.isDragging = dragging;
        },
        drop: (source, target, before) =>
          void this.moveNode(source, target, before),
        settle: () => {
          if (this.renderQueued) {
            void this.render();
          }
        },
      },
      node,
      el,
    );
  }

  private onBackgroundPointerDown(e: PointerEvent): void {
    // Pan with the main button only; side buttons (3/4) belong to the
    // history handler and must not grab pointer capture here.
    if (e.button !== 0 || e.pointerType === 'touch') {
      return;
    }
    if (e.target instanceof HTMLElement && e.target.closest('.mindmap-node')) {
      return;
    }
    this.selectedLine = null;
    this.clearSelectionClass();
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = this.scrollerEl.scrollLeft;
    const startTop = this.scrollerEl.scrollTop;
    const onMove = (ev: PointerEvent): void => {
      this.scrollerEl.scrollLeft = startLeft - (ev.clientX - startX);
      this.scrollerEl.scrollTop = startTop - (ev.clientY - startY);
    };
    const onUp = (): void => {
      this.scrollerEl.removeClass('is-panning');
      this.scrollerEl.removeEventListener('pointermove', onMove);
      this.scrollerEl.removeEventListener('pointerup', onUp);
      this.scrollerEl.removeEventListener('pointercancel', onUp);
    };

    this.scrollerEl.addClass('is-panning');
    this.scrollerEl.setPointerCapture(e.pointerId);
    this.scrollerEl.addEventListener('pointermove', onMove);
    this.scrollerEl.addEventListener('pointerup', onUp);
    this.scrollerEl.addEventListener('pointercancel', onUp);
  }
}
