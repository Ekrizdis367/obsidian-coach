import { ItemView, WorkspaceLeaf } from "obsidian";
import type {
	BodyData,
	BodyMeasurements,
	BodyweightEntry,
	FitnessGoal,
	HistoryEntry,
	MeasurementsEntry,
	NutritionGoals,
	NutritionTotals,
	PRRecord,
	SetLog,
	WeeklySchedule,
	WeightUnit,
} from "../types";
import { HistoryIndex } from "../data/history-index";
import { RecipeIndex } from "../data/recipe-index";
import { FITNESS_GOAL_LABELS, WEEKDAY_KEYS } from "../settings";
import {
	bestE1RM,
	formatDistance,
	formatMinutes,
	formatPace,
	formatSetsSummary,
	formatWater,
	formatWeight,
	maxReps,
	totalReps,
	totalVolume,
	waterUnitFor,
	weightedSetsForEntry,
} from "../utils/format";
import { formatCalories, formatGrams, resolveMeal, sumTotals } from "../utils/nutrition";
import { resolveWaterTarget } from "./water-renderer";
import { renderSparkline, type SparklinePoint } from "../utils/sparkline";
import {
	computeBMI,
	computeHRZone,
	type EffectiveWeight,
	effectiveWeight,
	FITNESS_GOAL_SPECS,
	recommendNutrition,
} from "../utils/body-stats";

export const ANALYTICS_VIEW_TYPE = "coach-analytics";

export interface AnalyticsViewDeps {
	historyIndex: HistoryIndex;
	recipes: RecipeIndex;
	getUnit: () => WeightUnit;
	getGoals: () => NutritionGoals;
	getGoalWeight: () => number | null;
	getSchedule: () => WeeklySchedule;
	getBodyData: () => BodyData;
	getFitnessGoal: () => FitnessGoal;
	getTrackFiber: () => boolean;
	getWaterTarget: () => number | null;
}

