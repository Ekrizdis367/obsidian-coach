import type {
	ActivityLevel,
	BodyData,
	FitnessGoal,
	Gender,
	HeightUnit,
	NutritionGoals,
	WeightUnit,
} from "../types";
import { ACTIVITY_LEVEL_FACTORS } from "../settings";

export interface BMIResult {
	value: number;
	category: BMICategory;
	categoryLabel: string;
}

export type BMICategory = "underweight" | "normal" | "overweight" | "obese";

const BMI_CATEGORY_LABELS: Record<BMICategory, string> = {
	underweight: "Underweight",
	normal: "Normal",
	overweight: "Overweight",
	obese: "Obese",
};

export function weightToKg(value: number, unit: WeightUnit): number {
	return unit === "lb" ? value / 2.20462 : value;
}

export function heightToMeters(value: number, unit: HeightUnit): number {
	return unit === "in" ? value * 0.0254 : value / 100;
}

export function computeBMI(
	weight: number,
	weightUnit: WeightUnit,
	height: number,
	heightUnit: HeightUnit,
): BMIResult | null {
	if (!Number.isFinite(weight) || weight <= 0) return null;
	if (!Number.isFinite(height) || height <= 0) return null;
	const kg = weightToKg(weight, weightUnit);
	const m = heightToMeters(height, heightUnit);
	if (m <= 0) return null;
	const bmi = kg / (m * m);
	const rounded = Math.round(bmi * 10) / 10;
	const category = bmiCategory(rounded);
	return {
		value: rounded,
		category,
		categoryLabel: BMI_CATEGORY_LABELS[category],
	};
}

function bmiCategory(bmi: number): BMICategory {
	if (bmi < 18.5) return "underweight";
	if (bmi < 25) return "normal";
	if (bmi < 30) return "overweight";
	return "obese";
}

/**
 * Mifflin–St Jeor BMR (kcal/day). Returns null if any input is missing/invalid.
 *
 * The formula has only two original variants (male/female). For "non-binary"
 * and "prefer not to say" we use the average of those two as a neutral
 * fallback, which is a common compromise in health apps. Users who want a
 * more accurate number can pick the physiology-based variant that matches
 * them best.
 */
export function computeBMR(
	weightKg: number,
	heightCm: number,
	age: number,
	gender: Gender,
): number | null {
	if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
	if (!Number.isFinite(heightCm) || heightCm <= 0) return null;
	if (!Number.isFinite(age) || age <= 0) return null;
	const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
	if (gender === "male") return base + 5;
	if (gender === "female") return base - 161;
	return base - 78;
}

export function computeTDEE(bmr: number, activity: ActivityLevel): number {
	const factor = ACTIVITY_LEVEL_FACTORS[activity] ?? 1.2;
	return bmr * factor;
}

export type GoalDirection = "lose" | "maintain" | "gain";

export function inferGoalDirection(currentKg: number | null, goalKg: number | null): GoalDirection {
	if (currentKg === null || goalKg === null) return "maintain";
	const diff = goalKg - currentKg;
	if (diff <= -1) return "lose";
	if (diff >= 1) return "gain";
	return "maintain";
}

/**
 * Per-goal nutrition + training prescription. Numbers are starting points based
 * on common evidence-based guidelines, not precise prescriptions.
 *
 *   calorieDelta — kcal/day vs TDEE. `null` means "infer from current vs goal
 *                  weight" (used for "general" so existing behavior stays
 *                  unchanged for users who don't pick a specific goal).
 *   proteinPerKg — g of protein per kg of body weight per day.
 *   fatPercent   — fraction of calories from fat (carbs fill the remainder).
 */
export interface FitnessGoalSpec {
	calorieDelta: number | null;
	proteinPerKg: number;
	fatPercent: number;
	summary: string;
	training: string;
	cardio: string;
	hrZone: { low: number; high: number };
}

