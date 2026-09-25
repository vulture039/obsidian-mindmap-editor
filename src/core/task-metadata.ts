/** Metadata kept at the end of a task title, where it stays portable Markdown. */
export type TaskPriority = 'highest' | 'high' | 'medium' | 'low';

export interface TaskMetadata {
  title: string;
  priority: TaskPriority | null;
  dueDate: string | null;
}

const PRIORITY_MARKS: Record<TaskPriority, string> = {
  highest: '❗',
  high: '▲',
  medium: '●',
  low: '▼',
};

const MARK_PRIORITY = new Map(
  Object.entries(PRIORITY_MARKS).map(([priority, mark]) => [
    mark,
    priority as TaskPriority,
  ]),
);
const DUE_DATE_RE = /\s+📅\s+(\d{4}-\d{2}-\d{2})\s*$/u;
const PRIORITY_RE = /\s+(❗|▲|●|▼)\s*$/u;

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

/** Separates the map label from recognized terminal task metadata. */
export function parseTaskMetadata(text: string): TaskMetadata {
  let title = text.trim();
  let dueDate: string | null = null;
  let priority: TaskPriority | null = null;

  while (true) {
    const date = DUE_DATE_RE.exec(title);

    if (date?.[1] && validDate(date[1])) {
      dueDate = date[1];
      title = title.slice(0, date.index).trimEnd();
      continue;
    }
    const mark = PRIORITY_RE.exec(title);

    if (mark?.[1]) {
      priority = MARK_PRIORITY.get(mark[1]) ?? null;
      title = title.slice(0, mark.index).trimEnd();
      continue;
    }
    break;
  }

  return { title, priority, dueDate };
}

export function priorityMark(priority: TaskPriority): string {
  return PRIORITY_MARKS[priority];
}

/** Writes metadata in one canonical order, keeping a plain title untouched. */
export function formatTaskMetadata(
  title: string,
  metadata: Pick<TaskMetadata, 'priority' | 'dueDate'>,
): string {
  const parts = [title.trimEnd()];

  if (metadata.priority) {
    parts.push(priorityMark(metadata.priority));
  }
  if (metadata.dueDate) {
    parts.push(`📅 ${metadata.dueDate}`);
  }

  return parts.join(' ');
}
