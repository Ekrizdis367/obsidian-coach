import { App, TFile, debounce } from "obsidian";
import { collectMarkdownFiles } from "../utils/vault-files";
import type {
	BodyweightEntry,
	HistoryEntry,
	MealsBlock,
	MeasurementsEntry,
	PRRecord,
	SetLog,
	WaterBlock,
} from "../types";
import { parseWorkoutBlock } from "./workout-block";
import { parseMealsBlock } from "./meals-block";
import { parseWaterBlock } from "./water-block";
import { totalVolume } from "../utils/format";

export type HistoryKind = "strength" | "cardio";

export interface MealsBlockRecord {
	filePath: string;
	date: string;
	block: MealsBlock;
}

export interface WaterBlockRecord {
	filePath: string;
	date: string;
	block: WaterBlock;
}

export interface WorkoutDurationEntry {
	date: string;
	durationMin: number;
	filePath: string;
}

const WORKOUT_BLOCK_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*workout[ \t]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm;
const MEALS_BLOCK_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*meals[ \t]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm;
const WATER_BLOCK_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*water[ \t]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm;
const ISO_DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/;

export class HistoryIndex {
	private byExercise = new Map<string, HistoryEntry[]>();
	private byFile = new Map<string, string[]>();
	private bodyweight: BodyweightEntry[] = [];
	private measurements: MeasurementsEntry[] = [];
	private durations: WorkoutDurationEntry[] = [];
	private mealsByFile = new Map<string, MealsBlockRecord[]>();
	private waterByFile = new Map<string, WaterBlockRecord[]>();
	private app: App;
	private ready = false;
	private rebuildScheduled = false;
	private readonly debouncedRescan: () => void;

	constructor(app: App) {
		this.app = app;
		this.debouncedRescan = debounce(() => this.rebuildAll(), 800, true);
	}

	async build(): Promise<void> {
		await this.rebuildAll();
		this.ready = true;
	}

	isReady(): boolean {
		return this.ready;
	}

	scheduleRescan(): void {
		this.rebuildScheduled = true;
		this.debouncedRescan();
	}

	async onFileChange(file: TFile): Promise<void> {
		if (file.extension !== "md") return;
		await this.indexFile(file);
	}

	onFileDelete(path: string): void {
		this.bodyweight = this.bodyweight.filter((b) => b.filePath !== path);
		this.measurements = this.measurements.filter((m) => m.filePath !== path);
		this.durations = this.durations.filter((d) => d.filePath !== path);
		this.mealsByFile.delete(path);
		this.waterByFile.delete(path);
		const exercises = this.byFile.get(path);
		if (!exercises) {
			return;
		}
		for (const name of exercises) {
			const entries = this.byExercise.get(name);
			if (!entries) continue;
			const filtered = entries.filter((e) => e.filePath !== path);
			if (filtered.length === 0) this.byExercise.delete(name);
			else this.byExercise.set(name, filtered);
		}
		this.byFile.delete(path);
	}

	onFileRename(oldPath: string, newFile: TFile): void {
		for (const entry of this.bodyweight) {
			if (entry.filePath === oldPath) entry.filePath = newFile.path;
		}
		for (const entry of this.measurements) {
			if (entry.filePath === oldPath) entry.filePath = newFile.path;
		}
		for (const entry of this.durations) {
			if (entry.filePath === oldPath) entry.filePath = newFile.path;
		}
		const meals = this.mealsByFile.get(oldPath);
		if (meals) {
			for (const record of meals) record.filePath = newFile.path;
			this.mealsByFile.delete(oldPath);
			this.mealsByFile.set(newFile.path, meals);
		}
		const water = this.waterByFile.get(oldPath);
		if (water) {
			for (const record of water) record.filePath = newFile.path;
			this.waterByFile.delete(oldPath);
			this.waterByFile.set(newFile.path, water);
		}
		const exercises = this.byFile.get(oldPath);
		if (!exercises) return;
		this.byFile.delete(oldPath);
		for (const name of exercises) {
			const entries = this.byExercise.get(name);
			if (!entries) continue;
			for (const entry of entries) {
				if (entry.filePath === oldPath) entry.filePath = newFile.path;
			}
		}
		this.byFile.set(newFile.path, exercises);
	}

