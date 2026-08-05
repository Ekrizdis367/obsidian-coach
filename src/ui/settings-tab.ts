import {
	App,
	ButtonComponent,
	DropdownComponent,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	SettingPage,
	TextComponent,
	setIcon,
} from "obsidian";
import type { SettingDefinitionItem, SettingGroupItem } from "obsidian";
import type {
	ActivityLevel,
	BodyData,
	Exercise,
	ExerciseCategory,
	ExerciseEquipment,
	FitnessGoal,
	Gender,
	HeightUnit,
	MealFavorite,
	NutritionGoals,
	TemplateCardio,
	TemplateExercise,
	Weekday,
	WeeklySchedule,
	WorkoutTemplate,
} from "../types";
import {
	ACTIVITY_LEVEL_LABELS,
	ACTIVITY_LEVEL_OPTIONS,
	FITNESS_GOAL_LABELS,
	FITNESS_GOAL_OPTIONS,
	GENDER_LABELS,
	GENDER_OPTIONS,
	WEEKDAY_KEYS,
	WEEKDAY_LABELS,
	clampRestDuration,
	clampSupersetTransition,
	generateId,
	isHeightUnitFor,
} from "../settings";
import {
	type EffectiveWeight,
	FITNESS_GOAL_SPECS,
	recommendNutrition,
	recommendWater,
	recommendedToGoals,
} from "../utils/body-stats";
import { formatWater, waterUnitFor } from "../utils/format";
import { formatServings } from "../utils/nutrition";
import { FavoriteEditModal } from "./favorite-edit-modal";

export interface SettingsTabDeps {
	getSettings: () => SettingsLike;
	save: () => Promise<void>;
	rebuildRecipes: () => void;
	getEffectiveWeight: () => EffectiveWeight | null;
}

export interface SettingsLike {
	weightUnit: "kg" | "lb";
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
	trackFiber: boolean;
	waterTarget: number | null;
	waterStep: number | null;
	mealFavorites: MealFavorite[];
}

const CATEGORY_OPTIONS: ExerciseCategory[] = ["push", "pull", "legs", "core", "cardio", "other"];
const EQUIPMENT_OPTIONS: ExerciseEquipment[] = [
	"barbell",
	"dumbbell",
	"machine",
	"cable",
	"bodyweight",
	"kettlebell",
	"other",
];

export class WorkoutSettingsTab extends PluginSettingTab {
	private deps: SettingsTabDeps;

	constructor(app: App, plugin: Plugin, deps: SettingsTabDeps) {
		super(app, plugin);
		this.deps = deps;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const settings = this.deps.getSettings();
		const heightUnit = isHeightUnitFor(settings.weightUnit);
		settings.bodyData.heightUnit = heightUnit;

		return [
			...this.generalItems(settings),
			{ type: "group", heading: "Body data", items: this.bodyDataItems(settings, heightUnit) },
			{ type: "group", heading: "Fitness goal", items: this.fitnessGoalItems(settings) },
			{ type: "group", heading: "Break timer", items: this.restTimerItems() },
			{ type: "group", heading: "Nutrition", items: this.nutritionItems(settings) },
			this.mealFavoritesPageDef(),
			{ type: "group", heading: "Hydration", items: this.hydrationItems(settings) },
			this.exerciseLibraryPageDef(),
			this.workoutTemplatesPageDef(),
			{ type: "group", heading: "Weekly schedule", items: this.weeklyScheduleItems(settings) },
		];
	}

