import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	Notice,
	TFile,
	debounce,
	setIcon,
} from "obsidian";
import type {
	MealEntry,
	MealFavorite,
	MealType,
	MealsBlock,
	NutritionGoals,
	NutritionTotals,
	WeightUnit,
} from "../types";
import { parseMealsBlock, updateMealsBlock } from "../data/meals-block";
import { RecipeIndex } from "../data/recipe-index";
import {
	formatCalories,
	formatGrams,
	formatServings,
	resolveMeal,
	sumTotals,
} from "../utils/nutrition";
import { generateId } from "../settings";
import { waterUnitFor } from "../utils/format";
import { RecipeSuggestModal } from "./recipe-suggest-modal";
import { CustomMealModal } from "./custom-meal-modal";
import { FavoritePickerModal } from "./favorite-picker-modal";
import { FavoriteEditModal } from "./favorite-edit-modal";
import { renderWaterTracker, resolveWaterStep, resolveWaterTarget } from "./water-renderer";

export interface MealsRendererDeps {
	app: App;
	recipes: RecipeIndex;
	getGoals: () => NutritionGoals;
	getRecipesFolders: () => string[];
	getTrackFiber: () => boolean;
	getWeightUnit: () => WeightUnit;
	getWaterTarget: () => number | null;
	getWaterStep: () => number | null;
	getMealFavorites: () => MealFavorite[];
	saveMealFavorites: (next: MealFavorite[]) => Promise<void>;
}

interface MacroInfo {
	key: keyof NutritionTotals;
	label: string;
	className: string;
}

const TYPE_ICONS: Record<MealType, string> = {
	drink: "cup-soda",
	snack: "cookie",
	meal: "utensils",
};

const TYPE_LABELS: Record<MealType, string> = {
	drink: "Drink",
	snack: "Snack",
	meal: "Meal",
};

export function registerMealsBlockProcessor(
	register: (
		language: string,
		handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void,
	) => void,
	deps: MealsRendererDeps,
): void {
	register("meals", (source, el, ctx) => {
		renderMealsBlock(source, el, ctx, deps);
	});
}

function renderMealsBlock(
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	deps: MealsRendererDeps,
): void {
	let block: MealsBlock;
	try {
		block = parseMealsBlock(source);
	} catch (err) {
		const errorEl = el.createDiv({ cls: "wp-error" });
		errorEl.setText(`Meals block error: ${(err as Error).message}`);
		return;
	}

	const container = el.createDiv({ cls: "wp-meals" });
	const file = deps.app.vault.getAbstractFileByPath(ctx.sourcePath);
	const targetFile = file instanceof TFile ? file : null;

	const persist = debounce(async (next: MealsBlock) => {
		if (!targetFile) return;
		try {
			await updateMealsBlock(deps.app, targetFile, source, next);
		} catch (err) {
			new Notice(`Failed to save meals: ${(err as Error).message}`);
		}
	}, 400, true);

	const state: MealsBlock = {
		date: block.date,
		entries: block.entries.map(cloneEntry),
		water: block.water,
	};

	const rerender = () => {
		container.empty();
		renderInner(container, state, deps, persist, rerender);
	};
	renderInner(container, state, deps, persist, rerender);

	const child = new MarkdownRenderChild(container);
	const unsubscribe = deps.recipes.subscribe(() => {
		rerender();
	});
	child.register(unsubscribe);
	ctx.addChild(child);
}

function renderInner(
	container: HTMLElement,
	state: MealsBlock,
	deps: MealsRendererDeps,
	persist: (next: MealsBlock) => void,
	rerender: () => void,
): void {
	renderHeader(container, state);

	const goals = deps.getGoals();
	const resolved = state.entries.map((entry) => resolveMeal(entry, deps.recipes));
	const totals = sumTotals(resolved.map((r) => r.totals));

	renderGoals(container, totals, goals, state, deps, persist, rerender);
	renderEntries(container, state, resolved, deps, persist, rerender);
	renderActions(container, state, deps, persist, rerender);
}

function renderHeader(container: HTMLElement, block: MealsBlock): void {
	const header = container.createDiv({ cls: "wp-meals-header" });
	header.createDiv({ cls: "wp-meals-title", text: "Meals" });
	if (block.date) {
		header.createDiv({ cls: "wp-meals-date", text: block.date });
	}
}

