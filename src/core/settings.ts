export interface MindmapSettings {
  palette: string;
  // Collapse checked tasks into "✓ n done" pills; toggled from the view
  // header too, and remembered across sessions.
  hideCompleted: boolean;
  // Mirror collapsed branches and the editor's folded headings/lists onto
  // each other, in both directions.
  syncFolds: boolean;
  // Draw a node's own text (the lines under it that are no node of their
  // own) inside the node, instead of leaving it to the editor.
  showBodyText: boolean;
  // Direction used whenever the plugin opens a split (map ⇄ editor).
  splitDirection: 'vertical' | 'horizontal';
}

export const DEFAULT_SETTINGS: MindmapSettings = {
  palette: '',
  hideCompleted: false,
  syncFolds: true,
  showBodyText: false,
  splitDirection: 'vertical',
};
