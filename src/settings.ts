import type {
	ActivityLevel,
	BodyData,
	Exercise,
	FitnessGoal,
	Gender,
	HeightUnit,
	MealFavorite,
	NutritionGoals,
	NutritionTotals,
	Weekday,
	WeeklySchedule,
	WeightUnit,
	WorkoutTemplate,
} from "./types";
import { DEFAULT_EXERCISES } from "./defaults/exercises";

export interface WorkoutSettings {
	weightUnit: WeightUnit;
	restDurationSec: number;
	supersetTransitionSec: number;
	autoStartRest: boolean;
	playSoundOnRest: boolean;
	showAddSetButton: boolean;
	goalWeight: number | null;
	bodyData: BodyData;
	fitnessGoal: FitnessGoal;
	exercises: Exercise[];
	templates: WorkoutTemplate[];
	weeklySchedule: WeeklySchedule;
	recipesFolders: string[];
	nutritionGoals: NutritionGoals;
	/**
	 * Whether to surface fiber as a 5th macro in the meals UI, settings, and
	 * analytics. Off by default to keep the UI uncluttered for users who
	 * don't care about fiber.
	 */
	trackFiber: boolean;
	/**
	 * Daily water target, in the user's water unit (ml when weightUnit=kg,
	 * fl oz when lb). When `null`, the UI falls back to a unit-appropriate
	 * default (see `defaultWaterTargetFor`).
	 */
	waterTarget: number | null;
	/**
	 * Step size used by the water tracker's +/- buttons, in the user's water
	 * unit. When `null`, falls back to a unit-appropriate default (250 ml or
	 * 8 fl oz). The value is intentionally stored in the active unit and is
	 * NOT auto-converted on weight-unit change, mirroring how `waterTarget`
	 * behaves.
	 */
	waterStep: number | null;
	/**
	 * Saved meal shortcuts surfaced via the Favorites picker on every meals
	 * block. Lets users one-click insert recurring entries (daily protein
	 * shake, usual breakfast, etc.) without re-entering the data.
	 */
	mealFavorites: MealFavorite[];
}

export const DEFAULT_BODY_DATA: BodyData = {
	height: null,
	heightUnit: "cm",
	age: null,
	gender: "unspecified",
	activityLevel: "moderate",
	weight: null,
};

export const GENDER_OPTIONS: readonly Gender[] = [
	"unspecified",
	"female",
	"male",
	"non-binary",
] as const;

export const GENDER_LABELS: Record<Gender, string> = {
	unspecified: "Prefer not to say",
	female: "Female",
	male: "Male",
	"non-binary": "Non-binary",
};

export const ACTIVITY_LEVEL_OPTIONS: readonly ActivityLevel[] = [
	"sedentary",
	"light",
	"moderate",
	"active",
	"very-active",
] as const;

export const ACTIVITY_LEVEL_LABELS: Record<ActivityLevel, string> = {
	sedentary: "Sedentary (desk job, no exercise)",
	light: "Light (1–3 workouts / week)",
	moderate: "Moderate (3–5 workouts / week)",
	active: "Active (6–7 workouts / week)",
	"very-active": "Very active (physical job + workouts)",
};

export const ACTIVITY_LEVEL_FACTORS: Record<ActivityLevel, number> = {
	sedentary: 1.2,
	light: 1.375,
	moderate: 1.55,
	active: 1.725,
	"very-active": 1.9,
};

export const FITNESS_GOAL_OPTIONS: readonly FitnessGoal[] = [
	"general",
	"lose-weight",
	"get-lean",
	"build-muscle",
	"endurance",
] as const;

export const FITNESS_GOAL_LABELS: Record<FitnessGoal, string> = {
	general: "General fitness",
	"lose-weight": "Lose weight",
	"get-lean": "Get lean (recomp)",
	"build-muscle": "Build muscle",
	endurance: "Improve endurance",
};

export const DEFAULT_FITNESS_GOAL: FitnessGoal = "general";

export const WEEKDAY_KEYS: readonly Weekday[] = [
	"sunday",
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
] as const;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
	sunday: "Sunday",
	monday: "Monday",
	tuesday: "Tuesday",
	wednesday: "Wednesday",
	thursday: "Thursday",
	friday: "Friday",
	saturday: "Saturday",
};

export const EMPTY_WEEKLY_SCHEDULE: WeeklySchedule = {
	sunday: null,
	monday: null,
	tuesday: null,
	wednesday: null,
	thursday: null,
	friday: null,
	saturday: null,
};

export const DEFAULT_NUTRITION_GOALS: NutritionGoals = {
	calories: 2200,
	protein: 150,
	carbs: 220,
	fats: 70,
	fiber: 30,
};

