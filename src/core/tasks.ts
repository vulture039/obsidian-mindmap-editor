import { MindNode } from './parse/parser';

export interface TaskProgress {
  completed: number;
  total: number;
}

export interface TaskStateUpdate {
  node: MindNode;
  checked: boolean;
}

/** Whether this branch contains work that is still open. */
export function hasIncompleteTask(node: MindNode): boolean {
  return (
    node.checked === false ||
    node.children.some((child) => hasIncompleteTask(child))
  );
}

/** Progress from direct child tasks; deeper work belongs to its own parent. */
export function taskProgress(node: MindNode): TaskProgress | null {
  const tasks = node.children.filter((child) => child.checked !== null);
  const completed = tasks.filter((task) => task.checked).length;
  const total = tasks.length;

  return total ? { completed, total } : null;
}

/** The first task reached down each branch, skipping structural nodes. */
export function childTasks(node: MindNode): MindNode[] {
  return node.children.flatMap((child) =>
    child.checked === null ? childTasks(child) : [child],
  );
}

export function descendantTasks(node: MindNode): MindNode[] {
  return node.children.flatMap((child) => [
    ...(child.checked === null ? [] : [child]),
    ...descendantTasks(child),
  ]);
}

/** Parent states derived bottom-up, so every level agrees with its children. */
export function taskParentUpdates(root: MindNode): TaskStateUpdate[] {
  const states = new Map<MindNode, boolean>();
  const updates: TaskStateUpdate[] = [];
  const visit = (node: MindNode): void => {
    node.children.forEach(visit);
    if (node.checked === null) {
      return;
    }
    const children = childTasks(node);
    const checked = children.length
      ? children.every((child) => states.get(child) ?? child.checked === true)
      : node.checked;

    states.set(node, checked);
    if (checked !== node.checked) {
      updates.push({ node, checked });
    }
  };

  visit(root);

  return updates;
}
