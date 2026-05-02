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
 * editable empty line between them in Live Preview. They return an empty
 * string when there's nothing to show (e.g. a rest day for
 * `getWorkoutFor*`) so call sites can safely `?? ""` the result.
 */
export interface WorkoutPlannerApi {
	getTemplateNameForDate(date?: Date | string): string | null;
	getTemplateForDate(date?: Date | string): WorkoutTemplate | null;
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
	// and Live Preview stay in sync. Returning empty string stays empty so
	// callers can safely `?? ""` the result.
	const withTrailingNewline = (block: string): string =>
		block.length > 0 ? block + "\n" : "";

	const getWorkoutForDate = (input?: Date | string): string => {
		const date = toDate(input);
		const template = getTemplateForDate(date);
		if (!template) return "";
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
	const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input.trim());
	if (match) {
		const year = Number(match[1]);
		const month = Number(match[2]) - 1;
		const day = Number(match[3]);
		return new Date(year, month, day);
	}
	const parsed = new Date(input);
	return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
