// Shared Markdown-structure patterns. Parsing (parser.ts) and line editing
// (markdown-ops.ts) both build on these, so keeping them in one place is what
// guarantees the two stay in agreement about what a heading, list item, or
// task checkbox looks like.

/** Regex source for a list bullet ('-', '*', '+', '1.', '1)'). */
const LIST_MARKER_SRC = String.raw`[-*+]|\d+[.)]`;

/** The checkbox states a task item can be written with. */
const CHECKBOX_STATE = String.raw`[ xX]`;

/** A list line's leading indent + marker + trailing space (indent uncaptured). */
const LIST_PREFIX_SRC = String.raw`\s*(?:${LIST_MARKER_SRC})\s+`;

/** Heading line: `## text`, capturing the hashes and the text. */
export const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** Heading line with optional trailing content, used when shifting levels. */
export const HEADING_SHIFT_RE = /^(#{1,6})(\s.*)?$/;

/** List line, capturing indent, marker, checkbox state (if any), and text. */
export const LIST_RE = new RegExp(
  String.raw`^(\s*)(${LIST_MARKER_SRC})\s+(?:\[(${CHECKBOX_STATE})\](?:\s+|$))?(.*)$`,
);

/** Opening or closing code fence (``` or ~~~). */
export const FENCE_RE = /^\s*(```|~~~)/;

/** A task line's `- [` prefix and `]`, around the state character. */
export const CHECKBOX_RE = new RegExp(
  String.raw`^(${LIST_PREFIX_SRC}\[)${CHECKBOX_STATE}(\])`,
);

/** A list item's prefix up to and including any checkbox, captured. */
export const LIST_PREFIX_RE = new RegExp(
  String.raw`^(${LIST_PREFIX_SRC}(?:\[${CHECKBOX_STATE}\]\s+)?)`,
);

/** A list item's marker prefix (no checkbox), captured. */
export const MARKER_PREFIX_RE = new RegExp(String.raw`^(${LIST_PREFIX_SRC})`);

/** A task item's marker prefix (captured) followed by its checkbox. */
export const TASK_BOX_RE = new RegExp(
  String.raw`^(${LIST_PREFIX_SRC})\[${CHECKBOX_STATE}\]\s*`,
);

/** An indented list line, capturing the indent (used to detect indent unit). */
export const INDENTED_LIST_RE = new RegExp(
  String.raw`^(\s+)(?:${LIST_MARKER_SRC})\s`,
);