	getControlValue(key: string): unknown {
		const settings = this.deps.getSettings();
		switch (key) {
			case "weightUnit":
				return settings.weightUnit;
			case "showAddSetButton":
				return settings.showAddSetButton;
			case "bodyData.gender":
				return settings.bodyData.gender;
			case "bodyData.activityLevel":
				return settings.bodyData.activityLevel;
			case "fitnessGoal":
				return settings.fitnessGoal;
			case "restDurationSec":
				return settings.restDurationSec;
			case "supersetTransitionSec":
				return settings.supersetTransitionSec;
			case "autoStartRest":
				return settings.autoStartRest;
			case "playSoundOnRest":
				return settings.playSoundOnRest;
			case "trackFiber":
				return settings.trackFiber;
			default: {
				const weekday = matchWeeklyScheduleKey(key);
				if (weekday) return settings.weeklySchedule[weekday] ?? "";
				return undefined;
			}
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.deps.getSettings();
		switch (key) {
			case "weightUnit":
				settings.weightUnit = value === "lb" ? "lb" : "kg";
				await this.deps.save();
				// Height unit, weight labels, and hydration units throughout the
				// tab all derive from this — rebuild definitions to refresh them.
				this.update();
				return;
			case "showAddSetButton":
				settings.showAddSetButton = value === true;
				await this.deps.save();
				return;
			case "bodyData.gender":
				settings.bodyData.gender = value as Gender;
				await this.deps.save();
				return;
			case "bodyData.activityLevel":
				settings.bodyData.activityLevel = value as ActivityLevel;
				await this.deps.save();
				return;
			case "fitnessGoal":
				settings.fitnessGoal = value as FitnessGoal;
				await this.deps.save();
				// The summary preview below the dropdown is only rebuilt on update().
				this.update();
				return;
			case "restDurationSec":
				settings.restDurationSec = clampRestDuration(Number(value));
				await this.deps.save();
				return;
			case "supersetTransitionSec":
				settings.supersetTransitionSec = clampSupersetTransition(Number(value));
				await this.deps.save();
				return;
			case "autoStartRest":
				settings.autoStartRest = value === true;
				await this.deps.save();
				return;
			case "playSoundOnRest":
				settings.playSoundOnRest = value === true;
				await this.deps.save();
				return;
			case "trackFiber":
				settings.trackFiber = value === true;
				await this.deps.save();
				// The daily goals grid gains/loses a fiber column.
				this.update();
				return;
			case "recipesFolders":
				settings.recipesFolders = parseFoldersInput(typeof value === "string" ? value : "");
				await this.deps.save();
				this.deps.rebuildRecipes();
				return;
			default: {
				const weekday = matchWeeklyScheduleKey(key);
				if (weekday) {
					settings.weeklySchedule[weekday] = typeof value === "string" && value.length > 0 ? value : null;
					await this.deps.save();
				}
			}
		}
	}

	private generalItems(settings: SettingsLike): SettingDefinitionItem[] {
		return [
			{
				name: "Weight unit",
				desc: "Used when displaying and logging weights.",
				control: {
					type: "dropdown",
					key: "weightUnit",
					options: { kg: "Kilograms (kg)", lb: "Pounds (lb)" },
				},
			},
			{
				name: "Goal body weight",
				desc: "Optional target weight in your selected unit. Shown in the body weight analytics section as a target line and gap-to-goal stat. Leave blank to disable.",
				render: (setting) => {
					setting.addText((t) => {
						t.inputEl.type = "number";
						t.inputEl.min = "0";
						t.inputEl.step = "0.1";
						t.setPlaceholder("75");
						t.setValue(settings.goalWeight !== null ? settings.goalWeight.toString() : "");
						t.onChange(async (value) => {
							const trimmed = value.trim();
							if (trimmed.length === 0) {
								settings.goalWeight = null;
								await this.deps.save();
								return;
							}
							const parsed = parseFloat(trimmed);
							if (!Number.isFinite(parsed) || parsed <= 0) return;
							settings.goalWeight = Math.round(parsed * 10) / 10;
							await this.deps.save();
						});
					});
				},
			},
			{
				name: "Show `Add set` button",
				desc: "Lets you append extra sets to an exercise mid-workout. Off by default since most lifters stick to the planned set count.",
				control: { type: "toggle", key: "showAddSetButton" },
			},
		];
	}

	private bodyDataItems(settings: SettingsLike, heightUnit: HeightUnit): SettingGroupItem[] {
		return [
			{
				name: "",
				desc: "Optional. Used by the analytics view to compute body mass index and recommended daily calories and macros. Stored in your vault only — nothing is sent anywhere. Not medical advice; consult a professional for anything health-related.",
			},
			{
				name: `Height (${heightUnit})`,
				desc: "Used to compute body mass index and your basal metabolic rate.",
				render: (setting) => {
					setting.addText((t) => {
						t.inputEl.type = "number";
						t.inputEl.min = "0";
						t.inputEl.step = heightUnit === "in" ? "0.5" : "1";
						t.setPlaceholder(heightUnit === "in" ? "70" : "175");
						t.setValue(settings.bodyData.height !== null ? settings.bodyData.height.toString() : "");
						t.onChange(async (value) => {
							const trimmed = value.trim();
							if (trimmed.length === 0) {
								settings.bodyData.height = null;
								await this.deps.save();
								return;
							}
							const parsed = parseFloat(trimmed);
							if (!Number.isFinite(parsed) || parsed <= 0) return;
							settings.bodyData.height = Math.round(parsed * 10) / 10;
							await this.deps.save();
						});
					});
				},
			},
			{
				name: "Age",
				desc: "Used to compute your basal metabolic rate.",
				render: (setting) => {
					setting.addText((t) => {
						t.inputEl.type = "number";
						t.inputEl.min = "0";
						t.inputEl.step = "1";
						t.setPlaceholder("30");
						t.setValue(settings.bodyData.age !== null ? settings.bodyData.age.toString() : "");
						t.onChange(async (value) => {
							const trimmed = value.trim();
							if (trimmed.length === 0) {
								settings.bodyData.age = null;
								await this.deps.save();
								return;
							}
							const parsed = parseInt(trimmed, 10);
							if (!Number.isFinite(parsed) || parsed <= 0) return;
							settings.bodyData.age = parsed;
							await this.deps.save();
						});
					});
				},
			},
			{
				name: "Gender",
				desc: "Used in the standard sex-specific basal metabolic rate estimate. Pick whichever fits you best, or choose non-binary or prefer not to say to use the average of the two.",
				control: {
					type: "dropdown",
					key: "bodyData.gender",
					options: recordFrom(GENDER_OPTIONS, GENDER_LABELS),
				},
			},
			{
				name: "Activity level",
				desc: "Used to estimate your total daily energy expenditure.",
				control: {
					type: "dropdown",
					key: "bodyData.activityLevel",
					options: recordFrom(ACTIVITY_LEVEL_OPTIONS, ACTIVITY_LEVEL_LABELS),
				},
			},
			{
				name: `Current weight (${settings.weightUnit})`,
				desc: "Optional fallback used for body mass index and nutrition recommendations when you haven't logged a body weight in a workout yet. Logged weights from workout blocks always take precedence, so once you start logging this value is ignored.",
				render: (setting) => {
					setting.addText((t) => {
						t.inputEl.type = "number";
						t.inputEl.min = "0";
						t.inputEl.step = "0.1";
						t.setPlaceholder(settings.weightUnit === "lb" ? "165" : "75");
						t.setValue(settings.bodyData.weight !== null ? settings.bodyData.weight.toString() : "");
						t.onChange(async (value) => {
							const trimmed = value.trim();
							if (trimmed.length === 0) {
								settings.bodyData.weight = null;
								await this.deps.save();
								return;
							}
							const parsed = parseFloat(trimmed);
							if (!Number.isFinite(parsed) || parsed <= 0) return;
							settings.bodyData.weight = Math.round(parsed * 10) / 10;
							await this.deps.save();
						});
					});
				},
			},
		];
	}

	private fitnessGoalItems(settings: SettingsLike): SettingGroupItem[] {
		return [
			{
				name: "",
				desc: "Your overall training intent. Drives the recommended calories and macros under daily goals, and the training and cardio focus shown in the analytics view. Estimates only; not medical advice.",
			},
			{
				name: "Goal",
				desc: "Pick whichever best matches what you're working toward right now. You can switch any time.",
				control: {
					type: "dropdown",
					key: "fitnessGoal",
					options: recordFrom(FITNESS_GOAL_OPTIONS, FITNESS_GOAL_LABELS),
				},
			},
			{
				name: "",
				searchable: false,
				render: (setting, group) => {
					setting.settingEl.remove();
					const wrap = group.listEl.createDiv({ cls: "wp-fitness-goal-preview" });
					const spec = FITNESS_GOAL_SPECS[settings.fitnessGoal];
					wrap.createDiv({ cls: "wp-fitness-goal-summary", text: spec.summary });
				},
			},
		];
	}

	private restTimerItems(): SettingGroupItem[] {
		return [
			{
				name: "Default duration",
				desc: "Length of the break timer in seconds (30 to 300).",
				control: { type: "slider", key: "restDurationSec", min: 30, max: 300, step: 5 },
			},
			{
				name: "Superset transition time",
				desc: "Shorter pause between exercises within a superset (10–120 seconds). The full default duration still applies once you complete a round of all paired exercises.",
				control: { type: "slider", key: "supersetTransitionSec", min: 10, max: 120, step: 5 },
			},
			{
				name: "Auto-start after logging a set",
				desc: "Start the break timer automatically when you mark a set complete.",
				control: { type: "toggle", key: "autoStartRest" },
			},
			{
				name: "Play sound when the break ends",
				desc: "Plays a short tone if the page is in the foreground.",
				control: { type: "toggle", key: "playSoundOnRest" },
			},
		];
	}

	private nutritionItems(settings: SettingsLike): SettingGroupItem[] {
		return [
			{
				name: "Recipes folders",
				desc: "One folder per line. Subfolders are included automatically, so listing `Cooking` covers `Cooking/Dinner`, `Cooking/Breakfast`, etc. Each recipe should have `calories`, `protein`, `carbs`, and `fats` in its frontmatter, per serving.",
				render: (setting) => {
					setting.addTextArea((t) => {
						t.setPlaceholder("Cooking");
						t.setValue(settings.recipesFolders.join("\n"));
						t.inputEl.rows = Math.max(3, settings.recipesFolders.length + 1);
						t.inputEl.addClass("wp-folders-input");
						t.onChange(async (value) => {
							await this.setControlValue("recipesFolders", value);
						});
					});
				},
			},
			{
				name: "Track fiber",
				desc: "Show fiber as a 5th macro in the meal log, recipe parsing, and analytics. Off by default. Useful if you're tracking fiber for diabetic-friendly meal planning or general gut health.",
				control: { type: "toggle", key: "trackFiber" },
			},
			{
				name: "Daily goals",
				desc: "Targets shown as progress bars in the meal log block.",
			},
			{
				name: "",
				searchable: false,
				render: (setting, group) => {
					setting.settingEl.remove();
					const grid = group.listEl.createDiv({ cls: "wp-goals-grid" });
					const macroFields: { key: keyof NutritionGoals; label: string; unit: string }[] = [
						{ key: "calories", label: "Calories", unit: "cal" },
						{ key: "protein", label: "Protein", unit: "g" },
						{ key: "carbs", label: "Carbs", unit: "g" },
						{ key: "fats", label: "Fats", unit: "g" },
					];
					if (settings.trackFiber) {
						macroFields.push({ key: "fiber", label: "Fiber", unit: "g" });
					}
					const inputs = new Map<keyof NutritionGoals, HTMLInputElement>();
					for (const macro of macroFields) {
						const cell = grid.createDiv({ cls: "wp-goal-cell" });
						cell.createEl("label", { text: `${macro.label} (${macro.unit})` });
						const input = cell.createEl("input", { cls: "wp-goal-input" });
						input.type = "number";
						input.min = "0";
						input.step = macro.key === "calories" ? "10" : "1";
						input.value = settings.nutritionGoals[macro.key].toString();
						input.addEventListener("change", () => {
							const parsed = parseFloat(input.value);
							if (!Number.isFinite(parsed) || parsed < 0) {
								input.value = settings.nutritionGoals[macro.key].toString();
								return;
							}
							settings.nutritionGoals[macro.key] = Math.round(parsed * 10) / 10;
							void this.deps.save();
						});
						inputs.set(macro.key, input);
					}

					this.renderRecommendCalculator(group.listEl, settings, inputs);
				},
			},
		];
	}

	private renderRecommendCalculator(
		parent: HTMLElement,
		settings: SettingsLike,
		inputs: Map<keyof NutritionGoals, HTMLInputElement>,
	): void {
		const wrap = parent.createDiv({ cls: "wp-recommend-block" });

		const status = wrap.createDiv({ cls: "wp-recommend-status" });

		const buttons = wrap.createDiv({ cls: "wp-recommend-actions" });
		const calculateBtn = new ButtonComponent(buttons)
			.setButtonText("Calculate from body data");
		const applyBtn = new ButtonComponent(buttons)
			.setButtonText("Apply to daily goals")
			.setCta();
		applyBtn.setDisabled(true);

		const update = () => {
			status.empty();
			const effective = this.deps.getEffectiveWeight();
			const rec = recommendNutrition(
				settings.bodyData,
				effective?.weight ?? null,
				settings.weightUnit,
				settings.goalWeight,
				settings.fitnessGoal,
			);
			if (rec === null) {
				status.createDiv({
					cls: "wp-recommend-empty",
					text: "Need height, age, and a current weight (either logged in a workout block or entered above) to compute recommendations. Fill in the body data section above.",
				});
				applyBtn.setDisabled(true);
				applyBtn.onClick(() => undefined);
				return;
			}
			const goalLabel = FITNESS_GOAL_LABELS[settings.fitnessGoal];
			const sourceText = effective?.source === "logged" && effective.loggedDate
				? `Using your latest logged weight: ${effective.weight} ${settings.weightUnit} (${effective.loggedDate}).`
				: `Using your settings weight: ${effective?.weight ?? 0} ${settings.weightUnit}.`;
			const sourceLine = status.createDiv({ cls: "wp-recommend-source" });
			sourceLine.setText(sourceText);
			const intro = status.createDiv({ cls: "wp-recommend-intro" });
			intro.setText(
				`Estimated TDEE: ${Math.round(rec.tdee)} cal/day. Suggested daily targets for ${goalLabel.toLowerCase()}:`,
			);
			const list = status.createEl("ul", { cls: "wp-recommend-list" });
			list.createEl("li", { text: `Calories: ${rec.calories} cal` });
			list.createEl("li", { text: `Protein: ${rec.protein} g` });
			list.createEl("li", { text: `Carbs: ${rec.carbs} g` });
			list.createEl("li", { text: `Fats: ${rec.fats} g` });
			if (settings.trackFiber) {
				list.createEl("li", { text: `Fiber: ${rec.fiber} g` });
			}
			const note = status.createDiv({ cls: "wp-recommend-disclaimer" });
			note.setText("Estimates only — not medical advice.");
			applyBtn.setDisabled(false);
			applyBtn.onClick(async () => {
				const goals = recommendedToGoals(rec);
				settings.nutritionGoals = goals;
				for (const [key, input] of inputs) {
					input.value = goals[key].toString();
				}
				await this.deps.save();
				new Notice("Daily goals updated from body data.");
			});
		};
		calculateBtn.onClick(() => update());
	}

	private hydrationItems(settings: SettingsLike): SettingGroupItem[] {
		const unit = waterUnitFor(settings.weightUnit);
		let targetInput: TextComponent | null = null;
		const stepDefault = unit === "ml" ? "250" : "8";

		return [
			{
				name: "",
				desc: `Optional. Sets the daily target and the +/- step amount used by the water tracker (embedded in the meal log block, the standalone water log block, and the analytics view). Units follow your weight unit (${unit}). When left blank, sensible defaults are used (~2.5 L target, 250 ml step / 8 fl oz step).`,
			},
			{
				name: `Daily target (${unit})`,
				desc: "Leave blank to use the default. Units follow your weight unit.",
				render: (setting) => {
					setting.addText((t) => {
						targetInput = t;
						t.inputEl.type = "number";
						t.inputEl.min = "0";
						t.inputEl.step = unit === "ml" ? "50" : "1";
						t.setPlaceholder(unit === "ml" ? "2500" : "80");
						t.setValue(settings.waterTarget !== null ? settings.waterTarget.toString() : "");
						t.onChange(async (value) => {
							const trimmed = value.trim();
							if (trimmed.length === 0) {
								settings.waterTarget = null;
								await this.deps.save();
								return;
							}
							const parsed = parseFloat(trimmed);
							if (!Number.isFinite(parsed) || parsed < 0) return;
							settings.waterTarget = Math.round(parsed);
							await this.deps.save();
						});
					});
				},
			},
			{
				name: `Step amount (${unit})`,
				desc: `How much each tap on the water tracker's +/- buttons adds or removes. Leave blank to use the default (${stepDefault} ${unit}).`,
				render: (setting) => {
					setting.addText((t) => {
						t.inputEl.type = "number";
						t.inputEl.min = "0";
						t.inputEl.step = unit === "ml" ? "50" : "1";
						t.setPlaceholder(stepDefault);
						t.setValue(settings.waterStep !== null ? settings.waterStep.toString() : "");
						t.onChange(async (value) => {
							const trimmed = value.trim();
							if (trimmed.length === 0) {
								settings.waterStep = null;
								await this.deps.save();
								return;
							}
							const parsed = parseFloat(trimmed);
							if (!Number.isFinite(parsed) || parsed <= 0) return;
							settings.waterStep = Math.round(parsed * 100) / 100;
							await this.deps.save();
						});
					});
				},
			},
			{
				name: "",
				searchable: false,
				render: (setting, group) => {
					setting.settingEl.remove();
					const calcWrap = group.listEl.createDiv({ cls: "wp-recommend-block" });
					const status = calcWrap.createDiv({ cls: "wp-recommend-status" });
					const buttons = calcWrap.createDiv({ cls: "wp-recommend-actions" });
					const calcBtn = new ButtonComponent(buttons).setButtonText("Calculate from body weight");
					const applyBtn = new ButtonComponent(buttons).setButtonText("Apply target").setCta();
					applyBtn.setDisabled(true);
					applyBtn.onClick(() => undefined);

					calcBtn.onClick(() => {
						status.empty();
						const effective = this.deps.getEffectiveWeight();
						if (!effective) {
							status.createDiv({
								cls: "wp-recommend-empty",
								text: "Need a current weight (logged in a workout block or entered in body data above) to suggest a target.",
							});
							applyBtn.setDisabled(true);
							applyBtn.onClick(() => undefined);
							return;
						}
						const recommended = recommendWater(effective.weight, settings.weightUnit);
						const sourceText = effective.source === "logged" && effective.loggedDate
							? `Using your latest logged weight: ${effective.weight} ${settings.weightUnit} (${effective.loggedDate}).`
							: `Using your settings weight: ${effective.weight} ${settings.weightUnit}.`;
						status.createDiv({ cls: "wp-recommend-source", text: sourceText });
						status.createDiv({
							cls: "wp-recommend-intro",
							text: `Suggested daily target: ${formatWater(recommended, unit)}. Based on the ~33 ml/kg (or ~0.5 fl oz/lb) guideline.`,
						});
						status.createDiv({
							cls: "wp-recommend-disclaimer",
							text: "Estimates only — not medical advice. Adjust for climate, activity, and personal needs.",
						});
						applyBtn.setDisabled(false);
						applyBtn.onClick(async () => {
							settings.waterTarget = recommended;
							if (targetInput) targetInput.setValue(recommended.toString());
							await this.deps.save();
							new Notice("Water target updated.");
						});
					});
				},
			},
		];
	}

	private weeklyScheduleItems(settings: SettingsLike): SettingGroupItem[] {
		const items: SettingGroupItem[] = [
			{
				name: "",
				desc: "Map each weekday to one of your templates. Off days can stay set to none. Used by the plugin API so a templater-powered daily note can inject the right workout automatically.",
			},
		];

		const options: Record<string, string> = { "": "None (off day)" };
		for (const template of settings.templates) {
			options[template.name] = template.name;
		}

		for (const key of WEEKDAY_KEYS) {
			items.push({
				name: WEEKDAY_LABELS[key],
				control: {
					type: "dropdown",
					key: `weeklySchedule.${key}`,
					options,
				},
			});
		}

		return items;
	}

	private mealFavoritesPageDef(): SettingDefinitionItem {
		return {
			type: "page",
			name: "Meal favorites",
			desc: "Saved shortcuts shown in the favorite picker on every meals block. Click the star on any meal entry to save it, or add a custom one here.",
			displayValue: () => {
				const count = this.deps.getSettings().mealFavorites.length;
				return count === 0 ? "None yet" : `${count}`;
			},
			page: () => new MealFavoritesPage(this.app, this.deps, this),
		};
	}

	private exerciseLibraryPageDef(): SettingDefinitionItem {
		return {
			type: "page",
			name: "Exercise library",
			desc: "Add your own exercises or remove ones you don't use. Built-in entries can be deleted but will be restored if you reset the plugin.",
			displayValue: () => `${this.deps.getSettings().exercises.length}`,
			page: () => new ExerciseLibraryPage(this.app, this.deps, this),
		};
	}

	private workoutTemplatesPageDef(): SettingDefinitionItem {
		return {
			type: "page",
			name: "Workout templates",
			desc: "Templates appear when you run the `Insert workout` command. Each template lists exercises with target sets, reps, and weight.",
			displayValue: () => {
				const count = this.deps.getSettings().templates.length;
				return count === 0 ? "None yet" : `${count}`;
			},
			page: () => new WorkoutTemplatesPage(this.app, this.deps, this),
		};
	}
}

/**
 * Meal favorites list, moved out of the main tab into its own navigable page
 * now that the list no longer needs a `<details>` collapsible wrapper.
 */
class MealFavoritesPage extends SettingPage {
	constructor(
		private app: App,
		private deps: SettingsTabDeps,
		private tab: WorkoutSettingsTab,
	) {
		super();
		this.title = "Meal favorites";
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.deps.getSettings();

		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Saved shortcuts shown in the favorite picker on every meals block. Click the star on any meal entry to save it, or add a custom one here.",
		});

