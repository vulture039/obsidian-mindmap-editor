import {
  debounce,
  ItemView,
  MarkdownView,
  Menu,
  Modifier,
  Notice,
  Scope,
  setIcon,
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
import { FENCE_RE } from '../../core/parse/patterns';
import { relocateNode, relocateTaskNode } from '../../core/write/relocate';
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
import { clampZoom, MAX_ZOOM } from '../../core/render/zoom';
import { mirrorCursorInBody } from '../../core/render/mirror-cursor';
import {
  NodeColor,
  nodeColorFor,
  parsePalette,
  rungBelow,
} from '../../core/render/colors';
import { renderNodeText } from './node-text';
import { canDrop } from '../../core/render/drag';
import { singleLineValue } from '../../core/write/edit-value';
import { taskEditUpdates, taskProgress } from '../../core/tasks';
import {
  formatTaskMetadata,
  priorityMark,
  TaskMetadata,
  TaskPriority,
} from '../../core/task-metadata';
import { DRAGGING_SELECTOR, setupNodeDrag } from './drag';
import { EditorPane } from '../markdown/editor-pane';
import { blockOf, clearPreviewLine } from '../markdown/preview-line';
import { caretAtEnd, EditSession, runEditor } from './inline-edit';
import { MapViewport } from './viewport';
import {
  anchorFor,
  NodeBookmark,
  resolveAnchor,
  trackAnchor,
} from '../../core/bookmarks';
import { BookmarkNameModal } from '../bookmarks';
import {
  readViewportState,
  ViewportState,
} from '../../core/render/viewport-state';
import {
  addChildOp,
  addSiblingOp,
  addTaskNoteOp,
  deleteNodeOp,
  deleteNodesOp,
  InsertResult,
  moveNodesOp,
  reorderSiblingOp,
  setTaskTreeCheckboxOp,
  setTaskMetadataOp,
  setTextOp,
  syncTaskParentsOp,
  toggleTaskOp,
} from '../../core/write/ops';
import {
  findEditingView,
  findFocusedEditingView,
  findMarkdownView,
  updateFileLines,
  WroteToDisk,
} from '../markdown/file-io';

export const VIEW_TYPE_MINDMAP = 'mindmap-editor';
export const MINDMAP_ICON = 'workflow';

const VIEWPORT_SETTLE_INTERVAL_MS = 16;
const VIEWPORT_STABLE_SAMPLES = 6;
const ORDERED_LABEL = /^\d+[.)](?:\s+|$)/;

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
const EDGE_ENTRY_RUN = 8;

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
  const entryRun = Math.min(EDGE_ENTRY_RUN, run * 0.25);
  const curveEnd = x2 - entryRun;
  const curveRun = curveEnd - x1;
  const lead = Math.min(curveRun * 0.25, BEND_LEAD);
  const settle = Math.min(curveRun * 0.45, BEND_SETTLE);

  return (
    `M ${x1} ${y1} C ${x1 + lead} ${y1}, ` +
    `${x1 + settle} ${y2}, ${curveEnd} ${y2} H ${x2}`
  );
}

/** Classes the view both writes and looks for again. */
const EDIT_INPUT = 'mindmap-edit-input';
const HEAD = 'mindmap-node-head';
const BODY = 'mindmap-node-body';
const BODY_LINE = 'mindmap-node-body-line';
const MIRROR_EDITOR_OWNERS = new WeakMap<MarkdownView, MindmapView>();

/** Just enough scrolling to bring something into view, and no more. */
const KEEP_IN_VIEW: ScrollIntoViewOptions = {
  block: 'nearest',
  inline: 'nearest',
};

/** One word for one thing: the tab menu, the command and this all say link. */
const LINK_LABEL = 'Link this map to its note';

/** How long the map waits before redrawing after a change to the file. */
const RENDER_DELAY = 80;

/** How long after a click or key it looks for a fold the user just made. */
const FOLD_CHECK_DELAY = 120;

/** How long an inline edit may grow before the map is laid out again. */
const REFLOW_DELAY = 60;

/** Do not hold a map blank indefinitely for a slow or unreachable image. */
const IMAGE_LAYOUT_WAIT = 1000;

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
  taskMetadata: null,
  children: [],
  parent: null,
};

export class MindmapView extends ItemView {
  private readonly plugin: MindmapPlugin;
  private file: TFile | null = null;
  private root: MindNode | null = null;
  /** Markdown revision that produced `root`; bookmark tracking starts here. */
  private renderedSource = '';
  private scrollerEl!: HTMLElement;
  private canvasEl!: HTMLElement;
  private selectedLine: number | null = null;
  private readonly selectedLines = new Set<number>();
  /** File line the editor's caret was last seen on; re-marked after a render. */
  private cursorLine: number | null = null;
  /** Read-only mirror of Obsidian's caret; these nodes restore the rich text. */
  private mirroredCursor: { el: HTMLElement; contents: Node[] } | null = null;
  /** Source pane whose body edit this map currently owns. */
  private mirrorEditorView: MarkdownView | null = null;
  /** Enter handlers installed on the source pane that owns the keyboard. */
  private mirrorEditorKeys: {
    scope: Scope;
    handlers: ReturnType<Scope['register']>[];
  } | null = null;
  /** Body run whose trailing blank lines stay visible while it is edited. */
  private pendingBodyLine: {
    path: string;
    ownerLine: number;
    line: number;
  } | null = null;
  /** A just-added node, to select and open for naming after the render. */
  private insertedLine: number | null = null;
  /** The last write the map made with no editor pane to remember it. */
  private undoable: (WroteToDisk & { path: string }) | null = null;
  /** Ends the edit on screen, for when the map is asked for its keyboard back. */
  private closeEdit: (() => void) | null = null;
  private isInlineEditing = false;
  private isDragging = false;
  private renderQueued = false;
  private syncingTasks = false;
  private renderSeq = 0;
  /** Render generation collecting async Markdown before its first layout. */
  private layoutBuildSeq: number | null = null;
  private pendingTextRenders: Promise<void>[] | null = null;
  /** Last complete frame kept visible while its replacement is measured. */
  private renderSnapshot: HTMLElement | null = null;
  private laidByLine = new Map<number, LaidNode>();
  /** Last built tree, so an edit can re-lay it out without rebuilding it. */
  private laidRoot: LaidNode | null = null;
  private hideCompletedActionEl: HTMLElement | null = null;
  private bodyTextActionEl: HTMLElement | null = null;
  private priorityMenu: Menu | null = null;
  private taskDatePicker: HTMLInputElement | null = null;
  private linkActionEl: HTMLElement | null = null;
  private autoOpenActionEl: HTMLElement | null = null;
  private viewport!: MapViewport;
  /** Last Markdown source observed for this map's Obsidian Link group. */
  private linkedSourceLeaf: WorkspaceLeaf | null = null;
  /** Markdown leaf opened from this map, retained while it closes. */
  private mapDrivenSourceLeaf: WorkspaceLeaf | null = null;
  /** Restored before the viewport DOM exists during workspace startup. */
  private savedZoom = 1;
  private hasRestoredViewport = false;
  private viewportReady = false;
  private lastViewport: ViewportState | null = null;
  private persistViewport = debounce(() => this.saveViewport(), 200, true);

