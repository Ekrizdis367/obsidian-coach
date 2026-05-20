import { App, MarkdownPostProcessorContext, Notice, TFile, debounce, setIcon } from "obsidian";
import type {
	BlockCardio,
	BlockExercise,
	BodyMeasurements,
	HistoryEntry,
	SetLog,
	WeightUnit,
	WorkoutBlock,
} from "../types";
import {
	parseWorkoutBlock,
	updateWorkoutBlock,
} from "../data/workout-block";
import { HistoryIndex, formatIsoDate } from "../data/history-index";
import {
	effectiveTracksWeight,
	formatDistance,
	formatMinutes,
	formatPace,
	formatSetsSummary,
	formatWeight,
} from "../utils/format";
import { markEmbedWrapper } from "../utils/embed";
import { RestTimerController } from "./rest-timer";

export interface WorkoutRendererDeps {
	app: App;
	getUnit: () => WeightUnit;
	getDefaultRestSec: () => number;
	getSupersetTransitionSec: () => number;
	getAutoStartRest: () => boolean;
	getShowAddSetButton: () => boolean;
	historyIndex: HistoryIndex;
	restTimer: RestTimerController;
	getWorkoutCollapsed: (filePath: string) => boolean;
	setWorkoutCollapsed: (filePath: string, collapsed: boolean) => void;
}

interface PRBadgeKind {
	icon: string;
	label: string;
	className: string;
}

const PR_BADGES: Record<"weight" | "e1rm" | "reps", PRBadgeKind> = {
	weight: { icon: "trophy", label: "Heaviest set ever", className: "wp-pr-badge--weight" },
	e1rm: { icon: "trending-up", label: "Best estimated 1RM", className: "wp-pr-badge--e1rm" },
	reps: { icon: "star", label: "Most reps ever", className: "wp-pr-badge--reps" },
};

const MEASUREMENT_FIELDS: Array<{ key: keyof BodyMeasurements; label: string }> = [
	{ key: "waist", label: "Waist" },
	{ key: "chest", label: "Chest" },
	{ key: "hips", label: "Hips" },
	{ key: "biceps", label: "Biceps" },
	{ key: "thighs", label: "Thighs" },
	{ key: "neck", label: "Neck" },
];

export function registerWorkoutBlockProcessor(
	register: (
		language: string,
		handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void,
	) => void,
	deps: WorkoutRendererDeps,
): void {
	register("workout", (source, el, ctx) => {
		renderWorkoutBlock(source, el, ctx, deps);
	});
}

function renderWorkoutBlock(
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	deps: WorkoutRendererDeps,
): void {
	let block: WorkoutBlock;
	try {
		block = parseWorkoutBlock(source);
	} catch (err) {
		const errorEl = el.createDiv({ cls: "wp-error" });
		errorEl.setText(`Workout block error: ${(err as Error).message}`);
		return;
	}

	const container = el.createDiv({ cls: "wp-workout" });
	markEmbedWrapper(container);
	const file = deps.app.vault.getAbstractFileByPath(ctx.sourcePath);
	const targetFile = file instanceof TFile ? file : null;

	const persist = debounce(async (next: WorkoutBlock) => {
		if (!targetFile) return;
		try {
			await updateWorkoutBlock(deps.app, targetFile, source, next);
		} catch (err) {
			new Notice(`Failed to save workout: ${(err as Error).message}`);
		}
	}, 400, true);

	const state: WorkoutBlock = cloneBlock(block);

	// Collapse state is a UI preference — not worth round-tripping through
	// the block YAML, so we persist it via the plugin data API keyed on the
	// note path. Notes with multiple workout blocks share a single toggle;
	// that's fine in practice since it's a rare layout.
	const filePath = targetFile?.path ?? null;
	const initialCollapsed = filePath ? deps.getWorkoutCollapsed(filePath) : false;
	if (initialCollapsed) container.addClass("wp-workout--collapsed");

	renderHeader(container, state, deps, persist, {
		collapsed: initialCollapsed,
		onToggle: () => {
			const nowCollapsed = !container.hasClass("wp-workout--collapsed");
			container.toggleClass("wp-workout--collapsed", nowCollapsed);
			if (filePath) deps.setWorkoutCollapsed(filePath, nowCollapsed);
		},
	});

	if (state.exercises.length > 0) {
		const exercisesEl = container.createDiv({ cls: "wp-exercises" });
		renderExerciseGroups(exercisesEl, state, deps, persist, targetFile?.path);
	}

	if (state.cardio.length > 0) {
		const cardioWrap = container.createDiv({ cls: "wp-cardio" });
		const heading = cardioWrap.createDiv({ cls: "wp-section-heading", text: "Cardio" });
		void heading;
		for (let i = 0; i < state.cardio.length; i++) {
			const cardio = state.cardio[i];
			if (!cardio) continue;
			renderCardio(cardioWrap, cardio, i, state, deps, persist, targetFile?.path);
		}
	}

	if (state.exercises.length === 0 && state.cardio.length === 0) {
		const empty = container.createDiv({ cls: "wp-empty" });
		empty.setText("No exercises yet. Add one to your workout block.");
	}
}

