import { Editor, Notice } from "obsidian";
import type {
	NutritionGoals,
	NutritionTotals,
	WeeklySchedule,
	WeightUnit,
} from "../types";
import { formatIsoDate, type HistoryIndex } from "../data/history-index";
import type { RecipeIndex } from "../data/recipe-index";
import { resolveMeal, sumTotals, formatGrams, formatCalories, EMPTY_TOTALS } from "../utils/nutrition";
import {
	formatMinutes,
	formatWater,
	formatWeight,
	totalReps,
	totalVolume,
	waterUnitFor,
	weightedSetsForEntry,
} from "../utils/format";
import { WEEKDAY_KEYS } from "../settings";

export interface WeeklyReviewDeps {
	historyIndex: HistoryIndex;
	recipes: RecipeIndex;
	getWeightUnit: () => WeightUnit;
	getGoals: () => NutritionGoals;
	getSchedule: () => WeeklySchedule;
	getTrackFiber: () => boolean;
}

/**
 * Build a markdown summary of the past 7 days of fitness data and insert it
 * at the cursor. Pulls from workouts, meals, water, and the schedule.
 */
export function openInsertWeeklyReviewCommand(editor: Editor, deps: WeeklyReviewDeps): void {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const start = new Date(today);
	start.setDate(today.getDate() - 6);
	const startIso = formatIsoDate(start);
	const endIso = formatIsoDate(today);

	const md = buildWeeklyReview(deps, startIso, endIso);

	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	const prefix = cursor.ch === 0 && line.length === 0 ? "" : "\n";
	editor.replaceRange(prefix + md + "\n", cursor);
	new Notice("Inserted weekly review");
}

function buildWeeklyReview(
	deps: WeeklyReviewDeps,
	startIso: string,
	endIso: string,
): string {
	const unit = deps.getWeightUnit();
	const waterUnit = waterUnitFor(unit);
	const goals = deps.getGoals();
	const schedule = deps.getSchedule();

	const datesInWeek = listDates(startIso, endIso);

	const workoutSummary = summarizeWorkouts(deps.historyIndex, datesInWeek, schedule);
	const mealsSummary = summarizeMeals(deps.historyIndex, deps.recipes, datesInWeek);
	const waterSummary = summarizeWater(deps.historyIndex, datesInWeek);
	const bodyweightSummary = summarizeBodyweight(deps.historyIndex, startIso);
	const prSummary = summarizeRecentPRs(deps.historyIndex, datesInWeek);

	const lines: string[] = [];
	lines.push(`## Weekly review (${startIso} – ${endIso})`);
	lines.push("");

	lines.push("### Workouts");
	lines.push(`- Sessions logged: **${workoutSummary.sessions}** of ${workoutSummary.scheduled} scheduled`);
	if (workoutSummary.adherence !== null) {
		lines.push(`- Adherence: **${workoutSummary.adherence}%**`);
	}
	if (workoutSummary.totalVolume > 0) {
		lines.push(`- Total volume: **${formatWeight(workoutSummary.totalVolume, unit)}**`);
	}
	if (workoutSummary.totalReps > 0) {
		lines.push(`- Bodyweight reps: **${workoutSummary.totalReps}**`);
	}
	if (workoutSummary.cardioMinutes > 0) {
		lines.push(`- Cardio: **${formatMinutes(workoutSummary.cardioMinutes)}** (${workoutSummary.cardioSessions} sessions)`);
	}
	if (workoutSummary.avgDurationMin !== null) {
		lines.push(`- Avg session length: **${Math.round(workoutSummary.avgDurationMin)} min**`);
	}
	if (workoutSummary.exerciseList.length > 0) {
		lines.push(`- Exercises trained: ${workoutSummary.exerciseList.slice(0, 8).join(", ")}${workoutSummary.exerciseList.length > 8 ? "..." : ""}`);
	}
	lines.push("");

	if (prSummary.length > 0) {
		lines.push("### Personal records this week");
		for (const pr of prSummary) {
			lines.push(`- ${pr}`);
		}
		lines.push("");
	}

	lines.push("### Nutrition");
	if (mealsSummary.daysLogged === 0) {
		lines.push("- No meals logged this week.");
	} else {
		lines.push(`- Days logged: **${mealsSummary.daysLogged} / 7**`);
		lines.push(`- Avg calories: **${formatCalories(mealsSummary.avgTotals.calories)}** (goal ${formatCalories(goals.calories)})`);
		lines.push(`- Avg protein: **${formatGrams(mealsSummary.avgTotals.protein)} g** (goal ${formatGrams(goals.protein)} g)`);
		lines.push(`- Avg carbs: **${formatGrams(mealsSummary.avgTotals.carbs)} g** (goal ${formatGrams(goals.carbs)} g)`);
		lines.push(`- Avg fats: **${formatGrams(mealsSummary.avgTotals.fats)} g** (goal ${formatGrams(goals.fats)} g)`);
		if (deps.getTrackFiber()) {
			lines.push(`- Avg fiber: **${formatGrams(mealsSummary.avgTotals.fiber)} g**${goals.fiber > 0 ? ` (goal ${formatGrams(goals.fiber)} g)` : ""}`);
		}
	}
	lines.push("");

	if (waterSummary.daysLogged > 0) {
		lines.push("### Hydration");
		lines.push(`- Days logged: **${waterSummary.daysLogged} / 7**`);
		lines.push(`- Avg per day: **${formatWater(waterSummary.avgAmount, waterUnit)}**`);
		lines.push("");
	}

	if (bodyweightSummary !== null) {
		lines.push("### Body weight");
		lines.push(`- Latest: **${bodyweightSummary.latest} ${unit}** on ${bodyweightSummary.latestDate}`);
		if (bodyweightSummary.delta !== null) {
			const sign = bodyweightSummary.delta >= 0 ? "+" : "";
			lines.push(`- Change vs week start: **${sign}${bodyweightSummary.delta.toFixed(1)} ${unit}**`);
		}
		lines.push("");
	}

	return lines.join("\n").trimEnd();
}

