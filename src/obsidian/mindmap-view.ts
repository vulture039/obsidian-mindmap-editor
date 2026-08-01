import {
  debounce,
  ItemView,
  Keymap,
  MarkdownView,
  Menu,
  Notice,
  Scope,
  TAbstractFile,
  TFile,
  ViewStateResult,
  WorkspaceLeaf,
} from 'obsidian';
import type MindmapPlugin from '../main';
import {
  findByLine,
  findEnclosing,
  MindNode,
  parseMarkdown,
} from '../core/parser';
import {
  collapsedFromFolds,
  FoldRange,
  foldsKey,
  foldTargets,
  isCollapsible,
  mergeFolds,
  pruneCollapsed,
  sameLines,
} from '../core/folds';
import { applyEditorFolds, loadStoredFolds, readEditorFolds } from './folds';
import { LaidNode, layoutTree, makeLaid } from '../core/render/layout';
import { branchColorFor, parsePalette } from '../core/render/colors';
import { renderNodeText } from './node-text';
import {
  canDrop,
  canDropAsSibling,
  DropTarget,
  findDrop,
} from '../core/render/drag';
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
} from '../core/markdown-ops';
import { findEditingView, findMarkdownView, updateFileLines } from './file-io';

export const VIEW_TYPE_MINDMAP = 'mindmap-editor';

/** Pointer travel (px) before a press on a node turns into a drag. */
const DRAG_START_THRESHOLD = 6;