function renderExerciseGroups(
	parent: HTMLElement,
	state: WorkoutBlock,
	deps: WorkoutRendererDeps,
	persist: (next: WorkoutBlock) => void,
	currentFilePath: string | undefined,
): void {
	let i = 0;
	while (i < state.exercises.length) {
		const exercise = state.exercises[i];
		if (!exercise) {
			i++;
			continue;
		}
		if (!exercise.group) {
			renderExercise(parent, exercise, i, state, deps, persist, currentFilePath);
			i++;
			continue;
		}
		const group = exercise.group;
		const groupIndices: number[] = [];
		let j = i;
		while (j < state.exercises.length) {
			const next = state.exercises[j];
			if (!next || next.group !== group) break;
			groupIndices.push(j);
			j++;
		}
		const wrap = parent.createDiv({ cls: "wp-superset" });
		const heading = wrap.createDiv({ cls: "wp-superset-heading" });
		const badge = heading.createSpan({ cls: "wp-superset-badge" });
		setIcon(badge, "link");
		heading.createSpan({ cls: "wp-superset-label", text: `Superset ${group}` });
		for (const idx of groupIndices) {
			const ex = state.exercises[idx];
			if (!ex) continue;
			renderExercise(wrap, ex, idx, state, deps, persist, currentFilePath);
		}
		i = j;
	}
}

interface CollapseControl {
	collapsed: boolean;
	onToggle: () => void;
}

function renderHeader(
	container: HTMLElement,
	block: WorkoutBlock,
	deps: WorkoutRendererDeps,
	persist: (next: WorkoutBlock) => void,
	collapse: CollapseControl,
): void {
	const header = container.createDiv({ cls: "wp-header" });
	const headLeft = header.createDiv({ cls: "wp-header-left" });
	const title = headLeft.createDiv({ cls: "wp-title" });
	title.setText(block.template ?? "Workout");
	if (block.date) {
		const date = headLeft.createDiv({ cls: "wp-date" });
		date.setText(block.date);
	}
	if (block.startedAt && block.endedAt) {
		const minutes = workoutDurationMinutes(block);
		if (minutes !== null) {
			const dur = headLeft.createDiv({ cls: "wp-duration" });
			const icon = dur.createSpan({ cls: "wp-duration-icon" });
			setIcon(icon, "timer");
			dur.createSpan({ cls: "wp-duration-text", text: formatDurationMin(minutes) });
		}
	}
	// When collapsed, surface a one-line summary next to the title so the
	// user can identify the session at a glance without expanding. Hidden
	// via CSS when the card is expanded to avoid visual noise.
	const summary = headLeft.createDiv({ cls: "wp-header-summary" });
	summary.setText(formatCollapsedSummary(block));

	// Collapse toggle lives at the end of the header so it stays visible
	// as a single control whether the card is expanded or not.
	const toggleBtn = header.createEl("button", {
		cls: "wp-collapse-toggle",
		attr: { "aria-label": collapse.collapsed ? "Expand workout" : "Collapse workout" },
	});
	setIcon(toggleBtn, "chevron-down");
	toggleBtn.addEventListener("click", () => {
		collapse.onToggle();
		const nowCollapsed = container.hasClass("wp-workout--collapsed");
		toggleBtn.setAttr("aria-label", nowCollapsed ? "Expand workout" : "Collapse workout");
	});

	// Body weight gets its own row under the header rather than being
	// squeezed into the header next to the collapse toggle. Keeps it
	// quick to log (no dropdown to open) while giving the header room
	// to breathe on narrow screens.
	const bwWrap = container.createDiv({ cls: "wp-bodyweight" });
	bwWrap.createSpan({ cls: "wp-bodyweight-label", text: "Body weight" });
	const bwInput = bwWrap.createEl("input", { cls: "wp-bodyweight-input" });
	bwInput.type = "number";
	bwInput.min = "0";
	bwInput.step = "0.1";
	bwInput.placeholder = "—";
	if (typeof block.bodyweight === "number" && block.bodyweight > 0) {
		bwInput.value = block.bodyweight.toString();
	}
	bwWrap.createSpan({ cls: "wp-bodyweight-unit", text: deps.getUnit() });

	const onBwCommit = () => {
		const raw = bwInput.value.trim();
		if (raw === "") {
			if (block.bodyweight !== undefined) {
				delete block.bodyweight;
				persist(block);
			}
			return;
		}
		const parsed = parseFloat(raw);
		if (!Number.isFinite(parsed) || parsed <= 0) {
			bwInput.value = block.bodyweight?.toString() ?? "";
			return;
		}
		block.bodyweight = parsed;
		persist(block);
	};
	bwInput.addEventListener("change", onBwCommit);

	renderMeasurements(container, block, deps.getUnit(), persist);
}