	getMostRecentBefore(
		exerciseName: string,
		beforeDate: string,
		excludePath?: string,
		kind?: HistoryKind,
	): HistoryEntry | null {
		const entries = this.byExercise.get(normalizeName(exerciseName));
		if (!entries || entries.length === 0) return null;
		const candidates = entries.filter((e) => {
			if (kind && e.kind !== kind) return false;
			if (e.kind === "strength" && e.sets.length === 0) return false;
			if (e.date >= beforeDate) return false;
			if (excludePath && e.filePath === excludePath && e.date === beforeDate) return false;
			return true;
		});
		if (candidates.length === 0) return null;
		candidates.sort((a, b) => (a.date < b.date ? 1 : -1));
		return candidates[0] ?? null;
	}

	getAllForExercise(exerciseName: string, kind?: HistoryKind): HistoryEntry[] {
		const entries = this.byExercise.get(normalizeName(exerciseName));
		if (!entries) return [];
		const filtered = kind ? entries.filter((e) => e.kind === kind) : entries;
		return [...filtered].sort((a, b) => (a.date < b.date ? -1 : 1));
	}

	getAllExerciseNames(kind?: HistoryKind): string[] {
		if (!kind) return Array.from(this.byExercise.keys()).sort();
		const out: string[] = [];
		for (const [name, entries] of this.byExercise) {
			if (entries.some((e) => e.kind === kind)) out.push(name);
		}
		return out.sort();
	}

	getKindFor(exerciseName: string): HistoryKind | null {
		const entries = this.byExercise.get(normalizeName(exerciseName));
		if (!entries || entries.length === 0) return null;
		const latest = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
		return latest?.kind ?? null;
	}

	getBodyweightEntries(): BodyweightEntry[] {
		return [...this.bodyweight].sort((a, b) => (a.date < b.date ? -1 : 1));
	}

	getMeasurementsEntries(): MeasurementsEntry[] {
		return [...this.measurements].sort((a, b) => (a.date < b.date ? -1 : 1));
	}

	getWorkoutDurationEntries(): WorkoutDurationEntry[] {
		return [...this.durations].sort((a, b) => (a.date < b.date ? -1 : 1));
	}

	getWorkoutDates(): Set<string> {
		const dates = new Set<string>();
		for (const entries of this.byExercise.values()) {
			for (const entry of entries) {
				dates.add(entry.date);
			}
		}
		return dates;
	}

	getEarliestWorkoutDate(): string | null {
		let earliest: string | null = null;
		for (const entries of this.byExercise.values()) {
			for (const entry of entries) {
				if (earliest === null || entry.date < earliest) {
					earliest = entry.date;
				}
			}
		}
		return earliest;
	}

	getAllMealsBlocks(): MealsBlockRecord[] {
		const out: MealsBlockRecord[] = [];
		for (const records of this.mealsByFile.values()) {
			out.push(...records);
		}
		out.sort((a, b) => (a.date < b.date ? -1 : 1));
		return out;
	}

	getAllWaterBlocks(): WaterBlockRecord[] {
		const out: WaterBlockRecord[] = [];
		for (const records of this.waterByFile.values()) {
			out.push(...records);
		}
		out.sort((a, b) => (a.date < b.date ? -1 : 1));
		return out;
	}

	/**
	 * Compute personal records for an exercise. Returns the all-time best across
	 * five categories. Ties go to the earliest date (so a PR is only a PR if it
	 * was actually first).
	 */
	getPRsForExercise(exerciseName: string): PRRecord[] {
		const entries = this.byExercise.get(normalizeName(exerciseName));
		if (!entries || entries.length === 0) return [];
		return computePRs(exerciseName, entries);
	}