export const DEFAULT_SETTINGS: WorkoutSettings = {
	weightUnit: "kg",
	restDurationSec: 90,
	supersetTransitionSec: 30,
	autoStartRest: true,
	playSoundOnRest: true,
	showAddSetButton: false,
	goalWeight: null,
	bodyData: { ...DEFAULT_BODY_DATA },
	fitnessGoal: DEFAULT_FITNESS_GOAL,
	weeklySchedule: { ...EMPTY_WEEKLY_SCHEDULE },
	recipesFolders: [],
	nutritionGoals: DEFAULT_NUTRITION_GOALS,
	trackFiber: false,
	waterTarget: null,
	waterStep: null,
	mealFavorites: [],
	exercises: DEFAULT_EXERCISES,
	templates: [
		{
			id: "push-day",
			name: "Push Day",
			exercises: [
				{ exerciseId: "bench-press", name: "Bench Press", sets: 3, reps: 5, weight: 60 },
				{ exerciseId: "overhead-press", name: "Overhead Press", sets: 3, reps: 8, weight: 35 },
				{ exerciseId: "lateral-raise", name: "Lateral Raise", sets: 3, reps: 12, weight: 8 },
				{ exerciseId: "triceps-pushdown", name: "Triceps Pushdown", sets: 3, reps: 12, weight: 20 },
			],
			cardio: [],
		},
		{
			id: "pull-day",
			name: "Pull Day",
			exercises: [
				{ exerciseId: "deadlift", name: "Deadlift", sets: 3, reps: 5, weight: 100 },
				{ exerciseId: "pull-up", name: "Pull-Up", sets: 3, reps: 8, weight: 0 },
				{ exerciseId: "barbell-row", name: "Barbell Row", sets: 3, reps: 8, weight: 60 },
				{ exerciseId: "dumbbell-curl", name: "Dumbbell Curl", sets: 3, reps: 12, weight: 12 },
			],
			cardio: [],
		},
		{
			id: "leg-day",
			name: "Leg Day",
			exercises: [
				{ exerciseId: "back-squat", name: "Back Squat", sets: 3, reps: 5, weight: 80 },
				{ exerciseId: "romanian-deadlift", name: "Romanian Deadlift", sets: 3, reps: 8, weight: 70 },
				{ exerciseId: "leg-press", name: "Leg Press", sets: 3, reps: 10, weight: 120 },
				{ exerciseId: "calf-raise", name: "Calf Raise", sets: 4, reps: 15, weight: 60 },
			],
			cardio: [],
		},
	],
};

export function migrateTemplate(template: WorkoutTemplate): WorkoutTemplate {
	if (!Array.isArray(template.cardio)) {
		template.cardio = [];
	}
	return template;
}

export function normalizeWeeklySchedule(
	value: unknown,
	templates: WorkoutTemplate[],
): WeeklySchedule {
	const out: WeeklySchedule = { ...EMPTY_WEEKLY_SCHEDULE };
	if (!value || typeof value !== "object") return out;
	const raw = value as Record<string, unknown>;
	const validNames = new Set(templates.map((t) => t.name));
	for (const key of WEEKDAY_KEYS) {
		const candidate = raw[key];
		if (typeof candidate === "string" && candidate.trim().length > 0 && validNames.has(candidate)) {
			out[key] = candidate;
		} else {
			out[key] = null;
		}
	}
	return out;
}

export function normalizeRecipesFolders(value: unknown, legacy?: unknown): string[] {
	const collected: string[] = [];
	if (Array.isArray(value)) {
		for (const item of value) {
			if (typeof item === "string") collected.push(item);
		}
	}
	if (typeof legacy === "string" && legacy.trim().length > 0) {
		collected.push(legacy);
	}
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of collected) {
		const cleaned = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "");
		if (cleaned.length === 0) continue;
		if (seen.has(cleaned)) continue;
		seen.add(cleaned);
		out.push(cleaned);
	}
	return out;
}

export function normalizeGoalWeight(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.round(value * 10) / 10;
	}
	if (typeof value === "string") {
		const parsed = parseFloat(value);
		if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed * 10) / 10;
	}
	return null;
}

