/** Zero-pad a non-negative integer to at least `width` digits. */
export function padNumber(value: number, width: number): string {
	const n = Math.trunc(Math.abs(value));
	const s = n.toString();
	if (s.length >= width) return s;
	return "0".repeat(width - s.length) + s;
}
