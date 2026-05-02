export type WeightUnit = "kg" | "lb";

export type DistanceUnit = "km" | "mi";

export type WaterUnit = "ml" | "fl oz";

export type ExerciseCategory =
	| "push"
	| "pull"
	| "legs"
	| "core"
	| "cardio"
	| "other";

export type ExerciseEquipment =
	| "barbell"
	| "dumbbell"
	| "machine"
	| "cable"
	| "bodyweight"
	| "kettlebell"
	| "other";

export interface Exercise {
	id: string;
	name: string;
	category: ExerciseCategory;
	equipment: ExerciseEquipment;
	custom: boolean;
}

export interface TemplateExercise {
	exerciseId: string;
	name: string;
	sets: number;
	reps: number;
	weight: number;
	tracksWeight?: boolean;
	/** Optional superset group label (e.g., "A", "B"). Exercises sharing a group are alternated round-by-round. */
	group?: string;
	/**
	 * When true, this exercise is a drop-set exercise: set 1 is the heavy
	 * working set; sets 2..N are drops. The renderer hides the weight column
	 * for drop rows and shows a `DS` badge instead. Drop sets are excluded
	 * from PR detection and volume aggregation since their weight is unknown.
	 */
	dropSet?: boolean;
	/**
	 * When true, every set of this exercise is taken to failure. The reps
	 * target renders as `{reps}F` (or `F` when reps is 0 — pure failure with
	 * no minimum). Logged reps still flow into volume / rep PRs as usual,
	 * and any reps > 0 satisfies the set-complete check.
	 */
	toFailure?: boolean;
}

export interface TemplateCardio {
	exerciseId: string;
	name: string;
	minutes: number;
	distance?: number;
	distanceUnit?: DistanceUnit;
	/**
	 * Whether the renderer should expose distance, unit, and finish-time inputs
	 * for this cardio entry. Off by default for new entries — most casual
	 * cardio (stationary bike, treadmill walk, elliptical) is just minutes.
	 * Existing templates without the field keep the legacy behavior (shown).
	 */
	trackDistance?: boolean;
}

export interface WorkoutTemplate {
	id: string;
	name: string;
	exercises: TemplateExercise[];
	cardio: TemplateCardio[];
}

export type Weekday =
	| "sunday"
	| "monday"
	| "tuesday"
	| "wednesday"
	| "thursday"
	| "friday"
	| "saturday";

export type WeeklySchedule = {
	[K in Weekday]: string | null;
};

export interface SetTarget {
	sets: number;
	reps: number;
	weight: number;
}

export interface SetLog {
	reps: number;
	weight: number;
	/** ISO timestamp when this set was logged. Optional for backwards compatibility. */
	loggedAt?: string;
}

export interface BlockExercise {
	name: string;
	target: SetTarget;
	log: SetLog[];
	tracksWeight?: boolean;
	/** Optional superset group label. Same group → alternate sets, short transition rest. */
	group?: string;
	/**
	 * Mirrors `TemplateExercise.dropSet`. When true, the renderer treats
	 * set 1 as the working set (full weight + reps inputs) and sets 2..N
	 * as drops (DS badge in place of the weight input, reps input only).
	 * Drops are excluded from volume / PR aggregation. Missing/false →
	 * normal exercise (today's behavior).
	 */
	dropSet?: boolean;
	/**
	 * Mirrors `TemplateExercise.toFailure` and `SetTarget.toFailure`. When
	 * true, every set of this exercise is to failure: reps target shown as
	 * `{reps}F` / `F`, any logged reps > 0 marks the set complete, and all
	 * sets are candidates for rep PRs. Missing/false → normal exercise.
	 */
	toFailure?: boolean;
}

export interface CardioTarget {
	minutes: number;
	distance?: number;
	distanceUnit?: DistanceUnit;
}

export interface CardioLog {
	minutes: number;
	distance?: number;
	distanceUnit?: DistanceUnit;
	/** Finish time in mm:ss or h:mm:ss format. Useful for race-style cardio (5K time, etc.). */
	finishTime?: string;
}

export interface BlockCardio {
	name: string;
	target: CardioTarget;
	log: CardioLog | null;
	/**
	 * Mirrors `TemplateCardio.trackDistance`. When `false`, the renderer hides
	 * the distance, unit, and finish-time inputs for this row. Treat
	 * `undefined` as `true` for backwards compatibility with logs created
	 * before this flag existed.
	 */
	trackDistance?: boolean;
}

/** Body measurements in the user's selected unit (cm with kg, in with lb). All optional. */
export interface BodyMeasurements {
	waist?: number;
	chest?: number;
	hips?: number;
	biceps?: number;
	thighs?: number;
	neck?: number;
}