export function normalizeBodyData(value: unknown, weightUnit: WeightUnit): BodyData {
	const out: BodyData = { ...DEFAULT_BODY_DATA };
	out.heightUnit = weightUnit === "lb" ? "in" : "cm";
	if (!value || typeof value !== "object") return out;
	const raw = value as Record<string, unknown>;

	const height = toPositiveFinite(raw.height);
	if (height !== null) out.height = Math.round(height * 10) / 10;

	if (raw.heightUnit === "in" || raw.heightUnit === "cm") {
		out.heightUnit = raw.heightUnit;
	}

	const age = toPositiveFinite(raw.age);
	if (age !== null) out.age = Math.round(age);

	const validGenders: Gender[] = ["male", "female", "non-binary", "unspecified"];
	const genderCandidate = typeof raw.gender === "string" ? raw.gender : raw.sex;
	if (typeof genderCandidate === "string" && (validGenders as string[]).includes(genderCandidate)) {
		out.gender = genderCandidate as Gender;
	}

	const validLevels: ActivityLevel[] = [
		"sedentary",
		"light",
		"moderate",
		"active",
		"very-active",
	];
	if (typeof raw.activityLevel === "string" && (validLevels as string[]).includes(raw.activityLevel)) {
		out.activityLevel = raw.activityLevel as ActivityLevel;
	}

	const weight = toPositiveFinite(raw.weight);
	if (weight !== null) out.weight = Math.round(weight * 10) / 10;

	return out;
}

function toPositiveFinite(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
	if (typeof value === "string") {
		const parsed = parseFloat(value);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return null;
}

export function isHeightUnitFor(weightUnit: WeightUnit): HeightUnit {
	return weightUnit === "lb" ? "in" : "cm";
}

export function normalizeFitnessGoal(value: unknown): FitnessGoal {
	if (typeof value === "string" && (FITNESS_GOAL_OPTIONS as readonly string[]).includes(value)) {
		return value as FitnessGoal;
	}
	return DEFAULT_FITNESS_GOAL;
}

export function clampRestDuration(value: number): number {
	if (Number.isNaN(value)) return 90;
	if (value < 30) return 30;
	if (value > 300) return 300;
	return Math.round(value / 5) * 5;
}

export function clampSupersetTransition(value: number): number {
	if (Number.isNaN(value)) return 30;
	if (value < 10) return 10;
	if (value > 120) return 120;
	return Math.round(value / 5) * 5;
}

export function normalizeNutritionGoals(value: unknown): NutritionGoals {
	const out: NutritionGoals = { ...DEFAULT_NUTRITION_GOALS };
	if (!value || typeof value !== "object") return out;
	const raw = value as Record<string, unknown>;
	for (const key of ["calories", "protein", "carbs", "fats", "fiber"] as const) {
		const n = toNonNegativeInt(raw[key]);
		if (n !== null) out[key] = n;
	}
	return out;
}

export function normalizeWaterTarget(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.round(value);
	}
	if (typeof value === "string") {
		const parsed = parseFloat(value);
		if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
	}
	return null;
}

export function normalizeMealFavorites(value: unknown): MealFavorite[] {
	if (!Array.isArray(value)) return [];
	const seenIds = new Set<string>();
	const out: MealFavorite[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const raw = item as Record<string, unknown>;
		const name = typeof raw.name === "string" ? raw.name.trim() : "";
		if (name.length === 0) continue;

		const servingsRaw = typeof raw.servings === "number" ? raw.servings : Number(raw.servings);
		const servings = Number.isFinite(servingsRaw) && servingsRaw > 0
			? Math.round(servingsRaw * 100) / 100
			: 1;

		const recipe = typeof raw.recipe === "string" && raw.recipe.trim().length > 0
			? raw.recipe.trim()
			: undefined;
		const nutrition = recipe ? undefined : normalizeFavoriteNutrition(raw.nutrition);
		// Skip freeform favorites with no nutrition — they'd be useless to insert.
		if (!recipe && !nutrition) continue;

		let id = typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : generateId("fav");
		while (seenIds.has(id)) id = generateId("fav");
		seenIds.add(id);

		const fav: MealFavorite = { id, name, servings };
		if (recipe) fav.recipe = recipe;
		if (nutrition) fav.nutrition = nutrition;
		out.push(fav);
	}
	return out;
}

function normalizeFavoriteNutrition(value: unknown): NutritionTotals | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const out: NutritionTotals = { calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0 };
	let total = 0;
	for (const key of ["calories", "protein", "carbs", "fats", "fiber"] as const) {
		const candidate = raw[key];
		const n = typeof candidate === "number" ? candidate : Number(candidate);
		if (Number.isFinite(n) && n >= 0) {
			out[key] = Math.round(n * 100) / 100;
			total += n;
		}
	}
	return total > 0 ? out : undefined;
}

export function normalizeWaterStep(value: unknown): number | null {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n) || n <= 0) return null;
	return Math.round(n * 100) / 100;
}

function toNonNegativeInt(value: unknown): number | null {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.round(n);
}

export function generateId(prefix: string): string {
	const rand = Math.random().toString(36).slice(2, 8);
	return `${prefix}-${Date.now().toString(36)}-${rand}`;
}