/**
 * One-line summary shown next to the title when the card is collapsed.
 * Keeps the collapsed state informative (e.g. "4 exercises · 1 cardio")
 * so users can tell what's inside without expanding.
 */
function formatCollapsedSummary(block: WorkoutBlock): string {
	const parts: string[] = [];
	if (block.exercises.length > 0) {
		parts.push(`${block.exercises.length} exercise${block.exercises.length === 1 ? "" : "s"}`);
	}
	if (block.cardio.length > 0) {
		parts.push(`${block.cardio.length} cardio`);
	}
	if (parts.length === 0) return "Empty workout";
	return parts.join(" · ");
}

function renderMeasurements(
	container: HTMLElement,
	block: WorkoutBlock,
	weightUnit: WeightUnit,
	persist: (next: WorkoutBlock) => void,
): void {
	const measureUnit = weightUnit === "lb" ? "in" : "cm";
	const hasAny = block.measurements
		&& MEASUREMENT_FIELDS.some(({ key }) => typeof block.measurements?.[key] === "number");

	const wrap = container.createDiv({ cls: "wp-measurements" });
	const summary = wrap.createEl("details", { cls: "wp-measurements-details" });
	if (hasAny) summary.setAttr("open", "true");
	const summaryHead = summary.createEl("summary", { cls: "wp-measurements-summary" });
	const headIcon = summaryHead.createSpan({ cls: "wp-measurements-icon" });
	setIcon(headIcon, "ruler");
	summaryHead.createSpan({ cls: "wp-measurements-title", text: "Measurements" });
	if (hasAny) {
		const inline = summaryHead.createSpan({ cls: "wp-measurements-inline" });
		inline.setText(formatMeasurementsSummary(block.measurements ?? {}, measureUnit));
	} else {
		const inline = summaryHead.createSpan({ cls: "wp-measurements-inline wp-measurements-inline--empty" });
		inline.setText("Optional");
	}

	const grid = summary.createDiv({ cls: "wp-measurements-grid" });
	for (const { key, label } of MEASUREMENT_FIELDS) {
		const row = grid.createDiv({ cls: "wp-measurement-row" });
		row.createSpan({ cls: "wp-measurement-label", text: label });
		const input = row.createEl("input", { cls: "wp-measurement-input" });
		input.type = "number";
		input.min = "0";
		input.step = "0.1";
		input.placeholder = "—";
		const current = block.measurements?.[key];
		if (typeof current === "number" && current > 0) {
			input.value = current.toString();
		}
		row.createSpan({ cls: "wp-measurement-unit", text: measureUnit });

		input.addEventListener("change", () => {
			const raw = input.value.trim();
			const m = block.measurements ?? {};
			if (raw === "") {
				if (m[key] !== undefined) {
					delete m[key];
					if (Object.keys(m).length === 0) {
						delete block.measurements;
					} else {
						block.measurements = m;
					}
					persist(block);
				}
				return;
			}
			const parsed = parseFloat(raw);
			if (!Number.isFinite(parsed) || parsed <= 0) {
				input.value = m[key]?.toString() ?? "";
				return;
			}
			m[key] = Math.round(parsed * 10) / 10;
			block.measurements = m;
			persist(block);
		});
	}
}

