import type { App, SplitDirection, WorkspaceLeaf } from 'obsidian';

/** Whether two panes are in the same window - a popout is a window of its own. */
export function sameWindow(a: WorkspaceLeaf, b: WorkspaceLeaf): boolean {
  return a.getContainer() === b.getContainer();
}

/** Whether two panes were split off each other - a pair read side by side. */
export function sameSplit(a: WorkspaceLeaf, b: WorkspaceLeaf): boolean {
  const split = a.parent?.parent;

  return a.parent !== b.parent && !!split && split === b.parent?.parent;
}

/** Transfers a tab only after its replacement has loaded successfully. */
export async function moveLeafToSplit(
  app: App,
  leaf: WorkspaceLeaf,
  near: WorkspaceLeaf,
  direction: SplitDirection,
): Promise<WorkspaceLeaf> {
  const state = leaf.getViewState();
  const group = (leaf as WorkspaceLeaf & { group?: string }).group;
  const split = app.workspace.createLeafBySplit(near, direction);

  try {
    await split.setViewState(state);
    split.setEphemeralState(leaf.getEphemeralState());
    if (group) {
      split.setGroup(group);
    }
  } catch (error) {
    split.detach();
    throw error;
  }
  leaf.detach();

  return split;
}
