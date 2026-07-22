export const DEFAULT_PALETTE = [
	'#3b82f6',
	'#ef4444',
	'#22c55e',
	'#f59e0b',
	'#a855f7',
	'#06b6d4',
	'#ec4899',
	'#84cc16',
	'#f97316',
	'#6366f1',
	'#14b8a6',
	'#eab308',
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
