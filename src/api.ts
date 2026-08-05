import type { Weekday, WorkoutTemplate } from "./types";
import type { WorkoutSettings } from "./settings";
import { WEEKDAY_KEYS } from "./settings";
import { buildWorkoutBlockText } from "./data/workout-builder";
import { serializeMealsBlock } from "./data/meals-block";
import { buildWaterBlockText } from "./ui/water-renderer";
import { formatIsoDate } from "./data/history-index";

/**
 * Public API for templater / dataview.
 *
 * All `get*ForDate` / `get*ForToday` helpers that emit a fenced code block
 * append a single trailing newline so the result drops cleanly into a
 * daily note alongside other plugins' card outputs without leaving an
 * editable empty line between them in Live Preview.
 *
 * Prefer `get*ForDate(tp.file.title)` (or another note-derived date) in
 * daily-note templates so backfilled / ahead-of-time notes get the right
 * schedule and `date:` stamp — `get*ForToday` always uses the wall clock.
 */
export interface WorkoutPlannerApi {
	getTemplateNameForDate(date?: Date | string): string | null;
	getTemplateForDate(date?: Date | string): WorkoutTemplate | null;
	/**
	 * Returns a ` ```workout ``` ` block for the scheduled template, or a
	 * rest-day card (body weight still prompted) when that weekday has no
	 * template. Date args accept a `Date`, `YYYY-MM-DD`, or any string that
	 * contains a `YYYY-MM-DD` (e.g. a daily-note title or path).
	 */
	getWorkoutForDate(date?: Date | string): string;
	getWorkoutForToday(): string;
	/**
	 * Returns a fresh ` ```meals ``` ` block (as a string) with `date:` set to
	 * the given day and `entries: []`. Always returns a block — meals aren't
	 * scheduled like workouts, so there's no "rest day" concept.
	 */
	getMealLogForDate(date?: Date | string): string;
	getMealLogForToday(): string;
	/**
	 * Returns a fresh ` ```water ``` ` block (as a string) with `date:` set to
	 * the given day and `amount: 0`. The daily target is intentionally left
	 * out so the renderer keeps following your settings — set a specific
	 * target by adding `target:` manually if you want to override per-day.
	 */
	getWaterBlockForDate(date?: Date | string): string;
	getWaterBlockForToday(): string;
}

export function createWorkoutApi(
	getSettings: () => WorkoutSettings,
): WorkoutPlannerApi {
	const weekdayKeyFor = (date: Date): Weekday => {
		const index = date.getDay();
		return WEEKDAY_KEYS[index] ?? "sunday";
	};

	const getTemplateNameForDate = (input?: Date | string): string | null => {
		const date = toDate(input);
		const key = weekdayKeyFor(date);
		const name = getSettings().weeklySchedule[key];
		return typeof name === "string" && name.trim().length > 0 ? name : null;
	};

	const getTemplateForDate = (input?: Date | string): WorkoutTemplate | null => {
		const name = getTemplateNameForDate(input);
		if (!name) return null;
		return getSettings().templates.find((t) => t.name === name) ?? null;
	};

	// Each block is followed by a single newline so a daily-note template
	// that concatenates several cards lands them on adjacent lines in the
	// source — no empty line between them. In Live Preview an empty source
	// line would otherwise render as an editable, full-line-height gap
	// between cards; visual breathing room is left to CSS so Reading mode
	// and Live Preview stay in sync.
	const withTrailingNewline = (block: string): string =>
		block.length > 0 ? block + "\n" : "";

	const getWorkoutForDate = (input?: Date | string): string => {
		const date = toDate(input);
		const template = getTemplateForDate(date);
		// Rest days still get a card so body weight can be logged.
		return withTrailingNewline(
			buildWorkoutBlockText(template, formatIsoDate(date)),
		);
	};

	const getWorkoutForToday = (): string => getWorkoutForDate();

	const getMealLogForDate = (input?: Date | string): string => {
		const date = formatIsoDate(toDate(input));
		const yaml = serializeMealsBlock({ date, entries: [] }).trimEnd();
		return withTrailingNewline("```meals\n" + yaml + "\n```");
	};

	const getMealLogForToday = (): string => getMealLogForDate();

	const getWaterBlockForDate = (input?: Date | string): string => {
		const date = formatIsoDate(toDate(input));
		return withTrailingNewline(buildWaterBlockText(date));
	};

	const getWaterBlockForToday = (): string => getWaterBlockForDate();

	return {
		getTemplateNameForDate,
		getTemplateForDate,
		getWorkoutForDate,
		getWorkoutForToday,
		getMealLogForDate,
		getMealLogForToday,
		getWaterBlockForDate,
		getWaterBlockForToday,
	};
}

function toDate(input?: Date | string): Date {
	if (!input) return new Date();
	if (input instanceof Date) return input;
	const trimmed = input.trim();
	// Exact ISO date, or the first YYYY-MM-DD found in a title/path
	// (daily notes like `2026-08-05` or `Noting/2026/August/2026-08-05`).
	const match = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(trimmed);
	if (match) {
		const year = Number(match[1]);
		const month = Number(match[2]) - 1;
		const day = Number(match[3]);
		return new Date(year, month, day);
	}
	const parsed = new Date(trimmed);
	return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