		const list = containerEl.createDiv({ cls: "wp-settings-list" });

		const sorted = [...settings.mealFavorites].sort((a, b) => a.name.localeCompare(b.name));
		for (const fav of sorted) {
			const row = list.createDiv({ cls: "wp-settings-row" });
			const nameWrap = row.createDiv({ cls: "wp-settings-row-main" });
			const star = nameWrap.createSpan({ cls: "wp-fav-icon" });
			setIcon(star, "star");
			nameWrap.createSpan({ text: fav.name });

			const meta = row.createDiv({ cls: "wp-settings-row-meta" });
			const parts: string[] = [];
			if (fav.servings !== 1) parts.push(`${formatServings(fav.servings)} servings default`);
			if (fav.recipe) {
				parts.push(`recipe: ${fav.recipe}`);
			} else if (fav.nutrition) {
				const n = fav.nutrition;
				parts.push(`${Math.round(n.calories)} cal · ${Math.round(n.protein)}P / ${Math.round(n.carbs)}C / ${Math.round(n.fats)}F`);
			}
			meta.setText(parts.join(" · ") || "—");

			const actions = row.createDiv({ cls: "wp-settings-row-actions" });
			new ButtonComponent(actions).setButtonText("Edit").onClick(() => {
				new FavoriteEditModal(
					this.app,
					"edit",
					{
						name: fav.name,
						servings: fav.servings,
						recipe: fav.recipe,
						nutrition: fav.nutrition,
					},
					async (updated) => {
						const target = settings.mealFavorites.find((f) => f.id === fav.id);
						if (!target) return;
						target.name = updated.name;
						target.servings = updated.servings;
						if (updated.nutrition) target.nutrition = updated.nutrition;
						await this.deps.save();
						this.tab.update();
						this.display();
					},
				).open();
			});
			new ButtonComponent(actions).setButtonText("Delete").setDestructive().onClick(async () => {
				settings.mealFavorites = settings.mealFavorites.filter((f) => f.id !== fav.id);
				await this.deps.save();
				this.tab.update();
				this.display();
			});
		}