function renderExercise(
	parent: HTMLElement,
	exercise: BlockExercise,
	exerciseIndex: number,
	block: WorkoutBlock,
	deps: WorkoutRendererDeps,
	persist: (next: WorkoutBlock) => void,
	currentFilePath: string | undefined,
): void {
	const wrap = parent.createDiv({ cls: "wp-exercise" });
	if (exercise.group) wrap.addClass("wp-exercise--superset");
	const tracksWeight = effectiveTracksWeight(exercise);

	const head = wrap.createDiv({ cls: "wp-exercise-head" });
	const nameEl = head.createDiv({ cls: "wp-exercise-name" });
	nameEl.setText(exercise.name);

	const target = head.createDiv({ cls: "wp-exercise-target" });
	target.setText(formatTarget(exercise, deps.getUnit(), tracksWeight));

	const lookupDate = block.date ?? formatIsoDate(new Date());
	const previous = deps.historyIndex.getMostRecentBefore(
		exercise.name,
		lookupDate,
		currentFilePath,
		"strength",
	);
	renderPreviousStrength(head, previous, deps.getUnit(), tracksWeight);

	const setsEl = wrap.createDiv({ cls: "wp-sets" });
	if (!tracksWeight) setsEl.addClass("wp-sets--bodyweight");
	const totalRows = Math.max(exercise.target.sets, exercise.log.length);
	for (let i = 0; i < totalRows; i++) {
		renderSetRow(
			setsEl,
			exercise,
			exerciseIndex,
			i,
			block,
			deps,
			persist,
			tracksWeight,
			currentFilePath,
			lookupDate,
		);
	}

	const showAddSet = deps.getShowAddSetButton();
	const showRestButton = !deps.getAutoStartRest();
	const canToggleWeight = canShowWeightToggle(exercise);
	if (showAddSet || showRestButton || canToggleWeight) {
		const actions = wrap.createDiv({ cls: "wp-exercise-actions" });

		if (showAddSet) {
			const addBtn = actions.createEl("button", { cls: "wp-btn", text: "Add set" });
			addBtn.addEventListener("click", () => {
				const fallback = lastSetFallback(exercise);
				exercise.log.push(fallback);
				exercise.target.sets = Math.max(exercise.target.sets, exercise.log.length);
				persist(block);
			});
		}

		if (canToggleWeight) {
			const label = tracksWeight ? "Hide weight" : "Add weight";
			const toggleBtn = actions.createEl("button", { cls: "wp-btn", text: label });
			toggleBtn.addEventListener("click", () => {
				exercise.tracksWeight = !tracksWeight;
				persist(block);
			});
		}

		if (showRestButton) {
			const restBtn = actions.createEl("button", { cls: "wp-btn", text: `Break (${deps.getDefaultRestSec()}s)` });
			restBtn.addEventListener("click", () => {
				deps.restTimer.start(deps.getDefaultRestSec(), exercise.name);
			});
		}
	}
}

function canShowWeightToggle(exercise: BlockExercise): boolean {
	if (typeof exercise.tracksWeight === "boolean") return true;
	return exercise.target.weight === 0 && exercise.log.every((s) => s.weight === 0);
}

function renderPreviousStrength(
	parent: HTMLElement,
	previous: HistoryEntry | null,
	unit: WeightUnit,
	tracksWeight: boolean,
): void {
	const prev = parent.createDiv({ cls: "wp-prev" });
	if (!previous || previous.kind !== "strength") {
		prev.setText("Last: —");
		return;
	}
	prev.setText(`Last (${previous.date}): ${formatSetsSummary(previous.sets, unit, tracksWeight)}`);
}

