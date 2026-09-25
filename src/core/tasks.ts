import { MindNode } from './parse/parser';
import { relocateNode } from './write/relocate';

export interface TaskProgress {
  completed: number;
  total: number;
}

export interface TaskStateUpdate {
  node: MindNode;
  checked: boolean;
}

function sameTaskShape(node: MindNode, other: MindNode | undefined): boolean {
  return (
    !!other &&
    node.type === other.type &&
    node.level === other.level &&
    node.indent === other.indent &&
    node.checked !== null &&
    other.checked !== null
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

/**
 * Syncs only from an identifiable checkbox edit. An initial render or a
 * structural rewrite is not permission to normalize Markdown behind the user.
 */
export function taskEditUpdates(
  previous: MindNode,
  current: MindNode,
): TaskStateUpdate[] {
  const changed: MindNode[] = [];
  const visit = (node: MindNode): void => {
    const relocated = relocateNode(previous, node);

    if (
      sameTaskShape(node, relocated ?? undefined) &&
      node.checked !== relocated?.checked
    ) {
      changed.push(node);
    }
    node.children.forEach(visit);
  };

  visit(current);
  if (!changed.length) {
    return [];
  }

  const explicitlyChanged = new Set(changed);
  const desired = new Map<MindNode, boolean>();

  // A parent-only edit is an explicit command for its unchanged descendants.
  changed.forEach((node) => {
    const descendants = descendantTasks(node);

    if (!descendants.some((child) => explicitlyChanged.has(child))) {
      descendants.forEach((child) => desired.set(child, node.checked!));
    }
  });

  // Recompute only ancestors of an edited task, deepest first. This avoids
  // changing an unrelated inconsistent branch merely because it was opened.
  const ancestors = new Set<MindNode>();

  changed.forEach((node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.checked !== null && !explicitlyChanged.has(parent)) {
        ancestors.add(parent);
      }
    }
  });
  [...ancestors]
    .sort((a, b) => b.level - a.level)
    .forEach((parent) => {
      const children = childTasks(parent);
      const checked =
        children.length > 0 &&
        children.every((child) => desired.get(child) ?? child.checked === true);

      desired.set(parent, checked);
    });

  return [...desired]
    .filter(([node, checked]) => node.checked !== checked)
    .map(([node, checked]) => ({ node, checked }));
}