export const FITNESS_GOAL_SPECS: Record<FitnessGoal, FitnessGoalSpec> = {
	general: {
		calorieDelta: null,
		proteinPerKg: 1.6,
		fatPercent: 0.3,
		summary: "Balanced strength and cardio for overall health and longevity.",
		training:
			"Aim for 8–12 reps per set on most lifts, 2–3 working sets per exercise. Mix in mobility and core work.",
		cardio:
			"150 minutes per week of moderate cardio (Zone 2–3, ~60–80% of max heart rate) is a good baseline.",
		hrZone: { low: 0.6, high: 0.8 },
	},
	"lose-weight": {
		calorieDelta: -500,
		proteinPerKg: 1.8,
		fatPercent: 0.25,
		summary:
			"Maintain a moderate calorie deficit (~500 kcal/day, roughly 1 lb / week) while protecting lean mass with high protein.",
		training:
			"Stick with 8–12 reps and moderate-heavy loads. 2–3 strength sessions plus 2–3 cardio sessions per week works well.",
		cardio:
			"Zone 2 cardio (60–70% of max heart rate) is the sweet spot for fat oxidation. Add one short HIIT session weekly if time allows.",
		hrZone: { low: 0.6, high: 0.7 },
	},
	"get-lean": {
		calorieDelta: -300,
		proteinPerKg: 2.0,
		fatPercent: 0.25,
		summary:
			"Small calorie deficit (~300 kcal/day) and very high protein to drop body fat while keeping or even building muscle.",
		training:
			"Stay heavy: 6–12 reps, 3–4 working sets per exercise, progressive overload. Don't slash training volume.",
		cardio:
			"2–3 weekly Zone 2 sessions (60–70% of max heart rate). Keep cardio steady and moderate; don't outrun your recovery.",
		hrZone: { low: 0.6, high: 0.7 },
	},
	"build-muscle": {
		calorieDelta: 300,
		proteinPerKg: 1.8,
		fatPercent: 0.25,
		summary:
			"Modest calorie surplus (~300 kcal/day) plus high protein and progressive overload to add lean mass without much fat gain.",
		training:
			"Heavy compound lifts in the 5–10 rep range, 3–4 working sets. Add weight when you hit the top of the range with good form.",
		cardio:
			"Keep cardio light: 1–2 short sessions per week in Zone 1–2 (50–70% of max heart rate) for recovery, not for burn.",
		hrZone: { low: 0.5, high: 0.7 },
	},
	endurance: {
		calorieDelta: 0,
		proteinPerKg: 1.4,
		fatPercent: 0.3,
		summary:
			"Maintenance calories with cardio as the headline; carbs fuel the work.",
		training:
			"Higher-rep strength (12–20+ reps, lighter loads) to build muscular endurance without compromising recovery.",
		cardio:
			"Build an aerobic base in Zone 2 (60–70% of max heart rate), 3–5 sessions per week. Add one weekly Zone 4 (80–90%) interval session.",
		hrZone: { low: 0.6, high: 0.7 },
	},
};

/**
 * Tanaka-simplified max heart rate (220 − age). Good enough for general
 * guidance; not a substitute for a tested HR max.
 */
export function computeMaxHR(age: number): number {
	if (!Number.isFinite(age) || age <= 0) return 0;
	return 220 - age;
}

export function computeHRZone(
	age: number,
	low: number,
	high: number,
): { low: number; high: number } | null {
	const max = computeMaxHR(age);
	if (max <= 0) return null;
	return {
		low: Math.round(max * low),
		high: Math.round(max * high),
	};
}

export interface RecommendedNutrition {
	tdee: number;
	calories: number;
	protein: number;
	carbs: number;
	fats: number;
	fiber: number;
	direction: GoalDirection;
	goal: FitnessGoal;
}

/**
 * Build a recommended set of daily nutrition targets from current body weight,
 * goal weight, and selected fitness goal.
 *
 * The fitness goal drives the calorie delta (vs TDEE) and the protein-per-kg
 * target. "General" still infers the calorie delta from current vs goal weight
 * so users who haven't picked a specific goal get the same behavior as before.
 */
