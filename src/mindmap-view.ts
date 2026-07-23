import {
  debounce,
  ItemView,
  Keymap,
  MarkdownView,
  Menu,
  Notice,
  Scope,
  TFile,
  ViewStateResult,
  WorkspaceLeaf,
} from 'obsidian';
import type MindmapPlugin from './main';
import {
  findByLine,
  isDescendantOrSelf,
  maxHeadingLevel,
  MindNode,
  parseMarkdown,
} from './parser';
import { LaidNode, layoutTree, makeLaid } from './layout';
import { branchColorFor, parsePalette } from './colors';
import { renderNodeText } from './node-text';
import {
  addChildOp,
  addSiblingOp,
  deleteNodeOp,
  findMarkdownView,
  InsertResult,
  moveNodeOp,
  reorderSiblingOp,
  setCheckboxOp,
  setTextOp,
  toggleTaskOp,
  updateFileLines,
} from './markdown-ops';

export const VIEW_TYPE_MINDMAP = 'mindmap-editor';

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
  private renderedWhileHidden = false;
  private laidByLine = new Map<number, LaidNode>();
  private hideCompletedActionEl: HTMLElement | null = null;
  /**
   * Parents (by line) whose completed tasks are shown despite
   * hideCompleted, via a click on their "✓ n done" pill.
   */
  private expandedDone = new Set<number>();
  /**
   * Most recently focused Markdown leaf, so syncEditorTo reuses the
   * editor the user was actually looking at instead of an arbitrary
   * (and possibly unfocused) open tab.
   */
  private lastActiveMarkdownLeaf: WorkspaceLeaf | null = null;

  /**
   * Checked tasks collapse into one "✓ n done" pill per parent. Backed by
   * plugin settings so the choice survives restarts.
   */
  private get hideCompleted(): boolean {
    return this.plugin.settings.hideCompleted;
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
    // A view scope receives keys whenever this leaf is active, without
    // depending on which inner element has DOM focus.
    this.scope = new Scope(this.app.scope);
    this.scope.register([], 'Enter', () => {
      const node = this.selectedNode();
      if (!node) return true;
      void (node.type === 'root'
        ? this.addChildNode(node)
        : this.addSiblingNode(node));
      return false;
    });
    this.scope.register([], 'Tab', () => {
      const node = this.selectedNode();
      if (!node) return true;
      void this.addChildNode(node);
      return false;
    });
    for (const key of ['Delete', 'Backspace']) {
      this.scope.register([], key, () => {
        const node = this.selectedNode();
        if (!node || node.type === 'root') return true;
        this.selectedLine = null;
        void this.applyOp((lines) => deleteNodeOp(lines, node));
        return false;
      });
    }
    this.scope.register([], 'F2', () => {
      const node = this.selectedNode();
      if (!node) return true;
      const laid = this.laidByLine.get(node.line);
      if (laid) this.startInlineEdit(node, laid.el);
      return false;
    });
    // Navigate visible nodes only: with hideCompleted on, checked tasks
    // have no element (laidByLine misses them), so stepping onto one
    // would silently strand the selection.
    const visibleChildren = (n: MindNode): MindNode[] =>
      n.children.filter((c) => !this.isHiddenDone(n, c));
    const sibling = (n: MindNode, delta: number): MindNode | null => {
      if (!n.parent) return null;
      const sibs = visibleChildren(n.parent);
      return sibs[sibs.indexOf(n) + delta] ?? null;
    };
    const nav: [string, (n: MindNode) => MindNode | null][] = [
      ['ArrowLeft', (n) => n.parent],
      ['ArrowRight', (n) => visibleChildren(n)[0] ?? null],
      ['ArrowUp', (n) => sibling(n, -1)],
      ['ArrowDown', (n) => sibling(n, 1)],
    ];
    for (const [key, move] of nav) {
      this.scope.register([], key, () => {
        if (this.isInlineEditing) return true;
        const node = this.selectedNode();
        if (!node) {
          if (this.root) this.selectByNode(this.root);
          return false;
        }
        const next = move(node);
        if (next) this.selectByNode(next);
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
        if (!node || node.type === 'root') return true;
        void this.reorderNode(node, delta);
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
      if (this.selectedLine === null) return true;
      this.selectedLine = null;
      this.clearSelectionClass();
      return false;
    });
  }

  /** Selects a node found by tree navigation and keeps it in view. */
  private selectByNode(node: MindNode): void {
    const laid = this.laidByLine.get(node.line);
    if (!laid) return;
    this.selectNode(node, laid.el);
    laid.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
    if (!other) return;
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
    if (!node || node.checked === null) return true;
    const laid = this.laidByLine.get(node.line);
    const cb = laid?.el.querySelector<HTMLInputElement>(
      '.mindmap-checkbox',
    );
    if (!laid || !cb) return true;
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

  private setHideCompleted(value: boolean): void {
    if (this.hideCompleted === value) return;
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
    this.hideCompletedActionEl.toggleClass(
      'is-active',
      this.hideCompleted,
    );
    this.scrollerEl = this.contentEl.createDiv({
      cls: 'mindmap-scroller',
      attr: { tabindex: '0' },
    });
    this.canvasEl = this.scrollerEl.createDiv({ cls: 'mindmap-canvas' });

    this.registerEvent(
      this.app.vault.on('modify', (f) => {
        if (f === this.file) this.requestRender();
      }),
    );
    this.registerEvent(
      this.app.workspace.on('editor-change', (_editor, info) => {
        if (info.file === this.file) this.requestRender();
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
      this.app.workspace.on('file-open', (f) => {
        if (
          this.plugin.settings.followActiveFile &&
          f &&
          f.extension === 'md' &&
          f !== this.file
        ) {
          void this.setFile(f);
        }
      }),
    );
    this.registerDomEvent(this.scrollerEl, 'pointerdown', (e) =>
      this.onBackgroundPointerDown(e),
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
    // During workspace restore, renders can run before files and editors
    // are fully loaded; one more render after layout-ready fills in the
    // real content (runs immediately when the layout is already ready).
    this.app.workspace.onLayoutReady(() => this.requestRender());
    await this.render();
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
      if (af instanceof TFile && af.path !== this.file?.path) {
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
    await this.render();
    const leaf = this.leaf as WorkspaceLeaf & {
      updateHeader?: () => void;
    };
    leaf.updateHeader?.();
  }

  refresh(): void {
    // Settings may have changed (e.g. hideCompleted from the settings
    // tab or another view's header button); keep the action in sync.
    this.hideCompletedActionEl?.toggleClass(
      'is-active',
      this.hideCompleted,
    );
    this.requestRender();
  }

  onResize(): void {
    if (this.renderedWhileHidden) this.requestRender();
  }

  /**
   * Reads the split orientation the map currently sits in from the DOM
   * (Obsidian: mod-vertical = side by side, mod-horizontal = stacked).
   * Returns null when the map is not actually sharing a split with
   * another pane, so a lone maximized map never rewrites the setting.
   */
  private detectSplitDirection(): 'vertical' | 'horizontal' | null {
    const split = this.containerEl.closest('.workspace-split');
    if (!split) return null;
    const panes = split.querySelectorAll(
      ':scope > .workspace-tabs, :scope > .workspace-split, :scope > .workspace-leaf',
    ).length;
    if (panes < 2) return null;
    if (split.classList.contains('mod-horizontal')) return 'horizontal';
    if (split.classList.contains('mod-vertical')) return 'vertical';
    return null;
  }

  private async getFileText(): Promise<string> {
    if (!this.file) return '';
    const mdView = findMarkdownView(this.app, this.file);
    // A workspace-restored MarkdownView can exist before its editor has
    // loaded the file's content; treat an empty editor as not-loaded and
    // read the vault instead (equivalent for a truly empty file).
    const editorText = mdView?.editor.getValue();
    return editorText || this.app.vault.cachedRead(this.file);
  }

  private async render(): Promise<void> {
    if (this.isInlineEditing || this.isDragging) {
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

    const text = await this.getFileText();
    // Renders can overlap across the await above (an op's render plus the
    // debounced editor-change render). Only the newest may touch the DOM;
    // an interleaved rebuild duplicates nodes and desyncs laidByLine.
    if (seq !== this.renderSeq) return;
    if (this.isInlineEditing || this.isDragging) {
      this.renderQueued = true;
      return;
    }

    const scrollLeft = this.scrollerEl.scrollLeft;
    const scrollTop = this.scrollerEl.scrollTop;
    this.canvasEl.empty();
    this.laidByLine.clear();
    this.root = parseMarkdown(text, this.file.basename);
    this.renderedWhileHidden = this.contentEl.offsetHeight === 0;

    const svg = this.canvasEl.createSvg('svg', { cls: 'mindmap-edges' });
    const palette = parsePalette(this.plugin.settings.palette);
    const laidRoot = this.buildNode(this.root, '', palette);
    const { width, height } = layoutTree(laidRoot);
    this.applyPositions(laidRoot);
    this.drawEdges(svg, laidRoot);
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
      if (laid) laid.el.addClass('is-selected');
      else this.selectedLine = null;
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
    let own = color;
    if (node.type === 'root') {
      own = '';
    } else if (node.parent?.type === 'root') {
      const index = node.parent.children.indexOf(node);
      own = branchColorFor(index, palette);
    }
    if (own) el.setCssProps({ '--branch-color': own });

    if (node.checked !== null) {
      const cb = el.createEl('input', {
        cls: 'mindmap-checkbox',
        type: 'checkbox',
      });
      cb.checked = node.checked;
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () =>
        this.writeCheckbox(node, el, cb),
      );
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
    let hiddenDone = 0;
    let shownDone = 0;
    for (const child of node.children) {
      if (this.isHiddenDone(node, child)) {
        hiddenDone++;
        continue;
      }
      if (isCompletedTask(child)) shownDone++;
      laid.children.push(this.buildNode(child, own, palette));
    }
    if (hiddenDone > 0) {
      laid.children.push(this.buildDonePill(node, hiddenDone, own));
    } else if (this.hideCompleted && shownDone > 0) {
      // This parent was expanded via its "✓ n done" pill; offer the
      // way back without touching the rest of the map.
      laid.children.push(this.buildDonePill(node, 0, own));
    }
    return laid;
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
    if (color) el.setCssProps({ '--branch-color': color });
    el.createSpan({
      cls: 'mindmap-node-text',
      text: expand ? `✓ ${hiddenCount} done` : '− hide done',
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (expand) this.expandedDone.add(parent.line);
      else this.expandedDone.delete(parent.line);
      void this.render();
    });
    return makeLaid(SUMMARY_NODE, el, color);
  }

  private applyPositions(laid: LaidNode): void {
    laid.el.setCssStyles({ left: `${laid.x}px`, top: `${laid.y}px` });
    for (const c of laid.children) this.applyPositions(c);
  }

  private drawEdges(svg: SVGSVGElement, laid: LaidNode): void {
    for (const child of laid.children) {
      const x1 = laid.x + laid.w;
      const y1 = laid.y + laid.h / 2;
      const x2 = child.x;
      const y2 = child.y + child.h / 2;
      const dx = Math.max(16, (x2 - x1) / 2);
      const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      svg.createSvg('path', {
        attr: {
          d,
          stroke: child.color || 'var(--text-faint)',
          fill: 'none',
          'stroke-width': '1.5',
        },
      });
      this.drawEdges(svg, child);
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
    if (!from) return;
    const linkpath = (target.split('#')[0] ?? '').trim();
    const resolve = (): TFile | null =>
      linkpath
        ? this.app.metadataCache.getFirstLinkpathDest(
            linkpath,
            from.path,
          )
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

  /**
   * Picks which Markdown pane to reuse: the one the user was last actually
   * looking at over an arbitrary open tab (getLeavesOfType's order is
   * unrelated to focus), else any open Markdown leaf, else a new split.
   */
  private resolveEditorLeaf(): WorkspaceLeaf {
    const markdownLeaves = this.app.workspace.getLeavesOfType('markdown');
    return (
      (this.lastActiveMarkdownLeaf &&
        markdownLeaves.includes(this.lastActiveMarkdownLeaf) &&
        this.lastActiveMarkdownLeaf) ||
      markdownLeaves[0] ||
      this.plugin.openSplit()
    );
  }

  /**
   * Shows `file` in a Markdown pane (reusing an existing one, else
   * splitting) without stealing focus, so the editor always tracks the
   * file the map is showing.
   */
  private async syncEditorTo(file: TFile): Promise<void> {
    if (findMarkdownView(this.app, file)) return;
    await this.resolveEditorLeaf().openFile(file, { active: false });
  }

  /**
   * Reveals and focuses the Markdown pane for this map's file, opening one
   * if none is open yet. The other half of the mind-map/Markdown toggle
   * command (see `openMindmap` in main.ts for the reverse direction).
   */
  async focusEditor(): Promise<void> {
    if (!this.file) return;
    const existing = findMarkdownView(this.app, this.file);
    const leaf = existing?.leaf ?? this.resolveEditorLeaf();
    if (!existing) await leaf.openFile(this.file, { active: false });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  /**
   * Switches the map to `dest` via the leaf's view state, so setState
   * flags the change (`result.history`) and Obsidian records it in the
   * leaf's navigation history.
   */
  private async followTo(from: TFile, dest: TFile): Promise<void> {
    if (dest.path === from.path) return;
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
    if (!this.file || node.line < 0) return;
    const mdView = findMarkdownView(this.app, this.file);
    if (mdView) {
      const editor = mdView.editor;
      if (node.line > editor.lastLine()) return;
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
      const leaf = this.app.workspace.getLeaf(
        'split',
        this.plugin.settings.splitDirection,
      );
      await leaf.openFile(this.file, {
        active: false,
        eState: { line: node.line },
      });
    }
  }

  private showNodeMenu(
    node: MindNode,
    el: HTMLElement,
    e: MouseEvent,
  ): void {
    const menu = new Menu();
    const add = (title: string, icon: string, onClick: () => void): void => {
      menu.addItem((item) =>
        item.setTitle(title).setIcon(icon).onClick(onClick),
      );
    };
    add('Add child', 'plus', () => void this.addChildNode(node));
    // A forced task child is always a list item, so skip it only where a
    // child cannot be one: the root once it already has heading children.
    if (
      node.type !== 'root' ||
      !node.children.some((c) => c.type === 'heading')
    ) {
      add('Add child task', 'check-square', () =>
        void this.addChildNode(node, true),
      );
    }
    if (node.type !== 'root') {
      add('Add sibling', 'corner-down-right', () =>
        void this.addSiblingNode(node),
      );
      if (node.type === 'list') {
        add('Add sibling task', 'check-square', () =>
          void this.addSiblingNode(node, true),
        );
      }
      add('Rename', 'pencil', () => this.startInlineEdit(node, el));
      if (this.reorderTarget(node, -1)) {
        add('Move up', 'arrow-up', () => void this.reorderNode(node, -1));
      }
      if (this.reorderTarget(node, 1)) {
        add('Move down', 'arrow-down', () =>
          void this.reorderNode(node, 1),
        );
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
    if (!this.file) return;
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

  private async applyOp(
    mutate: (lines: string[]) => string[],
  ): Promise<void> {
    if (!this.file) return;
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
    if (this.isInlineEditing) return;
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
    if (!el.isConnected) return;
    const textEl = el.querySelector<HTMLElement>('.mindmap-node-text');
    if (!textEl) return;
    this.isInlineEditing = true;
    // Edit in a span carrying the same text styles as the label it
    // replaces, so the node keeps the same size while editing and after
    // confirming (an <input> has a fixed width and cannot wrap).
    const input = el.createSpan({
      cls: 'mindmap-node-text mindmap-edit-input',
    });
    input.contentEditable = 'plaintext-only';
    input.textContent = node.text;
    textEl.hide();
    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      this.isInlineEditing = false;
      const value = (input.textContent ?? '')
        .replace(/[\r\n]+/g, ' ')
        .trim();
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
      if (ev.isComposing) return;
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
      if (done || el.doc.activeElement === input) return;
      input.focus();
      selectAll();
      el.win.setTimeout(() => {
        if (!done && el.doc.activeElement !== input) finish(false);
      }, 50);
    }, 0);
  }

  private canDrop(source: MindNode, target: MindNode): boolean {
    if (isDescendantOrSelf(target, source)) return false;
    if (source.type === 'heading' && target.type === 'list') return false;
    if (source.type === 'heading') {
      const targetLevel = target.type === 'root' ? 0 : target.level;
      const delta = targetLevel + 1 - source.level;
      if (delta > 0 && maxHeadingLevel(source) + delta > 6) return false;
    }
    return true;
  }

  private async moveNode(
    source: MindNode,
    target: MindNode,
    before: MindNode | null = null,
  ): Promise<void> {
    if (!this.canDrop(source, target)) {
      new Notice('This node cannot be dropped there.');
      return;
    }
    this.selectedLine = null;
    await this.applyOp((lines) => moveNodeOp(lines, source, target, before));
  }

  /** Max distance (px) from the pointer to a node for snap reparenting. */
  private static readonly SNAP_DISTANCE = 60;

  /** Whether `source` could be inserted as a sibling next to `target`. */
  private canDropAsSibling(source: MindNode, target: MindNode): boolean {
    return (
      !!target.parent &&
      target.type === source.type &&
      this.canDrop(source, target.parent)
    );
  }

  /**
   * What a drop at the pointer would do. `parent` null = reparent into
   * `laid.node` (pointer over the node's middle); otherwise insert into
   * `parent`'s children before `before` (pointer in the top/bottom third
   * of a same-type sibling; null `before` = at the end). Slots that would
   * leave the node where it already is return null.
   */
  private findDrop(
    source: MindNode,
    clientX: number,
    clientY: number,
  ): {
    laid: LaidNode;
    parent: MindNode | null;
    before: MindNode | null;
  } | null {
    let best: LaidNode | null = null;
    let bestRect: DOMRect | null = null;
    let bestDist = Infinity;
    for (const laid of this.laidByLine.values()) {
      if (isDescendantOrSelf(laid.node, source)) continue;
      const r = laid.el.getBoundingClientRect();
      const dx = Math.max(r.left - clientX, 0, clientX - r.right);
      const dy = Math.max(r.top - clientY, 0, clientY - r.bottom);
      const d = Math.hypot(dx, dy);
      if (d < bestDist) {
        bestDist = d;
        best = laid;
        bestRect = r;
      }
    }
    if (!best || !bestRect || bestDist > MindmapView.SNAP_DISTANCE) {
      return null;
    }
    const t = best.node;
    const parent = t.parent;
    if (parent && this.canDropAsSibling(source, t)) {
      const sibs = parent.children;
      const isNoop = (before: MindNode | null): boolean => {
        if (source.parent !== parent) return false;
        const i = sibs.indexOf(source);
        return (
          before === source ||
          sibs[i + 1] === before ||
          (before === null && i === sibs.length - 1)
        );
      };
      const r = bestRect;
      if (clientY < r.top + r.height / 3) {
        return isNoop(t) ? null : { laid: best, parent, before: t };
      }
      if (clientY > r.bottom - r.height / 3) {
        const before = sibs[sibs.indexOf(t) + 1] ?? null;
        return isNoop(before) ? null : { laid: best, parent, before };
      }
    }
    if (this.canDrop(source, t)) {
      return { laid: best, parent: null, before: null };
    }
    return null;
  }

  private setupDrag(node: MindNode, el: HTMLElement): void {
    if (node.type === 'root') return;
    el.addClass('is-draggable');
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.isInlineEditing) return;
      if (e.target instanceof HTMLInputElement) return;
      e.stopPropagation();
      const doc = el.doc;
      const pointerId = e.pointerId;
      const startX = e.clientX;
      const startY = e.clientY;
      let started = false;
      let finished = false;
      let ghost: HTMLElement | null = null;
      let indicator: HTMLElement | null = null;
      let drop: ReturnType<MindmapView['findDrop']> = null;
      const clearCues = (): void => {
        drop?.laid.el.removeClass(
          'is-drop-target',
          'is-shift-down',
          'is-shift-up',
        );
        indicator?.hide();
      };
      const applyCues = (): void => {
        if (!drop) return;
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
          if (
            Math.abs(ev.clientX - startX) +
              Math.abs(ev.clientY - startY) <
            6
          ) {
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
            if (laid.el === el) continue;
            const t = laid.node;
            if (
              !this.canDrop(node, t) &&
              !this.canDropAsSibling(node, t)
            ) {
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
        const next = this.findDrop(node, ev.clientX, ev.clientY);
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
        if (finished) return;
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
          this.canvasEl.querySelectorAll(
            '.mindmap-node.is-invalid-target',
          ),
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
              void this.moveNode(
                node,
                finalDrop.parent,
                finalDrop.before,
              );
            } else {
              void this.moveNode(node, finalDrop.laid.node);
            }
            return;
          }
        }
        if (this.renderQueued) void this.render();
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
    if (e.button !== 0) return;
    if (
      e.target instanceof HTMLElement &&
      e.target.closest('.mindmap-node')
    ) {
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
