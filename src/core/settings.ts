export interface MindmapSettings {
  followActiveFile: boolean;
  palette: string;
  // Collapse checked tasks into "✓ n done" pills; toggled from the view
  // header too, and remembered across sessions.
  hideCompleted: boolean;
  // Direction used whenever the plugin opens a split (map ⇄ editor).
  splitDirection: 'vertical' | 'horizontal';
}

export const DEFAULT_SETTINGS: MindmapSettings = {
  followActiveFile: true,
  palette: '',
  hideCompleted: false,
  splitDirection: 'vertical',
};
