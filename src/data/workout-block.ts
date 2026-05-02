import { App, parseYaml, stringifyYaml, TFile } from "obsidian";
import type {
	BlockCardio,
	BlockExercise,
	BodyMeasurements,
	CardioLog,
	CardioTarget,
	DistanceUnit,
	SetLog,
	WorkoutBlock,
} from "../types";

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})\s*workout\s*$/;

const MEASUREMENT_KEYS: ReadonlyArray<keyof BodyMeasurements> = [
	"waist",
	"chest",
	"hips",
	"biceps",
	"thighs",
	"neck",
];

export function parseWorkoutBlock(source: string): WorkoutBlock {
	const trimmed = source.trim();
	if (trimmed.length === 0) {
		return { exercises: [], cardio: [] };
	}

	let raw: unknown;
	try {
		raw = parseYaml(source);
	} catch (err) {
		throw new Error(`Could not parse workout block: ${(err as Error).message}`);
	}

	return normalizeBlock(raw);
}

function normalizeBlock(raw: unknown): WorkoutBlock {
	if (!isRecord(raw)) {
		return { exercises: [], cardio: [] };
	}

	const exercisesRaw = Array.isArray(raw.exercises) ? raw.exercises : [];
	const exercises: BlockExercise[] = exercisesRaw
		.filter(isRecord)
		.map(normalizeExercise);

	const cardioRaw = Array.isArray(raw.cardio) ? raw.cardio : [];
	const cardio: BlockCardio[] = cardioRaw.filter(isRecord).map(normalizeCardio);

	const block: WorkoutBlock = { exercises, cardio };
	if (typeof raw.template === "string") block.template = raw.template;
	if (typeof raw.date === "string") block.date = raw.date;
	const bw = typeof raw.bodyweight === "number" ? raw.bodyweight : Number(raw.bodyweight);
	if (Number.isFinite(bw) && bw > 0) block.bodyweight = bw;
	if (typeof raw.startedAt === "string" && raw.startedAt.trim().length > 0) {
		block.startedAt = raw.startedAt;
	}
	if (typeof raw.endedAt === "string" && raw.endedAt.trim().length > 0) {
		block.endedAt = raw.endedAt;
	}
	const measurements = normalizeMeasurements(raw.measurements);
	if (measurements) block.measurements = measurements;
	return block;
}

function normalizeMeasurements(raw: unknown): BodyMeasurements | null {
	if (!isRecord(raw)) return null;
	const out: BodyMeasurements = {};
	let any = false;
	for (const key of MEASUREMENT_KEYS) {
		const value = toPositiveNumber(raw[key]);
		if (value !== null) {
			out[key] = Math.round(value * 10) / 10;
			any = true;
		}
	}
	return any ? out : null;
}

function normalizeExercise(raw: Record<string, unknown>): BlockExercise {
	const name = typeof raw.name === "string" ? raw.name : "Unnamed exercise";
	const targetRaw = isRecord(raw.target) ? raw.target : {};
	const target = {
		sets: toNonNegativeInt(targetRaw.sets, 3),
		reps: toNonNegativeInt(targetRaw.reps, 8),
		weight: toNonNegativeNumber(targetRaw.weight, 0),
	};

	const logRaw = Array.isArray(raw.log) ? raw.log : [];
	const log: SetLog[] = logRaw.filter(isRecord).map((entry) => {
		const set: SetLog = {
			reps: toNonNegativeInt(entry.reps, 0),
			weight: toNonNegativeNumber(entry.weight, 0),
		};
		if (typeof entry.loggedAt === "string" && entry.loggedAt.length > 0) {
			set.loggedAt = entry.loggedAt;
		}
		return set;
	});

	const result: BlockExercise = { name, target, log };
	if (typeof raw.tracksWeight === "boolean") {
		result.tracksWeight = raw.tracksWeight;
	}
	if (typeof raw.group === "string" && raw.group.trim().length > 0) {
		result.group = raw.group.trim();
	}
	if (raw.dropSet === true) result.dropSet = true;
	if (raw.toFailure === true) result.toFailure = true;
	return result;
}

function normalizeCardio(raw: Record<string, unknown>): BlockCardio {
	const name = typeof raw.name === "string" ? raw.name : "Unnamed cardio";
	const targetRaw = isRecord(raw.target) ? raw.target : {};
	const target: CardioTarget = {
		minutes: toNonNegativeNumber(targetRaw.minutes, 20),
	};
	const targetDistance = toPositiveNumber(targetRaw.distance);
	if (targetDistance !== null) {
		target.distance = Math.round(targetDistance * 100) / 100;
		target.distanceUnit = normalizeDistanceUnit(targetRaw.distanceUnit) ?? "km";
	}
	const logRaw = isRecord(raw.log) ? raw.log : null;
	let log: CardioLog | null = null;
	if (logRaw) {
		log = { minutes: toNonNegativeNumber(logRaw.minutes, 0) };
		const dist = toPositiveNumber(logRaw.distance);
		if (dist !== null) {
			log.distance = Math.round(dist * 100) / 100;
			log.distanceUnit = normalizeDistanceUnit(logRaw.distanceUnit) ?? target.distanceUnit ?? "km";
		}
		if (typeof logRaw.finishTime === "string" && logRaw.finishTime.trim().length > 0) {
			log.finishTime = logRaw.finishTime.trim();
		}
	}
	const result: BlockCardio = { name, target, log };
	if (raw.trackDistance === false) result.trackDistance = false;
	else if (raw.trackDistance === true) result.trackDistance = true;
	return result;
}