interface WorkoutSummary {
	sessions: number;
	scheduled: number;
	adherence: number | null;
	totalVolume: number;
	totalReps: number;
	cardioMinutes: number;
	cardioSessions: number;
	avgDurationMin: number | null;
	exerciseList: string[];
}

function summarizeWorkouts(
	history: HistoryIndex,
	dates: string[],
	schedule: WeeklySchedule,
): WorkoutSummary {
	const workoutDates = history.getWorkoutDates();
	let scheduled = 0;
	let sessions = 0;
	for (const iso of dates) {
		const wd = WEEKDAY_KEYS[parseDate(iso).getDay()];
		if (wd && schedule[wd] !== null) scheduled += 1;
		if (workoutDates.has(iso)) sessions += 1;
	}
	const adherence = scheduled > 0 ? Math.round((sessions / scheduled) * 100) : null;

	let totalVolumeAcc = 0;
	let totalRepsAcc = 0;
	let cardioMinutes = 0;
	let cardioSessionsCount = 0;
	const exercises = new Set<string>();
	const allNames = history.getAllExerciseNames();
	for (const name of allNames) {
		const entries = history.getAllForExercise(name);
		for (const e of entries) {
			if (!dates.includes(e.date)) continue;
			exercises.add(name);
			if (e.kind === "strength") {
				const vol = totalVolume(weightedSetsForEntry(e));
				if (vol > 0) totalVolumeAcc += vol;
				else totalRepsAcc += totalReps(e.sets);
			} else {
				cardioMinutes += e.minutes;
				cardioSessionsCount += 1;
			}
		}
	}

	const durations = history.getWorkoutDurationEntries().filter((d) => dates.includes(d.date));
	const avgDurationMin = durations.length === 0
		? null
		: durations.reduce((acc, d) => acc + d.durationMin, 0) / durations.length;

	return {
		sessions,
		scheduled,
		adherence,
		totalVolume: totalVolumeAcc,
		totalReps: totalRepsAcc,
		cardioMinutes,
		cardioSessions: cardioSessionsCount,
		avgDurationMin,
		exerciseList: [...exercises].sort(),
	};
}

interface MealsSummary {
	daysLogged: number;
	avgTotals: NutritionTotals;
}

