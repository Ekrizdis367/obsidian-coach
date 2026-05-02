import {
	App,
	MarkdownPostProcessorContext,
	Notice,
	TFile,
	debounce,
	setIcon,
} from "obsidian";
import type { WaterBlock, WaterUnit, WeightUnit } from "../types";
import { parseWaterBlock, updateWaterBlock } from "../data/water-block";
import { defaultWaterTargetFor, formatWater, waterUnitFor } from "../utils/format";

export interface WaterRendererDeps {
	app: App;
	getWeightUnit: () => WeightUnit;
	/** User-configured daily target. `null` → fall back to the unit default. */
	getDailyTarget: () => number | null;
	/**
	 * User-configured step size for the +/- buttons. `null` → fall back to
	 * `defaultStepFor(unit)`. Always interpreted in the active water unit.
	 */
	getStep: () => number | null;
}

const STEP_ML = 250;
const STEP_OZ = 8;

export function defaultStepFor(unit: WaterUnit): number {
	return unit === "ml" ? STEP_ML : STEP_OZ;
}

/**
 * Resolve the effective step size, applying the user override when it's a
 * positive number, otherwise the unit-appropriate default. Pulled out so the
 * settings UI can show the same fallback the renderer uses.
 */
export function resolveWaterStep(override: number | null, unit: WaterUnit): number {
	if (typeof override === "number" && override > 0) {
		return Math.round(override * 100) / 100;
	}
	return defaultStepFor(unit);
}

/**
 * Resolve the effective daily target for a given block, using the per-block
 * override first, then the user setting, then the unit-appropriate default.
 * The third fallback means the bar is never blank — there's always a goal
 * to fill, even before the user has customized one.
 */
export function resolveWaterTarget(
	blockTarget: number | undefined,
	settingTarget: number | null,
	unit: WaterUnit,
): number {
	if (typeof blockTarget === "number" && blockTarget > 0) return blockTarget;
	if (typeof settingTarget === "number" && settingTarget > 0) return settingTarget;
	return defaultWaterTargetFor(unit);
}

export function registerWaterBlockProcessor(
	register: (
		language: string,
		handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void,
	) => void,
	deps: WaterRendererDeps,
): void {
	register("water", (source, el, ctx) => {
		renderStandaloneWaterBlock(source, el, ctx, deps);
	});
}

function renderStandaloneWaterBlock(
	source: string,
	el: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	deps: WaterRendererDeps,
): void {
	let block: WaterBlock;
	try {
		block = parseWaterBlock(source);
	} catch (err) {
		const errorEl = el.createDiv({ cls: "wp-error" });
		errorEl.setText(`Water block error: ${(err as Error).message}`);
		return;
	}

	const container = el.createDiv({ cls: "wp-water wp-water--standalone" });
	const file = deps.app.vault.getAbstractFileByPath(ctx.sourcePath);
	const targetFile = file instanceof TFile ? file : null;

	const persist = debounce(async (next: WaterBlock) => {
		if (!targetFile) return;
		try {
			await updateWaterBlock(deps.app, targetFile, source, next);
		} catch (err) {
			new Notice(`Failed to save water log: ${(err as Error).message}`);
		}
	}, 300, true);

	const state: WaterBlock = { ...block };
	const rerender = () => {
		container.empty();
		const unit = waterUnitFor(deps.getWeightUnit());
		renderWaterTracker(container, {
			amount: state.amount,
			unit,
			target: resolveWaterTarget(state.target, deps.getDailyTarget(), unit),
			step: resolveWaterStep(deps.getStep(), unit),
			onChange: (nextAmount) => {
				state.amount = nextAmount;
				persist(state);
				rerender();
			},
		});
	};
	rerender();
}

export interface WaterTrackerProps {
	amount: number;
	unit: WaterUnit;
	target: number;
	/** Step size for the +/- buttons in the active unit. Optional; defaults
	 * to `defaultStepFor(unit)` when omitted so callers that don't care about
	 * the user's setting (tests, dashboards) don't need to pass it. */
	step?: number;
	onChange: (nextAmount: number) => void;
}

/**
 * Render the water tracker UI into `container`. Used both by the standalone
 * `water` code block and embedded inside the meals planner.
 *
 * Layout is a single flex row that wraps the +/- controls below the bar
 * when the viewport gets too narrow.
 */
export function renderWaterTracker(container: HTMLElement, props: WaterTrackerProps): void {
	const amount = Math.max(0, Math.round(props.amount));
	const ratio = props.target > 0 ? Math.min(amount / props.target, 1) : 0;
	const done = props.target > 0 && amount >= props.target;

	const label = container.createDiv({ cls: "wp-water-label" });
	const icon = label.createSpan({ cls: "wp-water-icon" });
	setIcon(icon, "droplet");
	label.createSpan({ cls: "wp-water-label-text", text: "Water" });

	container.createSpan({ cls: "wp-water-current", text: formatWater(amount, props.unit) });

	const bar = container.createDiv({ cls: "wp-water-bar" });
	const fill = bar.createDiv({ cls: "wp-water-bar-fill" });
	fill.style.width = `${Math.round(ratio * 100)}%`;
	if (done) fill.addClass("wp-water-bar-fill--done");

	container.createSpan({
		cls: done ? "wp-water-goal wp-water-goal--done" : "wp-water-goal",
		text: `/ ${formatWater(props.target, props.unit)}`,
	});

	const step = typeof props.step === "number" && props.step > 0
		? Math.round(props.step * 100) / 100
		: defaultStepFor(props.unit);
	const controls = container.createDiv({ cls: "wp-water-controls" });

	const minusBtn = controls.createEl("button", {
		cls: "wp-water-step",
		attr: { "aria-label": `Subtract ${step} ${props.unit}` },
	});
	minusBtn.title = `−${step} ${props.unit}`;
	setIcon(minusBtn, "minus");
	minusBtn.addEventListener("click", () => {
		props.onChange(Math.max(0, Math.round(amount - step)));
	});

	const plusBtn = controls.createEl("button", {
		cls: "wp-water-step",
		attr: { "aria-label": `Add ${step} ${props.unit}` },
	});
	plusBtn.title = `+${step} ${props.unit}`;
	setIcon(plusBtn, "plus");
	plusBtn.addEventListener("click", () => {
		props.onChange(Math.max(0, Math.round(amount + step)));
	});
}

export function buildWaterBlockText(date?: string, target?: number): string {
	const lines: string[] = [];
	if (date) lines.push(`date: ${date}`);
	lines.push(`amount: 0`);
	if (typeof target === "number" && target > 0) lines.push(`target: ${Math.round(target)}`);
	return "```water\n" + lines.join("\n") + "\n```";
}