		new Setting(containerEl).addButton((b) =>
			b.setButtonText("Add favorite").setCta().onClick(() => {
				new FavoriteEditModal(
					this.app,
					"create",
					{ servings: 1 },
					async (created) => {
						const next: MealFavorite = {
							id: generateId("fav"),
							name: created.name,
							servings: created.servings,
						};
						if (created.recipe) next.recipe = created.recipe;
						if (created.nutrition) next.nutrition = created.nutrition;
						settings.mealFavorites.push(next);
						await this.deps.save();
						this.tab.update();
						this.display();
					},
				).open();
			}),
		);
	}
}

/** Exercise library list, moved out of the main tab into its own navigable page. */
class ExerciseLibraryPage extends SettingPage {
	constructor(
		private app: App,
		private deps: SettingsTabDeps,
		private tab: WorkoutSettingsTab,
	) {
		super();
		this.title = "Exercise library";
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.deps.getSettings();

		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Add your own exercises or remove ones you don't use. Built-in entries can be deleted but will be restored if you reset the plugin.",
		});

		const list = containerEl.createDiv({ cls: "wp-settings-list" });

		const sorted = [...settings.exercises].sort((a, b) => a.name.localeCompare(b.name));
		for (const exercise of sorted) {
			const row = list.createDiv({ cls: "wp-settings-row" });
			const name = row.createDiv({ cls: "wp-settings-row-main" });
			name.setText(exercise.name);
			const meta = row.createDiv({ cls: "wp-settings-row-meta" });
			meta.setText(`${exercise.category} · ${exercise.equipment}${exercise.custom ? " · custom" : ""}`);

			const actions = row.createDiv({ cls: "wp-settings-row-actions" });
			new ButtonComponent(actions).setButtonText("Edit").onClick(() => {
				new ExerciseEditorModal(this.app, exercise, async (updated) => {
					const target = settings.exercises.find((e) => e.id === exercise.id);
					if (!target) return;
					target.name = updated.name;
					target.category = updated.category;
					target.equipment = updated.equipment;
					await this.deps.save();
					this.tab.update();
					this.display();
				}).open();
			});
			new ButtonComponent(actions).setButtonText("Delete").setDestructive().onClick(async () => {
				settings.exercises = settings.exercises.filter((e) => e.id !== exercise.id);
				await this.deps.save();
				this.tab.update();
				this.display();
			});
		}

		new Setting(containerEl)
			.addButton((b) => b.setButtonText("Add exercise").setCta().onClick(() => {
				const blank: Exercise = {
					id: generateId("ex"),
					name: "",
					category: "other",
					equipment: "other",
					custom: true,
				};
				new ExerciseEditorModal(this.app, blank, async (created) => {
					if (created.name.trim().length === 0) {
						new Notice("Exercise name is required.");
						return;
					}
					settings.exercises.push({ ...blank, ...created, id: blank.id, custom: true });
					await this.deps.save();
					this.tab.update();
					this.display();
				}).open();
			}));
	}
}