function renderPreviousCardio(
	parent: HTMLElement,
	previous: HistoryEntry | null,
): void {
	const prev = parent.createDiv({ cls: "wp-prev" });
	if (!previous || previous.kind !== "cardio") {
		prev.setText("Last: —");
		return;
	}
	const parts: string[] = [formatMinutes(previous.minutes)];
	if (typeof previous.distance === "number" && previous.distance > 0) {
		parts.push(formatDistance(previous.distance, previous.distanceUnit ?? "km"));
		const pace = formatPace(previous.minutes, previous.distance, previous.distanceUnit ?? "km");
		if (pace) parts.push(pace);
	}
	if (previous.finishTime) parts.push(`finish ${previous.finishTime}`);
	prev.setText(`Last (${previous.date}): ${parts.join(" · ")}`);
}

function renderSetRow(
	parent: HTMLElement,
	exercise: BlockExercise,
	exerciseIndex: number,
	rowIndex: number,
	block: WorkoutBlock,
	deps: WorkoutRendererDeps,
	persist: (next: WorkoutBlock) => void,
	tracksWeight: boolean,
	currentFilePath: string | undefined,
	sessionDate: string,
): void {
	const row = parent.createDiv({ cls: "wp-set" });
	if (!tracksWeight) row.addClass("wp-set--bodyweight");
	const isLogged = rowIndex < exercise.log.length;
	const logEntry: SetLog | null = isLogged ? (exercise.log[rowIndex] ?? null) : null;
	row.toggleClass("is-logged", isLogged);

	// Drop-set behavior: row 0 is the heavy working set; rows 1..N keep the
	// weight input but show "DS" as the placeholder so the user can either
	// leave it blank (just track reps) or overwrite with the actual weight
	// they dropped to. PR/volume still excludes drops regardless.
	const isDrop = exercise.dropSet === true && rowIndex > 0;
	if (isDrop) row.addClass("wp-set--drop");

	const setNumber = row.createDiv({ cls: "wp-set-num" });
	setNumber.setText(`${rowIndex + 1}`);

	const repsInput = row.createEl("input", { cls: "wp-set-input wp-set-reps" });
	repsInput.type = "number";
	repsInput.min = "0";
	// "2F" is shorthand for "to failure" — the digit is just part of the label,
	// not a target rep count (failure sets have no minimum).
	repsInput.placeholder = exercise.toFailure ? "2F" : exercise.target.reps.toString();
	if (logEntry) repsInput.value = logEntry.reps.toString();

	let weightInput: HTMLInputElement | null = null;
	if (tracksWeight) {
		const at = row.createSpan({ cls: "wp-set-at", text: "×" });
		void at;

		weightInput = row.createEl("input", { cls: "wp-set-input wp-set-weight" });
		if (isDrop) weightInput.addClass("wp-set-weight--drop");
		weightInput.type = "number";
		weightInput.min = "0";
		weightInput.step = "0.5";
		weightInput.placeholder = isDrop ? "DS" : exercise.target.weight.toString();
		if (logEntry && logEntry.weight > 0) weightInput.value = logEntry.weight.toString();

		const unit = row.createSpan({ cls: "wp-set-unit", text: deps.getUnit() });
		void unit;
	} else {
		const repsUnit = row.createSpan({ cls: "wp-set-unit", text: "reps" });
		void repsUnit;
	}

	const commitBtn = row.createEl("button", { cls: "wp-set-check" });
	commitBtn.setAttr("aria-label", isLogged ? "Unlog set" : "Log set");
	setIcon(commitBtn, isLogged ? "check-circle-2" : "circle");

	const badges = row.createDiv({ cls: "wp-pr-badges" });
	if (isLogged && logEntry) {
		renderPRBadges(badges, exercise, rowIndex, logEntry, sessionDate, currentFilePath, deps);
	}

	if (isLogged) {
		const onEdit = debounce(() => {
			if (!exercise.log[rowIndex]) return;
			const existing = exercise.log[rowIndex];
			const next: SetLog = {
				reps: parseIntField(repsInput.value, exercise.target.reps),
				weight: weightInput
					? parseFloatField(weightInput.value, exercise.target.weight)
					: 0,
			};
			if (existing?.loggedAt) next.loggedAt = existing.loggedAt;
			exercise.log[rowIndex] = next;
			persist(block);
		}, 500, true);
		repsInput.addEventListener("change", onEdit);
		weightInput?.addEventListener("change", onEdit);

		commitBtn.addEventListener("click", () => {
			exercise.log.splice(rowIndex, 1);
			recomputeWorkoutTimestamps(block);
			persist(block);
		});
	} else {
		commitBtn.addEventListener("click", () => {
			while (exercise.log.length < rowIndex) {
				exercise.log.push(lastSetFallback(exercise));
			}
			const reps = parseIntField(repsInput.value, exercise.target.reps);
			const weight = weightInput
				? parseFloatField(weightInput.value, exercise.target.weight)
				: 0;
			const newSet: SetLog = { reps, weight, loggedAt: new Date().toISOString() };
			exercise.log[rowIndex] = newSet;
			stampWorkoutTimestamps(block);
			persist(block);
			if (deps.getAutoStartRest()) {
				const restSec = restSecForExercise(exercise, block, deps);
				deps.restTimer.start(restSec, exercise.name);
			}
		});
	}

	void exerciseIndex;
}

