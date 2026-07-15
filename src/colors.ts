export const PALETTE = [
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

/** Parses "Heading text: #rrggbb" lines from the settings textarea. */
export function parseColorOverrides(raw: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const line of raw.split('\n')) {
		const i = line.lastIndexOf(':');
		if (i < 0) continue;
		const key = line.slice(0, i).trim();
		const value = line.slice(i + 1).trim();
		if (key && value) map.set(key, value);
	}
	return map;
}

export function branchColorFor(
	text: string,
	index: number,
	overrides: Map<string, string>,
): string {
	const override = overrides.get(text);
	if (override) return override;
	return PALETTE[index % PALETTE.length] ?? '#888888';
}