export class AnalyticsView extends ItemView {
	private deps: AnalyticsViewDeps;
	private selectedExercise: string | null = null;
	private adherenceMode: AdherenceMode = "month";
	private rebuildTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, deps: AnalyticsViewDeps) {
		super(leaf);
		this.deps = deps;
	}

	getViewType(): string {
		return ANALYTICS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Workout analytics";
	}

	getIcon(): string {
		return "bar-chart-2";
	}

	onOpen(): Promise<void> {
		this.scheduleRender();
		this.registerEvent(
			this.app.workspace.on("file-open", () => this.scheduleRender()),
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
		this.rebuildTimer = window.setTimeout(() => this.render(), 250);
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("wp-analytics");

		root.createEl("h3", { text: "Workout analytics" });

		const banner = root.createDiv({ cls: "wp-analytics-banner" });
		banner.createDiv({ cls: "wp-analytics-banner-title", text: "Beta feature" });
		banner.createDiv({
			cls: "wp-analytics-banner-body",
			text:
				"Analytics are still being tested and remain pending completion of a larger dataset gathered through ongoing self-testing of the plugin. Numbers and charts may change as the calculations are refined.",
		});

		this.renderAdherence(root);
		this.renderWorkoutTrends(root);
		this.renderGoal(root);
		this.renderBodyweight(root);
		this.renderMeasurements(root);
		this.renderNutrition(root);
		this.renderHydration(root);
		this.renderRecords(root);

		const exercises = this.deps.historyIndex.getAllExerciseNames();
		if (exercises.length === 0) {
			root.createDiv({ cls: "wp-empty", text: "No logged workouts yet. Insert a workout block and log a set to see analytics here." });
			return;
		}

		if (!this.selectedExercise || !exercises.includes(this.selectedExercise)) {
			this.selectedExercise = exercises[0] ?? null;
		}

		const selectorWrap = root.createDiv({ cls: "wp-analytics-selector" });
		selectorWrap.createEl("label", { text: "Exercise" });
		const select = selectorWrap.createEl("select");
		for (const name of exercises) {
			const option = select.createEl("option", { value: name, text: titleCase(name) });
			if (name === this.selectedExercise) option.selected = true;
		}
		select.addEventListener("change", () => {
			this.selectedExercise = select.value;
			this.render();
		});

		if (!this.selectedExercise) return;

		const entries = this.deps.historyIndex.getAllForExercise(this.selectedExercise);
		const kind = entries[entries.length - 1]?.kind ?? "strength";
		if (kind === "cardio") {
			const cardioEntries = entries.filter(
				(e): e is Extract<HistoryEntry, { kind: "cardio" }> => e.kind === "cardio",
			);
			this.renderCardioSummary(root, cardioEntries);
			this.renderCardioChart(root, cardioEntries);
			this.renderCardioHistory(root, cardioEntries);
		} else {
			const strengthEntries = entries.filter(
				(e): e is Extract<HistoryEntry, { kind: "strength" }> => e.kind === "strength",
			);
			this.renderStrengthSummary(root, strengthEntries);
			this.renderStrengthChart(root, strengthEntries);
			this.renderStrengthHistory(root, strengthEntries);
		}
	}

	private renderAdherence(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: "wp-adherence-section" });

		const header = wrap.createDiv({ cls: "wp-adherence-header" });
		header.createEl("h4", { text: "Workout adherence" });
		this.renderAdherenceToggle(header);

		const schedule = this.deps.getSchedule();
		const workoutDates = this.deps.historyIndex.getWorkoutDates();
		const earliestIso = this.deps.historyIndex.getEarliestWorkoutDate();
		const earliest = earliestIso ? parseIsoDate(earliestIso) : null;
		const today = startOfDay(new Date());
		const hasSchedule = WEEKDAY_KEYS.some((k) => schedule[k] !== null);

		const windowStart =
			this.adherenceMode === "year"
				? new Date(today.getFullYear(), 0, 1)
				: new Date(today.getFullYear(), today.getMonth(), 1);
		const windowLabel = this.adherenceMode === "year" ? "YTD" : "this month";

		const stats = computeAdherenceStats(workoutDates, schedule, today, earliest, windowStart);
		const summary = wrap.createDiv({ cls: "wp-analytics-summary wp-adherence-summary" });
		if (hasSchedule) {
			stat(summary, `Completed (${windowLabel})`, `${stats.completed} / ${stats.scheduled}`);
			const pct = stats.scheduled > 0 ? Math.round((stats.completed / stats.scheduled) * 100) : 0;
			stat(summary, "Adherence", stats.scheduled > 0 ? `${pct}%` : "—");
			stat(summary, "Current streak", stats.streak === 1 ? "1 session" : `${stats.streak} sessions`);
		} else {
			stat(summary, `Workouts (${windowLabel})`, stats.completed.toString());
			stat(summary, "Schedule", "Not configured");
			const hint = wrap.createDiv({ cls: "wp-empty wp-adherence-hint" });
			hint.setText(
				"Configure a weekly schedule in settings to track scheduled vs missed workouts. Until then, only completed days are shown.",
			);
		}

		if (this.adherenceMode === "year") {
			this.renderYearGrid(wrap, today.getFullYear(), schedule, workoutDates, today, hasSchedule, earliest);
		} else {
			const months = wrap.createDiv({ cls: "wp-adherence-calendars" });
			this.renderMonthCalendar(
				months,
				monthKey(today),
				schedule,
				workoutDates,
				today,
				hasSchedule,
				earliest,
			);
		}

		const legend = wrap.createDiv({ cls: "wp-adherence-legend" });
		legendSwatch(legend, "wp-adherence-day--completed", "Completed");
		if (hasSchedule) legendSwatch(legend, "wp-adherence-day--missed", "Missed");
		legendSwatch(legend, "wp-adherence-day--rest", "Off day");
		legendSwatch(legend, "wp-adherence-day--pending", "Pending");
	}

	private renderAdherenceToggle(parent: HTMLElement): void {
		const toggle = parent.createDiv({ cls: "wp-adherence-toggle" });
		const make = (mode: AdherenceMode, label: string): HTMLButtonElement => {
			const btn = toggle.createEl("button", {
				cls: `wp-adherence-toggle-btn${this.adherenceMode === mode ? " is-active" : ""}`,
				text: label,
			});
			btn.type = "button";
			btn.setAttribute("aria-pressed", this.adherenceMode === mode ? "true" : "false");
			btn.addEventListener("click", () => {
				if (this.adherenceMode === mode) return;
				this.adherenceMode = mode;
				this.render();
			});
			return btn;
		};
		make("month", "Month");
		make("year", "Year");
	}

	private renderYearGrid(
		parent: HTMLElement,
		year: number,
		schedule: WeeklySchedule,
		workoutDates: Set<string>,
		today: Date,
		hasSchedule: boolean,
		earliest: Date | null,
	): void {
		const grid = parent.createDiv({ cls: "wp-adherence-year-grid" });
		for (let m = 0; m < 12; m++) {
			const card = grid.createDiv({ cls: "wp-adherence-year-month" });
			card.createDiv({
				cls: "wp-adherence-year-month-label",
				text: MONTH_NAMES_SHORT[m] ?? "",
			});
			const days = card.createDiv({ cls: "wp-adherence-year-days" });

			const firstWeekday = new Date(year, m, 1).getDay();
			for (let i = 0; i < firstWeekday; i++) {
				days.createDiv({ cls: "wp-adherence-mini-day wp-adherence-mini-day--outside" });
			}

			const daysInMonth = new Date(year, m + 1, 0).getDate();
			for (let d = 1; d <= daysInMonth; d++) {
				const date = new Date(year, m, d);
				const state = computeDayState(date, schedule, workoutDates, today, hasSchedule, earliest);
				const isToday = date.getTime() === today.getTime();
				const cell = days.createDiv({
					cls: `wp-adherence-mini-day wp-adherence-mini-day--${state}${isToday ? " is-today" : ""}`,
				});
				const iso = toIsoDate(date);
				cell.setAttribute("aria-label", `${iso}: ${STATE_LABELS[state]}`);
				cell.setAttribute("title", `${iso}: ${STATE_LABELS[state]}`);
			}
		}
	}

	private renderMonthCalendar(
		parent: HTMLElement,
		month: { year: number; month: number },
		schedule: WeeklySchedule,
		workoutDates: Set<string>,
		today: Date,
		hasSchedule: boolean,
		earliest: Date | null,
	): void {
		const wrap = parent.createDiv({ cls: "wp-adherence-month" });
		wrap.createEl("h5", {
			cls: "wp-adherence-month-title",
			text: `${MONTH_NAMES[month.month] ?? ""} ${month.year}`,
		});

		const grid = wrap.createDiv({ cls: "wp-adherence-grid" });
		for (const label of WEEKDAY_SHORT) {
			grid.createDiv({ cls: "wp-adherence-weekday", text: label });
		}

		const firstWeekday = new Date(month.year, month.month, 1).getDay();
		for (let i = 0; i < firstWeekday; i++) {
			grid.createDiv({ cls: "wp-adherence-day wp-adherence-day--outside" });
		}

		const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
		for (let day = 1; day <= daysInMonth; day++) {
			const date = new Date(month.year, month.month, day);
			const state = computeDayState(date, schedule, workoutDates, today, hasSchedule, earliest);
			const isToday = date.getTime() === today.getTime();
			const cell = grid.createDiv({
				cls: `wp-adherence-day wp-adherence-day--${state}${isToday ? " is-today" : ""}`,
				text: day.toString(),
			});
			const iso = toIsoDate(date);
			cell.setAttribute("aria-label", `${iso}: ${STATE_LABELS[state]}`);
			cell.setAttribute("title", `${iso}: ${STATE_LABELS[state]}`);
		}
	}

	private renderBodyweight(parent: HTMLElement): void {
		const entries = collapseToLatestPerDay(this.deps.historyIndex.getBodyweightEntries());
		const wrap = parent.createDiv({ cls: "wp-bodyweight-section" });
		wrap.createEl("h4", { text: "Body weight" });

		const unit = this.deps.getUnit();
		const goal = this.deps.getGoalWeight();
		const bodyData = this.deps.getBodyData();

		if (entries.length === 0) {
			if (bodyData.weight !== null) {
				const summary = wrap.createDiv({ cls: "wp-analytics-summary wp-bw-summary" });
				stat(summary, "Current weight", `${formatBodyweight(bodyData.weight)} ${unit}`);
				if (goal !== null) {
					stat(summary, "Goal", `${formatBodyweight(goal)} ${unit}`);
					stat(summary, "To goal", formatToGoal(bodyData.weight, goal, unit));
				}
				if (bodyData.height !== null) {
					const bmi = computeBMI(bodyData.weight, unit, bodyData.height, bodyData.heightUnit);
					if (bmi !== null) {
						stat(summary, "BMI", `${bmi.value} (${bmi.categoryLabel})`);
					}
				}
				wrap.createDiv({
					cls: "wp-empty",
					text: "Showing your settings weight. Log a body weight in any workout block to start tracking trends here.",
				});
				return;
			}
			wrap.createDiv({
				cls: "wp-empty",
				text: "Add a body weight value to a workout block (or set a current weight in settings) to start tracking.",
			});
			if (goal !== null) {
				wrap.createDiv({
					cls: "wp-empty",
					text: `Goal: ${formatBodyweight(goal)} ${unit}.`,
				});
			}
			return;
		}

		const latest = entries[entries.length - 1];
		if (!latest) return;

		const summary = wrap.createDiv({ cls: "wp-analytics-summary wp-bw-summary" });
		stat(summary, "Latest", `${formatBodyweight(latest.weight)} ${unit}`);
		stat(summary, "On", latest.date);

		const delta30 = changeOverDays(entries, 30);
		const delta90 = changeOverDays(entries, 90);
		stat(summary, "30-day change", formatDelta(delta30, unit));
		stat(summary, "90-day change", formatDelta(delta90, unit));

		if (goal !== null) {
			stat(summary, "Goal", `${formatBodyweight(goal)} ${unit}`);
			stat(summary, "To goal", formatToGoal(latest.weight, goal, unit));
		}

		if (bodyData.height !== null) {
			const bmi = computeBMI(latest.weight, unit, bodyData.height, bodyData.heightUnit);
			if (bmi !== null) {
				stat(summary, "BMI", `${bmi.value} (${bmi.categoryLabel})`);
			}
		}

		const chart = wrap.createDiv({ cls: "wp-analytics-chart" });
		chart.createEl("h5", { text: "Trend (last 90 days)" });

		const recent = entries.filter((e) => isWithinDays(e.date, 90));
		if (recent.length < 2) {
			chart.createDiv({ cls: "wp-empty", text: "Need at least two weigh-ins in the last 90 days to draw a trend." });
			return;
		}

		const rawPoints: SparklinePoint[] = recent.map((e) => ({ label: e.date, value: e.weight }));
		const avgPoints: SparklinePoint[] = movingAverage(rawPoints, 7);
		const overlays = [
			{ points: avgPoints, className: "wp-sparkline-overlay wp-sparkline-overlay--avg" },
		];
		if (goal !== null) {
			const goalSeries: SparklinePoint[] = rawPoints.map((p) => ({ label: p.label, value: goal }));
			overlays.push({
				points: goalSeries,
				className: "wp-sparkline-overlay wp-sparkline-overlay--goal",
			});
		}
		renderSparkline(chart, rawPoints, {
			width: 320,
			height: 100,
			yScale: "auto",
			showFill: false,
			overlays,
		});

		const legend = chart.createDiv({ cls: "wp-chart-legend" });
		legend.createSpan({ cls: "wp-legend-item wp-legend-raw", text: "Daily" });
		legend.createSpan({ cls: "wp-legend-item wp-legend-avg", text: "7-day average" });
		if (goal !== null) {
			legend.createSpan({
				cls: "wp-legend-item wp-legend-goal",
				text: `Goal (${formatBodyweight(goal)} ${unit})`,
			});
		}
	}

	private renderGoal(parent: HTMLElement): void {
		const goal = this.deps.getFitnessGoal();
		const spec = FITNESS_GOAL_SPECS[goal];
		const bodyData = this.deps.getBodyData();

		const wrap = parent.createDiv({ cls: "wp-goal-section" });
		const header = wrap.createDiv({ cls: "wp-goal-header" });
		header.createEl("h4", { text: "Goal & focus" });
		header.createDiv({ cls: "wp-goal-badge", text: FITNESS_GOAL_LABELS[goal] });

		wrap.createDiv({ cls: "wp-goal-summary", text: spec.summary });

		const grid = wrap.createDiv({ cls: "wp-goal-grid" });

		const trainingCard = grid.createDiv({ cls: "wp-goal-card" });
		trainingCard.createEl("h5", { text: "Training focus" });
		trainingCard.createDiv({ cls: "wp-goal-card-body", text: spec.training });

		const cardioCard = grid.createDiv({ cls: "wp-goal-card" });
		cardioCard.createEl("h5", { text: "Cardio focus" });
		cardioCard.createDiv({ cls: "wp-goal-card-body", text: spec.cardio });
		const hrZone = bodyData.age !== null ? computeHRZone(bodyData.age, spec.hrZone.low, spec.hrZone.high) : null;
		if (hrZone !== null) {
			cardioCard.createDiv({
				cls: "wp-goal-card-meta",
				text: `Target heart rate: ~${hrZone.low}–${hrZone.high} bpm (${Math.round(spec.hrZone.low * 100)}–${Math.round(spec.hrZone.high * 100)}% of estimated max).`,
			});
		} else {
			cardioCard.createDiv({
				cls: "wp-goal-card-meta wp-goal-card-meta--hint",
				text: `Add your age in settings to see this as bpm (currently ${Math.round(spec.hrZone.low * 100)}–${Math.round(spec.hrZone.high * 100)}% of max heart rate).`,
			});
		}

		this.renderRecommendedNutrition(wrap);

		const note = wrap.createDiv({ cls: "wp-goal-note" });
		note.setText(
			"Estimates only — general guidelines, not medical advice. Adjust to your own response and consult a professional if you have specific goals or conditions.",
		);
	}

	private renderRecommendedNutrition(parent: HTMLElement): void {
		const entries = collapseToLatestPerDay(this.deps.historyIndex.getBodyweightEntries());
		const unit = this.deps.getUnit();
		const bodyData = this.deps.getBodyData();
		const goal = this.deps.getFitnessGoal();
		const effective = effectiveWeight(entries, bodyData.weight);
		const rec = effective !== null
			? recommendNutrition(bodyData, effective.weight, unit, this.deps.getGoalWeight(), goal)
			: null;

		const wrap = parent.createDiv({ cls: "wp-recommend-section" });
		wrap.createEl("h5", { text: "Recommended daily nutrition" });

		if (rec === null) {
			const hint = wrap.createDiv({ cls: "wp-empty wp-recommend-hint" });
			hint.setText(
				"Set height, age, and a current weight (either logged in a workout block or entered in settings) to see recommended daily calories and macros tuned to this goal.",
			);
			return;
		}

		if (effective !== null) {
			renderWeightSource(wrap, effective, unit);
		}

		const intro = wrap.createDiv({ cls: "wp-recommend-intro" });
		intro.setText(
			`Estimated TDEE: ${formatCalories(rec.tdee)} cal/day. Targets tuned for ${FITNESS_GOAL_LABELS[goal].toLowerCase()}:`,
		);

		const summary = wrap.createDiv({ cls: "wp-analytics-summary wp-recommend-summary" });
		stat(summary, "Calories", `${formatCalories(rec.calories)} cal`);
		stat(summary, "Protein", `${rec.protein} g`);
		stat(summary, "Carbs", `${rec.carbs} g`);
		stat(summary, "Fats", `${rec.fats} g`);

		const note = wrap.createDiv({ cls: "wp-recommend-note" });
		note.setText(
			"Apply these to your daily goals from the plugin settings.",
		);
	}

	private renderNutrition(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: "wp-nutrition-section" });
		wrap.createEl("h4", { text: "Nutrition" });

		const days = aggregateMealsByDay(
			this.deps.historyIndex.getAllMealsBlocks(),
			this.deps.recipes,
		);
		const goals = this.deps.getGoals();

		if (days.length === 0) {
			wrap.createDiv({
				cls: "wp-empty",
				text: "Insert a meals block (`Insert meal log` command) and add a recipe to start tracking nutrition.",
			});
			return;
		}

		const recent30 = days.filter((d) => isWithinDays(d.date, 30));
		const summary = wrap.createDiv({ cls: "wp-analytics-summary wp-nutrition-summary" });
		const days30 = recent30.length;
		const avg30 = averageTotals(recent30.map((d) => d.totals));
		stat(summary, "Days logged (30d)", days30.toString());
		stat(summary, "Avg calories (30d)", days30 > 0 ? `${formatCalories(avg30.calories)} / ${formatCalories(goals.calories)}` : "—");
		stat(summary, "Avg protein (30d)", days30 > 0 ? `${formatGrams(avg30.protein)}g / ${formatGrams(goals.protein)}g` : "—");
		stat(summary, "Avg carbs (30d)", days30 > 0 ? `${formatGrams(avg30.carbs)}g / ${formatGrams(goals.carbs)}g` : "—");
		stat(summary, "Avg fats (30d)", days30 > 0 ? `${formatGrams(avg30.fats)}g / ${formatGrams(goals.fats)}g` : "—");
		if (this.deps.getTrackFiber()) {
			stat(
				summary,
				"Avg fiber (30d)",
				days30 > 0
					? `${formatGrams(avg30.fiber)}g${goals.fiber > 0 ? ` / ${formatGrams(goals.fiber)}g` : ""}`
					: "—",
			);
		}

		const chart = wrap.createDiv({ cls: "wp-analytics-chart" });
		chart.createEl("h5", { text: "Daily calories (last 30 days)" });

		const points = dailyCaloriesSeries(days, 30);
		const hasAny = points.some((p) => p.value > 0);
		if (!hasAny) {
			chart.createDiv({ cls: "wp-empty", text: "No meals logged in the last 30 days." });
			return;
		}

		const goalSeries: SparklinePoint[] = points.map((p) => ({ label: p.label, value: goals.calories }));
		renderSparkline(chart, points, {
			width: 320,
			height: 100,
			yScale: "auto",
			showFill: false,
			showDots: false,
			overlays: [{
				points: goalSeries,
				className: "wp-sparkline-overlay wp-sparkline-overlay--goal",
			}],
		});

		const legend = chart.createDiv({ cls: "wp-chart-legend" });
		legend.createSpan({ cls: "wp-legend-item wp-legend-raw", text: "Daily calories" });
		legend.createSpan({ cls: "wp-legend-item wp-legend-goal", text: `Goal (${formatCalories(goals.calories)} cal)` });
	}

	private renderStrengthSummary(
		parent: HTMLElement,
		entries: Extract<HistoryEntry, { kind: "strength" }>[],
	): void {
		const unit = this.deps.getUnit();
		const summary = parent.createDiv({ cls: "wp-analytics-summary" });

		const sessionCount = entries.length;
		const allSets: SetLog[] = entries.flatMap((e) => e.sets);
		const recent30 = entries.filter((e) => isWithinDays(e.date, 30));
		const recent30Sets = recent30.flatMap((e) => e.sets);
		const isBodyweight = allSets.length > 0 && allSets.every((s) => s.weight === 0);

		// For weighted aggregates (volume, e1RM) drop sets only contribute
		// their first (heavy) set — drops 2..N have an unknown reduced load.
		const weightedAll = entries.flatMap(weightedSetsForEntry);
		const weightedRecent30 = recent30.flatMap(weightedSetsForEntry);

		stat(summary, "Sessions", sessionCount.toString());
		stat(summary, "Sessions (30d)", recent30.length.toString());

		if (isBodyweight) {
			stat(summary, "Reps (all-time)", totalReps(allSets).toString());
			stat(summary, "Reps (30d)", totalReps(recent30Sets).toString());
			stat(summary, "Best set", `${maxReps(allSets)} reps`);
		} else {
			stat(summary, "Volume (all-time)", formatWeight(totalVolume(weightedAll), unit));
			stat(summary, "Volume (30d)", formatWeight(totalVolume(weightedRecent30), unit));
			stat(summary, "Estimated 1RM", formatWeight(bestE1RM(weightedAll), unit));
		}
	}

	private renderStrengthChart(
		parent: HTMLElement,
		entries: Extract<HistoryEntry, { kind: "strength" }>[],
	): void {
		const allSets = entries.flatMap((e) => e.sets);
		const isBodyweight = allSets.length > 0 && allSets.every((s) => s.weight === 0);
		const wrap = parent.createDiv({ cls: "wp-analytics-chart" });
		wrap.createEl("h4", {
			text: isBodyweight ? "Weekly reps (last 12 weeks)" : "Weekly volume (last 12 weeks)",
		});
		const valueFn = isBodyweight
			? (e: Extract<HistoryEntry, { kind: "strength" }>) => totalReps(e.sets)
			: (e: Extract<HistoryEntry, { kind: "strength" }>) => totalVolume(weightedSetsForEntry(e));
		const points = weeklyAggregate(entries, 12, valueFn);
		const totalSeries = points.reduce((acc, p) => acc + p.value, 0);
		if (totalSeries === 0) {
			wrap.createDiv({ cls: "wp-empty", text: "Not enough data yet." });
			return;
		}
		renderSparkline(wrap, points, { width: 320, height: 90 });
	}

	private renderStrengthHistory(
		parent: HTMLElement,
		entries: Extract<HistoryEntry, { kind: "strength" }>[],
	): void {
		const unit = this.deps.getUnit();
		const allSets = entries.flatMap((e) => e.sets);
		const isBodyweight = allSets.length > 0 && allSets.every((s) => s.weight === 0);
		const wrap = parent.createDiv({ cls: "wp-analytics-history" });
		wrap.createEl("h4", { text: "Recent sessions" });
		const list = wrap.createEl("ul", { cls: "wp-analytics-history-list" });
		const recent = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
		for (const entry of recent) {
			const item = list.createEl("li");
			const date = item.createSpan({ cls: "wp-history-date", text: entry.date });
			const summaryText = ` · ${formatSetsSummary(entry.sets, unit, !isBodyweight)}`;
			const summary = item.createSpan({ cls: "wp-history-summary", text: summaryText });
			void date; void summary;
			if (!isBodyweight) {
				const volSpan = item.createSpan({
					cls: "wp-history-volume",
					text: ` · ${formatWeight(totalVolume(weightedSetsForEntry(entry)), unit)}`,
				});
				void volSpan;
			} else {
				const repsSpan = item.createSpan({
					cls: "wp-history-volume",
					text: ` · ${totalReps(entry.sets)} reps`,
				});
				void repsSpan;
			}
		}
	}

	private renderCardioSummary(
		parent: HTMLElement,
		entries: Extract<HistoryEntry, { kind: "cardio" }>[],
	): void {
		const summary = parent.createDiv({ cls: "wp-analytics-summary" });
		const sessionCount = entries.length;
		const totalMin = entries.reduce((acc, e) => acc + e.minutes, 0);
		const recent30 = entries.filter((e) => isWithinDays(e.date, 30));
		const recentMin = recent30.reduce((acc, e) => acc + e.minutes, 0);
		const longest = entries.reduce((acc, e) => Math.max(acc, e.minutes), 0);
		const avg = entries.length > 0 ? totalMin / entries.length : 0;

		stat(summary, "Sessions", sessionCount.toString());
		stat(summary, "Sessions (30d)", recent30.length.toString());
		stat(summary, "Minutes (all-time)", formatMinutes(totalMin));
		stat(summary, "Minutes (30d)", formatMinutes(recentMin));
		stat(summary, "Longest", formatMinutes(longest));
		stat(summary, "Average", formatMinutes(avg));

		const withDistance = entries.filter(
			(e): e is Extract<HistoryEntry, { kind: "cardio" }> & { distance: number } =>
				typeof e.distance === "number" && e.distance > 0,
		);
		if (withDistance.length > 0) {
			const dominantUnit = mostFrequentUnit(withDistance);
			const totalDist = withDistance
				.filter((e) => (e.distanceUnit ?? "km") === dominantUnit)
				.reduce((acc, e) => acc + e.distance, 0);
			const farthest = withDistance.reduce(
				(best, e) => (best === null || e.distance > best.distance ? e : best),
				null as (typeof withDistance)[number] | null,
			);
			if (totalDist > 0) {
				stat(summary, `Total distance (${dominantUnit})`, formatDistance(Math.round(totalDist * 10) / 10, dominantUnit));
			}
			if (farthest) {
				const pace = formatPace(farthest.minutes, farthest.distance, farthest.distanceUnit ?? "km");
				stat(
					summary,
					"Farthest",
					`${formatDistance(farthest.distance, farthest.distanceUnit ?? "km")}${pace ? ` · ${pace}` : ""}`,
				);
			}
		}
	}

	private renderCardioChart(
		parent: HTMLElement,
		entries: Extract<HistoryEntry, { kind: "cardio" }>[],
	): void {
		const wrap = parent.createDiv({ cls: "wp-analytics-chart" });
		wrap.createEl("h4", { text: "Weekly minutes (last 12 weeks)" });
		const points = weeklyAggregate(entries, 12, (e) => e.minutes);
		const totalSeries = points.reduce((acc, p) => acc + p.value, 0);
		if (totalSeries === 0) {
			wrap.createDiv({ cls: "wp-empty", text: "Not enough data yet." });
			return;
		}
		renderSparkline(wrap, points, { width: 320, height: 90 });
	}

	private renderCardioHistory(
		parent: HTMLElement,
		entries: Extract<HistoryEntry, { kind: "cardio" }>[],
	): void {
		const wrap = parent.createDiv({ cls: "wp-analytics-history" });
		wrap.createEl("h4", { text: "Recent sessions" });
		const list = wrap.createEl("ul", { cls: "wp-analytics-history-list" });
		const recent = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
		for (const entry of recent) {
			const item = list.createEl("li");
			item.createSpan({ cls: "wp-history-date", text: entry.date });
			item.createSpan({ cls: "wp-history-summary", text: ` · ${formatMinutes(entry.minutes)}` });
			if (typeof entry.distance === "number" && entry.distance > 0) {
				const unit = entry.distanceUnit ?? "km";
				item.createSpan({
					cls: "wp-history-summary",
					text: ` · ${formatDistance(entry.distance, unit)}`,
				});
				const pace = formatPace(entry.minutes, entry.distance, unit);
				if (pace) {
					item.createSpan({
						cls: "wp-history-summary wp-history-pace",
						text: ` · ${pace}`,
					});
				}
			}
			if (entry.finishTime) {
				item.createSpan({
					cls: "wp-history-summary",
					text: ` · finish ${entry.finishTime}`,
				});
			}
		}
	}

	private renderWorkoutTrends(parent: HTMLElement): void {
		const durations = this.deps.historyIndex.getWorkoutDurationEntries();
		if (durations.length === 0) return;
		const wrap = parent.createDiv({ cls: "wp-duration-section" });
		wrap.createEl("h4", { text: "Workout duration" });

		const recent30 = durations.filter((d) => isWithinDays(d.date, 30));
		const totalAll = durations.reduce((acc, d) => acc + d.durationMin, 0);
		const total30 = recent30.reduce((acc, d) => acc + d.durationMin, 0);
		const avgAll = durations.length > 0 ? totalAll / durations.length : 0;
		const avg30 = recent30.length > 0 ? total30 / recent30.length : 0;
		const longest = durations.reduce((m, d) => Math.max(m, d.durationMin), 0);

		const summary = wrap.createDiv({ cls: "wp-analytics-summary" });
		stat(summary, "Avg session", formatDurationDisplay(avgAll));
		stat(summary, "Avg session (30d)", recent30.length > 0 ? formatDurationDisplay(avg30) : "—");
		stat(summary, "Longest session", formatDurationDisplay(longest));
		stat(summary, "Total time (30d)", formatDurationDisplay(total30));

		if (durations.length >= 2) {
			const chart = wrap.createDiv({ cls: "wp-analytics-chart" });
			chart.createEl("h5", { text: "Recent sessions" });
			const recent = [...durations].slice(-20);
			const points: SparklinePoint[] = recent.map((d) => ({
				label: d.date,
				value: Math.round(d.durationMin),
			}));
			renderSparkline(chart, points, { width: 320, height: 90, yScale: "auto" });
		}
	}

	private renderMeasurements(parent: HTMLElement): void {
		const all = this.deps.historyIndex.getMeasurementsEntries();
		if (all.length === 0) return;
		const unit = this.deps.getUnit();
		const lengthUnit = unit === "kg" ? "cm" : "in";

		const wrap = parent.createDiv({ cls: "wp-measurements-section" });
		wrap.createEl("h4", { text: "Body measurements" });

		const grid = wrap.createDiv({ cls: "wp-measurements-grid" });
		for (const field of MEASUREMENT_FIELD_ORDER) {
			const series = collectMeasurementSeries(all, field.key);
			if (series.length === 0) continue;
			renderMeasurementCard(grid, field.label, lengthUnit, series);
		}
	}

	private renderHydration(parent: HTMLElement): void {
		const records = this.deps.historyIndex.getAllWaterBlocks();
		if (records.length === 0) return;
		const unit = waterUnitFor(this.deps.getUnit());
		const target = resolveWaterTarget(undefined, this.deps.getWaterTarget(), unit);
		const usingDefault = (this.deps.getWaterTarget() ?? 0) <= 0;

		const wrap = parent.createDiv({ cls: "wp-hydration-section" });
		wrap.createEl("h4", { text: "Hydration" });

		const byDate = new Map<string, number>();
		for (const r of records) {
			const existing = byDate.get(r.date) ?? 0;
			byDate.set(r.date, existing + (r.block.amount ?? 0));
		}
		const recent30 = [...byDate.entries()].filter(([date]) => isWithinDays(date, 30));
		const recent7 = [...byDate.entries()].filter(([date]) => isWithinDays(date, 7));
		const days30 = recent30.length;
		const total30 = recent30.reduce((acc, [, v]) => acc + v, 0);
		const avg30 = days30 > 0 ? total30 / days30 : 0;
		const avg7 = recent7.length > 0
			? recent7.reduce((acc, [, v]) => acc + v, 0) / recent7.length
			: 0;

		const summary = wrap.createDiv({ cls: "wp-analytics-summary" });
		stat(summary, "Days logged (30d)", days30.toString());
		stat(summary, "Avg daily (7d)", recent7.length > 0 ? formatWater(avg7, unit) : "—");
		stat(summary, "Avg daily (30d)", days30 > 0 ? formatWater(avg30, unit) : "—");
		const hitDays = recent30.filter(([, v]) => v >= target).length;
		stat(summary, "Days at goal (30d)", days30 > 0 ? `${hitDays} / ${days30}` : "—");

		const chart = wrap.createDiv({ cls: "wp-analytics-chart" });
		chart.createEl("h5", { text: "Last 30 days" });
		const points = dailyWaterSeries(byDate, 30);
		const overlays = [{
			points: points.map((p) => ({ label: p.label, value: target })),
			className: "wp-sparkline-overlay wp-sparkline-overlay--goal",
		}];
		renderSparkline(chart, points, {
			width: 320,
			height: 100,
			yScale: "auto",
			showFill: false,
			showDots: false,
			overlays,
		});
		const legend = chart.createDiv({ cls: "wp-chart-legend" });
		legend.createSpan({ cls: "wp-legend-item wp-legend-raw", text: "Daily intake" });
		const goalLabel = usingDefault
			? `Default goal (${formatWater(target, unit)})`
			: `Goal (${formatWater(target, unit)})`;
		legend.createSpan({ cls: "wp-legend-item wp-legend-goal", text: goalLabel });
	}

	private renderRecords(parent: HTMLElement): void {
		const allNames = this.deps.historyIndex.getAllExerciseNames();
		if (allNames.length === 0) return;
		const unit = this.deps.getUnit();

		const allPRs: Array<PRRecord & { sortKey: number }> = [];
		for (const name of allNames) {
			for (const pr of this.deps.historyIndex.getPRsForExercise(name)) {
				allPRs.push({ ...pr, sortKey: Date.parse(pr.date + "T00:00:00") || 0 });
			}
		}
		if (allPRs.length === 0) return;

		const wrap = parent.createDiv({ cls: "wp-records-section" });
		wrap.createEl("h4", { text: "Personal records" });

		const today = startOfDay(new Date());
		const cutoff = today.getTime() - 30 * 24 * 60 * 60 * 1000;
		const recent = allPRs
			.filter((p) => p.sortKey >= cutoff)
			.sort((a, b) => b.sortKey - a.sortKey)
			.slice(0, 6);

		if (recent.length > 0) {
			const recentWrap = wrap.createDiv({ cls: "wp-records-recent" });
			recentWrap.createEl("h5", { text: "Recent records (30d)" });
			const list = recentWrap.createEl("ul", { cls: "wp-records-list" });
			for (const pr of recent) {
				const item = list.createEl("li", { cls: "wp-records-item" });
				item.createSpan({ cls: "wp-records-star", text: "★" });
				item.createSpan({ cls: "wp-records-name", text: pr.exerciseName });
				item.createSpan({ cls: "wp-records-kind", text: prKindLabel(pr.kind) });
				item.createSpan({ cls: "wp-records-value", text: formatPRValue(pr, unit) });
				item.createSpan({ cls: "wp-records-date", text: pr.date });
			}
		}

		const allWrap = wrap.createDiv({ cls: "wp-records-all" });
		allWrap.createEl("h5", { text: "All-time bests" });
		const groupedByExercise = new Map<string, PRRecord[]>();
		for (const pr of allPRs) {
			const list = groupedByExercise.get(pr.exerciseName) ?? [];
			list.push(pr);
			groupedByExercise.set(pr.exerciseName, list);
		}
		const exerciseTable = allWrap.createEl("ul", { cls: "wp-records-list" });
		const sortedExercises = [...groupedByExercise.entries()].sort(
			(a, b) => a[0].localeCompare(b[0]),
		);
		for (const [exercise, prs] of sortedExercises) {
			const item = exerciseTable.createEl("li", { cls: "wp-records-row" });
			item.createSpan({ cls: "wp-records-name", text: exercise });
			const badges = item.createSpan({ cls: "wp-records-badges" });
			for (const pr of prs.sort((a, b) => prKindOrder(a.kind) - prKindOrder(b.kind))) {
				const badge = badges.createSpan({ cls: "wp-records-badge" });
				badge.createSpan({ cls: "wp-records-badge-kind", text: prKindLabel(pr.kind) });
				badge.createSpan({ cls: "wp-records-badge-value", text: formatPRValue(pr, unit) });
			}
		}
	}
}

