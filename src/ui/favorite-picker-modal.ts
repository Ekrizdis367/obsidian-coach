import { App, FuzzySuggestModal } from "obsidian";
import type { MealFavorite, NutritionTotals } from "../types";
import type { RecipeIndex } from "../data/recipe-index";
import { formatCalories, formatGrams, formatServings } from "../utils/nutrition";

/**
 * Quick picker for inserting a saved meal favorite. Shows each favorite with
 * its display name, default servings, and resolved per-serving macros so the
 * user can tell similar items apart at a glance.
 */
export class FavoritePickerModal extends FuzzySuggestModal<MealFavorite> {
	private favorites: MealFavorite[];
	private recipes: RecipeIndex;
	private onChoose: (favorite: MealFavorite) => void;

	constructor(
		app: App,
		favorites: MealFavorite[],
		recipes: RecipeIndex,
		onChoose: (favorite: MealFavorite) => void,
	) {
		super(app);
		this.favorites = favorites;
		this.recipes = recipes;
		this.onChoose = onChoose;
		this.setPlaceholder("Search favorites…");
	}

	getItems(): MealFavorite[] {
		return [...this.favorites].sort((a, b) => a.name.localeCompare(b.name));
	}

	getItemText(item: MealFavorite): string {
		const nutrition = this.resolveNutrition(item);
		const servings = item.servings === 1 ? "" : ` · ${formatServings(item.servings)}×`;
		if (!nutrition) return `${item.name}${servings} · (recipe missing)`;
		return `${item.name}${servings} · ${formatCalories(nutrition.calories)}CAL · ${formatGrams(nutrition.protein)}P / ${formatGrams(nutrition.carbs)}C / ${formatGrams(nutrition.fats)}F`;
	}

	onChooseItem(item: MealFavorite): void {
		this.onChoose(item);
	}

	private resolveNutrition(fav: MealFavorite): NutritionTotals | null {
		if (fav.recipe) {
			const info = this.recipes.resolve(fav.recipe);
			return info ? info.nutrition : null;
		}
		return fav.nutrition ?? null;
	}
}
