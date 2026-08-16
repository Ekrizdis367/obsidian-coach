import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type { NutritionGoals, NutritionTotals, WeightUnit } from "../types";
import { HistoryIndex, formatIsoDate } from "../data/history-index";
import { RecipeIndex } from "../data/recipe-index";
import { resolveMeal, sumTotals, EMPTY_TOTALS } from "../utils/nutrition";
import { waterUnitFor } from "../utils/format";
import { createTodayDailyNote, findTodayDailyNote } from "../utils/daily-notes";
import { resolveWaterTarget } from "./water-renderer";

export const HEARTH_VIEW_TYPE = "coach-hearth";

export interface HearthViewDeps {
	historyIndex: HistoryIndex;
	recipes: RecipeIndex;
	getUnit: () => WeightUnit;
	getGoals: () => NutritionGoals;
	getTrackFiber: () => boolean;
	getWaterTarget: () => number | null;
}

interface MacroInfo {
	key: keyof NutritionTotals;
	label: string;
	className: string;
}

/**
 * Minimal today-only macros + water glance for dashboards (e.g. Hearth plugin
 * view cards). Opens via command / registered view type — not interactive.
 */
export class HearthView extends ItemView {
	private deps: HearthViewDeps;
	private rebuildTimer: number | null = null;
	private creating = false;

	constructor(leaf: WorkspaceLeaf, deps: HearthViewDeps) {
		super(leaf);
		this.deps = deps;
	}

	getViewType(): string {
		return HEARTH_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Macros";
	}

	getIcon(): string {
		return "flame";
	}

	onOpen(): Promise<void> {
		this.scheduleRender();
		this.registerEvent(
			this.app.vault.on("modify", () => this.scheduleRender()),
		);
		this.registerEvent(
			this.app.vault.on("create", () => this.scheduleRender()),
		);
		this.registerEvent(
			this.app.vault.on("delete", () => this.scheduleRender()),
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", () => this.scheduleRender()),
		);
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		if (this.rebuildTimer !== null) {
			window.clearTimeout(this.rebuildTimer);
			this.rebuildTimer = null;
		}
		return Promise.resolve();
	}

	scheduleRender(): void {
		if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
		this.rebuildTimer = window.setTimeout(() => this.render(), 200);
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("wp-hearth");

		const today = formatIsoDate(new Date());
		const dailyNote = findTodayDailyNote(this.app);

		if (!dailyNote) {
			this.renderMissingNote(root);
			return;
		}

		const { totals, water } = this.collectToday(today);
		this.renderMacros(root, totals);
		this.renderWater(root, water);
	}

	private renderMissingNote(parent: HTMLElement): void {
		const empty = parent.createDiv({ cls: "wp-hearth-empty" });
		empty.createDiv({
			cls: "wp-hearth-empty-copy",
			text: "No daily note for today yet.",
		});
		const btn = empty.createEl("button", {
			cls: "mod-cta wp-hearth-create",
			text: this.creating ? "Creating…" : "Create daily note",
		});
		btn.disabled = this.creating;
		btn.addEventListener("click", () => {
			void this.handleCreateDailyNote();
		});
	}

	private async handleCreateDailyNote(): Promise<void> {
		if (this.creating) return;
		this.creating = true;
		this.render();
		try {
			const file = await createTodayDailyNote(this.app);
			if (file) {
				// History index may still be catching up after Templater fills the note.
				window.setTimeout(() => this.scheduleRender(), 600);
			}
		} finally {
			this.creating = false;
			this.scheduleRender();
		}
	}

	private collectToday(today: string): { totals: NutritionTotals; water: number } {
		const meals = this.deps.historyIndex.getAllMealsBlocks().filter((r) => r.date === today);
		const mealTotals: NutritionTotals[] = [];

		for (const record of meals) {
			const resolved = record.block.entries.map((entry) =>
				resolveMeal(entry, this.deps.recipes).totals,
			);
			if (resolved.length > 0) mealTotals.push(sumTotals(resolved));
		}

		// History already folds embedded meal-block water into water records.
		let water = 0;
		for (const record of this.deps.historyIndex.getAllWaterBlocks()) {
			if (record.date !== today) continue;
			water += record.block.amount ?? 0;
		}

		const totals = mealTotals.length > 0 ? sumTotals(mealTotals) : { ...EMPTY_TOTALS };
		return { totals, water };
	}

	private renderMacros(parent: HTMLElement, totals: NutritionTotals): void {
		const goals = this.deps.getGoals();
		const trackFiber = this.deps.getTrackFiber();
		const macros: MacroInfo[] = [
			{ key: "calories", label: "Cals", className: "wp-macro--calories" },
			{ key: "protein", label: "Protein", className: "wp-macro--protein" },
			{ key: "carbs", label: "Carbs", className: "wp-macro--carbs" },
			{ key: "fats", label: "Fats", className: "wp-macro--fats" },
		];
		if (trackFiber) {
			macros.push({ key: "fiber", label: "Fiber", className: "wp-macro--fiber" });
		}

		const wrap = parent.createDiv({ cls: "wp-hearth-goals" });
		if (trackFiber) wrap.addClass("wp-hearth-goals--with-fiber");

		for (const macro of macros) {
			const value = totals[macro.key];
			const goal = Math.max(0, goals[macro.key]);
			const ratio = goal > 0 ? Math.min(value / goal, 1) : 0;
			const over = goal > 0 && value > goal;
			const pct = goal > 0 ? Math.round((value / goal) * 100) : 0;

			const cell = wrap.createDiv({ cls: `wp-macro ${macro.className}` });
			const head = cell.createDiv({ cls: "wp-macro-head" });
			head.createSpan({ cls: "wp-macro-label", text: macro.label });
			head.createSpan({
				cls: "wp-macro-pct",
				text: over ? `${pct}%` : `${Math.min(pct, 100)}%`,
			});

			const bar = cell.createDiv({ cls: "wp-macro-bar" });
			const fill = bar.createDiv({ cls: "wp-macro-bar-fill" });
			fill.style.width = `${Math.round(ratio * 100)}%`;
			if (over) {
				fill.addClass("wp-macro-bar-fill--over");
				cell.addClass("wp-macro--over");
			}
		}
	}

	private renderWater(parent: HTMLElement, amount: number): void {
		const unit = waterUnitFor(this.deps.getUnit());
		const target = resolveWaterTarget(undefined, this.deps.getWaterTarget(), unit);
		const ratio = target > 0 ? Math.min(amount / target, 1) : 0;
		const done = target > 0 && amount >= target;

		const cell = parent.createDiv({ cls: "wp-hearth-water" });
		if (done) cell.addClass("wp-hearth-water--done");
		const head = cell.createDiv({ cls: "wp-hearth-water-head" });
		const label = head.createSpan({ cls: "wp-hearth-water-label" });
		const icon = label.createSpan({ cls: "wp-water-icon" });
		setIcon(icon, "droplets");
		label.createSpan({ text: "Water" });
		const pct = target > 0 ? Math.round((amount / target) * 100) : 0;
		head.createSpan({
			cls: "wp-hearth-water-pct",
			text: `${pct}%`,
		});

		const bar = cell.createDiv({ cls: "wp-water-bar" });
		const fill = bar.createDiv({ cls: "wp-water-bar-fill" });
		fill.style.width = `${Math.round(ratio * 100)}%`;
		if (done) fill.addClass("wp-water-bar-fill--done");
	}
}