function renderPRBadges(
	parent: HTMLElement,
	exercise: BlockExercise,
	setIndex: number,
	logEntry: SetLog,
	sessionDate: string,
	currentFilePath: string | undefined,
	deps: WorkoutRendererDeps,
): void {
	const newPRs = deps.historyIndex.getNewPRsForSet(
		exercise.name,
		logEntry,
		sessionDate,
		currentFilePath,
		{
			setIndex,
			isDropSet: exercise.dropSet === true,
			isFailure: exercise.toFailure === true,
		},
	);
	if (newPRs.length === 0) return;
	for (const kind of newPRs) {
		const meta = PR_BADGES[kind];
		const badge = parent.createSpan({ cls: `wp-pr-badge ${meta.className}` });
		badge.setAttribute("aria-label", `New PR: ${meta.label.toLowerCase()}`);
		badge.setAttribute("title", `New PR: ${meta.label}`);
		setIcon(badge, meta.icon);
	}
}

function restSecForExercise(
	exercise: BlockExercise,
	block: WorkoutBlock,
	deps: WorkoutRendererDeps,
): number {
	if (!exercise.group) return deps.getDefaultRestSec();
	const supersetSec = deps.getSupersetTransitionSec();
	const groupExercises = block.exercises.filter((e) => e.group === exercise.group);
	const minLogged = groupExercises.reduce(
		(acc, e) => Math.min(acc, e.log.length),
		Number.POSITIVE_INFINITY,
	);
	const myLogged = exercise.log.length;
	if (Number.isFinite(minLogged) && myLogged === minLogged) {
		return deps.getDefaultRestSec();
	}
	return supersetSec;
}

function stampWorkoutTimestamps(block: WorkoutBlock): void {
	const now = new Date().toISOString();
	if (!block.startedAt) block.startedAt = now;
	block.endedAt = now;
}

function recomputeWorkoutTimestamps(block: WorkoutBlock): void {
	const stamps: string[] = [];
	for (const ex of block.exercises) {
		for (const s of ex.log) {
			if (s.loggedAt) stamps.push(s.loggedAt);
		}
	}
	if (stamps.length === 0) {
		delete block.startedAt;
		delete block.endedAt;
		return;
	}
	stamps.sort();
	block.startedAt = stamps[0];
	block.endedAt = stamps[stamps.length - 1];
}

function formatTarget(exercise: BlockExercise, unit: WeightUnit, tracksWeight: boolean): string {
	const t = exercise.target;
	// "2F" is the literal label for a to-failure target — no minimum reps,
	// the digit is just part of the shorthand for "to failure".
	const repsLabel = exercise.toFailure ? "2F" : t.reps.toString();
	if (!tracksWeight) return `${t.sets} × ${repsLabel}`;
	return `${t.sets} × ${repsLabel} @ ${formatWeight(t.weight, unit)}`;
}

function lastSetFallback(exercise: BlockExercise): SetLog {
	const last = exercise.log[exercise.log.length - 1];
	if (last) {
		const out: SetLog = { reps: last.reps, weight: last.weight };
		return out;
	}
	return { reps: exercise.target.reps, weight: exercise.target.weight };
}

