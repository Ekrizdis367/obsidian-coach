import { App, Modal, Notice, Setting } from "obsidian";
import type { NutritionTotals } from "../types";

export interface CustomMealResult {
	name: string;
	servings: number;
	nutrition: NutritionTotals;
}

/**
 * Modal for adding (or editing) a freeform meal entry that isn't backed by a
 * recipe note. Useful for restaurant meals, packaged foods, or anything you
 * don't want to create a full recipe note for.
 */
export class CustomMealModal extends Modal {
	private name = "";
	private servings = 1;
	private calories = 0;
	private protein = 0;
	private carbs = 0;
	private fats = 0;
	private fiber = 0;
	private onSubmit: (result: CustomMealResult) => void;

	constructor(
		app: App,
		initial: Partial<CustomMealResult> | null,
		onSubmit: (result: CustomMealResult) => void,
	) {
		super(app);
		this.onSubmit = onSubmit;
		if (initial?.name) this.name = initial.name;
		if (initial?.servings && initial.servings > 0) this.servings = initial.servings;
		if (initial?.nutrition) {
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
		contentEl.addClass("wp-custom-meal-modal");

		contentEl.createEl("h3", { text: "Add custom entry" });
		contentEl.createEl("p", {
			text:
				"Log a one-off meal without creating a recipe note. Enter the totals as eaten — servings will multiply them.",
			cls: "wp-modal-hint",
		});

		new Setting(contentEl)
			.setName("Name")
			.setDesc("Short label for what you ate.")
			.addText((t) => {
				t.setPlaceholder("Pad thai");
				t.setValue(this.name);
				t.onChange((v) => {
					this.name = v;
				});
			});

		new Setting(contentEl)
			.setName("Servings")
			.setDesc("Multiplier applied to the values below.")
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
			new Setting(contentEl)
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

		const buttons = contentEl.createDiv({ cls: "wp-modal-actions" });
		const cancel = buttons.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		const submit = buttons.createEl("button", { cls: "mod-cta", text: "Add entry" });
		submit.addEventListener("click", () => this.submit());
	}

	private submit(): void {
		const name = this.name.trim();
		if (name.length === 0) {
			new Notice("Give the entry a name first.");
			return;
		}
		const totalEnergy = this.calories + this.protein + this.carbs + this.fats + this.fiber;
		if (totalEnergy <= 0) {
			new Notice("Enter at least one nutrition value.");
			return;
		}
		this.onSubmit({
			name,
			servings: this.servings,
			nutrition: {
				calories: this.calories,
				protein: this.protein,
				carbs: this.carbs,
				fats: this.fats,
				fiber: this.fiber,
			},
		});
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