function summarizeMeals(
	history: HistoryIndex,
	recipes: RecipeIndex,
	dates: string[],
): MealsSummary {
	const records = history.getAllMealsBlocks().filter((r) => dates.includes(r.date));
	const byDate = new Map<string, NutritionTotals>();
	for (const r of records) {
		const totals = sumTotals(r.block.entries.map((e) => resolveMeal(e, recipes).totals));
		const existing = byDate.get(r.date) ?? { ...EMPTY_TOTALS };
		byDate.set(r.date, sumTotals([existing, totals]));
	}
	const days = byDate.size;
	if (days === 0) return { daysLogged: 0, avgTotals: { ...EMPTY_TOTALS } };
	const sums = sumTotals([...byDate.values()]);
	return {
		daysLogged: days,
		avgTotals: {
			calories: sums.calories / days,
			protein: sums.protein / days,
			carbs: sums.carbs / days,
			fats: sums.fats / days,
			fiber: sums.fiber / days,
		},
	};
}

interface WaterSummary {
	daysLogged: number;
	avgAmount: number;
}

function summarizeWater(history: HistoryIndex, dates: string[]): WaterSummary {
	const records = history.getAllWaterBlocks().filter((r) => dates.includes(r.date));
	const byDate = new Map<string, number>();
	for (const r of records) {
		const existing = byDate.get(r.date) ?? 0;
		byDate.set(r.date, existing + (r.block.amount ?? 0));
	}
	const days = byDate.size;
	if (days === 0) return { daysLogged: 0, avgAmount: 0 };
	const total = [...byDate.values()].reduce((acc, n) => acc + n, 0);
	return { daysLogged: days, avgAmount: total / days };
}

interface BodyweightSummary {
	latest: number;
	latestDate: string;
	delta: number | null;
}

function summarizeBodyweight(history: HistoryIndex, startIso: string): BodyweightSummary | null {
	const entries = history.getBodyweightEntries();
	if (entries.length === 0) return null;
	const latest = entries[entries.length - 1];
	if (!latest) return null;
	const before = [...entries].reverse().find((e) => e.date <= startIso);
	const delta = before ? Math.round((latest.weight - before.weight) * 10) / 10 : null;
	return {
		latest: Math.round(latest.weight * 10) / 10,
		latestDate: latest.date,
		delta,
	};
}

function summarizeRecentPRs(history: HistoryIndex, dates: string[]): string[] {
	const out: string[] = [];
	for (const name of history.getAllExerciseNames()) {
		const prs = history.getPRsForExercise(name);
		for (const pr of prs) {
			if (!dates.includes(pr.date)) continue;
			out.push(formatPRLine(pr));
		}
	}
	return out;
}

function formatPRLine(pr: ReturnType<HistoryIndex["getPRsForExercise"]>[number]): string {
	const name = pr.exerciseName;
	switch (pr.kind) {
		case "weight":
			return `${name}: heaviest set — ${pr.value} × ${pr.reps ?? "?"} reps (${pr.date})`;
		case "e1rm":
			return `${name}: best estimated 1RM — ${pr.value} (from ${pr.weight} × ${pr.reps}, ${pr.date})`;
		case "reps":
			return `${name}: most reps — ${pr.value} reps @ ${pr.weight ?? 0} (${pr.date})`;
		case "volume":
			return `${name}: highest session volume — ${pr.value} (${pr.date})`;
		case "duration":
			return `${name}: longest cardio — ${formatMinutes(pr.value)} (${pr.date})`;
		case "distance":
			return `${name}: farthest cardio — ${pr.value} km/mi (${pr.date})`;
	}
}

function listDates(startIso: string, endIso: string): string[] {
	const dates: string[] = [];
	const start = parseDate(startIso);
	const end = parseDate(endIso);
	const cursor = new Date(start);
	while (cursor <= end) {
		dates.push(formatIsoDate(cursor));
		cursor.setDate(cursor.getDate() + 1);
	}
	return dates;
}

function parseDate(iso: string): Date {
	const parts = iso.split("-").map((s) => parseInt(s, 10));
	return new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
}
