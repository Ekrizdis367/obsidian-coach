import { App, parseYaml, stringifyYaml, TFile } from "obsidian";
import type { WaterBlock } from "../types";

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})\s*water\s*$/;

export function parseWaterBlock(source: string): WaterBlock {
	const trimmed = source.trim();
	if (trimmed.length === 0) return { amount: 0 };

	let raw: unknown;
	try {
		raw = parseYaml(source);
	} catch (err) {
		throw new Error(`Could not parse water block: ${(err as Error).message}`);
	}

	return normalizeBlock(raw);
}

function normalizeBlock(raw: unknown): WaterBlock {
	if (!isRecord(raw)) return { amount: 0 };
	const block: WaterBlock = { amount: toNonNegativeNumber(raw.amount) };
	if (typeof raw.date === "string") block.date = raw.date;
	const target = toPositiveNumber(raw.target);
	if (target !== null) block.target = Math.round(target);
	return block;
}

export function serializeWaterBlock(block: WaterBlock): string {
	const out: Record<string, unknown> = {};
	if (block.date) out.date = block.date;
	out.amount = Math.max(0, Math.round(block.amount));
	if (typeof block.target === "number" && block.target > 0) {
		out.target = Math.round(block.target);
	}
	return stringifyYaml(out);
}

export interface WaterBlockLocation {
	startLine: number;
	endLine: number;
	contentStart: number;
	contentEnd: number;
}

export function findWaterBlock(
	fileText: string,
	desiredSource: string,
): WaterBlockLocation | null {
	const lines = fileText.split("\n");
	const wantedKey = desiredSource.trim();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (typeof line !== "string") continue;
		const fenceMatch = line.match(FENCE_RE);
		if (!fenceMatch) continue;
		const fence = fenceMatch[1] ?? "";
		const fenceFirst = fence.charAt(0);
		const closeRe = new RegExp(`^[ \\t]*${escapeRegex(fenceFirst)}{${fence.length},}\\s*$`);

		let endLine = -1;
		for (let j = i + 1; j < lines.length; j++) {
			const candidate = lines[j];
			if (typeof candidate !== "string") continue;
			if (closeRe.test(candidate)) {
				endLine = j;
				break;
			}
		}
		if (endLine === -1) continue;

		const inner = lines.slice(i + 1, endLine).join("\n");
		if (inner.trim() === wantedKey) {
			return {
				startLine: i,
				endLine,
				contentStart: i + 1,
				contentEnd: endLine,
			};
		}
	}

	return null;
}

export async function updateWaterBlock(
	app: App,
	file: TFile,
	originalSource: string,
	updatedBlock: WaterBlock,
): Promise<void> {
	const newSource = serializeWaterBlock(updatedBlock).trimEnd();
	await app.vault.process(file, (data) => {
		const location = findWaterBlock(data, originalSource);
		if (!location) return data;
		const lines = data.split("\n");
		const before = lines.slice(0, location.contentStart);
		const after = lines.slice(location.contentEnd);
		return [...before, newSource, ...after].join("\n");
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonNegativeNumber(value: unknown): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n) || n < 0) return 0;
	return n;
}

function toPositiveNumber(value: unknown): number | null {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n) || n <= 0) return null;
	return n;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