/** Gap (px) between a node's right edge and its collapse handle. */
const COLLAPSE_HANDLE_GAP = 4;

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
  foldable: false,
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
  private pendingEditLine: number | null = null;
  private isInlineEditing = false;
  private isDragging = false;
  private renderQueued = false;
  private renderSeq = 0;
  private laidByLine = new Map<number, LaidNode>();
  private hideCompletedActionEl: HTMLElement | null = null;
  /** Bulk-fold buttons, keyed by bodyOnly: false = branches, true = "≡". */
  private foldAllActionEls = new Map<boolean, HTMLElement>();
  /**
   * Parents (by line) whose completed tasks are shown despite
   * hideCompleted, via a click on their "✓ n done" pill.
   */
  private expandedDone = new Set<number>();
  /**
   * Collapsed nodes, by line. Mirrors the editor's folds while syncFolds is
   * on; otherwise it lives here only.
   */
  private collapsed = new Set<number>();
  /** Folds last read from or written to the editor, to spot user folds. */
  private lastEditorFoldsKey: string | null = null;
  /**
   * Set once folding the editor fails (the API is not public). Sync then stops
   * both ways: reading alone would let the next render undo the map's folds.
   */
  private foldSyncOff = false;
  /**
   * Most recently focused Markdown leaf, so syncEditorTo reuses the
   * editor the user was actually looking at instead of an arbitrary
   * (and possibly unfocused) open tab.
   */
  private lastActiveMarkdownLeaf: WorkspaceLeaf | null = null;
  /**
   * Linked-pane group ("Link with tab"), empty when unlinked. Read on demand:
   * a cached copy would depend on when Obsidian assigns the group.
   */
  private get linkGroup(): string {
    return (this.leaf as WorkspaceLeaf & { group?: string }).group ?? '';
  }

  /**
   * Checked tasks collapse into one "✓ n done" pill per parent. Backed by
   * plugin settings so the choice survives restarts.
   */
  private get hideCompleted(): boolean {
    return this.plugin.settings.hideCompleted;
  }

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
      !this.canvasEl.querySelector('.mindmap-edit-input')
    ) {
      this.isInlineEditing = false;
    }
    if (
      this.isDragging &&
      !this.canvasEl.querySelector('.mindmap-node.is-dragging')
    ) {
      this.isDragging = false;
    }

    return this.isInlineEditing || this.isDragging;
  }

  private readonly requestRender = debounce(
    () => {
      void this.render();
    },
    250,
    true,
  );

  constructor(leaf: WorkspaceLeaf, plugin: MindmapPlugin) {
    super(leaf);
    this.plugin = plugin;
    // This view navigates between files (wikilink follows), so it takes
    // part in Obsidian's per-leaf navigation history: back/forward via
    // the tab-header arrows, mouse buttons, and the built-in hotkeys.
    this.navigation = true;
    this.registerShortcuts();
  }

  /**
   * Registers the view-scoped keyboard shortcuts. A view scope receives keys
   * whenever this leaf is active, without depending on which inner element
   * has DOM focus.
   */
  private registerShortcuts(): void {
    this.scope = new Scope(this.app.scope);
    this.scope.register([], 'Enter', () => {
      const node = this.selectedNode();

      if (!node) {
        return true;
      }
      void (node.type === 'root'
        ? this.addChildNode(node)
        : this.addSiblingNode(node));

      return false;
    });
    this.scope.register([], 'Tab', () => {
      const node = this.selectedNode();

      if (!node) {
        return true;
      }
      void this.addChildNode(node);

      return false;
    });
    for (const key of ['Delete', 'Backspace']) {
      this.scope.register([], key, () => {
        const node = this.selectedNode();

        if (!node || node.type === 'root') {
          return true;
        }
        this.selectedLine = null;
        void this.applyOp((lines) => deleteNodeOp(lines, node));

        return false;
      });
    }
    this.scope.register([], 'F2', () => {
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
      this.scope.register([], key, () => {
        if (this.isInlineEditing) {
          return true;
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
      this.scope.register(['Shift'], key, () => {
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
      this.scope.register(['Mod'], key, () => {
        const node = this.selectedNode();

        if (!node || !isCollapsible(node)) {
          return true;
        }
        if (this.collapsed.has(node.line) !== collapse) {
          this.toggleCollapse(node);
        }

        return false;
      });
    }
    // Obsidian passes KeyboardEvent.key through, so space is ' '.
    this.scope.register([], ' ', () => this.toggleSelectedCheckbox());
    this.scope.register([], 'Escape', () => {
      if (this.isInlineEditing) {
        // This only fires when the edit input does not own focus
        // (a focused input handles Escape itself), i.e. the edit is
        // broken. Reset instead of leaving the map frozen.
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
    laid.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /**
   * Selects the node the editor's caret sits in, the mirror of
   * focusLineInEditor. Never takes focus: the user is typing over there.
   */
  private followEditorCursor(): void {
    if (this.isBusy() || !this.root || !this.file) {
      return;
    }
    const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (mdView?.file?.path !== this.file.path) {
      return;
    }
    const node = findEnclosing(this.root, mdView.editor.getCursor().line);
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
    // from bouncing against focusLineInEditor.
    if (laid.node.line === this.selectedLine) {
      return;
    }
    this.clearSelectionClass();
    laid.el.addClass('is-selected');
    this.selectedLine = laid.node.line;
    laid.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
    pill?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
    await this.applyOp((lines) => reorderSiblingOp(lines, node, other));
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
    void this.applyOp((lines) => setCheckboxOp(lines, node, cb.checked));
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
    if (this.collapsed.has(node.line)) {
      return [];
    }

    return node.children.filter((c) => !this.isHiddenDone(node, c));
  }

  /** The outermost collapsed ancestor - the one still on screen. */
  private collapsedAncestor(node: MindNode): MindNode | null {
    let outermost: MindNode | null = null;

    for (let cur = node.parent; cur; cur = cur.parent) {
      if (this.collapsed.has(cur.line)) {
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
    if (!isCollapsible(node)) {
      return;
    }
    if (this.collapsed.has(node.line)) {
      this.collapsed.delete(node.line);
    } else {
      this.collapsed.add(node.line);
      this.keepSelectionVisible();
    }
    this.syncCollapseToEditor();
    void this.render();
  }

  /**
   * Folds every handle of one kind, and unfolds them once all are folded.
   * Mixed state folds the rest, so the first click always tidies up.
   */
  private toggleAllCollapse(bodyOnly: boolean): void {
    const targets = this.root ? foldTargets(this.root, bodyOnly) : [];

    if (!targets.length) {
      return;
    }
    const collapseAll = targets.some((line) => !this.collapsed.has(line));

    for (const line of targets) {
      if (collapseAll) {
        this.collapsed.add(line);
      } else {
        this.collapsed.delete(line);
      }
    }
    if (collapseAll) {
      this.keepSelectionVisible();
    }
    this.syncCollapseToEditor();
    void this.render();
  }

  /** Lights up a bulk-fold button while everything it folds is folded. */
  private updateFoldActions(): void {
    for (const [bodyOnly, el] of this.foldAllActionEls) {
      const targets = this.root ? foldTargets(this.root, bodyOnly) : [];

      el.toggleClass(
        'is-active',
        targets.length > 0 && targets.every((line) => this.collapsed.has(line)),
      );
    }
  }

  /** Adopts `folds`; true if the collapse state changed. */
  private adoptFolds(root: MindNode, folds: FoldRange[]): boolean {
    this.lastEditorFoldsKey = foldsKey(folds);
    const next = collapsedFromFolds(root, folds);
    const changed = !sameLines(next, this.collapsed);

    this.collapsed = next;

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

  /** Folds the Markdown pane to match the map's collapsed branches. */
  private syncCollapseToEditor(): void {
    if (!this.syncFolds || !this.root || !this.file) {
      return;
    }
    const current = readEditorFolds(this.app, this.file);

    if (!current) {
      return;
    }
    const folds = mergeFolds(this.root, this.collapsed, current);

    if (!applyEditorFolds(this.app, this.file, folds)) {
      this.foldSyncOff = true;

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
    this.plugin.settings.hideCompleted = value;
    void this.plugin.saveSettings();
    this.expandedDone.clear();
    this.hideCompletedActionEl?.toggleClass('is-active', value);
    void this.render();
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('mindmap-view');
    this.hideCompletedActionEl = this.addAction(
      'check-check',
      'Hide/show completed tasks',
      () => this.setHideCompleted(!this.hideCompleted),
    );
    this.hideCompletedActionEl.toggleClass('is-active', this.hideCompleted);
    this.foldAllActionEls.set(
      false,
      this.addAction(
        'chevrons-down-up',
        'Collapse or expand all branches',
        () => this.toggleAllCollapse(false),
      ),
    );
    this.foldAllActionEls.set(
      true,
      this.addAction('align-justify', 'Fold or unfold all text', () =>
        this.toggleAllCollapse(true),
      ),
    );
    this.addAction('refresh-cw', 'Refresh from the Markdown', () => {
      void this.forceRefresh();
    });
    this.scrollerEl = this.contentEl.createDiv({
      cls: 'mindmap-scroller',
      attr: { tabindex: '0' },
    });
    this.canvasEl = this.scrollerEl.createDiv({ cls: 'mindmap-canvas' });

    this.registerWorkspaceEvents();
    // During workspace restore, renders can run before files and editors
    // are fully loaded; one more render after layout-ready fills in the
    // real content (runs immediately when the layout is already ready).
    this.app.workspace.onLayoutReady(() => this.requestRender());
    await this.render();
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
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf?.view instanceof MarkdownView) {
          this.lastActiveMarkdownLeaf = leaf;
        }
      }),
    );
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        // An explicit choice of source, so it wins over the active file and
        // over followActiveFile. Nothing to track means nothing to win.
        if (this.linkedLeaf()) {
          this.followLinkedLeaf();

          return;
        }
        const shouldFollow =
          this.plugin.settings.followActiveFile &&
          file &&
          file.extension === 'md' &&
          !this.isCurrentFile(file);

        if (shouldFollow) {
          void this.setFile(file);
        }
      }),
    );
    this.registerEvent(
      this.leaf.on('group-change', () => this.followLinkedLeaf()),
    );
    this.registerDomEvent(this.scrollerEl, 'pointerdown', (e) =>
      this.onBackgroundPointerDown(e),
    );
    // The caret moving in an editor fires no workspace event, but it does
    // move the document selection, which does.
    this.registerDomEvent(document, 'selectionchange', () =>
      this.followEditorCursor(),
    );
    // Nothing fires on a fold, so check once clicks and keys settle.
    const checkFolds = debounce(() => this.syncCollapseFromEditor(), 120);

    for (const type of ['click', 'keyup'] as const) {
      this.registerDomEvent(document, type, () => checkFolds());
    }
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => checkFolds()),
    );
    // Remember how the user arranged the map pane (side by side vs
    // stacked), so reopening the view recreates the same split without
    // touching the settings dropdown.
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        const dir = this.detectSplitDirection();

        if (dir && dir !== this.plugin.settings.splitDirection) {
          this.plugin.settings.splitDirection = dir;
          void this.plugin.saveSettings();
        }
      }),
    );
  }

  getState(): Record<string, unknown> {
    return { file: this.file?.path ?? null };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
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
          void this.syncEditorTo(af);
        }
        await this.setFile(af);
      }
    }
    await super.setState(state, result);
  }

  async setFile(file: TFile): Promise<void> {
    this.file = file;
    this.selectedLine = null;
    this.expandedDone.clear();
    this.collapsed.clear();
    this.lastEditorFoldsKey = null;
    await this.render(true);
    void this.loadStoredCollapse();
    const leaf = this.leaf as WorkspaceLeaf & {
      updateHeader?: () => void;
    };

    leaf.updateHeader?.();
  }

  refresh(): void {
    // Settings may have changed (e.g. hideCompleted from the settings
    // tab or another view's header button); keep the action in sync.
    this.hideCompletedActionEl?.toggleClass('is-active', this.hideCompleted);
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
    this.hideCompletedActionEl?.toggleClass('is-active', this.hideCompleted);
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
   * Reads the split orientation the map currently sits in from the DOM
   * (Obsidian: mod-vertical = side by side, mod-horizontal = stacked).
   * Returns null when the map is not actually sharing a split with
   * another pane, so a lone maximized map never rewrites the setting.
   */
  private detectSplitDirection(): 'vertical' | 'horizontal' | null {
    const split = this.containerEl.closest('.workspace-split');

    if (!split) {
      return null;
    }
    const panes = split.querySelectorAll(
      ':scope > .workspace-tabs, :scope > .workspace-split, :scope > .workspace-leaf',
    ).length;

    if (panes < 2) {
      return null;
    }
    if (split.classList.contains('mod-horizontal')) {
      return 'horizontal';
    }
    if (split.classList.contains('mod-vertical')) {
      return 'vertical';
    }

    return null;
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

    const scrollLeft = this.scrollerEl.scrollLeft;
    const scrollTop = this.scrollerEl.scrollTop;

    this.canvasEl.empty();
    this.laidByLine.clear();
    this.root = parseMarkdown(text, this.file.basename);
    // Keyed by line, so re-derive: the editor's folds, else prune.
    if (!this.pullEditorFolds(this.root)) {
      this.collapsed = pruneCollapsed(this.root, this.collapsed);
    }
    this.updateFoldActions();

    const svg = this.canvasEl.createSvg('svg', { cls: 'mindmap-edges' });
    const palette = parsePalette(this.plugin.settings.palette);
    const laidRoot = this.buildNode(this.root, '', palette);
    const { width, height } = layoutTree(laidRoot);

    this.applyPositions(laidRoot);
    this.drawEdges(svg, laidRoot, this.addCollapseToggles(laidRoot));
    this.canvasEl.setCssStyles({
      width: `${width}px`,
      height: `${height}px`,
    });
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    this.scrollerEl.scrollLeft = scrollLeft;
    this.scrollerEl.scrollTop = scrollTop;

    if (this.pendingEditLine !== null) {
      const laid = this.laidByLine.get(this.pendingEditLine);

      this.pendingEditLine = null;
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

  private buildNode(
    node: MindNode,
    color: string,
    palette: string[],
  ): LaidNode {
    const el = this.canvasEl.createDiv({
      cls: ['mindmap-node', `mindmap-node-${node.type}`],
    });

    el.dataset.line = String(node.line);

    const own = this.nodeColor(node, color, palette);

    if (own) {
      el.setCssProps({ '--branch-color': own });
    }

    if (node.checked !== null) {
      const cb = el.createEl('input', {
        cls: 'mindmap-checkbox',
        type: 'checkbox',
      });

      cb.checked = node.checked;
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => this.writeCheckbox(node, el, cb));
      el.toggleClass('is-done', node.checked);
    }
    const textEl = el.createSpan({ cls: 'mindmap-node-text' });

    if (node.text.length) {
      renderNodeText(
        textEl,
        node.text,
        this.app,
        this.file?.path ?? '',
        (target, evt) => void this.openInternalLink(target, evt),
      );
    } else {
      textEl.setText(' ');
    }

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

    const laid = makeLaid(node, el, own);

    this.laidByLine.set(node.line, laid);
    this.buildChildNodes(node, laid, own, palette);

    return laid;
  }

  /**
   * The node's own branch color: the root has none, a top-level branch takes
   * a palette color by its position, and deeper nodes inherit the passed-in
   * color.
   */
  private nodeColor(
    node: MindNode,
    inherited: string,
    palette: string[],
  ): string {
    if (node.type === 'root') {
      return '';
    }
    if (node.parent?.type === 'root') {
      return branchColorFor(node.parent.children.indexOf(node), palette);
    }

    return inherited;
  }

  /** A body-only node folds text the map never draws, so name the editor. */
  private collapseLabel(body: boolean, collapsed: boolean): string {
    if (body) {
      return collapsed
        ? 'Unfold text in the editor'
        : 'Fold text in the editor';
    }

    return collapsed ? 'Expand branch' : 'Collapse branch';
  }

  /**
   * Hangs a handle outside every foldable node and returns where each one's
   * branch now starts. Widths are read in one pass, after every placement.
   */
  private addCollapseToggles(laid: LaidNode): Map<LaidNode, number> {
    const handles: [LaidNode, HTMLElement][] = [];
    const visit = (l: LaidNode): void => {
      if (isCollapsible(l.node)) {
        handles.push([l, this.addCollapseToggle(l)]);
      }
      for (const child of l.children) {
        visit(child);
      }
    };

    visit(laid);
    const outlets = new Map<LaidNode, number>();

    for (const [l, el] of handles) {
      outlets.set(l, l.x + l.w + COLLAPSE_HANDLE_GAP + el.offsetWidth);
    }

    return outlets;
  }

  /** "−"/"+n" for a branch, "≡" for a node that only hides text. */
  private addCollapseToggle(laid: LaidNode): HTMLElement {
    const node = laid.node;
    const collapsed = this.collapsed.has(node.line);
    const body = node.children.length === 0;
    const toggle = this.canvasEl.createDiv({
      cls: 'mindmap-collapse',
      text: body ? '≡' : collapsed ? `+${node.children.length}` : '−',
      attr: { 'aria-label': this.collapseLabel(body, collapsed) },
    });

    if (laid.color) {
      toggle.setCssProps({ '--branch-color': laid.color });
    }
    // Clear of the node's edge; CSS does the vertical half, so no measuring.
    toggle.setCssStyles({
      left: `${laid.x + laid.w + COLLAPSE_HANDLE_GAP}px`,
      top: `${laid.y + laid.h / 2}px`,
    });
    toggle.toggleClass('is-body', body);
    toggle.toggleClass('is-collapsed', collapsed);
    // The handle sits on the canvas: an escaping press would pan the map.
    for (const type of ['pointerdown', 'dblclick'] as const) {
      toggle.addEventListener(type, (e) => e.stopPropagation());
    }
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
   * Builds the visible children under `laid`: none while the branch is
   * collapsed. With hideCompleted on, checked tasks are skipped and collapsed
   * into one "✓ n done" pill per parent (or a "− hide done" pill when the
   * parent is currently expanded).
   */
  private buildChildNodes(
    node: MindNode,
    laid: LaidNode,
    own: string,
    palette: string[],
  ): void {
    if (this.collapsed.has(node.line)) {
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
      laid.children.push(this.buildNode(child, own, palette));
    }
    if (hiddenDone > 0) {
      laid.children.push(this.buildDonePill(node, hiddenDone, own));
    } else if (this.hideCompleted && shownDone > 0) {
      laid.children.push(this.buildDonePill(node, 0, own));
    }
  }

  /**
   * Read-only pill under `parent`: "✓ n done" (click to show that
   * parent's hidden completed tasks) or "− hide done" (click to hide them
   * again). Only this parent is affected; the header button remains the
   * map-wide toggle. Not registered in laidByLine, so it cannot be
   * selected, edited, dragged, or targeted by a drop.
   */
  private buildDonePill(
    parent: MindNode,
    hiddenCount: number,
    color: string,
  ): LaidNode {
    const expand = hiddenCount > 0;
    const el = this.canvasEl.createDiv({
      cls: 'mindmap-node mindmap-node-summary',
    });

    // How followEditorCursor finds the pill: the tasks behind it have no
    // element of their own.
    el.dataset.parentLine = String(parent.line);

    if (color) {
      el.setCssProps({ '--branch-color': color });
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

    return makeLaid(SUMMARY_NODE, el, color);
  }

  private applyPositions(laid: LaidNode): void {
    laid.el.setCssStyles({ left: `${laid.x}px`, top: `${laid.y}px` });
    for (const c of laid.children) {
      this.applyPositions(c);
    }
  }

  /**
   * Draws the branch curves. A handle hands out its right side as the start
   * (`outlets`) and gets a stub across its gap, so it reads as the joint the
   * branch hangs from; a body-only handle gets neither, having no branch.
   */
  private drawEdges(
    svg: SVGSVGElement,
    laid: LaidNode,
    outlets: Map<LaidNode, number>,
  ): void {
    const y1 = laid.y + laid.h / 2;
    const outlet = outlets.get(laid);
    const stroke = (color: string): string => color || 'var(--text-faint)';
    const line = (d: string, color: string): void => {
      svg.createSvg('path', {
        attr: { d, stroke: stroke(color), fill: 'none', 'stroke-width': '1.5' },
      });
    };

    if (outlet !== undefined && laid.node.children.length > 0) {
      line(`M ${laid.x + laid.w} ${y1} H ${outlet}`, laid.color);
    }
    for (const child of laid.children) {
      const x1 = outlet ?? laid.x + laid.w;
      const x2 = child.x;
      const y2 = child.y + child.h / 2;
      const dx = Math.max(16, (x2 - x1) / 2);

      line(
        `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
        child.color,
      );
      this.drawEdges(svg, child, outlets);
    }
  }

  private selectNode(node: MindNode, el: HTMLElement): void {
    this.clearSelectionClass();
    el.addClass('is-selected');
    this.selectedLine = node.line;
    this.scrollerEl.focus({ preventScroll: true });
    // The editor always follows the current selection, whether it came
    // from a click or from arrow-key navigation.
    void this.focusLineInEditor(node);
  }

  private clearSelectionClass(): void {
    this.canvasEl
      .querySelector('.mindmap-node.is-selected')
      ?.removeClass('is-selected');
  }

  /**
   * Opens a [[wikilink]]: follows it on the map and shows it in an editor
   * pane. The map switch goes through leaf.setViewState (not openLinkText
   * + file-open events, which target the active leaf — this view — and do
   * not reliably update the map), so it lands in the leaf's navigation
   * history and Obsidian's own back/forward can return.
   */
  private async openInternalLink(
    target: string,
    evt: MouseEvent,
  ): Promise<void> {
    const from = this.file;

    if (!from) {
      return;
    }
    const linkpath = (target.split('#')[0] ?? '').trim();
    const resolve = (): TFile | null =>
      linkpath
        ? this.app.metadataCache.getFirstLinkpathDest(linkpath, from.path)
        : null;
    let dest = resolve();

    if (!dest || dest.extension !== 'md') {
      // Unresolved (openLinkText may create the note) or not Markdown:
      // default behavior, then follow to the note if one now exists.
      await this.app.workspace.openLinkText(
        target,
        from.path,
        Keymap.isModEvent(evt),
      );
      dest = resolve();
      if (dest && dest.extension === 'md') {
        await this.followTo(from, dest);
      }

      return;
    }
    await this.followTo(from, dest);
  }

  /** The Markdown tab this map is linked to, if any. */
  private linkedLeaf(): WorkspaceLeaf | null {
    if (!this.linkGroup) {
      return null;
    }
    for (const leaf of this.app.workspace.getGroupLeaves(this.linkGroup)) {
      if (leaf !== this.leaf && leaf.getViewState().type === 'markdown') {
        return leaf;
      }
    }

    return null;
  }

  /**
   * The linked tab's file, read from its view state so a tab that is still
   * deferred (never opened in this session) counts too.
   */
  private linkedFile(): TFile | null {
    const path = this.linkedLeaf()?.getViewState().state?.file;
    const af =
      typeof path === 'string'
        ? this.app.vault.getAbstractFileByPath(path)
        : null;

    return af instanceof TFile ? af : null;
  }

  private followLinkedLeaf(): void {
    const file = this.linkedFile();

    if (file && file.path !== this.file?.path) {
      void this.setFile(file);
    }
  }

  /**
   * Where to show the map's file. The linked tab owns that job when there is
   * one; otherwise a new tab beside the Markdown pane the user was last
   * looking at (getLeavesOfType's order is unrelated to focus), since the
   * note that pane is showing is not ours to replace. No pane, so a split.
   */
  private resolveEditorLeaf(): WorkspaceLeaf {
    const linked = this.linkedLeaf();

    if (linked) {
      return linked;
    }
    const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
    const near =
      (this.lastActiveMarkdownLeaf &&
        markdownLeaves.includes(this.lastActiveMarkdownLeaf) &&
        this.lastActiveMarkdownLeaf) ||
      markdownLeaves[0];

    return near
      ? this.app.workspace.createLeafInParent(near.parent, -1)
      : this.plugin.openSplit();
  }

  /**
   * Shows `file` in a Markdown pane (reusing an existing one, else
   * splitting) without stealing focus, so the editor always tracks the
   * file the map is showing.
   */
  private async syncEditorTo(file: TFile): Promise<void> {
    // The linked tab moves with the map even when another tab has the file.
    if (this.linkedLeaf()) {
      if (this.linkedFile()?.path !== file.path) {
        await this.resolveEditorLeaf().openFile(file, { active: false });
      }

      return;
    }
    if (findMarkdownView(this.app, file)) {
      return;
    }
    await this.resolveEditorLeaf().openFile(file, { active: false });
  }

  /**
   * Reveals and focuses the Markdown pane for this map's file, opening one
   * if none is open yet. The other half of the mind-map/Markdown toggle
   * command (see `openMindmap` in main.ts for the reverse direction).
   */
  async focusEditor(): Promise<void> {
    if (!this.file) {
      return;
    }
    const existing = findMarkdownView(this.app, this.file);
    const leaf = existing?.leaf ?? this.resolveEditorLeaf();

    if (!existing) {
      await leaf.openFile(this.file, { active: false });
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
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

  /**
   * Moves the editor cursor to `node`'s line, without stealing keyboard
   * focus from the map — selecting a node (click or arrow keys) always
   * calls this, so the map stays navigable throughout.
   */
  private async focusLineInEditor(node: MindNode): Promise<void> {
    if (!this.file || node.line < 0) {
      return;
    }
    const mdView = findMarkdownView(this.app, this.file);

    if (mdView) {
      const editor = mdView.editor;

      if (node.line > editor.lastLine()) {
        return;
      }
      const lineText = editor.getLine(node.line);

      editor.setCursor({ line: node.line, ch: lineText.length });
      editor.scrollIntoView(
        {
          from: { line: node.line, ch: 0 },
          to: { line: node.line, ch: lineText.length },
        },
        true,
      );
      // The unfocused editor hides its caret, so flash-highlight the
      // line (same mechanism as search results / outline clicks) to
      // make the jump target visible.
      mdView.setEphemeralState({ line: node.line });
      this.scrollerEl.focus({ preventScroll: true });
    } else {
      // resolveEditorLeaf, not a fresh split: splitting past a Markdown tab
      // that is already there stacks up panes nobody asked for.
      await this.resolveEditorLeaf().openFile(this.file, {
        active: false,
        eState: { line: node.line },
      });
    }
  }

  private showNodeMenu(node: MindNode, el: HTMLElement, e: MouseEvent): void {
    const menu = new Menu();
    const add = (title: string, icon: string, onClick: () => void): void => {
      menu.addItem((item) =>
        item.setTitle(title).setIcon(icon).onClick(onClick),
      );
    };

    if (isCollapsible(node)) {
      const collapsed = this.collapsed.has(node.line);

      add(
        this.collapseLabel(node.children.length === 0, collapsed),
        collapsed ? 'chevron-down' : 'chevron-right',
        () => this.toggleCollapse(node),
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
          () => void this.applyOp((lines) => toggleTaskOp(lines, node)),
        );
      }
      menu.addSeparator();
      add('Delete', 'trash', () => {
        this.selectedLine = null;
        void this.applyOp((lines) => deleteNodeOp(lines, node));
      });
    }
    menu.showAtMouseEvent(e);
  }

  private async addSiblingNode(node: MindNode, task?: boolean): Promise<void> {
    await this.applyInsert((lines) => addSiblingOp(lines, node, task));
  }

  private async addChildNode(node: MindNode, task?: boolean): Promise<void> {
    await this.applyInsert((lines) => addChildOp(lines, node, task));
  }

  private async applyInsert(
    mutate: (lines: string[]) => InsertResult,
  ): Promise<void> {
    if (!this.file) {
      return;
    }
    try {
      await updateFileLines(this.app, this.file, (lines) => {
        const result = mutate(lines);

        this.pendingEditLine = result.insertedLine;

        return result.lines;
      });
    } catch (err) {
      this.pendingEditLine = null;
      this.reportOpError(err);
    }
    await this.render();
  }

  private async applyOp(mutate: (lines: string[]) => string[]): Promise<void> {
    if (!this.file) {
      return;
    }
    try {
      await updateFileLines(this.app, this.file, mutate);
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
    if (this.isInlineEditing) {
      return;
    }
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
    this.isInlineEditing = true;
    // Edit in a span carrying the same text styles as the label it
    // replaces, so the node keeps the same size while editing and after
    // confirming (an <input> has a fixed width and cannot wrap).
    const input = el.createSpan({
      cls: 'mindmap-node-text mindmap-edit-input',
    });

    input.contentEditable = 'plaintext-only';
    input.textContent = node.text;
    // Exactly the label's place, so the node's contents do not shift.
    textEl.after(input);
    textEl.hide();
    let done = false;
    const finish = (save: boolean): void => {
      if (done) {
        return;
      }
      done = true;
      this.isInlineEditing = false;
      const value = (input.textContent ?? '').replace(/[\r\n]+/g, ' ').trim();

      if (save && value !== node.text) {
        void this.applyOp((lines) => setTextOp(lines, node, value));
      } else if (this.renderQueued) {
        void this.render();
      } else {
        input.remove();
        textEl.show();
      }
    };

    // Clicks inside the editor must not reach the node handlers, which
    // would move focus to the map and close the edit via blur.
    for (const type of ['pointerdown', 'click', 'dblclick'] as const) {
      input.addEventListener(type, (ev) => ev.stopPropagation());
    }
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      // IME candidate confirmation also fires a "real" Enter keydown
      // with isComposing still true — that must only close the IME
      // composition, not the inline edit itself.
      if (ev.isComposing) {
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    const selectAll = (): void => {
      const range = el.doc.createRange();

      range.selectNodeContents(input);
      const sel = el.win.getSelection();

      sel?.removeAllRanges();
      sel?.addRange(range);
    };

    input.focus();
    selectAll();
    // A closing menu or leaf activation can keep focus away right as the
    // edit opens. Without focus the blur handler can never fire, so
    // retry once, then abort the edit instead of leaving it stuck.
    el.win.setTimeout(() => {
      if (done || el.doc.activeElement === input) {
        return;
      }
      input.focus();
      selectAll();
      el.win.setTimeout(() => {
        if (!done && el.doc.activeElement !== input) {
          finish(false);
        }
      }, 50);
    }, 0);
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
    await this.applyOp((lines) => moveNodeOp(lines, source, target, before));
  }

  private setupDrag(node: MindNode, el: HTMLElement): void {
    if (node.type === 'root') {
      return;
    }
    el.addClass('is-draggable');
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.isInlineEditing) {
        return;
      }
      if (e.target instanceof HTMLInputElement) {
        return;
      }
      e.stopPropagation();
      const doc = el.doc;
      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      let started = false;
      let finished = false;
      let ghost: HTMLElement | null = null;
      let indicator: HTMLElement | null = null;
      let drop: DropTarget | null = null;
      const clearCues = (): void => {
        drop?.laid.el.removeClass(
          'is-drop-target',
          'is-shift-down',
          'is-shift-up',
        );
        indicator?.hide();
      };
      const applyCues = (): void => {
        if (!drop) {
          return;
        }
        const laid = drop.laid;

        if (!drop.parent) {
          laid.el.addClass('is-drop-target');

          return;
        }
        // Sibling slot: nudge the anchor node aside and show an
        // insertion bar in the gap the drop would fill.
        const above = drop.before === laid.node;

        laid.el.addClass(above ? 'is-shift-down' : 'is-shift-up');
        if (!indicator) {
          indicator = this.canvasEl.createDiv({
            cls: 'mindmap-drop-indicator',
          });
        }
        indicator.show();
        indicator.setCssStyles({
          left: `${laid.x}px`,
          width: `${laid.w}px`,
          top: `${above ? laid.y - 8 : laid.y + laid.h + 4}px`,
        });
      };
      const onMove = (ev: PointerEvent): void => {
        if (!started) {
          const traveled =
            Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY);

          if (traveled < DRAG_START_THRESHOLD) {
            return;
          }
          started = true;
          this.isDragging = true;
          // Capture the pointer so pointerup still arrives when the
          // button is released outside the window. A missed
          // pointerup leaves isDragging stuck, which blocks every
          // re-render and desyncs the map from the Markdown.
          try {
            el.setPointerCapture(pointerId);
          } catch {
            // Pointer already gone; the doc listeners still
            // cover the normal in-window case.
          }
          el.addClass('is-dragging');
          this.canvasEl.addClass('is-drag-active');
          for (const laid of this.laidByLine.values()) {
            if (laid.el === el) {
              continue;
            }
            const target = laid.node;

            if (!canDrop(node, target) && !canDropAsSibling(node, target)) {
              laid.el.addClass('is-invalid-target');
            }
          }
          ghost = el.cloneNode(true) as HTMLElement;
          ghost.removeClass('is-dragging', 'is-selected');
          ghost.addClass('mindmap-ghost');
          this.canvasEl.appendChild(ghost);
        }
        const rect = this.canvasEl.getBoundingClientRect();

        ghost?.setCssStyles({
          left: `${ev.clientX - rect.left + 10}px`,
          top: `${ev.clientY - rect.top + 10}px`,
        });
        const next = findDrop(this.laidByLine, node, ev.clientX, ev.clientY);
        const same =
          drop === next ||
          (drop &&
            next &&
            drop.laid === next.laid &&
            drop.parent === next.parent &&
            drop.before === next.before);

        if (!same) {
          clearCues();
          drop = next;
          applyCues();
        }
      };
      const finish = (apply: boolean): void => {
        if (finished) {
          return;
        }
        finished = true;
        doc.removeEventListener('pointermove', onMove);
        doc.removeEventListener('pointerup', onUp);
        doc.removeEventListener('pointercancel', onCancel);
        el.removeEventListener('lostpointercapture', onCancel);
        try {
          if (el.hasPointerCapture(pointerId)) {
            el.releasePointerCapture(pointerId);
          }
        } catch {
          // Capture already released; nothing to clean up.
        }
        el.removeClass('is-dragging');
        this.canvasEl.removeClass('is-drag-active');
        for (const marked of Array.from(
          this.canvasEl.querySelectorAll('.mindmap-node.is-invalid-target'),
        )) {
          marked.removeClass('is-invalid-target');
        }
        ghost?.remove();
        const finalDrop = drop;

        clearCues();
        indicator?.remove();
        this.isDragging = false;
        if (started) {
          // Swallow the click generated by this pointerup so it
          // doesn't select a node or open a link under the cursor.
          const suppress = (ce: MouseEvent): void => {
            ce.stopPropagation();
            ce.preventDefault();
          };

          doc.addEventListener('click', suppress, true);
          el.win.setTimeout(
            () => doc.removeEventListener('click', suppress, true),
            0,
          );
          if (apply && finalDrop) {
            if (finalDrop.parent) {
              void this.moveNode(node, finalDrop.parent, finalDrop.before);
            } else {
              void this.moveNode(node, finalDrop.laid.node);
            }

            return;
          }
        }
        if (this.renderQueued) {
          void this.render();
        }
      };
      const onUp = (): void => finish(true);
      const onCancel = (): void => finish(false);

      doc.addEventListener('pointermove', onMove);
      doc.addEventListener('pointerup', onUp);
      doc.addEventListener('pointercancel', onCancel);
      // Fires if the node element is torn down mid-drag (e.g. the
      // leaf is detached); ends the drag instead of leaving it stuck.
      el.addEventListener('lostpointercapture', onCancel);
    });
  }

  private onBackgroundPointerDown(e: PointerEvent): void {
    // Pan with the main button only; side buttons (3/4) belong to the
    // history handler and must not grab pointer capture here.
    if (e.button !== 0) {
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
      this.scrollerEl.removeEventListener('pointermove', onMove);
      this.scrollerEl.removeEventListener('pointerup', onUp);
      this.scrollerEl.removeEventListener('pointercancel', onUp);
    };

    this.scrollerEl.setPointerCapture(e.pointerId);
    this.scrollerEl.addEventListener('pointermove', onMove);
    this.scrollerEl.addEventListener('pointerup', onUp);
    this.scrollerEl.addEventListener('pointercancel', onUp);
  }
}