	/**
	 * Determine which PRs (if any) a single set just established — used to flash a
	 * star next to the set in the workout UI right when it's logged.
	 *
	 * Returns the PR kinds that *would be set or matched* if the candidate set were
	 * appended to the prior history. We compare against history strictly before
	 * the candidate's session (same date is allowed if it's a different file path).
	 */
	getNewPRsForSet(
		exerciseName: string,
		candidate: SetLog,
		sessionDate: string,
		sessionFilePath: string | undefined,
		options?: { setIndex?: number; isDropSet?: boolean; isFailure?: boolean },
	): Array<"weight" | "e1rm" | "reps"> {
		// Failure sets never count as PR candidates — the rep target is
		// undefined ("go until you can't"), so any rep PR would be noisy.
		if (options?.isFailure === true) return [];

		// Drop sets only attribute weight/e1rm/volume to set 1; subsequent
		// drops are excluded so a long drop ladder never out-PRs a real set.
		// Reps PRs are still allowed on drops since reps remain meaningful.
		const isDropSet = options?.isDropSet === true;
		const setIndex = options?.setIndex ?? 0;
		const isWeightedSet = !isDropSet || setIndex === 0;

		const entries = this.byExercise.get(normalizeName(exerciseName));
		const result: Array<"weight" | "e1rm" | "reps"> = [];
		if (!entries) {
			if (isWeightedSet && candidate.weight > 0) result.push("weight");
			if (isWeightedSet && candidate.weight > 0) result.push("e1rm");
			if (candidate.reps > 0) result.push("reps");
			return result;
		}
		let bestWeight = 0;
		let bestE1rm = 0;
		let bestReps = 0;
		for (const e of entries) {
			if (e.kind !== "strength") continue;
			// Failure entries can't out-PR anything — exclude wholesale.
			if (e.toFailure === true) continue;
			const sameSession =
				sessionFilePath !== undefined
				&& e.filePath === sessionFilePath
				&& e.date === sessionDate;
			if (sameSession) continue;
			for (let i = 0; i < e.sets.length; i++) {
				const s = e.sets[i];
				if (!s) continue;
				const sCountsForWeight = e.dropSet !== true || i === 0;
				if (sCountsForWeight) {
					if (s.weight > bestWeight) bestWeight = s.weight;
					const e1 = epley(s.weight, s.reps);
					if (e1 > bestE1rm) bestE1rm = e1;
				}
				if (s.reps > bestReps) bestReps = s.reps;
			}
		}
		if (isWeightedSet && candidate.weight > bestWeight && candidate.weight > 0) {
			result.push("weight");
		}
		const candE1rm = epley(candidate.weight, candidate.reps);
		if (isWeightedSet && candE1rm > bestE1rm && candidate.weight > 0) {
			result.push("e1rm");
		}
		if (candidate.reps > bestReps && candidate.reps > 0) result.push("reps");
		return result;
	}

	private async rebuildAll(): Promise<void> {
		this.byExercise.clear();
		this.byFile.clear();
		this.bodyweight = [];
		this.measurements = [];
		this.durations = [];
		this.mealsByFile.clear();
		this.waterByFile.clear();
		const files = collectMarkdownFiles(this.app.vault.getRoot());
		for (const file of files) {
			await this.indexFile(file);
		}
		this.rebuildScheduled = false;
	}