/** Workout templates list, moved out of the main tab into its own navigable page. */
class WorkoutTemplatesPage extends SettingPage {
	constructor(
		private app: App,
		private deps: SettingsTabDeps,
		private tab: WorkoutSettingsTab,
	) {
		super();
		this.title = "Workout templates";
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.deps.getSettings();

		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Templates appear when you run the `Insert workout` command. Each template lists exercises with target sets, reps, and weight.",
		});

		const list = containerEl.createDiv({ cls: "wp-settings-list" });

		for (const template of settings.templates) {
			const row = list.createDiv({ cls: "wp-settings-row" });
			const name = row.createDiv({ cls: "wp-settings-row-main", text: template.name });
			const cardioCount = template.cardio?.length ?? 0;
			const metaParts: string[] = [`${template.exercises.length} exercise(s)`];
			if (cardioCount > 0) metaParts.push(`${cardioCount} cardio`);
			const meta = row.createDiv({ cls: "wp-settings-row-meta", text: metaParts.join(" · ") });
			void name; void meta;

			const actions = row.createDiv({ cls: "wp-settings-row-actions" });
			new ButtonComponent(actions).setButtonText("Edit").onClick(() => {
				new TemplateEditorModal(this.app, template, settings.exercises, async (updated) => {
					const idx = settings.templates.findIndex((t) => t.id === template.id);
					if (idx === -1) return;
					settings.templates[idx] = updated;
					await this.deps.save();
					this.tab.update();
					this.display();
				}).open();
			});
			new ButtonComponent(actions).setButtonText("Delete").setDestructive().onClick(async () => {
				settings.templates = settings.templates.filter((t) => t.id !== template.id);
				await this.deps.save();
				this.tab.update();
				this.display();
			});
		}

		new Setting(containerEl).addButton((b) => b.setButtonText("Add template").setCta().onClick(() => {
			const blank: WorkoutTemplate = { id: generateId("tpl"), name: "", exercises: [], cardio: [] };
			new TemplateEditorModal(this.app, blank, settings.exercises, async (created) => {
				if (created.name.trim().length === 0) {
					new Notice("Template name is required.");
					return;
				}
				settings.templates.push(created);
				await this.deps.save();
				this.tab.update();
				this.display();
			}).open();
		}));
	}
}

