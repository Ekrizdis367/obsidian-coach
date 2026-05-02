import { App, Modal, Notice, Setting } from "obsidian";
import type { NutritionTotals } from "../types";

export interface FavoriteEditInitial {
	name?: string;
	servings?: number;
	recipe?: string;
	nutrition?: NutritionTotals;
}

export interface FavoriteEditResult {
	name: string;
	servings: number;
	recipe?: string;
	nutrition?: NutritionTotals;
}

/**
 * Modal for creating a new meal favorite or editing an existing one. The
 * shape of the form depends on `initial.recipe`:
 *
 * - Recipe-linked: shows the recipe path read-only, since nutrition is pulled
 *   fresh from the note's frontmatter at render time.
 * - Freeform: shows editable per-serving nutrition inputs (calories, protein,
 *   carbs, fats, fiber).
 *
 * In both cases the user can rename the favorite and adjust default servings.
 */
export class FavoriteEditModal extends Modal {
	private name: string;
	private servings: number;
	private recipe?: string;
	private calories = 0;
	private protein = 0;
	private carbs = 0;
	private fats = 0;
	private fiber = 0;
	private mode: "create" | "edit";
	private onSubmit: (result: FavoriteEditResult) => void | Promise<void>;

	constructor(
		app: App,
		mode: "create" | "edit",
		initial: FavoriteEditInitial,
		onSubmit: (result: FavoriteEditResult) => void | Promise<void>,
	) {
		super(app);
		this.mode = mode;
		this.onSubmit = onSubmit;
		this.name = initial.name ?? "";
		this.servings = initial.servings && initial.servings > 0 ? initial.servings : 1;
		this.recipe = initial.recipe;
		if (initial.nutrition) {
			this.calories = initial.nutrition.calories;
			this.protein = initial.nutrition.protein;
			this.carbs = initial.nutrition.carbs;
			this.fats = initial.nutrition.fats;
			this.fiber = initial.nutrition.fiber;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("wp-favorite-modal");

		contentEl.createEl("h3", { text: this.mode === "create" ? "Save favorite" : "Edit favorite" });

		const hint = this.recipe
			? "Linked to a recipe — its nutrition is pulled fresh on every insert."
			: "Enter the values per serving — they'll be multiplied by servings on insert.";
		contentEl.createEl("p", { text: hint, cls: "wp-modal-hint" });

		new Setting(contentEl)
			.setName("Name")
			.setDesc("Shown in the favorites picker.")
			.addText((t) => {
				t.setPlaceholder("Daily protein shake");
				t.setValue(this.name);
				t.onChange((v) => {
					this.name = v;
				});
			});

		new Setting(contentEl)
			.setName("Default servings")
			.setDesc("Quantity inserted when picking this favorite.")
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "0";
				t.inputEl.step = "0.25";
				t.setValue(this.servings.toString());
				t.onChange((v) => {
					const n = parseFloat(v);
					if (Number.isFinite(n) && n > 0) this.servings = n;
				});
			});

		if (this.recipe) {
			new Setting(contentEl)
				.setName("Recipe")
				.setDesc("Path to the recipe note. Nutrition is read live.")
				.addText((t) => {
					t.setValue(this.recipe ?? "");
					t.setDisabled(true);
				});
		} else {
			this.renderNutritionFields(contentEl);
		}

		const buttons = contentEl.createDiv({ cls: "wp-modal-actions" });
		const cancel = buttons.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		const submit = buttons.createEl("button", {
			cls: "mod-cta",
			text: this.mode === "create" ? "Save favorite" : "Save changes",
		});
		submit.addEventListener("click", () => this.submit());
	}

	private renderNutritionFields(parent: HTMLElement): void {
		const macros: Array<{
			label: string;
			desc: string;
			get: () => number;
			set: (v: number) => void;
		}> = [
			{
				label: "Calories",
				desc: "kcal per serving.",
				get: () => this.calories,
				set: (v) => {
					this.calories = v;
				},
			},
			{
				label: "Protein (g)",
				desc: "Per serving.",
				get: () => this.protein,
				set: (v) => {
					this.protein = v;
				},
			},
			{
				label: "Carbs (g)",
				desc: "Per serving.",
				get: () => this.carbs,
				set: (v) => {
					this.carbs = v;
				},
			},
			{
				label: "Fats (g)",
				desc: "Per serving.",
				get: () => this.fats,
				set: (v) => {
					this.fats = v;
				},
			},
			{
				label: "Fiber (g)",
				desc: "Per serving (optional).",
				get: () => this.fiber,
				set: (v) => {
					this.fiber = v;
				},
			},
		];

		for (const m of macros) {
			new Setting(parent)
				.setName(m.label)
				.setDesc(m.desc)
				.addText((t) => {
					t.inputEl.type = "number";
					t.inputEl.min = "0";
					t.inputEl.step = "0.1";
					t.setValue(m.get() > 0 ? m.get().toString() : "");
					t.onChange((v) => {
						const n = parseFloat(v);
						m.set(Number.isFinite(n) && n >= 0 ? n : 0);
					});
				});
		}
	}

	private submit(): void {
		const name = this.name.trim();
		if (name.length === 0) {
			new Notice("Give the favorite a name first.");
			return;
		}
		const result: FavoriteEditResult = {
			name,
			servings: this.servings,
		};
		if (this.recipe) {
			result.recipe = this.recipe;
		} else {
			const total = this.calories + this.protein + this.carbs + this.fats + this.fiber;
			if (total <= 0) {
				new Notice("Enter at least one nutrition value.");
				return;
			}
			result.nutrition = {
				calories: this.calories,
				protein: this.protein,
				carbs: this.carbs,
				fats: this.fats,
				fiber: this.fiber,
			};
		}
		void this.onSubmit(result);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
