export const DEFAULT_PALETTE = [
	'#3b82f6', // blue
	'#ef4444', // red
	'#22c55e', // green
	'#f59e0b', // amber
	'#a855f7', // purple
	'#06b6d4', // cyan
	'#ec4899', // pink
	'#84cc16', // lime
	'#f97316', // orange
	'#6366f1', // indigo
	'#14b8a6', // teal
	'#eab308', // yellow
];

/** Parses one color per line from the settings textarea. Falls back to
 *  the default palette if the result would otherwise be empty. */
export function parsePalette(raw: string): string[] {
	const colors = raw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	return colors.length > 0 ? colors : DEFAULT_PALETTE;
}

export function branchColorFor(index: number, palette: string[]): string {
	// palette is always non-empty: parsePalette guarantees it.
	return palette[index % palette.length]!;
}