function stat(parent: HTMLElement, label: string, value: string): void {
	const cell = parent.createDiv({ cls: "wp-stat" });
	cell.createDiv({ cls: "wp-stat-label", text: label });
	cell.createDiv({ cls: "wp-stat-value", text: value });
}

function renderWeightSource(
	parent: HTMLElement,
	effective: EffectiveWeight,
	unit: WeightUnit,
): void {
	const text = effective.source === "logged" && effective.loggedDate
		? `Using your latest logged weight: ${formatBodyweight(effective.weight)} ${unit} (${effective.loggedDate}).`
		: `Using your settings weight: ${formatBodyweight(effective.weight)} ${unit}. Log a body weight in any workout block to use the latest reading instead.`;
	const hint = parent.createDiv({ cls: "wp-weight-source" });
	hint.setText(text);
}

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const MONTH_NAMES_SHORT = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

const WEEKDAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"];

export type AdherenceMode = "month" | "year";

type DayState = "completed" | "missed" | "rest" | "pending" | "future" | "before" | "outside";

const STATE_LABELS: Record<DayState, string> = {
	completed: "completed",
	missed: "missed",
	rest: "rest day",
	pending: "scheduled, not yet logged",
	future: "future",
	before: "before tracking started",
	outside: "",
};

interface AdherenceStats {
	completed: number;
	scheduled: number;
	streak: number;
}

