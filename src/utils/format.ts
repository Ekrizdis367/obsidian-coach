import type { BlockExercise, DistanceUnit, HistoryEntry, SetLog, WaterUnit, WeightUnit } from "../types";

export function formatWeight(value: number, unit: WeightUnit): string {
	if (!Number.isFinite(value)) return `0 ${unit}`;
	const rounded = Math.round(value * 100) / 100;
	const display = Number.isInteger(rounded) ? rounded.toString() : rounded.toString();
	return `${display} ${unit}`;
}

export function effectiveTracksWeight(exercise: BlockExercise): boolean {
	if (typeof exercise.tracksWeight === "boolean") return exercise.tracksWeight;
	// To-failure exercises don't have a meaningful rep target so they often
	// also have a `target.weight` of 0 in the template, but the user is
	// still lifting *something* — we want to keep the weight column visible
	// by default so they can record what they pushed to failure with.
	if (exercise.toFailure === true) return true;
	if (exercise.target.weight > 0) return true;
	return !exercise.log.every((s) => s.weight === 0);
}

export function formatSetsSummary(sets: SetLog[], unit: WeightUnit, tracksWeight = true): string {
	if (sets.length === 0) return "—";
	const allSameReps = sets.every((s) => s.reps === sets[0]?.reps);
	if (!tracksWeight) {
		if (allSameReps && sets[0]) return `${sets.length} × ${sets[0].reps}`;
		return sets.map((s) => s.reps.toString()).join(", ");
	}
	const allSameWeight = sets.every((s) => s.weight === sets[0]?.weight);
	if (allSameWeight && allSameReps && sets[0]) {
		return `${sets.length} × ${sets[0].reps} @ ${formatWeight(sets[0].weight, unit)}`;
	}
	return sets.map((s) => `${s.reps}@${s.weight}`).join(", ") + ` ${unit}`;
}

export function totalReps(sets: SetLog[]): number {
	let total = 0;
	for (const s of sets) total += s.reps;
	return total;
}

export function maxReps(sets: SetLog[]): number {
	let best = 0;
	for (const s of sets) if (s.reps > best) best = s.reps;
	return best;
}

export function totalVolume(sets: SetLog[]): number {
	let total = 0;
	for (const s of sets) total += s.reps * s.weight;
	return total;
}

/**
 * Sets that contribute to "weighted" aggregates (volume, weight PR, e1RM PR).
 * For drop-set exercises only the first set carries a meaningful weight; the
 * rest are drops with reduced (untracked) load. Use this helper anywhere we
 * aggregate volume across history entries to avoid double-counting drops.
 */
export function weightedSetsForEntry(
	entry: Extract<HistoryEntry, { kind: "strength" }>,
): SetLog[] {
	if (entry.dropSet === true) return entry.sets.slice(0, 1);
	return entry.sets;
}

export function epley1RM(weight: number, reps: number): number {
	if (reps <= 0 || weight <= 0) return 0;
	if (reps === 1) return weight;
	return weight * (1 + reps / 30);
}

export function bestE1RM(sets: SetLog[]): number {
	let best = 0;
	for (const s of sets) {
		const e = epley1RM(s.weight, s.reps);
		if (e > best) best = e;
	}
	return best;
}

export function formatDuration(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	const m = Math.floor(s / 60);
	const r = s % 60;
	return `${m}:${r.toString().padStart(2, "0")}`;
}

export function formatMinutes(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return "0 min";
	const rounded = Math.round(value * 10) / 10;
	const display = Number.isInteger(rounded) ? rounded.toString() : rounded.toString();
	return `${display} min`;
}

export function waterUnitFor(weightUnit: WeightUnit): WaterUnit {
	return weightUnit === "lb" ? "fl oz" : "ml";
}

/**
 * Default daily hydration target used when the user hasn't customized one
 * yet. Roughly 2.5 L (85 fl oz), a common general-purpose recommendation.
 */
export function defaultWaterTargetFor(unit: WaterUnit): number {
	return unit === "ml" ? 2500 : 85;
}

export function formatWater(amount: number, unit: WaterUnit): string {
	if (!Number.isFinite(amount) || amount <= 0) return `0 ${unit}`;
	if (unit === "ml") {
		if (amount >= 1000) {
			const liters = amount / 1000;
			const rounded = Math.round(liters * 100) / 100;
			return `${rounded} L`;
		}
		return `${Math.round(amount)} ml`;
	}
	const rounded = Math.round(amount * 10) / 10;
	const display = Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
	return `${display} fl oz`;
}

export function formatDistance(value: number, unit: DistanceUnit): string {
	if (!Number.isFinite(value) || value <= 0) return `0 ${unit}`;
	const rounded = Math.round(value * 100) / 100;
	const display = Number.isInteger(rounded) ? rounded.toString() : rounded.toString();
	return `${display} ${unit}`;
}

export function formatPace(minutes: number, distance: number, unit: DistanceUnit): string | null {
	if (!Number.isFinite(minutes) || !Number.isFinite(distance) || minutes <= 0 || distance <= 0) {
		return null;
	}
	const paceMin = minutes / distance;
	const wholeMin = Math.floor(paceMin);
	const sec = Math.round((paceMin - wholeMin) * 60);
	const ss = sec.toString().padStart(2, "0");
	return `${wholeMin}:${ss}/${unit}`;
}