export interface WorkoutBlock {
	template?: string;
	date?: string;
	bodyweight?: number;
	measurements?: BodyMeasurements;
	/** ISO timestamp when first set was logged. Auto-set on first log. */
	startedAt?: string;
	/** ISO timestamp when most recent set was logged. Auto-updated on each log. */
	endedAt?: string;
	exercises: BlockExercise[];
	cardio: BlockCardio[];
}

export interface BodyweightEntry {
	date: string;
	weight: number;
	filePath: string;
}

export interface MeasurementsEntry {
	date: string;
	measurements: BodyMeasurements;
	filePath: string;
}

export type Gender = "male" | "female" | "non-binary" | "unspecified";

export type FitnessGoal =
	| "general"
	| "lose-weight"
	| "get-lean"
	| "build-muscle"
	| "endurance";

export type HeightUnit = "cm" | "in";

export type ActivityLevel =
	| "sedentary"
	| "light"
	| "moderate"
	| "active"
	| "very-active";

export interface BodyData {
	height: number | null;
	heightUnit: HeightUnit;
	age: number | null;
	gender: Gender;
	activityLevel: ActivityLevel;
	/**
	 * Optional fallback weight (in the user's selected weight unit) used for
	 * BMI and nutrition recommendations when no body weight has been logged
	 * in any workout block. Logged weights always take precedence.
	 */
	weight: number | null;
}

export type HistoryEntry =
	| {
		kind: "strength";
		date: string;
		filePath: string;
		sets: SetLog[];
		/** True if this exercise instance was logged as a drop set. Sets at index > 0 should be excluded from weight/e1rm/volume PRs. */
		dropSet?: boolean;
		/** True if this exercise instance was logged as a to-failure exercise. Excluded from all PR detection (weight, e1RM, reps, volume). */
		toFailure?: boolean;
	}
	| {
		kind: "cardio";
		date: string;
		filePath: string;
		minutes: number;
		distance?: number;
		distanceUnit?: DistanceUnit;
		finishTime?: string;
	};

export interface RestTimerState {
	startedAt: number;
	durationSec: number;
	label?: string;
}

export interface NutritionGoals {
	calories: number;
	protein: number;
	carbs: number;
	fats: number;
	fiber: number;
}

export interface NutritionTotals {
	calories: number;
	protein: number;
	carbs: number;
	fats: number;
	fiber: number;
}

/**
 * A logged meal entry. Two flavors:
 *
 *   1. Recipe-linked: `recipe` is set, nutrition is pulled from that recipe's frontmatter.
 *   2. Freeform: `recipe` is omitted, `name` and `nutrition` are explicit (one-off restaurant
 *      meal, packaged food, etc.). Useful when you don't want to create a full recipe note.
 */
export interface MealEntry {
	recipe?: string;
	name?: string;
	nutrition?: NutritionTotals;
	servings: number;
	note?: string;
}

/**
 * A saved meal shortcut that can be inserted into any day's meals block with
 * one click. Two flavors mirror `MealEntry`:
 *
 *   1. Recipe-linked: `recipe` is set (path), nutrition is pulled fresh from
 *      the recipe note's frontmatter at render time.
 *   2. Freeform: `recipe` is omitted, `nutrition` is explicit (e.g. a daily
 *      protein shake from a brand canister, a take-out order, etc.).
 *
 * `name` is the user-facing label shown in the picker and settings (defaults
 * to the recipe basename for recipe-linked favorites). `servings` is the
 * quantity inserted by default — most users want "1", but a meal-prepped
 * dish you eat in halves can default to 0.5.
 */
export interface MealFavorite {
	id: string;
	name: string;
	servings: number;
	recipe?: string;
	nutrition?: NutritionTotals;
}

export interface MealsBlock {
	date?: string;
	entries: MealEntry[];
	/**
	 * Optional in-block water tracker. Amount is in the user's water unit
	 * (ml when weightUnit=kg, fl oz when weightUnit=lb). When present, the
	 * meals UI renders an embedded water bar so a single block tracks both
	 * intake and hydration for the day.
	 */
	water?: number;
}

export type MealType = "drink" | "snack" | "meal";

export interface RecipeInfo {
	path: string;
	basename: string;
	nutrition: NutritionTotals;
	type: MealType;
}

export interface NutritionDay {
	date: string;
	totals: NutritionTotals;
	missingRecipes: number;
}

/** Daily water log block (separate from meals so it can live on workout-only days). */
export interface WaterBlock {
	date?: string;
	/** Amount logged today, in the user's water unit (ml or fl oz). */
	amount: number;
	/** Optional per-block override for the daily target. Falls back to the global setting. */
	target?: number;
}

/** A single personal record for an exercise. */
export type PRKind = "weight" | "e1rm" | "reps" | "volume" | "duration" | "distance";

export interface PRRecord {
	exerciseName: string;
	kind: PRKind;
	value: number;
	/** Companion fields, populated based on kind. */
	weight?: number;
	reps?: number;
	date: string;
	filePath: string;
}