function computeAdherenceStats(
	workoutDates: Set<string>,
	schedule: WeeklySchedule,
	today: Date,
	earliest: Date | null,
	windowStart: Date,
): AdherenceStats {
	let completed = 0;
	let scheduled = 0;
	const cursor = new Date(windowStart);
	cursor.setHours(0, 0, 0, 0);
	const end = new Date(today);
	end.setHours(0, 0, 0, 0);
	while (cursor.getTime() <= end.getTime()) {
		const iso = toIsoDate(cursor);
		if (workoutDates.has(iso)) completed++;
		if (!earliest || cursor.getTime() >= earliest.getTime()) {
			const weekday = WEEKDAY_KEYS[cursor.getDay()];
			if (weekday && schedule[weekday] !== null) scheduled++;
		}
		cursor.setDate(cursor.getDate() + 1);
	}

	let streak = 0;
	const streakCursor = new Date(today);
	for (let safety = 0; safety < 365; safety++) {
		const iso = toIsoDate(streakCursor);
		const weekday = WEEKDAY_KEYS[streakCursor.getDay()];
		const isScheduled = weekday ? schedule[weekday] !== null : false;
		const isCompleted = workoutDates.has(iso);
		if (isScheduled) {
			if (isCompleted) {
				streak++;
			} else if (streakCursor.getTime() === today.getTime()) {
				// Today scheduled but not yet completed — don't break the streak.
			} else {
				break;
			}
		}
		streakCursor.setDate(streakCursor.getDate() - 1);
		if (earliest && streakCursor.getTime() < earliest.getTime()) break;
	}

	return { completed, scheduled, streak };
}