	private async indexFile(file: TFile): Promise<void> {
		this.removeFile(file.path);
		let content: string;
		try {
			content = await this.app.vault.cachedRead(file);
		} catch {
			return;
		}
		const hasWorkout = content.includes("workout");
		const hasMeals = content.includes("meals");
		const hasWater = content.includes("water");
		if (!hasWorkout && !hasMeals && !hasWater) return;

		const fileDateFallback = inferFileDate(file);

		const waterRecords: WaterBlockRecord[] = [];

		if (hasMeals) {
			const records: MealsBlockRecord[] = [];
			MEALS_BLOCK_RE.lastIndex = 0;
			let mealsMatch: RegExpExecArray | null;
			while ((mealsMatch = MEALS_BLOCK_RE.exec(content)) !== null) {
				const inner = mealsMatch[2] ?? "";
				let block;
				try {
					block = parseMealsBlock(inner);
				} catch {
					continue;
				}
				const date = (block.date && /^\d{4}-\d{2}-\d{2}$/.test(block.date))
					? block.date
					: fileDateFallback;
				records.push({ filePath: file.path, date, block });
				if (typeof block.water === "number" && block.water > 0) {
					waterRecords.push({
						filePath: file.path,
						date,
						block: { date, amount: block.water },
					});
				}
			}
			if (records.length > 0) {
				this.mealsByFile.set(file.path, records);
			}
		}

		if (hasWater) {
			WATER_BLOCK_RE.lastIndex = 0;
			let waterMatch: RegExpExecArray | null;
			while ((waterMatch = WATER_BLOCK_RE.exec(content)) !== null) {
				const inner = waterMatch[2] ?? "";
				let block;
				try {
					block = parseWaterBlock(inner);
				} catch {
					continue;
				}
				const date = (block.date && /^\d{4}-\d{2}-\d{2}$/.test(block.date))
					? block.date
					: fileDateFallback;
				waterRecords.push({ filePath: file.path, date, block });
			}
		}

		if (waterRecords.length > 0) {
			this.waterByFile.set(file.path, waterRecords);
		}

		if (!hasWorkout) return;

		const exercisesInFile: string[] = [];

		WORKOUT_BLOCK_RE.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = WORKOUT_BLOCK_RE.exec(content)) !== null) {
			const inner = match[2] ?? "";
			let block;
			try {
				block = parseWorkoutBlock(inner);
			} catch {
				continue;
			}
			const blockDate = (block.date && /^\d{4}-\d{2}-\d{2}$/.test(block.date))
				? block.date
				: fileDateFallback;

			if (typeof block.bodyweight === "number" && block.bodyweight > 0) {
				this.bodyweight.push({
					date: blockDate,
					weight: block.bodyweight,
					filePath: file.path,
				});
			}

			if (block.measurements && Object.keys(block.measurements).length > 0) {
				this.measurements.push({
					date: blockDate,
					measurements: { ...block.measurements },
					filePath: file.path,
				});
			}

			if (block.startedAt && block.endedAt) {
				const start = Date.parse(block.startedAt);
				const end = Date.parse(block.endedAt);
				if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
					const minutes = (end - start) / 60000;
					if (minutes > 0 && minutes < 360) {
						this.durations.push({
							date: blockDate,
							durationMin: minutes,
							filePath: file.path,
						});
					}
				}
			}

			for (const ex of block.exercises) {
				if (ex.log.length === 0) continue;
				const key = normalizeName(ex.name);
				const entry: HistoryEntry = {
					kind: "strength",
					date: blockDate,
					filePath: file.path,
					sets: ex.log.map((s): SetLog => {
						const set: SetLog = { reps: s.reps, weight: s.weight };
						if (s.loggedAt) set.loggedAt = s.loggedAt;
						return set;
					}),
				};
				if (ex.dropSet === true) entry.dropSet = true;
				if (ex.toFailure === true) entry.toFailure = true;
				const list = this.byExercise.get(key) ?? [];
				list.push(entry);
				this.byExercise.set(key, list);
				exercisesInFile.push(key);
			}

			for (const c of block.cardio) {
				if (!c.log) continue;
				const key = normalizeName(c.name);
				const entry: HistoryEntry = {
					kind: "cardio",
					date: blockDate,
					filePath: file.path,
					minutes: c.log.minutes,
				};
				if (typeof c.log.distance === "number" && c.log.distance > 0) {
					entry.distance = c.log.distance;
					entry.distanceUnit = c.log.distanceUnit ?? "km";
				}
				if (c.log.finishTime) entry.finishTime = c.log.finishTime;
				const list = this.byExercise.get(key) ?? [];
				list.push(entry);
				this.byExercise.set(key, list);
				exercisesInFile.push(key);
			}
		}

		if (exercisesInFile.length > 0) {
			this.byFile.set(file.path, exercisesInFile);
		}
	}

	private removeFile(path: string): void {
		this.bodyweight = this.bodyweight.filter((b) => b.filePath !== path);
		this.measurements = this.measurements.filter((m) => m.filePath !== path);
		this.durations = this.durations.filter((d) => d.filePath !== path);
		this.mealsByFile.delete(path);
		this.waterByFile.delete(path);
		const exercises = this.byFile.get(path);
		if (!exercises) return;
		for (const name of exercises) {
			const entries = this.byExercise.get(name);
			if (!entries) continue;
			const filtered = entries.filter((e) => e.filePath !== path);
			if (filtered.length === 0) this.byExercise.delete(name);
			else this.byExercise.set(name, filtered);
		}
		this.byFile.delete(path);
	}
}