  /** A revealed pane waits for its first visible, stable layout to frame it. */
  private revealPending:
    | { kind: 'center' }
    | { kind: 'initial'; cursorLine: number | null }
    | { kind: 'restore'; position: ViewportState }
    | null = null;
  private revealTimer: number | null = null;
  private revealSize: string | null = null;
  private revealStableSamples = 0;
  /** A node selected while Markdown opens waits for the map's new width. */
  private selectedNodeReveal: {
    line: number;
    size: string;
    stable: number;
    requireSelection: boolean;
  } | null = null;
  private selectedNodeRevealTimer: number | null = null;
  /** How many `pointEditorAtFile` calls this map has in flight. */
  private pointing = 0;
  /** Changes when a body interaction deliberately hands focus to Markdown. */
  private bodyEditSeq = 0;
  private returningFromBodyEdit = false;
  private composing = false;
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
    this.scope?.register(mods, key, (event) => {
      const input = this.canvasEl.querySelector(`.${EDIT_INPUT}`);
      const active = this.canvasEl.doc.activeElement;
      const markdown = this.file && findFocusedEditingView(this.app, this.file);
      const bodyEditor = this.mirrorEditorView;

      if (key === 'Enter' && event.isComposing) {
        return true;
      }
      if (
        active?.matches('.mindmap-task-date-trigger, .mindmap-task-date-picker')
      ) {
        return true;
      }

      // A mirrored edit still belongs entirely to Obsidian's editor. Let its
      // keymap handle Enter and every other key the map normally claims. The
      // visible mirror is also enough: focus reporting can lag the keydown.
      if (
        this.mirroredCursor?.el.isConnected ||
        (bodyEditor !== null &&
          bodyEditor.file?.path === this.file?.path &&
          bodyEditor.editor.hasFocus()) ||
        (!this.containerEl.contains(active) &&
          markdown &&
          markdown.file?.path === this.file?.path &&
          markdown.getMode() === 'source' &&
          markdown.editor.hasFocus())
      ) {
        if (key === 'Enter' && this.insertMirroredLine()) {
          return false;
        }

        return true;
      }

      // Only while the edit has the keyboard. An editor left open with the
      // focus elsewhere is not who the key is for - and taking every key for
      // it would leave the map with none.
      if (!input || input.doc.activeElement !== input) {
        return run();
      }
      // Obsidian consumes Escape before the document capture listener in
      // some releases, so finish the edit from the scope that saw it.
      if (key === 'Escape') {
        this.closeEdit?.();

        return false;
      }

      return true;
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
    // Obsidian normally treats Shift+Enter differently. In a mirrored body,
    // both keys mean the same continuation line; outside one it passes on.
    this.onKey(['Shift'], 'Enter', () => true);
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
        const nodes = this.selectedNodes();

        if (!nodes.length || nodes.some((node) => node.type === 'root')) {
          return true;
        }
        this.selectOnly(null);
        void this.applyToNodes(nodes, (lines, found) =>
          deleteNodesOp(lines, found),
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
    this.onKey(['Shift'], 'F2', () => {
      const node = this.selectedNode();

      if (!node) {
        return true;
      }
      void this.editNodeNote(node);

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
    this.onKey(['Mod'], 'B', () => {
      const node = this.selectedNode();

      if (!node || node.type === 'root' || !this.file) {
        return true;
      }
      const bookmark = this.bookmarkFor(node);

      if (bookmark) {
        void this.plugin.removeBookmark(bookmark.id);
      } else {
        void this.addNodeBookmark(node);
      }

      return false;
    });
    this.onKey([], 'Escape', () => {
      // A flag left set with no editor on screen: the edit is over, and this
      // is what unfreezes the map. An editor that is still there kept the key
      // to itself, and never reached here.
      if (this.isInlineEditing) {
        this.isInlineEditing = false;
        void this.render();

        return false;
      }
      if (this.clearBodyLineSelection()) {
        return false;
      }
      if (this.selectedLine === null) {
        return true;
      }
      this.selectOnly(null);
      this.clearSelectionClass();

      return false;
    });
  }

  /** Adds a body line when the map, rather than Markdown, holds the key. */
  private insertMirroredLine(): boolean {
    const file = this.file;
    const view = this.mirrorEditorView;

    if (
      !file ||
      !view ||
      view.file?.path !== file.path ||
      MIRROR_EDITOR_OWNERS.get(view) !== this ||
      view.editor.somethingSelected()
    ) {
      return false;
    }
    const cursor = view.editor.getCursor();
    const current = view.editor.getLine(cursor.line);
    let indent = /^\s*/.exec(current)?.[0] ?? '';

    if (!current.trim() && this.root) {
      const node = findEnclosing(this.root, cursor.line);
      const first = Math.max(0, node?.line ?? 0);
      const last = Math.min(
        view.editor.lastLine(),
        node?.endLine ?? cursor.line,
      );

      for (let distance = 1; distance <= last - first + 1; distance++) {
        const source = [cursor.line - distance, cursor.line + distance].find(
          (line) =>
            line >= first &&
            line <= last &&
            view.editor.getLine(line).trim().length > 0,
        );

        if (source !== undefined) {
          indent = /^\s*/.exec(view.editor.getLine(source))?.[0] ?? '';

          break;
        }
      }
    }
    view.editor.replaceRange(`\n${indent}`, cursor);
    view.editor.setCursor({ line: cursor.line + 1, ch: indent.length });

    return true;
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
    const mdView =
      findFocusedEditingView(this.app, this.file) ??
      (this.mirroredCursor
        ? findEditingView(this.app, this.file, this.leaf)
        : null) ??
      this.app.workspace.getActiveViewOfType(MarkdownView);

    if (mdView?.file?.path !== this.file.path) {
      return;
    }
    const cursorLine = mdView.editor.getCursor().line;

    // An insertion shifts every line below it before the debounced render has
    // rebuilt the tree. Remember the caret, but never select against that
    // stale line map: Shift+Enter would flash the following node as selected.
    if (mdView.editor.getValue() !== this.renderedSource) {
      this.cursorLine = cursorLine;
      this.requestRender();

      return;
    }

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
    this.selectOnly(laid.node.line);
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
    this.mirrorEditorCursor();
    if (moved) {
      el?.scrollIntoView(KEEP_IN_VIEW);
    }
  }

  /** Leaves the node selected while stepping out of its selected body line. */
  private clearBodyLineSelection(): boolean {
    const selected = this.canvasEl.querySelectorAll(
      `.${BODY_LINE}.is-cursor-line`,
    );

    if (!selected.length) {
      return false;
    }
    selected.forEach((line) => line.removeClass('is-cursor-line'));
    this.cursorLine = null;

    return true;
  }

  /** Restores the rendered Markdown replaced by the read-only editing mirror. */
  private clearMirroredCursor(keepBodyEdit = false): void {
    const mirrored = this.mirroredCursor;

    if (!mirrored?.el.isConnected) {
      this.mirroredCursor = null;

      return;
    }
    mirrored.el.replaceChildren(
      ...mirrored.contents.map((node) => node.cloneNode(true)),
    );
    mirrored.el.removeClass('is-mirror-editing');
    if (!keepBodyEdit) {
      this.mirroredCursor = null;
    }
  }

  /** Blank lines kept visible while a newly added task note is being typed. */
  private pendingBodyLines(node: MindNode): { line: number; text: string }[] {
    const pending = this.pendingBodyLine;

    if (
      !pending ||
      pending.path !== this.file?.path ||
      pending.ownerLine !== node.line
    ) {
      return [];
    }
    const source = this.renderedSource.split(/\r?\n/);
    const lines: { line: number; text: string }[] = [];

    for (let line = pending.line; line < source.length; line++) {
      if (node.body.some((body) => body.line === line)) {
        continue;
      }
      if (/^\s*$/.test(source[line] ?? '\u0000')) {
        lines.push({ line, text: '' });

        continue;
      }
      break;
    }

    return lines;
  }

  /**
   * Mirrors the focused Markdown editor without writing anything back. A
   * broken or stale mirror can therefore only affect this temporary display.
   */
  private mirrorEditorCursor(): void {
    if (
      !this.mirrorEditorView &&
      this.containerEl.contains(this.containerEl.doc.activeElement)
    ) {
      this.clearMirroredCursor();

      return;
    }
    const view = this.file && findFocusedEditingView(this.app, this.file);

    if (!view?.file || view.file.path !== this.file?.path) {
      // Focus can briefly disappear while Obsidian moves it into its editor.
      // The explicit map-selection and Escape paths end the editing session.
      this.clearMirroredCursor();

      return;
    }
    const cursor = view.editor.getCursor();
    const lineEl = this.canvasEl.querySelector<HTMLElement>(
      `.${BODY_LINE}[data-line="${cursor.line}"]`,
    );
    const node = this.root && findEnclosing(this.root, cursor.line);
    const body =
      node?.body.find((item) => item.line === cursor.line) ??
      (this.pendingBodyLine &&
      cursor.line >= this.pendingBodyLine.line &&
      /^\s*$/.test(this.renderedSource.split(/\r?\n/)[cursor.line] ?? '\u0000')
        ? { line: cursor.line, text: '' }
        : undefined);

    if (!lineEl || !body) {
      this.clearMirroredCursor();

      return;
    }
    if (this.mirroredCursor?.el !== lineEl) {
      this.clearMirroredCursor();
      this.mirroredCursor = {
        el: lineEl,
        contents: [...lineEl.childNodes].map((child) => child.cloneNode(true)),
      };
    }
    const renderedSource =
      this.renderedSource.split(/\r?\n/)[cursor.line] ?? '';
    const composingLine = this.composing
      ? view.containerEl.querySelector<HTMLElement>('.cm-activeLine')
          ?.textContent
      : null;
    const mirrored = mirrorCursorInBody(
      composingLine ?? view.editor.getLine(cursor.line),
      cursor.ch,
      renderedSource,
      body.text,
      /^\s*/.exec(lineEl.textContent ?? '')?.[0] ?? '',
    );
    const before = lineEl.doc.createTextNode(mirrored.before);
    const caret = lineEl.createSpan();
    const after = lineEl.doc.createTextNode(mirrored.after);

    caret.addClass('mindmap-mirrored-caret');
    caret.setAttribute('aria-hidden', 'true');
    lineEl.replaceChildren(before, caret, after);
    lineEl.addClass('is-mirror-editing');
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
    this.selectOnly(null);
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
    this.selectOnly(
      delta < 0 ? other.line : node.line + (other.endLine - node.endLine),
    );
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
      setTaskTreeCheckboxOp(lines, target!, cb.checked),
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

  /** Replaces a multi-selection with one node, or clears it. */
  private selectOnly(line: number | null): void {
    this.selectedLine = line;
    this.selectedLines.clear();
    if (line !== null) {
      this.selectedLines.add(line);
    }
  }

  private selectedNode(): MindNode | null {
    if (
      this.isInlineEditing ||
      !this.root ||
      this.selectedLine === null ||
      this.selectedLines.size !== 1
    ) {
      return null;
    }

    return findByLine(this.root, this.selectedLine);
  }

  private selectedNodes(): MindNode[] {
    if (this.isInlineEditing || !this.root) {
      return [];
    }

    return [...this.selectedLines]
      .sort((a, b) => a - b)
      .map((line) => findByLine(this.root!, line))
      .filter((node): node is MindNode => !!node);
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
    return MINDMAP_ICON;
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
      this.selectOnly(standIn.line);
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

  private async toggleAutoOpen(): Promise<void> {
    const enable = !this.plugin.isAutoOpenFile(this.file);

    await this.plugin.toggleAutoOpen(this.file);
    if (enable && !this.plugin.isMobile) {
      await this.linkToEditor();
    }
    this.syncToggleActions();
  }

  /** Lights up the header buttons that stand for what this map is showing. */
  private syncToggleActions(): void {
    const text = this.showBodyText;
    const linked = !!this.editor.linkedLeaf();
    const autoOpen = this.plugin.isAutoOpenFile(this.file);

    this.linkActionEl?.toggleClass('is-active', linked);
    this.linkActionEl?.setAttribute(
      'aria-label',
      linked ? 'Unlink this map, so it follows the active file' : LINK_LABEL,
    );
    this.autoOpenActionEl?.toggleClass('is-active', autoOpen);
    this.autoOpenActionEl?.setAttribute(
      'aria-label',
      autoOpen
        ? 'Stop opening this map automatically with the note'
        : 'Open this map automatically with the note',
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
    this.autoOpenActionEl = this.addAction(
      'file-check-2',
      'Open this map automatically with the note',
      () => void this.toggleAutoOpen(),
    );
    this.addAction('bookmark', 'Node bookmarks', (event) =>
      this.showBookmarksMenu(event),
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
    this.addAction('focus', 'Fit mind map to viewport', () => this.fit());
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
    this.registerDomEvent(this.scrollerEl, 'scroll', () => {
      if (this.canCaptureViewport) {
        this.lastViewport = this.viewport.snapshot();
        this.persistViewport();
      }
    });
    this.register(() => this.persistViewport.cancel());
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
    this.saveViewport();
    this.persistViewport.cancel();
    this.taskDatePicker?.remove();
    this.taskDatePicker = null;
    this.endBodyEdit();
    if (this.revealTimer !== null) {
      this.containerEl.win.clearTimeout(this.revealTimer);
    }
    this.cancelSelectedNodeReveal();
    this.finishRenderStaging();
    this.viewport?.destroy();
    clearPreviewLine();
  }

  /**
   * Wires the vault/workspace events that keep the map in sync: re-render on
   * edits, track the last-focused Markdown pane, follow the active file, pan
   * on background drag, and remember the split direction.
   */
  private registerWorkspaceEvents(): void {
    this.linkedSourceLeaf = this.editor.linkedLeaf();
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
          this.followEditorCursor();
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
        const editorStillOpen = this.editor.hasOpenLastActive();
        const returning = this.returningFromBodyEdit;

        this.returningFromBodyEdit = false;
        this.editor.noteActiveLeaf(leaf);
        this.mirrorEditorCursor();
        // Selecting a map tab points the Markdown side at its note. Closing
        // the last-active Markdown tab can also activate this map, but that
        // must not recreate the pane the user just closed.
        if (
          leaf === this.leaf &&
          editorStillOpen &&
          !returning &&
          !this.plugin.isMobile
        ) {
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
        this.linkedSourceLeaf =
          this.editor.linkedLeaf() ?? this.linkedSourceLeaf;
        this.syncToggleActions();
        this.followFile(this.app.workspace.getActiveFile());
      }),
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () =>
        this.handleLinkedSourceClose(),
      ),
    );
    this.registerDomEvent(this.scrollerEl, 'pointerdown', (e) =>
      this.onBackgroundPointerDown(e),
    );
    // The caret moving in an editor fires no workspace event, but it does
    // move the document selection, which does.
    this.everyDocument(['selectionchange'], () => {
      this.followEditorCursor();
    });
    this.everyDocument(
      ['compositionstart', 'compositionupdate', 'compositionend'],
      (event) => {
        this.composing = event.type !== 'compositionend';
        this.mirrorEditorCursor();
      },
    );
    this.everyDocument(
      ['keydown'],
      (event) => {
        if (event.key === 'Escape' && this.returnFromBodyEdit(event.target)) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      { capture: true },
    );
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

  /** Handle the map after its linked Markdown source tab closes. */
  private handleLinkedSourceClose(): void {
    const linked = this.editor.linkedLeaf();

    if (linked) {
      this.linkedSourceLeaf = linked;

      return;
    }
    const previous = this.linkedSourceLeaf;

    if (!previous) {
      return;
    }
    this.linkedSourceLeaf = null;
    if (!this.app.workspace.getLeavesOfType('markdown').includes(previous)) {
      if (this.plugin.settings.closeLinkedMapWithSource) {
        this.leaf.detach();

        return;
      }
      this.scrollerEl.removeClass('is-positioning');
      this.revealSelectedNodeAfterPaneChange(this.selectedLine);
    }
  }

  /**
   * A listener in every window's document: a caret moves and a fold handle is
   * clicked in the editor's, and a popout has one of its own.
   */
  private everyDocument<K extends keyof DocumentEventMap>(
    types: readonly K[],
    run: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    const listening = new Set<Document>();
    const listen = (doc: Document): void => {
      if (listening.has(doc)) {
        return;
      }
      listening.add(doc);
      for (const type of types) {
        this.registerDomEvent(doc, type, run, options);
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

  private get canCaptureViewport(): boolean {
    return (
      this.viewportReady &&
      !this.revealPending &&
      !this.renderQueued &&
      this.layoutBuildSeq === null &&
      this.contentEl.offsetHeight > 0 &&
      this.viewport.canCapturePosition
    );
  }

  private saveViewport(): void {
    const file = this.file;
    const canSave = file !== null && this.viewportReady;

    if (!canSave) {
      return;
    }
    const position = this.captureViewport();

    if (position) {
      this.app.saveLocalStorage(
        `mindmap-editor:viewport:${file.path}`,
        position,
      );
      this.app.workspace.requestSaveLayout();
    }
  }

  private captureViewport(): ViewportState | null {
    if (this.revealPending?.kind === 'restore') {
      return this.revealPending.position;
    }
    if (this.canCaptureViewport) {
      this.lastViewport = this.viewport.snapshot();
    }

    return this.lastViewport;
  }

  getState(): Record<string, unknown> {
    const position = this.captureViewport();

    return {
      file: this.file?.path ?? null,
      hideCompleted: this.hideCompleted,
      showBodyText: this.showBodyText,
      zoom: position?.zoom ?? this.viewport?.value ?? this.savedZoom,
      viewport: position,
    };
  }

  /** Live-only state used when Obsidian transfers this view to another leaf. */
  getEphemeralState(): Record<string, unknown> {
    return {
      ...super.getEphemeralState(),
      viewport: this.captureViewport(),
    };
  }

  setEphemeralState(state: unknown): void {
    super.setEphemeralState(state);
    const shown = (state ?? {}) as Record<string, unknown>;
    const position = readViewportState(shown.viewport);

    if (position) {
      this.scrollerEl.addClass('is-positioning');
      this.hasRestoredViewport = false;
      this.revealPending = { kind: 'restore', position };
      this.revealAfterLayout();
    }
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    // What this pane was left drawing, which is its own and not the settings'.
    const shown = (state ?? {}) as Record<string, unknown>;
    const zoom =
      typeof shown.zoom === 'number' && Number.isFinite(shown.zoom)
        ? clampZoom(shown.zoom)
        : null;
    const updatingVisibleViewport =
      zoom !== null &&
      this.canCaptureViewport &&
      (!shown.file || shown.file === this.file?.path);

    if (typeof shown.hideCompleted === 'boolean') {
      this.hideCompleted = shown.hideCompleted;
    }
    if (typeof shown.showBodyText === 'boolean') {
      this.showBodyText = shown.showBodyText;
    }
    this.syncToggleActions();
    if (typeof shown.file === 'string') {
      const af = this.app.vault.getAbstractFileByPath(shown.file);

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
    if (zoom !== null) {
      this.savedZoom = zoom;
      this.viewport?.restore(zoom);
    }
    const position = readViewportState(shown.viewport);

    if (position) {
      const restored = { ...position, zoom: zoom ?? position.zoom };

      if (updatingVisibleViewport) {
        // Live zoom/state updates are not an opening or a layout transition.
        this.viewport.restorePosition(restored);
        this.lastViewport = this.viewport.snapshot();
      } else {
        this.scrollerEl.addClass('is-positioning');
        this.hasRestoredViewport = false;
        this.revealPending = { kind: 'restore', position: restored };
        this.revealAfterLayout();
      }
    }
    await super.setState(state, result);
  }

  async setFile(file: TFile): Promise<void> {
    this.saveViewport();
    this.persistViewport.cancel();
    this.viewportReady = false;
    this.hasRestoredViewport = false;
    this.lastViewport = null;
    let position: ViewportState | null = null;

    position = readViewportState(
      this.app.loadLocalStorage(`mindmap-editor:viewport:${file.path}`),
    );

    if (!position) {
      // Do not carry a remembered map's zoom into an ordinary one.
      this.savedZoom = 1;
      this.viewport?.restore(1);
    }

    this.revealPending = null;
    if (this.revealTimer !== null) {
      this.containerEl.win.clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
    this.file = file;
    this.scrollerEl.addClass('is-positioning');
    // File changes and workspace restoration can bypass the opening command.
    if (position) {
      this.revealPending = { kind: 'restore', position };
    } else {
      this.revealPending = { kind: 'initial', cursorLine: null };
    }
    this.syncToggleActions();
    this.selectOnly(null);
    this.cursorLine = null;
    this.expandedDone.clear();
    this.collapsedBranches.clear();
    this.foldedText.clear();
    this.lastEditorFoldsKey = null;
    await this.render(true);
    await this.loadStoredCollapse();
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

  /** Fits the complete map inside the viewport and centers it. */
  fit(): void {
    this.viewport.fit();
  }

  /** Centers a revealed map after its first visible render settles. */
  private centerAfterReveal(): void {
    this.scrollerEl.addClass('is-positioning');
    this.revealPending = { kind: 'center' };
    this.revealAfterLayout();
  }

  /** Reopenings resume their viewport; first openings frame the caret. */
  initialViewportAfterReveal(cursorLine: number | null): void {
    const restored =
      this.hasRestoredViewport || this.revealPending?.kind === 'restore';

    if (restored) {
      this.revealAfterLayout();

      return;
    }
    // setFile may have fitted the map while the opening command awaited the
    // pane reveal. Cursor-based ordinary openings start at their normal scale,
    // then center the cursor without changing it.
    if (cursorLine !== null && !restored) {
      this.savedZoom = 1;
      this.viewport.restore(1);
    }
    this.scrollerEl.addClass('is-positioning');
    this.revealPending = { kind: 'initial', cursorLine };
    this.revealAfterLayout();
  }

  private revealAfterLayout(): void {
    if (this.renderQueued && this.contentEl.offsetHeight > 0) {
      void this.render();

      return;
    }
    this.schedulePendingReveal();
  }

  private schedulePendingReveal(): void {
    if (
      !this.revealPending ||
      this.renderQueued ||
      this.layoutBuildSeq !== null ||
      !this.laidRoot ||
      this.contentEl.offsetHeight === 0
    ) {
      return;
    }
    const seq = this.renderSeq;
    const win = this.containerEl.win;

    if (this.revealTimer !== null) {
      win.clearTimeout(this.revealTimer);
    }
    this.revealSize = `${this.scrollerEl.clientWidth}:${this.scrollerEl.clientHeight}`;
    this.revealStableSamples = 0;
    this.revealTimer = win.setTimeout(
      () => this.checkViewportSettled(seq),
      VIEWPORT_SETTLE_INTERVAL_MS,
    );
  }

  private checkViewportSettled(seq: number): void {
    this.revealTimer = null;
    if (
      !this.revealPending ||
      seq !== this.renderSeq ||
      this.renderQueued ||
      this.layoutBuildSeq !== null ||
      this.contentEl.offsetHeight === 0
    ) {
      return;
    }
    const size = `${this.scrollerEl.clientWidth}:${this.scrollerEl.clientHeight}`;

    if (size === this.revealSize) {
      this.revealStableSamples += 1;
    } else {
      this.revealSize = size;
      this.revealStableSamples = 0;
    }
    if (this.revealStableSamples >= VIEWPORT_STABLE_SAMPLES) {
      this.finishPendingReveal();

      return;
    }
    this.revealTimer = this.containerEl.win.setTimeout(
      () => this.checkViewportSettled(seq),
      VIEWPORT_SETTLE_INTERVAL_MS,
    );
  }

  private finishPendingReveal(): void {
    this.scrollerEl.removeClass('is-positioning');
    this.applyPendingReveal();
    this.revealPending = null;
    this.saveViewport();
  }

  /** Centers a selected node only after opening Markdown settles the split. */
  private revealSelectedNodeAfterPaneChange(line: number | null): void {
    if (line === null) {
      this.centerAfterReveal();

      return;
    }
    this.revealNodeAfterPaneChange(line, true);
  }

  /** Keeps a node visible after an action whose caret may select its parent. */
  private revealNodeAfterPaneChange(
    line: number | null,
    requireSelection: boolean,
  ): void {
    this.cancelSelectedNodeReveal();
    if (line === null) {
      return;
    }
    this.selectedNodeReveal = {
      line,
      size: `${this.scrollerEl.clientWidth}:${this.scrollerEl.clientHeight}`,
      stable: 0,
      requireSelection,
    };
    this.scheduleSelectedNodeReveal();
  }

  private scheduleSelectedNodeReveal(): void {
    if (!this.selectedNodeReveal || this.selectedNodeRevealTimer !== null) {
      return;
    }
    this.selectedNodeRevealTimer = this.containerEl.win.setTimeout(() => {
      this.selectedNodeRevealTimer = null;
      this.checkSelectedNodeReveal();
    }, VIEWPORT_SETTLE_INTERVAL_MS);
  }

  private checkSelectedNodeReveal(): void {
    const pending = this.selectedNodeReveal;

    if (
      !pending ||
      (pending.requireSelection && pending.line !== this.selectedLine)
    ) {
      this.cancelSelectedNodeReveal();

      return;
    }
    const size = `${this.scrollerEl.clientWidth}:${this.scrollerEl.clientHeight}`;

    if (size === pending.size) {
      pending.stable += 1;
    } else {
      pending.size = size;
      pending.stable = 0;
    }
    if (pending.stable < VIEWPORT_STABLE_SAMPLES) {
      this.scheduleSelectedNodeReveal();

      return;
    }
    const laid = this.laidByLine?.get(pending.line);

    if (laid) {
      this.viewport.centerElement(laid.el);
      this.lastViewport = this.viewport.snapshot();
    }
    this.cancelSelectedNodeReveal();
  }

  private cancelSelectedNodeReveal(): void {
    if (this.selectedNodeRevealTimer !== null) {
      this.containerEl.win.clearTimeout(this.selectedNodeRevealTimer);
      this.selectedNodeRevealTimer = null;
    }
    this.selectedNodeReveal = null;
  }

  private applyPendingReveal(): void {
    const pending = this.revealPending;

    if (pending?.kind === 'restore') {
      this.hasRestoredViewport = true;
      this.viewport.restorePosition(pending.position);
      this.viewportReady = true;
      this.lastViewport = this.viewport.snapshot();

      return;
    }
    if (pending?.kind === 'initial') {
      if (!this.focusInitialCursor(pending.cursorLine)) {
        this.fit();
      }

      return;
    }
    this.viewport.center();
  }

  /** Selects and centers the node under the opening Markdown caret. */
  private focusInitialCursor(line: number | null): boolean {
    if (line === null || !this.root) {
      return false;
    }
    const node = findEnclosing(this.root, line);

    if (!node) {
      return false;
    }
    const shown = this.collapsedAncestor(node) ?? node;
    const laid = this.laidByLine.get(shown.line);

    if (!laid) {
      return false;
    }
    this.markCursorLine(line);
    this.clearSelectionClass();
    laid.el.addClass('is-selected');
    this.selectOnly(laid.node.line);
    laid.el.scrollIntoView({ block: 'center', inline: 'center' });

    return true;
  }

  /**
   * Picks up the render skipped while the pane was hidden, straight to
   * render() — the debounce would leave the stale map up for its delay.
   */
  onResize(): void {
    if (this.renderQueued && this.contentEl.offsetHeight > 0) {
      void this.render();
    }
    this.schedulePendingReveal();
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
    const editorText = findEditingView(
      this.app,
      this.file,
      this.editor.linkedLeaf() ?? this.leaf,
    )?.editor.getValue();

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
      this.finishRenderStaging();
      this.clearMirroredCursor();
      this.canvasEl.empty();
      this.laidByLine.clear();
      this.renderedSource = '';
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
    if (this.isBusy() || this.contentEl.offsetHeight === 0) {
      this.renderQueued = true;

      return;
    }
    const parsed = parseMarkdown(text, this.file.basename);
    const pendingOwner =
      this.pendingBodyLine?.path === this.file.path
        ? findByLine(parsed, this.pendingBodyLine.ownerLine)
        : null;

    if (
      this.pendingBodyLine &&
      (!pendingOwner ||
        (!pendingOwner.body.some(
          ({ line }) => line === this.pendingBodyLine?.line,
        ) &&
          !/^\s*$/.test(
            text.split(/\r?\n/)[this.pendingBodyLine.line] ?? '\u0000',
          )))
    ) {
      this.pendingBodyLine = null;
    }
    const previous =
      !switched && this.renderedSource
        ? parseMarkdown(this.renderedSource, this.file.basename)
        : null;
    const taskUpdates = previous ? taskEditUpdates(previous, parsed) : [];

    if (taskUpdates.length && !this.syncingTasks) {
      const file = this.file;
      let synced = false;

      this.syncingTasks = true;
      try {
        await this.writeFile(file, (lines) => {
          const latest = parseMarkdown(lines.join('\n'), file.basename);
          const updates = taskEditUpdates(previous!, latest);

          return syncTaskParentsOp(lines, updates);
        });
        synced = true;
      } catch (err) {
        this.reportOpError(err);
      } finally {
        this.syncingTasks = false;
      }
      if (synced) {
        await this.render(switched);

        return;
      }
    }
    const restoreViewport = this.viewport.isInitialized;
    const scrollLeft = this.scrollerEl.scrollLeft;
    const scrollTop = this.scrollerEl.scrollTop;

    const canvasParent = this.canvasEl.parentElement;

    if (restoreViewport && !this.renderSnapshot && canvasParent) {
      const snapshot = this.canvasEl.cloneNode(true) as HTMLElement;

      snapshot.addClass('mindmap-render-snapshot');
      canvasParent.appendChild(snapshot);
      this.renderSnapshot = snapshot;
    }
    if (this.renderSnapshot) {
      this.canvasEl.addClass('is-render-staging');
    }
    this.clearMirroredCursor();
    this.taskDatePicker?.remove();
    this.taskDatePicker = null;
    this.canvasEl.empty();
    this.laidByLine.clear();
    this.root = parsed;
    this.renderedSource = text;
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

    this.layoutBuildSeq = seq;
    const textRenders: Promise<void>[] = [];

    this.pendingTextRenders = textRenders;
    this.laidRoot = this.buildNode(this.root, palette);
    this.pendingTextRenders = null;
    await Promise.all(textRenders);
    if (seq !== this.renderSeq) {
      return;
    }
    await this.waitForRenderedImages();
    if (seq !== this.renderSeq) {
      return;
    }
    // Reading and rendering Markdown can outlive the tab's visible layout.
    if (this.contentEl.offsetHeight === 0) {
      this.renderQueued = true;

      return;
    }
    this.applyLayout();
    this.layoutBuildSeq = null;
    this.finishRenderStaging();
    if (restoreViewport) {
      this.scrollerEl.scrollLeft = scrollLeft;
      this.scrollerEl.scrollTop = scrollTop;
    }
    this.viewportReady = true;
    this.schedulePendingReveal();

    if (this.cursorLine !== null) {
      // The rebuild dropped the mark, and no caret move is coming to redo
      // it. Same line as before, so this re-marks without scrolling - a
      // render must not yank a map the user just panned somewhere else.
      this.markCursorLine(this.cursorLine);
    }

    if (this.insertedLine !== null) {
      const laid = this.laidByLine.get(this.insertedLine);

      if (laid) {
        // A file-change render can arrive before the write that inserted the
        // line has reached the pane. Only the frame that finds it may consume
        // the pending edit.
        this.insertedLine = null;
        this.selectNode(laid.node, laid.el);
        // Let the key and the render that created the element finish before
        // its editor takes focus. Obsidian otherwise restores focus after us.
        this.canvasEl.win.setTimeout(
          () => this.startInlineEdit(laid.node, laid.el),
          0,
        );
      }
    } else if (this.selectedLine !== null) {
      for (const line of [...this.selectedLines]) {
        const laid = this.laidByLine.get(line);

        if (laid) {
          laid.el.addClass('is-selected');
        } else {
          this.selectedLines.delete(line);
        }
      }
      if (!this.selectedLines.size) {
        this.selectOnly(null);
      } else if (!this.selectedLines.has(this.selectedLine)) {
        this.selectedLine = this.selectedLines.values().next().value ?? null;
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

    this.addTaskMetadata(node, el);
    // The checkbox and the label share a row of their own, so body text below
    // them is a block under it rather than another item on the same line.
    const head = el.createDiv({ cls: HEAD });

    if (node.checked !== null) {
      el.addClass('is-task');
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

    const label = node.taskMetadata?.title ?? node.text;

    if (label.length) {
      this.renderText(textEl, label);
    } else {
      textEl.setText(' ');
    }
    const progress = taskProgress(node);

    if (progress) {
      const progressEl = el.createDiv({ cls: 'mindmap-task-progress' });
      const percent = (progress.completed / progress.total) * 100;

      progressEl.setAttribute('role', 'progressbar');
      progressEl.setAttribute('aria-valuemin', '0');
      progressEl.setAttribute('aria-valuemax', String(progress.total));
      progressEl.setAttribute('aria-valuenow', String(progress.completed));
      progressEl.setAttribute(
        'aria-label',
        `${progress.completed} of ${progress.total} subtasks complete`,
      );
      progressEl.setCssProps({ '--task-progress': `${percent}%` });
      progressEl.createDiv({ cls: 'mindmap-task-progress-bar' });
      progressEl.createSpan({
        cls: 'mindmap-task-progress-label',
        text: `${progress.completed}/${progress.total}`,
      });
    }
    this.addBodyText(node, el);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectNode(node, el, undefined, e.ctrlKey || e.metaKey);
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

  private addTaskMetadata(node: MindNode, el: HTMLElement): void {
    const metadata = node.taskMetadata;

    if (!metadata) {
      return;
    }
    const details = el.createDiv({
      cls: `mindmap-task-metadata${
        metadata.priority || metadata.dueDate ? '' : ' is-empty'
      }`,
    });
    const claimPointer = (event: Event): void => event.stopPropagation();
    const priority = details.createEl('button', {
      cls: `mindmap-task-priority${metadata.priority ? '' : ' is-unset'}`,
      text: metadata.priority ? priorityMark(metadata.priority) : '+',
      attr: {
        'data-priority': metadata.priority ?? 'unset',
        'aria-label': metadata.priority
          ? `Change ${metadata.priority} priority`
          : 'Set priority',
      },
    });
    const dueDate = details.createDiv({
      cls: `mindmap-task-due-date${metadata.dueDate ? '' : ' is-unset'}`,
      attr: {
        'aria-label': metadata.dueDate
          ? `Change due date, ${metadata.dueDate}`
          : 'Set due date',
      },
    });

    setIcon(
      dueDate.createSpan(),
      metadata.dueDate ? 'calendar-days' : 'calendar-plus',
    );
    if (metadata.dueDate) {
      dueDate.createSpan({ text: metadata.dueDate });
    }
    const dateInput = dueDate.createEl('input', {
      cls: 'mindmap-task-date-trigger',
      type: 'date',
      attr: {
        'aria-label': metadata.dueDate
          ? `Change due date, ${metadata.dueDate}`
          : 'Set due date',
      },
    });

    dateInput.value = metadata.dueDate ?? '';
    priority.addEventListener('pointerdown', claimPointer);
    priority.addEventListener('click', (event) => {
      event.stopPropagation();
      this.showPriorityMenu(null, node, priority);
    });
    dateInput.addEventListener('pointerdown', claimPointer);
    dateInput.addEventListener('click', claimPointer);
    dateInput.addEventListener('change', () => {
      void this.setTaskMetadata(node, { dueDate: dateInput.value || null });
    });
  }

  /** Node text with its links clickable, following them on the map. */
  private renderText(
    el: HTMLElement,
    text: string,
    renderMarkdown = true,
  ): void {
    if (!renderMarkdown) {
      el.appendText(text);

      return;
    }
    const seq = this.renderSeq;
    const rendered = renderNodeText(
      el,
      text,
      this.app,
      this.file?.path ?? '',
      this,
      (target, evt) => void this.openInternalLink(target, evt),
      () => {
        if (this.layoutBuildSeq !== seq) {
          this.reflow();
        }
      },
    ).catch((error: unknown) => {
      console.error('Mindmap: failed to render node text', error);
      el.setText(text);
      if (this.layoutBuildSeq !== seq) {
        this.reflow();
      }
    });

    this.pendingTextRenders?.push(rendered);
  }

  /** Waits briefly for image dimensions so the first layout is the final one. */
  private async waitForRenderedImages(): Promise<void> {
    const cleanups: (() => void)[] = [];
    const pending = [...this.canvasEl.querySelectorAll('img')]
      .filter((image) => !image.complete)
      .map(
        (image) =>
          new Promise<void>((resolve) => {
            const cleanup = (): void => {
              image.removeEventListener('load', settled);
              image.removeEventListener('error', settled);
            };
            const settled = (): void => {
              cleanup();
              resolve();
            };

            cleanups.push(cleanup);
            image.addEventListener('load', settled, { once: true });
            image.addEventListener('error', settled, { once: true });
            // It may have completed between the filter and listener setup.
            if (image.complete) {
              settled();
            }
          }),
      );

    if (!pending.length) {
      return;
    }
    await Promise.race([
      Promise.all(pending),
      new Promise<void>((resolve) =>
        this.canvasEl.win.setTimeout(resolve, IMAGE_LAYOUT_WAIT),
      ),
    ]);
    cleanups.forEach((cleanup) => cleanup());
  }

  /** Reveals the completed tree and discards the frozen frame it replaced. */
  private finishRenderStaging(): void {
    this.canvasEl?.removeClass('is-render-staging');
    this.renderSnapshot?.remove();
    this.renderSnapshot = null;
  }

  /**
   * Draws the node's own text inside it, one element per source line so a
   * click can name the line it hit.
   */
  private addBodyText(node: MindNode, el: HTMLElement): void {
    const pending = this.pendingBodyLines(node);
    const body = pending.length
      ? [...node.body, ...pending].sort((a, b) => a.line - b.line)
      : node.body;

    if (!this.showBodyText || !body.length) {
      return;
    }
    if (this.isTextFolded(node)) {
      return;
    }
    const bodyEl = el.createDiv({ cls: BODY });

    el.addClass('has-body');

    let previous = -1;
    let inFence = false;

    for (const { line, text } of body) {
      const lineEl = bodyEl.createDiv({ cls: BODY_LINE });
      const fence = FENCE_RE.test(text);

      lineEl.dataset.line = String(line);
      // A gap in the line numbers is a child node standing between two runs
      // of text. They are written back separately, so they read separately.
      lineEl.toggleClass('is-run-start', previous >= 0 && line > previous + 1);
      previous = line;
      this.renderText(lineEl, text, !inFence && !fence);
      if (fence) {
        inFence = !inFence;
      }
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
      this.selectNode(node, el, lineAt(e.target), e.ctrlKey || e.metaKey);
    });
    // The map draws this text; the editor is where it is written. A
    // double-click opens the line there, with the caret on it.
    bodyEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const line = lineAt(e.target);

      if (this.file) {
        this.pendingBodyLine = {
          path: this.file.path,
          ownerLine: node.line,
          line,
        };
      }
      void this.editBodyLine(line);
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
    const bookmarkedLines = this.bookmarkedLines();
    const visit = (l: LaidNode): void => {
      if (bookmarkedLines.has(l.node.line)) {
        this.addBookmarkMark(l);
      }
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

  private bookmarkedLines(): Set<number> {
    if (!this.root) {
      return new Set();
    }
    const root = this.root;
    const lines = this.plugin
      .bookmarksFor(this.file)
      .filter((bookmark) => !bookmark.unresolved)
      .map((bookmark) => resolveAnchor(root, bookmark)?.line)
      .filter((line): line is number => line !== undefined);

    return new Set(lines);
  }

  /** Persistent state opposite the transient text-fold handle. */
  private addBookmarkMark(laid: LaidNode): void {
    const mark = this.canvasEl.createDiv({
      cls: 'mindmap-bookmark-mark',
      attr: { 'aria-label': 'Bookmarked' },
    });

    setIcon(mark, 'bookmark');
    mark.setCssStyles({
      left: `${laid.x}px`,
      top: `${laid.y}px`,
    });
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
      .querySelectorAll('.mindmap-collapse, .mindmap-bookmark-mark')
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
  private selectNode(
    node: MindNode,
    el: HTMLElement,
    line?: number,
    extend = false,
  ): void {
    if (extend && node.type !== 'root') {
      const selected = this.selectedNodes();
      const compatible = selected.every(
        (item) => item.parent === node.parent && item.type === node.type,
      );

      if (compatible && selected.length) {
        if (this.selectedLines.delete(node.line)) {
          el.removeClass('is-selected');
          this.selectedLine = this.selectedLines.values().next().value ?? null;
        } else {
          this.selectedLines.add(node.line);
          this.selectedLine = node.line;
          el.addClass('is-selected');
        }
        this.scrollerEl.focus({ preventScroll: true });

        return;
      }
    }
    this.clearSelectionClass();
    el.addClass('is-selected');
    this.selectOnly(node.line);
    this.scrollerEl.focus({ preventScroll: true });
    // Here rather than from the editor's own event: with the map holding
    // focus that event may never come, leaving the last mark standing.
    this.markCursorLine(line ?? node.line);
    // markCursorLine can briefly rediscover the pane that just lost focus, so
    // release its keyboard only after the selection marker has been updated.
    this.endBodyEdit();
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
    const bodyEditSeq = this.bodyEditSeq;

    void this.pointEditorAtFile().then(() => {
      // A double-click can start editing while this earlier selection is
      // revealing its pane. Its flash must not arrive over the real editor.
      if (bodyEditSeq !== this.bodyEditSeq) {
        return;
      }

      return this.editor.goToLine(
        line ?? node.line,
        blockOf(node, line ?? node.line),
      );
    });
  }

  private clearSelectionClass(): void {
    this.canvasEl
      .querySelectorAll('.mindmap-node.is-selected')
      .forEach((el) => el.removeClass('is-selected'));
  }

  /**
   * Moves this map onto `file` if it is the map's to follow. A map tracks the
   * active file, like Obsidian's own outline; one linked to a tab tracks that
   * tab instead, which is how a map is kept on one note.
   */
  private followFile(file: TFile | null): void {
    // Mobile maps live in their own tabs. Letting hidden map tabs follow every
    // opened note changes all of them behind the user's back and leaves no tab
    // to restore for a remembered note.
    if (this.plugin.isMobile) {
      return;
    }
    const source = this.mapDrivenSourceLeaf;

    if (
      source &&
      !this.app.workspace.getLeavesOfType('markdown').includes(source)
    ) {
      this.mapDrivenSourceLeaf = null;
      this.scrollerEl.removeClass('is-positioning');
      this.revealSelectedNodeAfterPaneChange(this.selectedLine);

      return;
    }
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
    const bodyEditSeq = this.bodyEditSeq;
    const opensNewPane =
      !this.editor.linkedLeaf() &&
      !findMarkdownView(this.app, this.file, this.leaf);

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
      const opened = await this.editor.showFile(this.file);

      this.mapDrivenSourceLeaf =
        findMarkdownView(this.app, this.file, this.leaf)?.leaf ?? null;
      if (opensNewPane) {
        this.revealSelectedNodeAfterPaneChange(this.selectedLine);
      }

      if (opened && had && bodyEditSeq === this.bodyEditSeq) {
        this.scrollerEl.focus({ preventScroll: true });
      }
    } finally {
      if (--this.pointing === 0) {
        this.plugin.mapDrivenOpen = null;
      }
    }
  }

  /** Focuses a body line without an earlier pointerdown taking focus back. */
  private async editBodyLine(line: number): Promise<boolean> {
    const file = this.file;
    const opensNewPane = !!file && !findMarkdownView(this.app, file, this.leaf);

    this.bodyEditSeq++;
    clearPreviewLine();
    const view = await this.editor.editLine(line);

    if (!view) {
      return false;
    }
    if (opensNewPane) {
      this.revealSelectedNodeAfterPaneChange(this.selectedLine);
    }
    clearPreviewLine(view.containerEl);
    if (
      this.mirrorEditorView &&
      this.mirrorEditorView !== view &&
      MIRROR_EDITOR_OWNERS.get(this.mirrorEditorView) === this
    ) {
      MIRROR_EDITOR_OWNERS.delete(this.mirrorEditorView);
    }
    this.mirrorEditorView = view;
    MIRROR_EDITOR_OWNERS.set(view, this);
    this.clearMirrorEditorKeys();
    const scope = (view as MarkdownView & { scope: Scope }).scope;
    const handleEnter = (event: KeyboardEvent): boolean =>
      event.isComposing ||
      this.mirrorEditorView !== view ||
      MIRROR_EDITOR_OWNERS.get(view) !== this ||
      !this.insertMirroredLine();

    this.mirrorEditorKeys = {
      scope,
      handlers: [
        scope.register([], 'Enter', handleEnter),
        scope.register(['Shift'], 'Enter', handleEnter),
      ],
    };

    return opensNewPane;
  }

  private clearMirrorEditorKeys(): void {
    const keys = this.mirrorEditorKeys;

    keys?.handlers.forEach((handler) => keys.scope.unregister(handler));
    this.mirrorEditorKeys = null;
  }

  /** Releases the Markdown-side keyboard once its editing caret is gone. */
  private endBodyEdit(): void {
    const view = this.mirrorEditorView;

    this.clearMirroredCursor();
    this.clearMirrorEditorKeys();
    if (view && MIRROR_EDITOR_OWNERS.get(view) === this) {
      MIRROR_EDITOR_OWNERS.delete(view);
    }
    this.mirrorEditorView = null;
  }

  /** Hands Escape from this map's source editor back to the map. */
  private returnFromBodyEdit(target?: EventTarget | null): boolean {
    const view = this.mirrorEditorView;
    const fromEditor =
      !target ||
      (view &&
        target instanceof view.containerEl.doc.defaultView!.Node &&
        view.containerEl.contains(target));

    if (
      !fromEditor ||
      !this.mirroredCursor?.el.isConnected ||
      !view ||
      MIRROR_EDITOR_OWNERS.get(view) !== this
    ) {
      return false;
    }
    this.endBodyEdit();
    this.returningFromBodyEdit = true;
    this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
    this.scrollerEl.focus({ preventScroll: true });

    return true;
  }

  /**
   * Ties this map to the tab its note is in - Obsidian's own "Link with tab",
   * so the pairing shows in its tab menu and comes undone there. This is what
   * keeps a map on one note: it now tracks that tab rather than the active
   * file, and the two move together from either side.
   */
  async linkToEditor(): Promise<void> {
    if (this.file) {
      const source = await this.editor.tabFor(this.file);

      this.leaf.setGroupMember(source);
      await this.plugin.rememberLinkedMap(this.file);
      this.syncToggleActions();
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
    const menu = new Menu().setUseNativeMenu(false);
    const add = (
      title: string,
      icon: string,
      onClick: (event: MouseEvent | KeyboardEvent) => void,
    ): void => {
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
    add(node.body.length ? 'Edit note' : 'Add note', 'sticky-note', () => {
      void this.editNodeNote(node);
    });
    if (node.type !== 'root') {
      if (this.file) {
        const bookmark = this.bookmarkFor(node);

        add(
          bookmark ? 'Remove bookmark' : 'Add bookmark',
          bookmark ? 'bookmark-minus' : 'bookmark-plus',
          () => {
            if (bookmark) {
              void this.plugin.removeBookmark(bookmark.id);
            } else {
              void this.addNodeBookmark(node);
            }
          },
        );
        if (bookmark) {
          add('Rename bookmark label', 'pencil', () => {
            new BookmarkNameModal(
              this.app,
              bookmark.name ?? '',
              (name) => void this.plugin.renameBookmark(bookmark.id, name),
            ).open();
          });
        }
        menu.addSeparator();
      }
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
        if (node.checked !== null) {
          menu.addItem((item) =>
            item
              .setTitle('Priority')
              .setIcon('circle-dot')
              .onClick(() => this.showPriorityMenu(menu, node, el)),
          );
          add(
            node.taskMetadata?.dueDate ? 'Change due date' : 'Set due date',
            'calendar-days',
            () => this.openTaskDatePicker(node, el),
          );
          if (node.taskMetadata?.dueDate) {
            add(
              'Clear due date',
              'calendar-x',
              () => void this.setTaskMetadata(node, { dueDate: null }),
            );
          }
        }
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
        this.selectOnly(null);
        void this.applyToNodes([node], (lines, [target]) =>
          deleteNodeOp(lines, target!),
        );
      });
    }
    menu.showAtMouseEvent(e);
    this.attachPrioritySubmenu(menu, node);
  }

  private attachPrioritySubmenu(menu: Menu, node: MindNode): void {
    if (node.checked === null || !this.canvasEl) {
      return;
    }
    const menus = this.canvasEl.doc.querySelectorAll('.menu');
    const parent = menus[menus.length - 1];
    const item = [...(parent?.querySelectorAll('.menu-item') ?? [])].find(
      (candidate) =>
        candidate.querySelector('.menu-item-title')?.textContent === 'Priority',
    ) as HTMLElement | undefined;

    if (!item) {
      return;
    }
    item.addClass('mindmap-menu-has-submenu');
    const open = (): void => this.showPriorityMenu(menu, node, item);

    item.addEventListener('mouseenter', open);
    item.addEventListener('focus', open);
  }

  private showPriorityMenu(
    parent: Menu | null,
    node: MindNode,
    anchor: HTMLElement,
  ): void {
    this.priorityMenu?.hide();
    const menu = new Menu().setUseNativeMenu(false);
    const priorities: [string, TaskPriority | null][] = [
      ['❗ Highest', 'highest'],
      ['▲ High', 'high'],
      ['● Medium', 'medium'],
      ['▼ Low', 'low'],
      ['Clear priority', null],
    ];

    priorities.forEach(([title, priority]) =>
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setChecked(node.taskMetadata?.priority === priority)
          .onClick(() => {
            parent?.hide();
            void this.setTaskMetadata(node, { priority });
          }),
      ),
    );
    const box = anchor.getBoundingClientRect();
    const point = { x: box.right, y: box.top };

    this.priorityMenu = menu;
    menu.showAtPosition(point, this.canvasEl.doc);
  }

  private openTaskDatePicker(node: MindNode, anchor: HTMLElement): void {
    this.taskDatePicker?.remove();
    const picker = this.canvasEl.doc.body.createEl('input');
    const nodeBox =
      anchor.closest('.mindmap-node')?.getBoundingClientRect() ??
      anchor.getBoundingClientRect();

    picker.type = 'date';
    picker.value = node.taskMetadata?.dueDate ?? '';
    picker.setAttribute('aria-label', 'Due date');
    picker.addClass('mindmap-task-date-picker');
    const left = Math.min(nodeBox.left, this.canvasEl.win.innerWidth - 180);
    const top = Math.min(
      nodeBox.bottom + 8,
      this.canvasEl.win.innerHeight - 40,
    );

    picker.style.left = `${Math.max(8, left)}px`;
    picker.style.top = `${Math.max(8, top)}px`;
    const close = (): void => {
      picker.remove();
      this.taskDatePicker = null;
    };

    picker.addEventListener('change', () => {
      const dueDate = picker.value;

      close();
      void this.setTaskMetadata(node, { dueDate: dueDate || null });
    });
    picker.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        close();
      }
    });
    picker.addEventListener('pointerdown', (event) => event.stopPropagation());
    picker.addEventListener('click', (event) => event.stopPropagation());
    this.taskDatePicker = picker;
    picker.focus();
    try {
      picker.showPicker();
    } catch {
      // Some Electron versions do not expose the native picker. The visible
      // date input remains directly editable in those versions.
    }
  }

  private async setTaskMetadata(
    node: MindNode,
    change: Partial<Pick<TaskMetadata, 'priority' | 'dueDate'>>,
  ): Promise<void> {
    await this.applyOp((lines) => {
      const fresh = parseMarkdown(lines.join('\n'), this.file?.basename ?? '');
      const target = relocateTaskNode(fresh, node);

      if (!target) {
        throw new Error(`Mindmap: "${node.text}" is no longer in the file`);
      }
      const metadata = target.taskMetadata ?? {
        title: target.text,
        priority: null,
        dueDate: null,
      };

      return setTaskMetadataOp(lines, target, {
        priority: 'priority' in change ? change.priority! : metadata.priority,
        dueDate: 'dueDate' in change ? change.dueDate! : metadata.dueDate,
      });
    });
  }

  private bookmarkFor(node: MindNode): NodeBookmark | null {
    if (!this.root) {
      return null;
    }

    return (
      this.plugin
        .bookmarksFor(this.file)
        .filter((bookmark) => !bookmark.unresolved)
        .find(
          (bookmark) => resolveAnchor(this.root!, bookmark)?.line === node.line,
        ) ?? null
    );
  }

  private async addNodeBookmark(node: MindNode): Promise<void> {
    if (!this.file) {
      return;
    }
    const source = await this.getFileText(false);
    const current = trackAnchor(
      parseMarkdown(source, this.file.basename),
      anchorFor(node),
      this.renderedSource,
      source,
    );

    if (!current) {
      new Notice('Mind map: node changed before it could be bookmarked.');

      return;
    }
    await this.plugin.addBookmark(this.file, current, source);
  }

  private showBookmarksMenu(event: MouseEvent): void {
    const menu = new Menu().setUseNativeMenu(false);

    const bookmarks = [...this.plugin.bookmarksFor(this.file)].sort((a, b) => {
      if (a.unresolved !== b.unresolved) {
        return a.unresolved ? 1 : -1;
      }

      return a.line - b.line;
    });

    if (!bookmarks.length) {
      menu.addItem((item) =>
        item.setTitle('No bookmarks for this note').setDisabled(true),
      );
    }
    for (const bookmark of bookmarks) {
      const title = bookmark.name ?? this.bookmarkNodeLabel(bookmark);
      let icon = 'circle-alert';

      if (!bookmark.unresolved) {
        icon = this.bookmarkNodeIcon(bookmark);
      }

      menu.addItem((item) =>
        item
          .setTitle(this.bookmarkMenuTitle(menu, bookmark, title))
          .setIcon(icon)
          .onClick(() => void this.revealBookmark(bookmark)),
      );
    }
    if (bookmarks.length) {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle('Remove all bookmarks')
          .setIcon('trash')
          .onClick(() => this.removeAllBookmarks()),
      );
    }
    menu.showAtMouseEvent(event);
  }

  private removeAllBookmarks(): void {
    if (
      this.plugin.bookmarksFor(this.file).length &&
      this.containerEl.win.confirm('Remove all bookmarks for this note?')
    ) {
      void this.plugin.resetBookmarks(this.file ?? undefined);
    }
  }

  private bookmarkMenuTitle(
    menu: Menu,
    bookmark: NodeBookmark,
    title: string,
  ): DocumentFragment {
    const fragment = this.containerEl.doc
      .createRange()
      .createContextualFragment(
        '<span class="mindmap-bookmark-menu-title">' +
          '<span class="mindmap-bookmark-menu-label"></span>' +
          '<span class="mindmap-bookmark-remove" role="button" tabindex="0"></span>' +
          '</span>',
      );
    const label = fragment.querySelector('.mindmap-bookmark-menu-label');
    const remove = fragment.querySelector<HTMLElement>(
      '.mindmap-bookmark-remove',
    );

    label!.textContent = bookmark.unresolved ? `${title} (not found)` : title;
    remove!.ariaLabel = 'Remove bookmark';
    setIcon(remove!, 'trash');
    const removeBookmark = (): void => {
      menu.hide();
      void this.plugin.removeBookmark(bookmark.id);
    };

    remove!.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      removeBookmark();
    });
    remove!.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      removeBookmark();
    });

    return fragment;
  }

  private bookmarkNodeIcon(bookmark: NodeBookmark): string {
    if (bookmark.type === 'heading') {
      const level = bookmark.level ?? 1;

      return `heading-${Math.max(1, Math.min(6, level))}`;
    }
    if (typeof bookmark.checked === 'boolean') {
      return 'list-checks';
    }

    const ordered =
      /^\d+[.)]$/.test(bookmark.marker ?? '') ||
      ORDERED_LABEL.test(bookmark.text);

    return ordered ? 'list-ordered' : 'list';
  }

  private bookmarkNodeLabel(bookmark: NodeBookmark): string {
    if (
      bookmark.type === 'list' &&
      typeof bookmark.checked !== 'boolean' &&
      ORDERED_LABEL.test(bookmark.text)
    ) {
      return bookmark.text.replace(ORDERED_LABEL, '');
    }

    return bookmark.text;
  }

  private async revealBookmark(bookmark: NodeBookmark): Promise<void> {
    if (!this.root) {
      return;
    }
    const node = resolveAnchor(this.root, bookmark);

    if (!node) {
      new Notice('Mind map: bookmarked node could not be found.');

      return;
    }
    this.revealPending = null;
    if (this.revealTimer !== null) {
      this.containerEl.win.clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
    for (let parent = node.parent; parent; parent = parent.parent) {
      this.collapsedBranches.delete(parent.line);
      this.expandedDone.add(parent.line);
    }
    this.syncCollapseToEditor();
    await this.render();
    const refreshed = this.root && resolveAnchor(this.root, bookmark);
    const laid = refreshed && this.laidByLine.get(refreshed.line);

    if (refreshed && laid) {
      if (this.viewport.value < 1) {
        this.viewport.restore(1);
      }
      this.selectNode(refreshed, laid.el);
      laid.el.scrollIntoView({ block: 'center', inline: 'center' });
    }
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

  /** Opens a node's note, creating its first body line when needed. */
  private async editNodeNote(node: MindNode): Promise<void> {
    const line = node.body[0]?.line;

    if (line === undefined) {
      await this.addTaskNote(node);
    } else {
      await this.editBodyLine(line);
    }
  }

  /** Creates a Markdown continuation line, then hands its writing to Obsidian. */
  private async addTaskNote(node: MindNode): Promise<void> {
    if (!this.file) {
      return;
    }
    const file = this.file;
    let insertedLine: number | null = null;
    let ownerLine: number | null = null;

    try {
      await this.writeFile(file, (lines) => {
        const fresh = parseMarkdown(lines.join('\n'), file.basename);
        const target = relocateNode(fresh, node);

        if (!target) {
          throw new Error(`Mindmap: "${node.text}" is no longer in the file`);
        }
        const result = addTaskNoteOp(lines, target);

        insertedLine = result.insertedLine;
        ownerLine = target.line;

        return result.lines;
      });
    } catch (err) {
      this.reportOpError(err);
    }
    if (insertedLine === null || ownerLine === null) {
      await this.render();

      return;
    }
    this.showBodyText = true;
    this.pendingBodyLine = { path: file.path, ownerLine, line: insertedLine };
    this.app.workspace.requestSaveLayout();
    this.syncToggleActions();
    await this.render();
    if (await this.editBodyLine(insertedLine)) {
      this.revealNodeAfterPaneChange(ownerLine, false);
    }
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
    const near = this.editor.linkedLeaf() ?? this.leaf;
    const wrote = await updateFileLines(this.app, file, mutate, near);

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
    const displayed = node.taskMetadata?.title ?? node.text;

    input.textContent = displayed;
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
            label = formatTaskMetadata(
              value,
              node.taskMetadata ?? {
                priority: null,
                dueDate: null,
              },
            );
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

  private async moveNodes(
    sources: MindNode[],
    target: MindNode,
    before: MindNode | null = null,
  ): Promise<void> {
    if (sources.some((source) => !canDrop(source, target))) {
      new Notice('This node cannot be dropped there.');

      return;
    }
    this.selectOnly(null);
    await this.applyToNodes([...sources, target, before], (lines, found) =>
      moveNodesOp(
        lines,
        found.slice(0, sources.length),
        found[sources.length]!,
        found[sources.length + 1] ?? null,
      ),
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
        sources: (source) => {
          const selected = this.selectedNodes();

          return this.selectedLines.has(source.line) && selected.length
            ? selected
            : [source];
        },
        drop: (sources, target, before) =>
          void this.moveNodes(sources, target, before),
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
    this.selectOnly(null);
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