function computeDayState(
	date: Date,
	schedule: WeeklySchedule,
	workoutDates: Set<string>,
	today: Date,
	hasSchedule: boolean,
	earliest: Date | null,
): DayState {
	const iso = toIsoDate(date);
	if (workoutDates.has(iso)) return "completed";

	if (date.getTime() > today.getTime()) {
		if (!hasSchedule) return "future";
		const weekday = WEEKDAY_KEYS[date.getDay()];
		return weekday && schedule[weekday] !== null ? "pending" : "rest";
	}

	if (date.getTime() === today.getTime()) {
		if (!hasSchedule) return "future";
		const weekday = WEEKDAY_KEYS[date.getDay()];
		return weekday && schedule[weekday] !== null ? "pending" : "rest";
	}

	if (!hasSchedule) return "before";
	if (earliest && date.getTime() < earliest.getTime()) return "before";

	const weekday = WEEKDAY_KEYS[date.getDay()];
	return weekday && schedule[weekday] !== null ? "missed" : "rest";
}

function legendSwatch(parent: HTMLElement, modifier: string, label: string): void {
	const item = parent.createDiv({ cls: "wp-adherence-legend-item" });
	item.createSpan({ cls: `wp-adherence-day ${modifier}` });
	item.createSpan({ cls: "wp-adherence-legend-label", text: label });
}