function computePRs(exerciseName: string, entries: HistoryEntry[]): PRRecord[] {
	const display = titleCaseName(exerciseName);
	const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
	const out: PRRecord[] = [];
	const strength = sorted.filter(
		(e): e is Extract<HistoryEntry, { kind: "strength" }> => e.kind === "strength",
	);
	const cardio = sorted.filter(
		(e): e is Extract<HistoryEntry, { kind: "cardio" }> => e.kind === "cardio",
	);

	if (strength.length > 0) {
		let bestWeight: { value: number; reps: number; date: string; filePath: string } | null = null;
		let bestE1rm: { value: number; weight: number; reps: number; date: string; filePath: string } | null = null;
		let bestReps: { value: number; weight: number; date: string; filePath: string } | null = null;
		let bestVolume: { value: number; date: string; filePath: string } | null = null;
		for (const e of strength) {
			// Failure entries are excluded from every strength PR — see
			// types.HistoryEntry.toFailure. The rep target is undefined
			// for failure sets so PR comparisons would be noisy.
			if (e.toFailure === true) continue;
			for (let i = 0; i < e.sets.length; i++) {
				const s = e.sets[i];
				if (!s) continue;
				const countsForWeight = e.dropSet !== true || i === 0;
				if (countsForWeight) {
					if (s.weight > 0 && (bestWeight === null || s.weight > bestWeight.value)) {
						bestWeight = { value: s.weight, reps: s.reps, date: e.date, filePath: e.filePath };
					}
					const e1 = epley(s.weight, s.reps);
					if (s.weight > 0 && (bestE1rm === null || e1 > bestE1rm.value)) {
						bestE1rm = { value: e1, weight: s.weight, reps: s.reps, date: e.date, filePath: e.filePath };
					}
				}
				if (s.reps > 0 && (bestReps === null || s.reps > bestReps.value)) {
					bestReps = { value: s.reps, weight: s.weight, date: e.date, filePath: e.filePath };
				}
			}
			// Drop sets only count set 1 toward total volume (we don't know
			// the actual weight on later drops).
			const volSets = e.dropSet === true ? e.sets.slice(0, 1) : e.sets;
			const vol = totalVolume(volSets);
			if (vol > 0 && (bestVolume === null || vol > bestVolume.value)) {
				bestVolume = { value: vol, date: e.date, filePath: e.filePath };
			}
		}
		if (bestWeight) {
			out.push({
				exerciseName: display,
				kind: "weight",
				value: bestWeight.value,
				reps: bestWeight.reps,
				date: bestWeight.date,
				filePath: bestWeight.filePath,
			});
		}
		if (bestE1rm) {
			out.push({
				exerciseName: display,
				kind: "e1rm",
				value: Math.round(bestE1rm.value * 10) / 10,
				weight: bestE1rm.weight,
				reps: bestE1rm.reps,
				date: bestE1rm.date,
				filePath: bestE1rm.filePath,
			});
		}
		if (bestReps) {
			out.push({
				exerciseName: display,
				kind: "reps",
				value: bestReps.value,
				weight: bestReps.weight,
				date: bestReps.date,
				filePath: bestReps.filePath,
			});
		}
		if (bestVolume) {
			out.push({
				exerciseName: display,
				kind: "volume",
				value: Math.round(bestVolume.value * 10) / 10,
				date: bestVolume.date,
				filePath: bestVolume.filePath,
			});
		}
	}

	if (cardio.length > 0) {
		let longest = cardio[0];
		let farthest: typeof cardio[number] | null = null;
		for (const e of cardio) {
			if (longest && e.minutes > longest.minutes) longest = e;
			if (typeof e.distance === "number" && e.distance > 0) {
				if (farthest === null || (e.distance ?? 0) > (farthest.distance ?? 0)) {
					farthest = e;
				}
			}
		}
		if (longest && longest.minutes > 0) {
			out.push({
				exerciseName: display,
				kind: "duration",
				value: Math.round(longest.minutes * 10) / 10,
				date: longest.date,
				filePath: longest.filePath,
			});
		}
		if (farthest && typeof farthest.distance === "number") {
			out.push({
				exerciseName: display,
				kind: "distance",
				value: farthest.distance,
				date: farthest.date,
				filePath: farthest.filePath,
			});
		}
	}

	return out;
}

function epley(weight: number, reps: number): number {
	if (reps <= 0 || weight <= 0) return 0;
	if (reps === 1) return weight;
	return weight * (1 + reps / 30);
}

function normalizeName(name: string): string {
	return name.trim().toLowerCase();
}

function titleCaseName(name: string): string {
	return name
		.split(/(\s+)/)
		.map((segment) => {
			if (/^\s+$/.test(segment) || segment.length === 0) return segment;
			return segment.charAt(0).toUpperCase() + segment.slice(1);
		})
		.join("");
}

function inferFileDate(file: TFile): string {
	const fromName = file.basename.match(ISO_DATE_RE);
	if (fromName?.[1]) return fromName[1];
	const d = new Date(file.stat.mtime);
	return formatIsoDate(d);
}

export function formatIsoDate(d: Date): string {
	const yyyy = d.getFullYear().toString().padStart(4, "0");
	const mm = (d.getMonth() + 1).toString().padStart(2, "0");
	const dd = d.getDate().toString().padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}