function renderGoals(
	parent: HTMLElement,
	totals: NutritionTotals,
	goals: NutritionGoals,
	state: MealsBlock,
	deps: MealsRendererDeps,
	persist: (next: MealsBlock) => void,
	rerender: () => void,
): void {
	const trackFiber = deps.getTrackFiber();
	const macros: MacroInfo[] = [
		{ key: "calories", label: "Cals", className: "wp-macro--calories" },
		{ key: "protein", label: "Protein", className: "wp-macro--protein" },
		{ key: "carbs", label: "Carbs", className: "wp-macro--carbs" },
		{ key: "fats", label: "Fats", className: "wp-macro--fats" },
	];
	if (trackFiber) {
		macros.push({ key: "fiber", label: "Fiber", className: "wp-macro--fiber" });
	}

	const wrap = parent.createDiv({ cls: "wp-meals-goals" });
	if (trackFiber) wrap.addClass("wp-meals-goals--with-fiber");

	for (const macro of macros) {
		const value = totals[macro.key];
		const goal = Math.max(0, goals[macro.key]);
		const ratio = goal > 0 ? Math.min(value / goal, 1) : 0;
		const over = goal > 0 && value > goal;

		const cell = wrap.createDiv({ cls: `wp-macro ${macro.className}` });
		const head = cell.createDiv({ cls: "wp-macro-head" });
		head.createSpan({ cls: "wp-macro-label", text: macro.label });
		const valueText = macro.key === "calories"
			? `${formatCalories(value)} / ${formatCalories(goal)}`
			: `${formatGrams(value)} / ${formatGrams(goal)}`;
		head.createSpan({ cls: "wp-macro-value", text: valueText });

		const bar = cell.createDiv({ cls: "wp-macro-bar" });
		const fill = bar.createDiv({ cls: "wp-macro-bar-fill" });
		fill.style.width = `${Math.round(ratio * 100)}%`;
		if (over) fill.addClass("wp-macro-bar-fill--over");

		if (over) {
			const overText = macro.key === "calories"
				? `${formatCalories(value - goal)} over`
				: `${formatGrams(value - goal)} over`;
			cell.createDiv({ cls: "wp-macro-over", text: overText });
		} else if (goal > 0) {
			const remaining = goal - value;
			const remainText = macro.key === "calories"
				? `${formatCalories(remaining)} left`
				: `${formatGrams(remaining)} left`;
			cell.createDiv({ cls: "wp-macro-remaining", text: remainText });
		}
	}

	const waterCell = wrap.createDiv({ cls: "wp-water wp-water--embedded" });
	const unit = waterUnitFor(deps.getWeightUnit());
	const target = resolveWaterTarget(undefined, deps.getWaterTarget(), unit);
	const step = resolveWaterStep(deps.getWaterStep(), unit);
	renderWaterTracker(waterCell, {
		amount: state.water ?? 0,
		unit,
		target,
		step,
		onChange: (next) => {
			state.water = next > 0 ? next : 0;
			persist(state);
			rerender();
		},
	});
}

function renderEntries(
	parent: HTMLElement,
	state: MealsBlock,
	resolved: ReturnType<typeof resolveMeal>[],
	deps: MealsRendererDeps,
	persist: (next: MealsBlock) => void,
	rerender: () => void,
): void {
	const wrap = parent.createDiv({ cls: "wp-meals-entries" });

	if (state.entries.length === 0) {
		wrap.createDiv({ cls: "wp-empty wp-meals-empty", text: "No meals yet. Add one to start tracking today." });
		return;
	}

	for (let i = 0; i < state.entries.length; i++) {
		const entry = state.entries[i];
		const meal = resolved[i];
		if (!entry || !meal) continue;
		renderEntryRow(wrap, state, entry, meal, i, deps, persist, rerender);
	}
}