function startOfDay(d: Date): Date {
	const out = new Date(d);
	out.setHours(0, 0, 0, 0);
	return out;
}

function parseIsoDate(iso: string): Date {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!match) return new Date(NaN);
	const year = Number(match[1]);
	const month = Number(match[2]) - 1;
	const day = Number(match[3]);
	return new Date(year, month, day);
}

function monthKey(d: Date): { year: number; month: number } {
	return { year: d.getFullYear(), month: d.getMonth() };
}

function isWithinDays(dateIso: string, days: number): boolean {
	const d = new Date(dateIso + "T00:00:00");
	const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
	return d.getTime() >= cutoff;
}

function weeklyAggregate<T extends { date: string }>(
	entries: T[],
	weeks: number,
	value: (entry: T) => number,
): SparklinePoint[] {
	const now = new Date();
	const weekStart = startOfWeek(now);
	const points: SparklinePoint[] = [];
	for (let i = weeks - 1; i >= 0; i--) {
		const start = new Date(weekStart);
		start.setDate(start.getDate() - i * 7);
		const end = new Date(start);
		end.setDate(end.getDate() + 7);
		const startIso = toIsoDate(start);
		const endIso = toIsoDate(end);
		const total = entries
			.filter((e) => e.date >= startIso && e.date < endIso)
			.reduce((acc, e) => acc + value(e), 0);
		points.push({ label: startIso, value: total });
	}
	return points;
}

