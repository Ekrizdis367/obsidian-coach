import { App, TFile, TFolder, debounce } from "obsidian";
import { collectMarkdownFiles } from "../utils/vault-files";
import type { MealType, NutritionTotals, RecipeInfo } from "../types";

export interface RecipeIndexDeps {
	getFolders: () => string[];
	onChanged: () => void;
}

export class RecipeIndex {
	private byPath = new Map<string, RecipeInfo>();
	private byBasename = new Map<string, string>();
	private subscribers = new Set<() => void>();
	private app: App;
	private deps: RecipeIndexDeps;
	private readonly debouncedRebuild: () => void;

	constructor(app: App, deps: RecipeIndexDeps) {
		this.app = app;
		this.deps = deps;
		this.debouncedRebuild = debounce(() => {
			this.rebuildAll();
			this.notify();
		}, 400, true);
	}

	rebuild(): void {
		this.rebuildAll();
		this.notify();
	}

	scheduleRebuild(): void {
		this.debouncedRebuild();
	}

	subscribe(callback: () => void): () => void {
		this.subscribers.add(callback);
		return () => {
			this.subscribers.delete(callback);
		};
	}

	onFileChange(file: TFile): void {
		if (file.extension !== "md") return;
		if (!this.isInsideFolder(file.path)) {
			if (this.byPath.delete(file.path)) {
				this.rebuildBasenameIndex();
				this.notify();
			}
			return;
		}
		const info = this.readRecipe(file);
		if (info) {
			this.byPath.set(file.path, info);
		} else {
			this.byPath.delete(file.path);
		}
		this.rebuildBasenameIndex();
		this.notify();
	}

	onFileDelete(path: string): void {
		if (this.byPath.delete(path)) {
			this.rebuildBasenameIndex();
			this.notify();
		}
	}

	onFileRename(oldPath: string, file: TFile): void {
		const had = this.byPath.delete(oldPath);
		if (had) {
			const info = this.readRecipe(file);
			if (info) this.byPath.set(file.path, info);
			this.rebuildBasenameIndex();
			this.notify();
			return;
		}
		this.onFileChange(file);
	}

	private notify(): void {
		this.deps.onChanged();
		for (const fn of this.subscribers) {
			try {
				fn();
			} catch (err) {
				console.error("RecipeIndex subscriber failed", err);
			}
		}
	}

	getAll(): RecipeInfo[] {
		return Array.from(this.byPath.values()).sort((a, b) => a.basename.localeCompare(b.basename));
	}

	getByPath(path: string): RecipeInfo | null {
		return this.byPath.get(path) ?? null;
	}

	resolve(reference: string): RecipeInfo | null {
		if (!reference) return null;
		const direct = this.byPath.get(reference);
		if (direct) return direct;
		const withMd = reference.endsWith(".md") ? reference : `${reference}.md`;
		const direct2 = this.byPath.get(withMd);
		if (direct2) return direct2;
		const file = this.app.metadataCache.getFirstLinkpathDest(reference, "");
		if (file) {
			const info = this.byPath.get(file.path);
			if (info) return info;
		}
		const base = baseName(reference);
		const path = this.byBasename.get(base.toLowerCase());
		if (path) return this.byPath.get(path) ?? null;
		return null;
	}

	private rebuildAll(): void {
		this.byPath.clear();
		this.byBasename.clear();
		const folders = this.normalizedFolders();
		const files =
			folders.length > 0
				? folders.flatMap((folder) => this.markdownFilesInFolder(folder))
				: collectMarkdownFiles(this.app.vault.getRoot());
		for (const file of files) {
			const info = this.readRecipe(file);
			if (info) this.byPath.set(file.path, info);
		}
		this.rebuildBasenameIndex();
	}