export function recommendNutrition(
	body: BodyData,
	currentWeight: number | null,
	weightUnit: WeightUnit,
	goalWeight: number | null,
	fitnessGoal: FitnessGoal = "general",
): RecommendedNutrition | null {
	if (currentWeight === null) return null;
	if (body.height === null || body.age === null) return null;

	const weightKg = weightToKg(currentWeight, weightUnit);
	const heightM = heightToMeters(body.height, body.heightUnit);
	const heightCm = heightM * 100;

	const bmr = computeBMR(weightKg, heightCm, body.age, body.gender);
	if (bmr === null) return null;

	const tdee = computeTDEE(bmr, body.activityLevel);

	const goalKg = goalWeight !== null ? weightToKg(goalWeight, weightUnit) : null;
	const direction = inferGoalDirection(weightKg, goalKg);

	const spec = FITNESS_GOAL_SPECS[fitnessGoal];
	const delta = spec.calorieDelta !== null
		? spec.calorieDelta
		: (direction === "lose" ? -500 : direction === "gain" ? 300 : 0);

	let calories = tdee + delta;
	if (calories < 1200) calories = 1200;

	const protein = Math.round(weightKg * spec.proteinPerKg);
	const fats = Math.round((calories * spec.fatPercent) / 9);
	const carbs = Math.max(0, Math.round((calories - protein * 4 - fats * 9) / 4));
	// Fiber: ~14 g per 1000 kcal (USDA / Institute of Medicine guideline).
	const fiber = Math.max(20, Math.round((calories / 1000) * 14));

	return {
		tdee: Math.round(tdee),
		calories: Math.round(calories / 10) * 10,
		protein,
		carbs,
		fats,
		fiber,
		direction,
		goal: fitnessGoal,
	};
}

export function recommendedToGoals(rec: RecommendedNutrition): NutritionGoals {
	return {
		calories: rec.calories,
		protein: rec.protein,
		carbs: rec.carbs,
		fats: rec.fats,
		fiber: rec.fiber,
	};
}

export function goalsMatchRecommended(
	goals: NutritionGoals,
	rec: RecommendedNutrition,
): boolean {
	return (
		Math.abs(goals.calories - rec.calories) < 1 &&
		Math.abs(goals.protein - rec.protein) < 1 &&
		Math.abs(goals.carbs - rec.carbs) < 1 &&
		Math.abs(goals.fats - rec.fats) < 1 &&
		Math.abs(goals.fiber - rec.fiber) < 1
	);
}

/**
 * Latest bodyweight from sorted (ascending) entries. Returns null if empty.
 */
export function latestWeight<T extends { weight: number }>(entries: T[]): number | null {
	if (entries.length === 0) return null;
	const last = entries[entries.length - 1];
	return last ? last.weight : null;
}

/**
 * Daily water target recommendation: ~33 ml/kg of body weight, with a 2,000 ml floor.
 * Returns the target in ml when weight unit is kg, fl oz when weight unit is lb
 * (using ~0.5 fl oz per lb, which is the imperial equivalent of 33 ml/kg).
 */
export function recommendWater(
	weight: number,
	weightUnit: WeightUnit,
): number {
	if (!Number.isFinite(weight) || weight <= 0) return 0;
	if (weightUnit === "lb") {
		return Math.max(64, Math.round(weight * 0.5));
	}
	return Math.max(2000, Math.round(weight * 33 / 50) * 50);
}

export type WeightSource = "logged" | "settings";

export interface EffectiveWeight {
	weight: number;
	source: WeightSource;
	/** ISO date of the logged entry, when source === "logged". */
	loggedDate?: string;
}

/**
 * Resolve the body weight to use for BMI / nutrition calculations.
 *
 * Priority: any logged entry wins (always reflects reality). The settings
 * weight is only consulted when there are no logged entries — it acts as a
 * day-one fallback so users who haven't logged a workout yet still get
 * useful recommendations.
 */
export function effectiveWeight<T extends { weight: number; date: string }>(
	loggedEntries: T[],
	settingsWeight: number | null,
): EffectiveWeight | null {
	if (loggedEntries.length > 0) {
		const last = loggedEntries[loggedEntries.length - 1];
		if (last) {
			return { weight: last.weight, source: "logged", loggedDate: last.date };
		}
	}
	if (settingsWeight !== null && Number.isFinite(settingsWeight) && settingsWeight > 0) {
		return { weight: settingsWeight, source: "settings" };
	}
	return null;
}