function parseIntField(raw: string, fallback: number): number {
	if (raw.trim() === "") return fallback;
	const n = parseInt(raw, 10);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseFloatField(raw: string, fallback: number): number {
	if (raw.trim() === "") return fallback;
	const n = parseFloat(raw);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function cloneBlock(block: WorkoutBlock): WorkoutBlock {
	const out: WorkoutBlock = {
		template: block.template,
		date: block.date,
		bodyweight: block.bodyweight,
		exercises: block.exercises.map(cloneExercise),
		cardio: block.cardio.map(cloneCardio),
	};
	if (block.measurements) out.measurements = { ...block.measurements };
	if (block.startedAt) out.startedAt = block.startedAt;
	if (block.endedAt) out.endedAt = block.endedAt;
	return out;
}

function cloneExercise(ex: BlockExercise): BlockExercise {
	const out: BlockExercise = {
		name: ex.name,
		target: { ...ex.target },
		log: ex.log.map((s) => {
			const set: SetLog = { reps: s.reps, weight: s.weight };
			if (s.loggedAt) set.loggedAt = s.loggedAt;
			return set;
		}),
	};
	if (typeof ex.tracksWeight === "boolean") out.tracksWeight = ex.tracksWeight;
	if (ex.group) out.group = ex.group;
	if (ex.dropSet === true) out.dropSet = true;
	if (ex.toFailure === true) out.toFailure = true;
	return out;
}

function cloneCardio(c: BlockCardio): BlockCardio {
	const target = { ...c.target };
	let log = null;
	if (c.log) {
		log = { ...c.log };
	}
	const cloned: BlockCardio = { name: c.name, target, log };
	if (c.trackDistance === false) cloned.trackDistance = false;
	else if (c.trackDistance === true) cloned.trackDistance = true;
	return cloned;
}

function renderCardio(
	parent: HTMLElement,
	cardio: BlockCardio,
	cardioIndex: number,
	block: WorkoutBlock,
	deps: WorkoutRendererDeps,
	persist: (next: WorkoutBlock) => void,
	currentFilePath: string | undefined,
): void {
	const wrap = parent.createDiv({ cls: "wp-exercise wp-cardio-item" });

	const head = wrap.createDiv({ cls: "wp-exercise-head" });
	const nameEl = head.createDiv({ cls: "wp-exercise-name" });
	nameEl.setText(cardio.name);

	const target = head.createDiv({ cls: "wp-exercise-target" });
	target.setText(formatCardioTarget(cardio));

	const lookupDate = block.date ?? formatIsoDate(new Date());
	const previous = deps.historyIndex.getMostRecentBefore(
		cardio.name,
		lookupDate,
		currentFilePath,
		"cardio",
	);
	renderPreviousCardio(head, previous);

	const setsEl = wrap.createDiv({ cls: "wp-sets" });
	renderCardioRow(setsEl, cardio, cardioIndex, block, deps, persist);
}

function formatCardioTarget(cardio: BlockCardio): string {
	const parts: string[] = [`Target: ${formatMinutes(cardio.target.minutes)}`];
	if (typeof cardio.target.distance === "number" && cardio.target.distance > 0) {
		parts.push(formatDistance(cardio.target.distance, cardio.target.distanceUnit ?? "km"));
	}
	return parts.join(" · ");
}

function renderCardioRow(
	parent: HTMLElement,
	cardio: BlockCardio,
	cardioIndex: number,
	block: WorkoutBlock,
	_deps: WorkoutRendererDeps,
	persist: (next: WorkoutBlock) => void,
): void {
	const row = parent.createDiv({ cls: "wp-set wp-cardio-row" });
	const isLogged = cardio.log !== null;
	row.toggleClass("is-logged", isLogged);

	// Treat undefined as `true` so blocks created before this flag existed
	// keep showing distance/finish inputs as they always did.
	const tracksDistance = cardio.trackDistance !== false;
	// Drives a wider grid template so the minutes input doesn't get
	// squished when we also need columns for distance + finish time.
	if (tracksDistance) row.addClass("wp-cardio-row--with-distance");

	const minutesInput = row.createEl("input", { cls: "wp-set-input wp-cardio-minutes" });
	minutesInput.type = "number";
	minutesInput.min = "0";
	minutesInput.step = "0.5";
	minutesInput.placeholder = cardio.target.minutes.toString();
	if (cardio.log) minutesInput.value = cardio.log.minutes.toString();
	row.createSpan({ cls: "wp-set-unit", text: "min" });

	let distanceInput: HTMLInputElement | null = null;
	let distUnitSel: HTMLSelectElement | null = null;
	let finishInput: HTMLInputElement | null = null;

	if (tracksDistance) {
		distanceInput = row.createEl("input", { cls: "wp-set-input wp-cardio-distance" });
		distanceInput.type = "number";
		distanceInput.min = "0";
		distanceInput.step = "0.01";
		distanceInput.placeholder = cardio.target.distance ? cardio.target.distance.toString() : "0";
		if (cardio.log?.distance) distanceInput.value = cardio.log.distance.toString();

		distUnitSel = row.createEl("select", { cls: "wp-cardio-distance-unit" });
		for (const u of ["km", "mi"] as const) {
			const opt = distUnitSel.createEl("option", { value: u, text: u });
			const current = cardio.log?.distanceUnit ?? cardio.target.distanceUnit ?? "km";
			if (u === current) opt.selected = true;
		}

		finishInput = row.createEl("input", { cls: "wp-set-input wp-cardio-finish" });
		finishInput.type = "text";
		finishInput.placeholder = "Mm:ss";
		finishInput.title = "Finish time, e.g. 28:00 for a 5k";
		if (cardio.log?.finishTime) finishInput.value = cardio.log.finishTime;
	}

	const commitBtn = row.createEl("button", { cls: "wp-set-check" });
	commitBtn.setAttr("aria-label", isLogged ? "Unlog cardio" : "Log cardio");
	setIcon(commitBtn, isLogged ? "check-circle-2" : "circle");

	const buildLog = () => {
		const minutes = parseFloatField(minutesInput.value, cardio.target.minutes);
		const log: NonNullable<BlockCardio["log"]> = { minutes };
		if (distanceInput && distUnitSel) {
			const distance = parseFloatField(distanceInput.value, cardio.target.distance ?? 0);
			if (distance > 0) {
				log.distance = Math.round(distance * 100) / 100;
				const sel = distUnitSel.value;
				log.distanceUnit = sel === "mi" ? "mi" : "km";
			}
		}
		if (finishInput) {
			const finish = finishInput.value.trim();
			if (finish.length > 0 && /^\d{1,2}(:\d{2}){1,2}$/.test(finish)) {
				log.finishTime = finish;
			}
		}
		return log;
	};

	if (isLogged) {
		const onEdit = debounce(() => {
			if (!cardio.log) return;
			cardio.log = buildLog();
			persist(block);
		}, 500, true);
		minutesInput.addEventListener("change", onEdit);
		distanceInput?.addEventListener("change", onEdit);
		distUnitSel?.addEventListener("change", onEdit);
		finishInput?.addEventListener("change", onEdit);

		commitBtn.addEventListener("click", () => {
			cardio.log = null;
			persist(block);
		});
	} else {
		commitBtn.addEventListener("click", () => {
			cardio.log = buildLog();
			persist(block);
		});
	}

	void cardioIndex;
}

function workoutDurationMinutes(block: WorkoutBlock): number | null {
	if (!block.startedAt || !block.endedAt) return null;
	const start = Date.parse(block.startedAt);
	const end = Date.parse(block.endedAt);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
	const minutes = (end - start) / 60000;
	if (minutes <= 0 || minutes > 360) return null;
	return Math.round(minutes);
}

function formatDurationMin(minutes: number): string {
	if (minutes < 60) return `${minutes} min`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function formatMeasurementsSummary(m: BodyMeasurements, unit: string): string {
	const parts: string[] = [];
	for (const { key, label } of MEASUREMENT_FIELDS) {
		const v = m[key];
		if (typeof v === "number" && v > 0) {
			parts.push(`${label.charAt(0).toLowerCase()}${label.slice(1)} ${v}${unit}`);
		}
	}
	return parts.length === 0 ? "Optional" : parts.join(" · ");
}