function renderEntryRow(
	parent: HTMLElement,
	state: MealsBlock,
	entry: MealEntry,
	meal: ReturnType<typeof resolveMeal>,
	index: number,
	deps: MealsRendererDeps,
	persist: (next: MealsBlock) => void,
	rerender: () => void,
): void {
	const row = parent.createDiv({ cls: "wp-meal-row" });
	if (meal.missing) row.addClass("wp-meal-row--missing");
	if (meal.freeform) row.addClass("wp-meal-row--freeform");

	const servingsInput = row.createEl("input", { cls: "wp-meal-qty" });
	servingsInput.type = "number";
	servingsInput.min = "0";
	servingsInput.step = "0.25";
	servingsInput.value = formatServings(entry.servings);
	servingsInput.title = entry.servings === 1 ? "1 serving" : `${formatServings(entry.servings)} servings`;
	servingsInput.setAttribute("aria-label", "Servings");

	servingsInput.addEventListener("change", () => {
		const raw = servingsInput.value.trim();
		const parsed = parseFloat(raw);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			servingsInput.value = formatServings(entry.servings);
			return;
		}
		entry.servings = Math.round(parsed * 100) / 100;
		persist(state);
		rerender();
	});

	const nameWrap = row.createDiv({ cls: "wp-meal-name" });
	if (meal.missing) {
		nameWrap.createSpan({ cls: "wp-meal-missing-icon", text: "!" });
		nameWrap.createSpan({ text: entry.recipe ?? entry.name ?? "Unknown" });
		nameWrap.title = "Recipe not found in the configured recipes folder.";
	} else if (meal.freeform) {
		const iconWrap = nameWrap.createSpan({ cls: "wp-meal-type wp-meal-type--freeform" });
		setIcon(iconWrap, "edit-3");
		iconWrap.setAttribute("aria-label", "Custom entry");
		const text = nameWrap.createSpan({ cls: "wp-meal-link wp-meal-link--freeform", text: meal.displayName });
		text.title = "Custom entry — click to edit nutrition";
		text.addEventListener("click", () => openEditFreeform(state, entry, deps, persist, rerender));
	} else {
		if (meal.type) {
			const iconWrap = nameWrap.createSpan({ cls: `wp-meal-type wp-meal-type--${meal.type}` });
			setIcon(iconWrap, TYPE_ICONS[meal.type]);
			iconWrap.setAttribute("aria-label", TYPE_LABELS[meal.type]);
		}
		const link = nameWrap.createEl("a", { text: meal.displayName, cls: "wp-meal-link" });
		link.href = "#";
		link.addEventListener("click", (e) => {
			e.preventDefault();
			if (entry.recipe) void deps.app.workspace.openLinkText(entry.recipe, "");
		});
	}

	const macros = row.createDiv({ cls: "wp-meal-macros" });
	if (meal.missing) {
		macros.setText("No nutrition data");
	} else {
		const t = meal.totals;
		const hasFiber = t.fiber > 0;
		const fiberSeg = hasFiber ? ` / ${formatGrams(t.fiber)}Fb` : "";
		macros.setText(
			`${formatCalories(t.calories)}CAL · ${formatGrams(t.protein)}P / ${formatGrams(t.carbs)}C / ${formatGrams(t.fats)}F${fiberSeg}`,
		);
	}

	// "Favorited" = at least one saved favorite already references this
	// recipe (or, for freeform entries, matches by name). When favorited
	// we render a filled star and let the user untoggle it.
	const matchingFavorites = matchingFavoritesFor(entry, deps.getMealFavorites());
	const isFavorited = matchingFavorites.length > 0;
	const favBtn = row.createEl("button", {
		cls: "wp-meal-fav",
		attr: { "aria-label": isFavorited ? "Remove favorite" : "Save as favorite" },
	});
	if (isFavorited) favBtn.addClass("wp-meal-fav--active");
	setIcon(favBtn, "star");
	favBtn.title = isFavorited
		? "Saved as a favorite — click to remove"
		: "Save this entry as a favorite";
	favBtn.addEventListener("click", () => {
		if (isFavorited) {
			void removeMatchingFavorites(matchingFavorites, deps, rerender);
		} else {
			openSaveAsFavorite(entry, meal, deps, rerender);
		}
	});

	const removeBtn = row.createEl("button", { cls: "wp-meal-remove", attr: { "aria-label": "Remove meal" } });
	setIcon(removeBtn, "x");
	removeBtn.addEventListener("click", () => {
		state.entries.splice(index, 1);
		persist(state);
		rerender();
	});
}

function openSaveAsFavorite(
	entry: MealEntry,
	meal: ReturnType<typeof resolveMeal>,
	deps: MealsRendererDeps,
	rerender: () => void,
): void {
	if (meal.missing) {
		new Notice("Can't save a favorite for a missing recipe.");
		return;
	}
	new FavoriteEditModal(
		deps.app,
		"create",
		{
			name: meal.displayName,
			servings: entry.servings,
			recipe: entry.recipe,
			nutrition: entry.recipe ? undefined : entry.nutrition,
		},
		async (result) => {
			const favorites = [...deps.getMealFavorites()];
			const next: MealFavorite = {
				id: generateId("fav"),
				name: result.name,
				servings: result.servings,
			};
			if (result.recipe) next.recipe = result.recipe;
			if (result.nutrition) next.nutrition = result.nutrition;
			favorites.push(next);
			await deps.saveMealFavorites(favorites);
			new Notice(`Saved "${result.name}" to favorites.`);
			// Re-render so the star on the source row flips to filled.
			rerender();
		},
	).open();
}

/**
 * Returns the favorites that match a given meal entry. Recipe-based
 * entries match on `recipe` path; freeform entries match on a
 * case-insensitive name comparison (and only against favorites that are
 * themselves freeform — i.e. have no recipe).
 */
