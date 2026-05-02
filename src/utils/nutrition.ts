import type { MealEntry, MealType, NutritionTotals } from "../types";
import type { RecipeIndex } from "../data/recipe-index";

export const EMPTY_TOTALS: NutritionTotals = {
	calories: 0,
	protein: 0,
	carbs: 0,
	fats: 0,
	fiber: 0,
};

export interface ResolvedMeal {
	entry: MealEntry;
	totals: NutritionTotals;
	missing: boolean;
	displayName: string;
	type: MealType | null;
	freeform: boolean;
}

export function resolveMeal(entry: MealEntry, recipes: RecipeIndex): ResolvedMeal {
	const recipe = entry.recipe ? recipes.resolve(entry.recipe) : null;
	if (recipe) {
		const servings = entry.servings;
		return {
			entry,
			missing: false,
			freeform: false,
			displayName: entry.name ?? recipe.basename,
			type: recipe.type,
			totals: scale(recipe.nutrition, servings),
		};
	}

	if (entry.nutrition) {
		const servings = entry.servings;
		return {
			entry,
			missing: false,
			freeform: !entry.recipe,
			displayName: entry.name ?? entry.recipe ?? "Custom entry",
			type: null,
			totals: scale(entry.nutrition, servings),
		};
	}

	return {
		entry,
		totals: { ...EMPTY_TOTALS },
		missing: true,
		freeform: false,
		displayName: entry.name ?? entry.recipe ?? "Unknown",
		type: null,
	};
}

function scale(totals: NutritionTotals, servings: number): NutritionTotals {
	return {
		calories: totals.calories * servings,
		protein: totals.protein * servings,
		carbs: totals.carbs * servings,
		fats: totals.fats * servings,
		fiber: totals.fiber * servings,
	};
}

export function sumTotals(items: NutritionTotals[]): NutritionTotals {
	return items.reduce<NutritionTotals>(
		(acc, t) => ({
			calories: acc.calories + t.calories,
			protein: acc.protein + t.protein,
			carbs: acc.carbs + t.carbs,
			fats: acc.fats + t.fats,
			fiber: acc.fiber + t.fiber,
		}),
		{ ...EMPTY_TOTALS },
	);
}

export function formatGrams(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}

export function formatCalories(value: number): string {
	return Math.round(value).toString();
}

export function formatServings(value: number): string {
	const rounded = Math.round(value * 100) / 100;
	if (Number.isInteger(rounded)) return rounded.toString();
	return rounded.toString();
}
