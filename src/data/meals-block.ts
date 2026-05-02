import { App, parseYaml, stringifyYaml, TFile } from "obsidian";
import type { MealEntry, MealsBlock, NutritionTotals } from "../types";

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})\s*meals\s*$/;
const WIKILINK_RE = /^\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/;

export function parseMealsBlock(source: string): MealsBlock {
	const trimmed = source.trim();
	if (trimmed.length === 0) return { entries: [] };

	let raw: unknown;
	try {
		raw = parseYaml(source);
	} catch (err) {
		throw new Error(`Could not parse meals block: ${(err as Error).message}`);
	}

	return normalizeBlock(raw);
}

function normalizeBlock(raw: unknown): MealsBlock {
	if (!isRecord(raw)) return { entries: [] };

	const entriesRaw = Array.isArray(raw.entries) ? raw.entries : [];
	const entries: MealEntry[] = entriesRaw
		.map(normalizeEntry)
		.filter((e): e is MealEntry => e !== null);

	const block: MealsBlock = { entries };
	if (typeof raw.date === "string") block.date = raw.date;
	const water = toFiniteNumber(raw.water);
	if (water !== null && water >= 0) {
		block.water = Math.round(water);
	}
	return block;
}

function toFiniteNumber(value: unknown): number | null {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return null;
	return n;
}

function normalizeEntry(raw: unknown): MealEntry | null {
	if (!isRecord(raw)) return null;
	const recipe = normalizeRecipeRef(raw.recipe);
	const name = typeof raw.name === "string" && raw.name.trim().length > 0
		? raw.name.trim()
		: undefined;
	const nutrition = normalizeFreeformNutrition(raw.nutrition);
	const servings = toServings(raw.servings);

	const isFreeform = !recipe;
	if (isFreeform) {
		if (!name || !nutrition) return null;
		const entry: MealEntry = { name, nutrition, servings };
		if (typeof raw.note === "string" && raw.note.trim().length > 0) {
			entry.note = raw.note.trim();
		}
		return entry;
	}

	const entry: MealEntry = { recipe, servings };
	if (name) entry.name = name;
	if (nutrition) entry.nutrition = nutrition;
	if (typeof raw.note === "string" && raw.note.trim().length > 0) {
		entry.note = raw.note.trim();
	}
	return entry;
}

function normalizeFreeformNutrition(value: unknown): NutritionTotals | null {
	if (!isRecord(value)) return null;
	const calories = toNonNegativeNumber(value.calories);
	const protein = toNonNegativeNumber(value.protein);
	const carbs = toNonNegativeNumber(value.carbs ?? value.carb);
	const fats = toNonNegativeNumber(value.fats ?? value.fat);
	const fiber = toNonNegativeNumber(value.fiber);
	if (calories === 0 && protein === 0 && carbs === 0 && fats === 0 && fiber === 0) {
		return null;
	}
	return { calories, protein, carbs, fats, fiber };
}

function normalizeRecipeRef(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	const wiki = trimmed.match(WIKILINK_RE);
	if (wiki?.[1]) return wiki[1].trim();
	return trimmed;
}

function toServings(value: unknown): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n) || n <= 0) return 1;
	return Math.round(n * 100) / 100;
}

function toNonNegativeNumber(value: unknown): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n) || n < 0) return 0;
	return n;
}

export function serializeMealsBlock(block: MealsBlock): string {
	const out: Record<string, unknown> = {};
	if (block.date) out.date = block.date;
	out.entries = block.entries.map((e) => {
		const entry: Record<string, unknown> = { servings: e.servings };
		if (e.recipe) entry.recipe = e.recipe;
		if (e.name) entry.name = e.name;
		if (e.nutrition) {
			entry.nutrition = {
				calories: e.nutrition.calories,
				protein: e.nutrition.protein,
				carbs: e.nutrition.carbs,
				fats: e.nutrition.fats,
				fiber: e.nutrition.fiber,
			};
		}
		if (e.note) entry.note = e.note;
		return entry;
	});
	if (typeof block.water === "number" && block.water > 0) {
		out.water = Math.max(0, Math.round(block.water));
	}
	return stringifyYaml(out);
}

export interface MealsBlockLocation {
	startLine: number;
	endLine: number;
	contentStart: number;
	contentEnd: number;
}

export function findMealsBlock(
	fileText: string,
	desiredSource: string,
): MealsBlockLocation | null {
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

export async function updateMealsBlock(
	app: App,
	file: TFile,
	originalSource: string,
	updatedBlock: MealsBlock,
): Promise<void> {
	const newSource = serializeMealsBlock(updatedBlock).trimEnd();
	await app.vault.process(file, (data) => {
		const location = findMealsBlock(data, originalSource);
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

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