function matchingFavoritesFor(entry: MealEntry, favorites: MealFavorite[]): MealFavorite[] {
	if (entry.recipe) {
		return favorites.filter((f) => f.recipe === entry.recipe);
	}
	const name = (entry.name ?? "").trim().toLowerCase();
	if (!name) return [];
	return favorites.filter((f) => !f.recipe && f.name.trim().toLowerCase() === name);
}

async function removeMatchingFavorites(
	matches: MealFavorite[],
	deps: MealsRendererDeps,
	rerender: () => void,
): Promise<void> {
	const ids = new Set(matches.map((f) => f.id));
	const next = deps.getMealFavorites().filter((f) => !ids.has(f.id));
	await deps.saveMealFavorites(next);
	const first = matches[0];
	const label = matches.length === 1 && first
		? `"${first.name}"`
		: `${matches.length} favorites`;
	new Notice(`Removed ${label} from favorites.`);
	rerender();
}

function openEditFreeform(
	state: MealsBlock,
	entry: MealEntry,
	deps: MealsRendererDeps,
	persist: (next: MealsBlock) => void,
	rerender: () => void,
): void {
	new CustomMealModal(
		deps.app,
		{
			name: entry.name ?? "",
			servings: entry.servings,
			nutrition: entry.nutrition,
		},
		(result) => {
			entry.name = result.name;
			entry.servings = result.servings;
			entry.nutrition = result.nutrition;
			delete entry.recipe;
			persist(state);
			rerender();
		},
	).open();
}

function renderActions(
	parent: HTMLElement,
	state: MealsBlock,
	deps: MealsRendererDeps,
	persist: (next: MealsBlock) => void,
	rerender: () => void,
): void {
	const actions = parent.createDiv({ cls: "wp-meals-actions" });

	const addBtn = actions.createEl("button", { cls: "wp-btn", text: "Add meal" });
	addBtn.addEventListener("click", () => {
		const recipes = deps.recipes.getAll();
		if (recipes.length === 0) {
			const folders = deps.getRecipesFolders().map((f) => f.trim()).filter((f) => f.length > 0);
			if (folders.length === 0) {
				new Notice("Set at least one recipes folder in plugin settings to add meals.");
			} else {
				const list = folders.map((f) => `'${f}'`).join(", ");
				new Notice(`No recipes with nutrition frontmatter found in ${list}.`);
			}
			return;
		}
		new RecipeSuggestModal(deps.app, recipes, (recipe) => {
			state.entries.push({ recipe: recipe.path, servings: 1 });
			persist(state);
			rerender();
		}).open();
	});

	const customBtn = actions.createEl("button", { cls: "wp-btn", text: "Add custom" });
	customBtn.title = "Log a one-off meal without a recipe note";
	customBtn.addEventListener("click", () => {
		new CustomMealModal(deps.app, null, (result) => {
			state.entries.push({
				name: result.name,
				servings: result.servings,
				nutrition: result.nutrition,
			});
			persist(state);
			rerender();
		}).open();
	});

	const favorites = deps.getMealFavorites();
	const favBtn = actions.createEl("button", { cls: "wp-btn wp-btn-favorite", text: "Favorite" });
	if (favorites.length === 0) {
		favBtn.title = "Save a favorite first by clicking the star on any entry, or add one in plugin settings.";
	} else {
		favBtn.title = `Insert from ${favorites.length} saved favorite${favorites.length === 1 ? "" : "s"}`;
	}
	favBtn.addEventListener("click", () => {
		const list = deps.getMealFavorites();
		if (list.length === 0) {
			new Notice("No favorites yet. Click the star on a meal entry to save one.");
			return;
		}
		new FavoritePickerModal(deps.app, list, deps.recipes, (favorite) => {
			state.entries.push(favoriteToEntry(favorite));
			persist(state);
			rerender();
		}).open();
	});
}

function favoriteToEntry(fav: MealFavorite): MealEntry {
	const entry: MealEntry = { servings: fav.servings };
	if (fav.recipe) {
		entry.recipe = fav.recipe;
	} else {
		entry.name = fav.name;
		if (fav.nutrition) entry.nutrition = { ...fav.nutrition };
	}
	return entry;
}

function cloneEntry(entry: MealEntry): MealEntry {
	const out: MealEntry = { servings: entry.servings };
	if (entry.recipe) out.recipe = entry.recipe;
	if (entry.name) out.name = entry.name;
	if (entry.nutrition) out.nutrition = { ...entry.nutrition };
	if (entry.note) out.note = entry.note;
	return out;
}
