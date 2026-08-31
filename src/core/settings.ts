export interface MindmapSettings {
  palette: string;
  // What a map being opened starts with; each pane then holds its own,
  // since one header button must not redraw every other map.
  hideCompleted: boolean;
  // Mirror collapsed branches and the editor's folded headings/lists onto
  // each other, in both directions.
  syncFolds: boolean;
  // Likewise: the map draws a node's own text (the lines under it that are
  // no node of their own) rather than leaving it to the editor.
  showBodyText: boolean;
  // Direction used whenever the plugin opens a split (map ⇄ editor).
  splitDirection: 'vertical' | 'horizontal';
  // Notes whose map should be restored when the note is opened. Kept in
  // plugin data rather than in the note's frontmatter.
  autoOpenFiles: string[];
}

export const DEFAULT_SETTINGS: MindmapSettings = {
  palette: '',
  hideCompleted: false,
  syncFolds: true,
  showBodyText: false,
  splitDirection: 'vertical',
  autoOpenFiles: [],
};