function startOfWeek(d: Date): Date {
	const out = new Date(d);
	out.setHours(0, 0, 0, 0);
	const day = out.getDay();
	const diff = (day + 6) % 7;
	out.setDate(out.getDate() - diff);
	return out;
}

function toIsoDate(d: Date): string {
	const yyyy = d.getFullYear().toString().padStart(4, "0");
	const mm = (d.getMonth() + 1).toString().padStart(2, "0");
	const dd = d.getDate().toString().padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function titleCase(value: string): string {
	return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

function collapseToLatestPerDay(entries: BodyweightEntry[]): BodyweightEntry[] {
	const byDate = new Map<string, BodyweightEntry>();
	for (const entry of [...entries].sort((a, b) => (a.date < b.date ? -1 : 1))) {
		byDate.set(entry.date, entry);
	}
	return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

function changeOverDays(entries: BodyweightEntry[], days: number): number | null {
	if (entries.length === 0) return null;
	const latest = entries[entries.length - 1];
	if (!latest) return null;
	const cutoffMs = new Date(latest.date + "T00:00:00").getTime() - days * 24 * 60 * 60 * 1000;
	const baseline = entries
		.filter((e) => new Date(e.date + "T00:00:00").getTime() <= cutoffMs)
		.pop();
	if (!baseline) return null;
	return latest.weight - baseline.weight;
}

function formatDelta(delta: number | null, unit: WeightUnit): string {
	if (delta === null) return "—";
	const rounded = Math.round(delta * 10) / 10;
	const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
	const abs = Math.abs(rounded);
	const display = Number.isInteger(abs) ? abs.toString() : abs.toString();
	return `${sign}${display} ${unit}`;
}

function formatBodyweight(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded) ? rounded.toString() : rounded.toString();
}

function formatToGoal(latest: number, goal: number, unit: WeightUnit): string {
	const diff = Math.round((goal - latest) * 10) / 10;
	if (diff === 0) return "Reached";
	const abs = Math.abs(diff);
	const display = Number.isInteger(abs) ? abs.toString() : abs.toString();
	return diff > 0 ? `${display} ${unit} to gain` : `${display} ${unit} to lose`;
}

interface NutritionDayTotal {
	date: string;
	totals: NutritionTotals;
}

function aggregateMealsByDay(
	records: ReturnType<HistoryIndex["getAllMealsBlocks"]>,
	recipes: RecipeIndex,
): NutritionDayTotal[] {
	const byDate = new Map<string, NutritionTotals>();
	for (const record of records) {
		const dailyTotals = sumTotals(
			record.block.entries.map((entry) => resolveMeal(entry, recipes).totals),
		);
		const existing = byDate.get(record.date);
		if (existing) {
			byDate.set(record.date, sumTotals([existing, dailyTotals]));
		} else {
			byDate.set(record.date, dailyTotals);
		}
	}
	return Array.from(byDate.entries())
		.map(([date, totals]) => ({ date, totals }))
		.sort((a, b) => (a.date < b.date ? -1 : 1));
}

function averageTotals(items: NutritionTotals[]): NutritionTotals {
	if (items.length === 0) return { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0 };
	const sum = sumTotals(items);
	return {
		calories: sum.calories / items.length,
		protein: sum.protein / items.length,
		carbs: sum.carbs / items.length,
		fats: sum.fats / items.length,
		fiber: sum.fiber / items.length,
	};
}

function dailyCaloriesSeries(days: NutritionDayTotal[], window: number): SparklinePoint[] {
	const byDate = new Map(days.map((d) => [d.date, d.totals.calories] as const));
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const points: SparklinePoint[] = [];
	for (let i = window - 1; i >= 0; i--) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		const iso = toIsoDate(d);
		points.push({ label: iso, value: byDate.get(iso) ?? 0 });
	}
	return points;
}

function movingAverage(points: SparklinePoint[], window: number): SparklinePoint[] {
	if (points.length === 0 || window <= 1) return [...points];
	const result: SparklinePoint[] = [];
	for (let i = 0; i < points.length; i++) {
		const start = Math.max(0, i - window + 1);
		const slice = points.slice(start, i + 1);
		const avg = slice.reduce((acc, p) => acc + p.value, 0) / slice.length;
		const point = points[i];
		if (point) result.push({ label: point.label, value: avg });
	}
	return result;
}

const MEASUREMENT_FIELD_ORDER: Array<{ key: keyof BodyMeasurements; label: string }> = [
	{ key: "waist", label: "Waist" },
	{ key: "chest", label: "Chest" },
	{ key: "hips", label: "Hips" },
	{ key: "biceps", label: "Biceps" },
	{ key: "thighs", label: "Thighs" },
	{ key: "neck", label: "Neck" },
];

interface MeasurementSeriesPoint {
	date: string;
	value: number;
}

function collectMeasurementSeries(
	entries: MeasurementsEntry[],
	key: keyof BodyMeasurements,
): MeasurementSeriesPoint[] {
	const byDate = new Map<string, number>();
	for (const e of [...entries].sort((a, b) => (a.date < b.date ? -1 : 1))) {
		const v = e.measurements[key];
		if (typeof v === "number" && Number.isFinite(v) && v > 0) {
			byDate.set(e.date, v);
		}
	}
	return [...byDate.entries()].map(([date, value]) => ({ date, value }));
}

function renderMeasurementCard(
	parent: HTMLElement,
	label: string,
	unit: string,
	series: MeasurementSeriesPoint[],
): void {
	const card = parent.createDiv({ cls: "wp-measurement-card" });
	card.createDiv({ cls: "wp-measurement-label", text: label });
	const latest = series[series.length - 1];
	if (!latest) return;

	const head = card.createDiv({ cls: "wp-measurement-head" });
	head.createDiv({ cls: "wp-measurement-value", text: `${formatMeasurementValue(latest.value)} ${unit}` });
	head.createDiv({ cls: "wp-measurement-date", text: latest.date });

	const baseline = pickBaselineForDays(series, 30);
	if (baseline) {
		const delta = latest.value - baseline.value;
		const deltaCls = delta > 0
			? "wp-measurement-delta wp-measurement-delta--up"
			: delta < 0
				? "wp-measurement-delta wp-measurement-delta--down"
				: "wp-measurement-delta";
		card.createDiv({
			cls: deltaCls,
			text: `${formatMeasurementDelta(delta)} ${unit} vs ${baseline.date}`,
		});
	}

	if (series.length >= 2) {
		const points: SparklinePoint[] = series.slice(-30).map((p) => ({
			label: p.date,
			value: p.value,
		}));
		const sparkWrap = card.createDiv({ cls: "wp-measurement-spark" });
		renderSparkline(sparkWrap, points, {
			width: 160,
			height: 40,
			yScale: "auto",
			showFill: false,
			showDots: false,
		});
	}
}

function pickBaselineForDays(
	series: MeasurementSeriesPoint[],
	days: number,
): MeasurementSeriesPoint | null {
	if (series.length === 0) return null;
	const latest = series[series.length - 1];
	if (!latest) return null;
	const cutoffMs = new Date(latest.date + "T00:00:00").getTime() - days * 24 * 60 * 60 * 1000;
	const baseline = series
		.filter((e) => new Date(e.date + "T00:00:00").getTime() <= cutoffMs)
		.pop();
	return baseline ?? series[0] ?? null;
}

function formatMeasurementValue(v: number): string {
	const rounded = Math.round(v * 10) / 10;
	return Number.isInteger(rounded) ? rounded.toString() : rounded.toString();
}

function formatMeasurementDelta(delta: number): string {
	const rounded = Math.round(delta * 10) / 10;
	if (rounded === 0) return "no change";
	const sign = rounded > 0 ? "+" : "−";
	return `${sign}${Math.abs(rounded)}`;
}

function dailyWaterSeries(byDate: Map<string, number>, window: number): SparklinePoint[] {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const points: SparklinePoint[] = [];
	for (let i = window - 1; i >= 0; i--) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		const iso = toIsoDate(d);
		points.push({ label: iso, value: byDate.get(iso) ?? 0 });
	}
	return points;
}

