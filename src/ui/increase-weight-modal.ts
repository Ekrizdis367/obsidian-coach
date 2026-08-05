import { App, Modal, Setting } from "obsidian";
import type { WeightUnit } from "../types";
import { formatWeight } from "../utils/format";

export interface IncreaseWeightResult {
	newWeight: number;
}

/**
 * Asked after the user finishes every planned set on a weighted exercise.
 * Lets them confirm (and optionally tweak) a bump for next time.
 */
export class IncreaseWeightModal extends Modal {
	private currentWeight: number;
	private newWeight: number;
	private unit: WeightUnit;
	private summary: string;
	private onSubmit: (result: IncreaseWeightResult) => void;

	constructor(
		app: App,
		opts: {
			currentWeight: number;
			suggestedWeight: number;
			unit: WeightUnit;
			summary: string;
		},
		onSubmit: (result: IncreaseWeightResult) => void,
	) {
		super(app);
		this.currentWeight = opts.currentWeight;
		this.newWeight = opts.suggestedWeight;
		this.unit = opts.unit;
		this.summary = opts.summary;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("wp-increase-weight-modal");

		contentEl.createEl("h3", { text: "Increase weight?" });
		contentEl.createEl("p", {
			cls: "wp-modal-hint",
			text: `${this.summary} Increase the planned weight for next time?`,
		});

		new Setting(contentEl)
			.setName("Current")
			.setDesc(`What you just lifted.`)
			.addText((t) => {
				t.setValue(formatWeight(this.currentWeight, this.unit));
				t.setDisabled(true);
			});

		new Setting(contentEl)
			.setName("Next time")
			.setDesc(`New planned weight (${this.unit}).`)
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "0";
				t.inputEl.step = "0.5";
				t.setValue(this.newWeight.toString());
				t.onChange((v) => {
					const n = parseFloat(v);
					this.newWeight = Number.isFinite(n) ? n : Number.NaN;
				});
				window.setTimeout(() => t.inputEl.select(), 0);
			});

		const buttons = contentEl.createDiv({ cls: "wp-modal-actions" });
		const skip = buttons.createEl("button", { text: "Keep current" });
		skip.addEventListener("click", () => this.close());
		const confirm = buttons.createEl("button", { cls: "mod-cta", text: "Increase" });
		confirm.addEventListener("click", () => {
			if (!Number.isFinite(this.newWeight) || this.newWeight <= this.currentWeight) {
				return;
			}
			this.onSubmit({ newWeight: this.newWeight });
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Default plate bump: 2.5 kg or 5 lb. */
export function defaultWeightIncrement(unit: WeightUnit): number {
	return unit === "kg" ? 2.5 : 5;
}

export function suggestNextWeight(current: number, unit: WeightUnit): number {
	const next = current + defaultWeightIncrement(unit);
	return Math.round(next * 100) / 100;
}
