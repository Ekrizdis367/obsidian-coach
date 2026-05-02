import { App, FuzzySuggestModal } from "obsidian";
import type { RecipeInfo } from "../types";
import { formatCalories, formatGrams } from "../utils/nutrition";

export class RecipeSuggestModal extends FuzzySuggestModal<RecipeInfo> {
	private recipes: RecipeInfo[];
	private onChoose: (recipe: RecipeInfo) => void;

	constructor(app: App, recipes: RecipeInfo[], onChoose: (recipe: RecipeInfo) => void) {
		super(app);
		this.recipes = recipes;
		this.onChoose = onChoose;
		this.setPlaceholder("Search recipes…");
	}

	getItems(): RecipeInfo[] {
		return this.recipes;
	}

	getItemText(item: RecipeInfo): string {
		const n = item.nutrition;
		return `${item.basename} · ${formatCalories(n.calories)}CAL · ${formatGrams(n.protein)}P / ${formatGrams(n.carbs)}C / ${formatGrams(n.fats)}F`;
	}

	onChooseItem(item: RecipeInfo): void {
		this.onChoose(item);
	}
}