class ExerciseEditorModal extends Modal {
	private exercise: Exercise;
	private onSave: (exercise: Exercise) => Promise<void>;

	constructor(app: App, exercise: Exercise, onSave: (exercise: Exercise) => Promise<void>) {
		super(app);
		this.exercise = { ...exercise };
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.exercise.name ? "Edit exercise" : "Add exercise" });

		new Setting(contentEl).setName("Name").addText((t: TextComponent) => {
			t.setValue(this.exercise.name);
			t.onChange((v) => { this.exercise.name = v; });
		});

		new Setting(contentEl).setName("Category").addDropdown((dd: DropdownComponent) => {
			for (const c of CATEGORY_OPTIONS) dd.addOption(c, c);
			dd.setValue(this.exercise.category);
			dd.onChange((v) => { this.exercise.category = v as ExerciseCategory; });
		});

		new Setting(contentEl).setName("Equipment").addDropdown((dd: DropdownComponent) => {
			for (const e of EQUIPMENT_OPTIONS) dd.addOption(e, e);
			dd.setValue(this.exercise.equipment);
			dd.onChange((v) => { this.exercise.equipment = v as ExerciseEquipment; });
		});

		const actions = contentEl.createDiv({ cls: "wp-modal-actions" });
		new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
		new ButtonComponent(actions).setButtonText("Save").setCta().onClick(async () => {
			await this.onSave(this.exercise);
			this.close();
		});
	}
}

class TemplateEditorModal extends Modal {
	private template: WorkoutTemplate;
	private library: Exercise[];
	private onSave: (template: WorkoutTemplate) => Promise<void>;

	constructor(
		app: App,
		template: WorkoutTemplate,
		library: Exercise[],
		onSave: (template: WorkoutTemplate) => Promise<void>,
	) {
		super(app);
		this.template = {
			id: template.id,
			name: template.name,
			exercises: template.exercises.map((e) => ({ ...e })),
			cardio: (template.cardio ?? []).map((c) => ({ ...c })),
		};
		this.library = library;
		this.onSave = onSave;
	}