	private markdownFilesInFolder(folderPath: string): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) return [];
		return collectMarkdownFiles(folder);
	}

	private rebuildBasenameIndex(): void {
		this.byBasename.clear();
		for (const info of this.byPath.values()) {
			this.byBasename.set(info.basename.toLowerCase(), info.path);
		}
	}

	private readRecipe(file: TFile): RecipeInfo | null {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) return null;
		const nutrition = readNutrition(fm);
		if (!nutrition) return null;
		return {
			path: file.path,
			basename: file.basename,
			nutrition,
			type: detectMealType(fm, file.path),
		};
	}

	private isInsideFolder(path: string): boolean {
		const folders = this.normalizedFolders();
		if (folders.length === 0) return true;
		return this.isInsideAnyFolder(path, folders);
	}

	private isInsideAnyFolder(path: string, folders: string[]): boolean {
		const normalizedPath = path.replace(/^\/+/, "");
		for (const folder of folders) {
			if (folder === "") return true;
			if (normalizedPath === folder || normalizedPath.startsWith(folder + "/")) {
				return true;
			}
		}
		return false;
	}

	private normalizedFolders(): string[] {
		return this.deps.getFolders().map(normalizeFolder).filter((f) => f.length > 0);
	}
}

function detectMealType(fm: Record<string, unknown>, path: string): MealType {
	const lookup = buildLowercaseLookup(fm);
	for (const key of ["type", "mealtype", "category"]) {
		const fromFm = normalizeMealType(lookup.get(key));
		if (fromFm) return fromFm;
	}
	return inferTypeFromPath(path);
}

function normalizeMealType(value: unknown): MealType | null {
	if (typeof value !== "string") return null;
	const lower = value.toLowerCase().trim();
	if (lower.length === 0) return null;
	if (DRINK_TOKENS.has(lower)) return "drink";
	if (SNACK_TOKENS.has(lower)) return "snack";
	if (MEAL_TOKENS.has(lower)) return "meal";
	return null;
}

function inferTypeFromPath(path: string): MealType {
	const segments = path.toLowerCase().split("/");
	for (const segment of segments) {
		if (DRINK_TOKENS.has(segment)) return "drink";
		if (SNACK_TOKENS.has(segment)) return "snack";
	}
	return "meal";
}

const DRINK_TOKENS = new Set([
	"drink",
	"drinks",
	"beverage",
	"beverages",
	"smoothie",
	"smoothies",
	"shake",
	"shakes",
]);

const SNACK_TOKENS = new Set([
	"snack",
	"snacks",
	"appetizer",
	"appetizers",
	"dessert",
	"desserts",
]);

const MEAL_TOKENS = new Set([
	"meal",
	"meals",
	"main",
	"mains",
	"dish",
	"dishes",
	"breakfast",
	"lunch",
	"dinner",
	"dinners",
	"supper",
	"entree",
	"entrees",
]);

function readNutrition(fm: Record<string, unknown>): NutritionTotals | null {
	const lookup = buildLowercaseLookup(fm);
	const calories = toNonNegative(lookup.get("calories"));
	const protein = toNonNegative(lookup.get("protein"));
	const carbs = toNonNegative(lookup.get("carbs") ?? lookup.get("carb"));
	const fats = toNonNegative(lookup.get("fats") ?? lookup.get("fat"));
	const fiber = toNonNegative(lookup.get("fiber") ?? lookup.get("fibre"));
	if (
		calories === null
		&& protein === null
		&& carbs === null
		&& fats === null
		&& fiber === null
	) {
		return null;
	}

	const totals: NutritionTotals = {
		calories: calories ?? 0,
		protein: protein ?? 0,
		carbs: carbs ?? 0,
		fats: fats ?? 0,
		fiber: fiber ?? 0,
	};

	const servings = toNonNegative(lookup.get("servings"));
	if (servings !== null && servings > 0 && servings !== 1) {
		totals.calories /= servings;
		totals.protein /= servings;
		totals.carbs /= servings;
		totals.fats /= servings;
		totals.fiber /= servings;
	}

	return totals;
}

function buildLowercaseLookup(fm: Record<string, unknown>): Map<string, unknown> {
	const out = new Map<string, unknown>();
	for (const [key, value] of Object.entries(fm)) {
		out.set(key.toLowerCase(), value);
	}
	return out;
}

function toNonNegative(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
	if (typeof value === "string") {
		const n = parseFloat(value);
		if (Number.isFinite(n) && n >= 0) return n;
	}
	return null;
}

function baseName(reference: string): string {
	const trimmed = reference.replace(/\.md$/i, "");
	const slash = trimmed.lastIndexOf("/");
	return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

function normalizeFolder(folder: string): string {
	return folder.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}