function normalizeDistanceUnit(value: unknown): DistanceUnit | null {
	if (value === "km" || value === "mi") return value;
	return null;
}

export function serializeWorkoutBlock(block: WorkoutBlock): string {
	const out: Record<string, unknown> = {};
	if (block.template) out.template = block.template;
	if (block.date) out.date = block.date;
	if (typeof block.bodyweight === "number" && block.bodyweight > 0) {
		out.bodyweight = block.bodyweight;
	}
	if (block.measurements) {
		const m: Record<string, number> = {};
		let any = false;
		for (const key of MEASUREMENT_KEYS) {
			const value = block.measurements[key];
			if (typeof value === "number" && Number.isFinite(value) && value > 0) {
				m[key] = value;
				any = true;
			}
		}
		if (any) out.measurements = m;
	}
	if (block.startedAt) out.startedAt = block.startedAt;
	if (block.endedAt) out.endedAt = block.endedAt;
	out.exercises = block.exercises.map((ex) => {
		const entry: Record<string, unknown> = {
			name: ex.name,
			target: { sets: ex.target.sets, reps: ex.target.reps, weight: ex.target.weight },
			log: ex.log.map((s) => {
				const set: Record<string, unknown> = { reps: s.reps, weight: s.weight };
				if (s.loggedAt) set.loggedAt = s.loggedAt;
				return set;
			}),
		};
		// Persist both true and false so the user's "Add weight" / "Hide
		// weight" toggle round-trips. Without this, an explicit `true`
		// would get dropped on save and the next reload would fall back to
		// the auto-detection in `effectiveTracksWeight`, undoing the click.
		if (typeof ex.tracksWeight === "boolean") entry.tracksWeight = ex.tracksWeight;
		if (ex.group) entry.group = ex.group;
		if (ex.dropSet === true) entry.dropSet = true;
		if (ex.toFailure === true) entry.toFailure = true;
		return entry;
	});
	if (block.cardio.length > 0) {
		out.cardio = block.cardio.map((c) => {
			const target: Record<string, unknown> = { minutes: c.target.minutes };
			if (typeof c.target.distance === "number" && c.target.distance > 0) {
				target.distance = c.target.distance;
				target.distanceUnit = c.target.distanceUnit ?? "km";
			}
			let log: Record<string, unknown> | null = null;
			if (c.log) {
				log = { minutes: c.log.minutes };
				if (typeof c.log.distance === "number" && c.log.distance > 0) {
					log.distance = c.log.distance;
					log.distanceUnit = c.log.distanceUnit ?? "km";
				}
				if (c.log.finishTime) log.finishTime = c.log.finishTime;
			}
			const entry: Record<string, unknown> = { name: c.name, target, log };
			if (c.trackDistance === false) entry.trackDistance = false;
			return entry;
		});
	}
	return stringifyYaml(out);
}

export interface WorkoutBlockLocation {
	startLine: number;
	endLine: number;
	contentStart: number;
	contentEnd: number;
}

export function findWorkoutBlock(
	fileText: string,
	desiredSource: string,
): WorkoutBlockLocation | null {
	const lines = fileText.split("\n");
	const wantedKey = desiredSource.trim();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (typeof line !== "string") continue;
		const fenceMatch = line.match(FENCE_RE);
		if (!fenceMatch) continue;
		const fence = fenceMatch[1] ?? "";
		const fenceFirst = fence.charAt(0);
		const closeRe = new RegExp(`^[ \\t]*${escapeRegex(fenceFirst)}{${fence.length},}\\s*$`);

		let endLine = -1;
		for (let j = i + 1; j < lines.length; j++) {
			const candidate = lines[j];
			if (typeof candidate !== "string") continue;
			if (closeRe.test(candidate)) {
				endLine = j;
				break;
			}
		}
		if (endLine === -1) continue;

		const inner = lines.slice(i + 1, endLine).join("\n");
		if (inner.trim() === wantedKey) {
			return {
				startLine: i,
				endLine,
				contentStart: i + 1,
				contentEnd: endLine,
			};
		}
	}

	return null;
}

export async function updateWorkoutBlock(
	app: App,
	file: TFile,
	originalSource: string,
	updatedBlock: WorkoutBlock,
): Promise<void> {
	const newSource = serializeWorkoutBlock(updatedBlock).trimEnd();
	await app.vault.process(file, (data) => {
		const location = findWorkoutBlock(data, originalSource);
		if (!location) return data;
		const lines = data.split("\n");
		const before = lines.slice(0, location.contentStart);
		const after = lines.slice(location.contentEnd);
		return [...before, newSource, ...after].join("\n");
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonNegativeInt(value: unknown, fallback: number): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n) || n < 0) return fallback;
	return Math.round(n);
}

function toNonNegativeNumber(value: unknown, fallback: number): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n) || n < 0) return fallback;
	return n;
}

function toPositiveNumber(value: unknown): number | null {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n) || n <= 0) return null;
	return n;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