	onOpen(): void {
		this.modalEl.addClass("wp-template-modal");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.template.name ? "Edit template" : "Add template" });

		new Setting(contentEl).setName("Name").addText((t: TextComponent) => {
			t.setValue(this.template.name);
			t.onChange((v) => { this.template.name = v; });
		});

		const strengthList = contentEl.createDiv({ cls: "wp-template-exercise-list" });
		strengthList.createDiv({ cls: "wp-template-section-label", text: "Strength" });
		if (this.template.exercises.length === 0) {
			strengthList.createDiv({ cls: "wp-template-empty", text: "No strength exercises yet." });
		}
		for (let i = 0; i < this.template.exercises.length; i++) {
			const item = this.template.exercises[i];
			if (!item) continue;
			this.renderExerciseRow(strengthList, item, i);
		}

		const cardioList = contentEl.createDiv({ cls: "wp-template-exercise-list" });
		cardioList.createDiv({ cls: "wp-template-section-label", text: "Cardio" });
		if (this.template.cardio.length === 0) {
			cardioList.createDiv({ cls: "wp-template-empty", text: "No cardio yet." });
		}
		for (let i = 0; i < this.template.cardio.length; i++) {
			const item = this.template.cardio[i];
			if (!item) continue;
			this.renderCardioRow(cardioList, item, i);
		}

		const addRow = contentEl.createDiv({ cls: "wp-template-add" });
		new Setting(addRow)
			.setName("Add exercise")
			.setDesc("Cardio entries (treadmill, rowing, etc.) are added to the cardio section automatically.")
			.addDropdown((dd) => {
				dd.addOption("", "Select…");
				for (const ex of [...this.library].sort((a, b) => a.name.localeCompare(b.name))) {
					dd.addOption(ex.id, ex.name);
				}
				dd.onChange((value) => {
					if (!value) return;
					const found = this.library.find((e) => e.id === value);
					if (!found) return;
					if (found.category === "cardio") {
						this.template.cardio.push({
							exerciseId: found.id,
							name: found.name,
							minutes: 20,
							trackDistance: false,
						});
					} else {
						const isBodyweight = found.equipment === "bodyweight";
						this.template.exercises.push({
							exerciseId: found.id,
							name: found.name,
							sets: 3,
							reps: isBodyweight ? 12 : 8,
							weight: 0,
							...(isBodyweight ? { tracksWeight: false } : {}),
						});
					}
					this.render();
				});
			});

		const actions = contentEl.createDiv({ cls: "wp-modal-actions" });
		new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
		new ButtonComponent(actions).setButtonText("Save").setCta().onClick(async () => {
			await this.onSave(this.template);
			this.close();
		});
	}

	private renderExerciseRow(parent: HTMLElement, item: TemplateExercise, index: number): void {
		const row = parent.createDiv({ cls: "wp-template-exercise" });

		// Top line: name + badges + numeric inputs. Buttons go on their
		// own line below so the row stays readable on narrow screens.
		const main = row.createDiv({ cls: "wp-template-exercise-main" });
		const nameWrap = main.createDiv({ cls: "wp-template-exercise-name" });
		nameWrap.setText(item.name);
		const badges = nameWrap.createSpan({ cls: "wp-template-exercise-badges" });
		if (item.group) {
			badges.createSpan({
				cls: "wp-template-badge wp-template-badge--group",
				text: `SS ${item.group}`,
			});
		}
		if (item.dropSet) badges.createSpan({ cls: "wp-template-badge wp-template-badge--ds", text: "DS" });
		if (item.toFailure) badges.createSpan({ cls: "wp-template-badge wp-template-badge--f", text: "F" });

		const inputs = main.createDiv({ cls: "wp-template-exercise-inputs" });
		const tracksWeight = item.tracksWeight !== false;

		this.numberInput(inputs, "Sets", item.sets, (v) => { item.sets = v; });
		// To-failure exercises have no minimum reps target — the renderer
		// shows literal "2F" everywhere — so the reps input is hidden.
		if (!item.toFailure) {
			this.numberInput(inputs, "Reps", item.reps, (v) => { item.reps = v; });
		}
		if (tracksWeight) {
			this.numberInput(inputs, "Weight", item.weight, (v) => { item.weight = v; }, true);
		}

		const actions = row.createDiv({ cls: "wp-template-exercise-actions" });

		new ButtonComponent(actions)
			.setIcon(tracksWeight ? "minus-circle" : "plus-circle")
			.setTooltip(tracksWeight ? "Hide weight" : "Track weight")
			.onClick(() => {
				item.tracksWeight = !tracksWeight;
				if (item.tracksWeight === false) item.weight = 0;
				this.render();
			});

		// Superset link: tie this exercise to the one above it. When the
		// previous row has no group yet, we auto-assign the next available
		// label (A, B, C…). Click again to remove this row's group.
		const prev = this.template.exercises[index - 1];
		const linkBtn = new ButtonComponent(actions)
			.setIcon("link")
			.setTooltip(this.linkButtonTooltip(item, prev))
			.onClick(() => {
				this.toggleSupersetLink(index);
				this.render();
			});
		if (!prev) linkBtn.setDisabled(true);
		if (item.group) linkBtn.buttonEl.addClass("wp-template-toggle--active");

		const dsBtn = new ButtonComponent(actions)
			.setIcon("trending-down")
			.setTooltip(item.dropSet ? "Drop set on — sets 2..N show DS" : "Mark as drop set")
			.onClick(() => {
				item.dropSet = !item.dropSet;
				this.render();
			});
		if (item.dropSet) dsBtn.buttonEl.addClass("wp-template-toggle--active");

		const fBtn = new ButtonComponent(actions)
			.setIcon("flame")
			.setTooltip(item.toFailure ? "To failure on — sets show 2F" : "Mark as to failure")
			.onClick(() => {
				item.toFailure = !item.toFailure;
				// Failure exercises have no rep target — clear it so we
				// don't leak a stale value into PR / display logic.
				if (item.toFailure) item.reps = 0;
				this.render();
			});
		if (item.toFailure) fBtn.buttonEl.addClass("wp-template-toggle--active");

		// Reorder: arrows let the user pull a row up or push it down, which
		// is required to put grouped exercises next to each other (the
		// renderer breaks supersets the moment it sees a non-matching group).
		const upBtn = new ButtonComponent(actions)
			.setIcon("chevron-up")
			.setTooltip("Move up")
			.onClick(() => {
				this.swapExercises(index, index - 1);
				this.render();
			});
		if (index === 0) upBtn.setDisabled(true);

		const downBtn = new ButtonComponent(actions)
			.setIcon("chevron-down")
			.setTooltip("Move down")
			.onClick(() => {
				this.swapExercises(index, index + 1);
				this.render();
			});
		if (index === this.template.exercises.length - 1) downBtn.setDisabled(true);

		new ButtonComponent(actions)
			.setIcon("trash-2")
			.setTooltip("Remove")
			.onClick(() => {
				this.template.exercises.splice(index, 1);
				this.render();
			});
	}

	private linkButtonTooltip(item: TemplateExercise, prev: TemplateExercise | undefined): string {
		if (!prev) return "First exercise — nothing above to group with";
		if (item.group && prev.group === item.group) {
			return `In superset ${item.group} with the row above — click to unlink`;
		}
		return "Group with previous (start a superset)";
	}

	private toggleSupersetLink(index: number): void {
		const item = this.template.exercises[index];
		const prev = this.template.exercises[index - 1];
		if (!item || !prev) return;
		// Already linked → unlink this row only. The renderer groups by
		// adjacency, so the rows below us keep whatever group they had.
		if (item.group && prev.group === item.group) {
			delete item.group;
			return;
		}
		// Not linked → adopt previous row's group (creating one if needed).
		if (!prev.group) prev.group = this.nextAvailableGroupLabel();
		item.group = prev.group;
	}

	private nextAvailableGroupLabel(): string {
		const used = new Set(
			this.template.exercises
				.map((e) => e.group)
				.filter((g): g is string => typeof g === "string" && g.length > 0),
		);
		// 26 letters covers any realistic template; fall back to A1, A2…
		// for the absurd case where you've already used every letter.
		for (let i = 0; i < 26; i++) {
			const label = String.fromCharCode(65 + i);
			if (!used.has(label)) return label;
		}
		let n = 1;
		while (used.has(`A${n}`)) n++;
		return `A${n}`;
	}

	private swapExercises(a: number, b: number): void {
		const list = this.template.exercises;
		if (a < 0 || b < 0 || a >= list.length || b >= list.length || a === b) return;
		const tmp = list[a]!;
		list[a] = list[b]!;
		list[b] = tmp;
	}

	private renderCardioRow(parent: HTMLElement, item: TemplateCardio, index: number): void {
		const row = parent.createDiv({ cls: "wp-template-exercise" });

		// Mirror the strength row layout: name + inputs on top, action
		// buttons on a dedicated line below.
		const main = row.createDiv({ cls: "wp-template-exercise-main" });
		main.createDiv({ cls: "wp-template-exercise-name", text: item.name });

		const inputs = main.createDiv({ cls: "wp-template-exercise-inputs" });
		this.numberInput(inputs, "Minutes", item.minutes, (v) => { item.minutes = v; }, true);

		// Treat undefined as `true` for backwards compat — pre-existing
		// templates predate this flag, so they keep the original behavior.
		const tracksDistance = item.trackDistance !== false;
		if (tracksDistance) {
			this.numberInput(
				inputs,
				"Distance",
				item.distance ?? 0,
				(v) => { item.distance = v > 0 ? v : undefined; },
				true,
			);
		}

		const actions = row.createDiv({ cls: "wp-template-exercise-actions" });

		new ButtonComponent(actions)
			.setIcon(tracksDistance ? "minus-circle" : "plus-circle")
			.setTooltip(tracksDistance ? "Hide distance" : "Track distance")
			.onClick(() => {
				if (tracksDistance) {
					item.trackDistance = false;
					item.distance = undefined;
					item.distanceUnit = undefined;
				} else {
					item.trackDistance = true;
				}
				this.render();
			});

		new ButtonComponent(actions)
			.setIcon("trash-2")
			.setTooltip("Remove")
			.onClick(() => {
				this.template.cardio.splice(index, 1);
				this.render();
			});
	}

	private numberInput(parent: HTMLElement, label: string, value: number, onChange: (v: number) => void, allowDecimal = false): void {
		const wrap = parent.createDiv({ cls: "wp-template-input" });
		wrap.createEl("label", { text: label });
		const input = wrap.createEl("input");
		input.type = "number";
		input.min = "0";
		input.step = allowDecimal ? "0.5" : "1";
		input.value = value.toString();
		input.addEventListener("change", () => {
			const parsed = allowDecimal ? parseFloat(input.value) : parseInt(input.value, 10);
			if (Number.isFinite(parsed) && parsed >= 0) onChange(parsed);
			else input.value = value.toString();
		});
	}
}

function parseFoldersInput(value: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const line of value.split(/\r?\n/)) {
		const cleaned = line.trim().replace(/^\/+/, "").replace(/\/+$/, "");
		if (cleaned.length === 0) continue;
		if (seen.has(cleaned)) continue;
		seen.add(cleaned);
		out.push(cleaned);
	}
	return out;
}

function matchWeeklyScheduleKey(key: string): Weekday | null {
	const match = /^weeklySchedule\.(.+)$/.exec(key);
	if (!match) return null;
	const day = match[1];
	return (WEEKDAY_KEYS as readonly string[]).includes(day ?? "") ? (day as Weekday) : null;
}

function recordFrom<T extends string>(values: readonly T[], labels: Record<T, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const v of values) out[v] = labels[v];
	return out;
}