function mostFrequentUnit(
	entries: Array<{ distanceUnit?: "km" | "mi" }>,
): "km" | "mi" {
	let km = 0;
	let mi = 0;
	for (const e of entries) {
		if ((e.distanceUnit ?? "km") === "mi") mi++;
		else km++;
	}
	return mi > km ? "mi" : "km";
}

function formatDurationDisplay(min: number): string {
	if (!Number.isFinite(min) || min <= 0) return "—";
	const rounded = Math.round(min);
	if (rounded < 60) return `${rounded} min`;
	const hours = Math.floor(rounded / 60);
	const mins = rounded % 60;
	return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

function prKindLabel(kind: PRRecord["kind"]): string {
	switch (kind) {
		case "weight": return "Heaviest";
		case "e1rm": return "Best 1RM";
		case "reps": return "Most reps";
		case "volume": return "Top volume";
		case "duration": return "Longest";
		case "distance": return "Farthest";
	}
}

function prKindOrder(kind: PRRecord["kind"]): number {
	switch (kind) {
		case "weight": return 0;
		case "e1rm": return 1;
		case "reps": return 2;
		case "volume": return 3;
		case "duration": return 4;
		case "distance": return 5;
	}
}

function formatPRValue(pr: PRRecord, unit: WeightUnit): string {
	switch (pr.kind) {
		case "weight":
			return `${formatBodyweight(pr.value)} ${unit} × ${pr.reps ?? "?"}`;
		case "e1rm":
			return `${formatBodyweight(pr.value)} ${unit}`;
		case "reps":
			return `${pr.value} @ ${pr.weight ?? 0} ${unit}`;
		case "volume":
			return `${formatBodyweight(pr.value)} ${unit}`;
		case "duration":
			return formatMinutes(pr.value);
		case "distance":
			return `${pr.value}`;
	}
}
