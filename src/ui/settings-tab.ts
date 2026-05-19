import { App, ButtonComponent, DropdownComponent, Modal, Notice, Plugin, PluginSettingTab, Setting, TextComponent, setIcon } from "obsidian";
import type {
	ActivityLevel,
	BodyData,
	Exercise,
	ExerciseCategory,
	ExerciseEquipment,
	FitnessGoal,
	Gender,
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
	private exercisesExpanded = false;
	private favoritesExpanded = false;

	constructor(app: App, plugin: Plugin, deps: SettingsTabDeps) {
		super(app, plugin);
		this.deps = deps;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const settings = this.deps.getSettings();

		this.renderGeneral(containerEl, settings);
		this.renderBodyData(containerEl, settings);
		this.renderFitnessGoal(containerEl, settings);
		this.renderRestTimer(containerEl, settings);
		this.renderNutrition(containerEl, settings);
		this.renderMealFavorites(containerEl, settings);
		this.renderHydration(containerEl, settings);
		this.renderExercises(containerEl, settings);
		this.renderTemplates(containerEl, settings);
		this.renderWeeklySchedule(containerEl, settings);
	}

	private renderBodyData(parent: HTMLElement, settings: SettingsLike): void {
		new Setting(parent).setName("Body data").setHeading();
		const desc = parent.createEl("p", { cls: "setting-item-description" });
		desc.setText(
			"Optional. Used by the analytics view to compute body mass index and recommended daily calories and macros. Stored in your vault only — nothing is sent anywhere. Not medical advice; consult a professional for anything health-related.",
		);

		const heightUnit = isHeightUnitFor(settings.weightUnit);
		settings.bodyData.heightUnit = heightUnit;

		new Setting(parent)
			.setName(`Height (${heightUnit})`)
			.setDesc("Used to compute body mass index and your basal metabolic rate.")
			.addText((t) => {
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

		new Setting(parent)
			.setName("Age")
			.setDesc("Used to compute your basal metabolic rate.")
			.addText((t) => {
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

		new Setting(parent)
			.setName("Gender")
			.setDesc(
				"Used in the standard sex-specific basal metabolic rate estimate. Pick whichever fits you best, or choose non-binary or prefer not to say to use the average of the two.",
			)
			.addDropdown((dd) => {
				for (const value of GENDER_OPTIONS) dd.addOption(value, GENDER_LABELS[value]);
				dd.setValue(settings.bodyData.gender);
				dd.onChange(async (value) => {
					settings.bodyData.gender = value as Gender;
					await this.deps.save();
				});
			});

		new Setting(parent)
			.setName("Activity level")
			.setDesc("Used to estimate your total daily energy expenditure.")
			.addDropdown((dd) => {
				for (const value of ACTIVITY_LEVEL_OPTIONS) dd.addOption(value, ACTIVITY_LEVEL_LABELS[value]);
				dd.setValue(settings.bodyData.activityLevel);
				dd.onChange(async (value) => {
					settings.bodyData.activityLevel = value as ActivityLevel;
					await this.deps.save();
				});
			});

		new Setting(parent)
			.setName(`Current weight (${settings.weightUnit})`)
			.setDesc(
				"Optional fallback used for body mass index and nutrition recommendations when you haven't logged a body weight in a workout yet. Logged weights from workout blocks always take precedence, so once you start logging this value is ignored.",
			)
			.addText((t) => {
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
	}

	private renderFitnessGoal(parent: HTMLElement, settings: SettingsLike): void {
		new Setting(parent).setName("Fitness goal").setHeading();
		const desc = parent.createEl("p", { cls: "setting-item-description" });
		desc.setText(
			"Your overall training intent. Drives the recommended calories and macros under daily goals, and the training and cardio focus shown in the analytics view. Estimates only; not medical advice.",
		);

		let summaryWrap: HTMLElement | null = null;
		const renderSummary = () => {
			if (!summaryWrap) return;
			summaryWrap.empty();
			const spec = FITNESS_GOAL_SPECS[settings.fitnessGoal];
			summaryWrap.createDiv({ cls: "wp-fitness-goal-summary", text: spec.summary });
		};

		new Setting(parent)
			.setName("Goal")
			.setDesc("Pick whichever best matches what you're working toward right now. You can switch any time.")
			.addDropdown((dd) => {
				for (const value of FITNESS_GOAL_OPTIONS) dd.addOption(value, FITNESS_GOAL_LABELS[value]);
				dd.setValue(settings.fitnessGoal);
				dd.onChange(async (value) => {
					settings.fitnessGoal = value as FitnessGoal;
					renderSummary();
					await this.deps.save();
				});
			});

		summaryWrap = parent.createDiv({ cls: "wp-fitness-goal-preview" });
		renderSummary();
	}

	private renderWeeklySchedule(parent: HTMLElement, settings: SettingsLike): void {
		new Setting(parent).setName("Weekly schedule").setHeading();
		const desc = parent.createEl("p", { cls: "setting-item-description" });
		desc.setText(
			"Map each weekday to one of your templates. Off days can stay set to none. Used by the plugin API so a templater-powered daily note can inject the right workout automatically.",
		);

		const weekdayOrder: Weekday[] = [...WEEKDAY_KEYS];
		for (const key of weekdayOrder) {
			new Setting(parent)
				.setName(WEEKDAY_LABELS[key])
				.addDropdown((dd) => {
					dd.addOption("", "None (off day)");
					for (const template of settings.templates) {
						dd.addOption(template.name, template.name);
					}
					const current = settings.weeklySchedule[key];
					dd.setValue(current ?? "");
					dd.onChange(async (value) => {
						settings.weeklySchedule[key] = value === "" ? null : value;
						await this.deps.save();
					});
				});
		}
	}

	private renderNutrition(parent: HTMLElement, settings: SettingsLike): void {
		new Setting(parent).setName("Nutrition").setHeading();

		new Setting(parent)
			.setName("Recipes folders")
			.setDesc("One folder per line. Subfolders are included automatically, so listing `Cooking` covers `Cooking/Dinner`, `Cooking/Breakfast`, etc. Each recipe should have `calories`, `protein`, `carbs`, and `fats` in its frontmatter, per serving.")
			.addTextArea((t) => {
				t.setPlaceholder("Cooking");
				t.setValue(settings.recipesFolders.join("\n"));
				t.inputEl.rows = Math.max(3, settings.recipesFolders.length + 1);
				t.inputEl.addClass("wp-folders-input");
				t.onChange(async (value) => {
					settings.recipesFolders = parseFoldersInput(value);
					await this.deps.save();
					this.deps.rebuildRecipes();
				});
			});

		new Setting(parent)
			.setName("Track fiber")
			.setDesc(
				"Show fiber as a 5th macro in the meal log, recipe parsing, and analytics. Off by default. Useful if you're tracking fiber for diabetic-friendly meal planning or general gut health.",
			)
			.addToggle((t) => {
				t.setValue(settings.trackFiber);
				t.onChange(async (value) => {
					settings.trackFiber = value;
					await this.deps.save();
					this.display();
				});
			});

		new Setting(parent)
			.setName("Daily goals")
			.setDesc("Targets shown as progress bars in the meal log block.");

		const grid = parent.createDiv({ cls: "wp-goals-grid" });
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

		this.renderRecommendCalculator(parent, settings, inputs);
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

	private renderGeneral(parent: HTMLElement, settings: SettingsLike): void {
		new Setting(parent)
			.setName("Weight unit")
			.setDesc("Used when displaying and logging weights.")
			.addDropdown((dd) => {
				dd.addOption("kg", "Kilograms (kg)");
				dd.addOption("lb", "Pounds (lb)");
				dd.setValue(settings.weightUnit);
				dd.onChange(async (value) => {
					settings.weightUnit = value === "lb" ? "lb" : "kg";
					await this.deps.save();
				});
			});

		new Setting(parent)
			.setName("Goal body weight")
			.setDesc("Optional target weight in your selected unit. Shown in the body weight analytics section as a target line and gap-to-goal stat. Leave blank to disable.")
			.addText((t) => {
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
					if (!Number.isFinite(parsed) || parsed <= 0) {
						return;
					}
					settings.goalWeight = Math.round(parsed * 10) / 10;
					await this.deps.save();
				});
			});

		new Setting(parent)
			.setName("Show `Add set` button")
			.setDesc("Lets you append extra sets to an exercise mid-workout. Off by default since most lifters stick to the planned set count.")
			.addToggle((t) => {
				t.setValue(settings.showAddSetButton);
				t.onChange(async (value) => {
					settings.showAddSetButton = value;
					await this.deps.save();
				});
			});
	}

	private renderRestTimer(parent: HTMLElement, settings: SettingsLike): void {
		new Setting(parent).setName("Break timer").setHeading();

		new Setting(parent)
			.setName("Default duration")
			.setDesc("Length of the break timer in seconds (30 to 300).")
			.addSlider((s) => {
				s.setLimits(30, 300, 5);
				s.setValue(settings.restDurationSec);
				s.setDynamicTooltip();
				s.onChange(async (value) => {
					settings.restDurationSec = clampRestDuration(value);
					await this.deps.save();
				});
			});

		new Setting(parent)
			.setName("Superset transition time")
			.setDesc(
				"Shorter pause between exercises within a superset (10–120 seconds). The full default duration still applies once you complete a round of all paired exercises.",
			)
			.addSlider((s) => {
				s.setLimits(10, 120, 5);
				s.setValue(settings.supersetTransitionSec);
				s.setDynamicTooltip();
				s.onChange(async (value) => {
					settings.supersetTransitionSec = clampSupersetTransition(value);
					await this.deps.save();
				});
			});

		new Setting(parent)
			.setName("Auto-start after logging a set")
			.setDesc("Start the break timer automatically when you mark a set complete.")
			.addToggle((t) => {
				t.setValue(settings.autoStartRest);
				t.onChange(async (value) => {
					settings.autoStartRest = value;
					await this.deps.save();
				});
			});

		new Setting(parent)
			.setName("Play sound when the break ends")
			.setDesc("Plays a short tone if the page is in the foreground.")
			.addToggle((t) => {
				t.setValue(settings.playSoundOnRest);
				t.onChange(async (value) => {
					settings.playSoundOnRest = value;
					await this.deps.save();
				});
			});
	}

	private renderHydration(parent: HTMLElement, settings: SettingsLike): void {
		new Setting(parent).setName("Hydration").setHeading();
		const desc = parent.createEl("p", { cls: "setting-item-description" });
		const unit = waterUnitFor(settings.weightUnit);
		desc.setText(
			`Optional. Sets the daily target and the +/- step amount used by the water tracker (embedded in the meal log block, the standalone water log block, and the analytics view). Units follow your weight unit (${unit}). When left blank, sensible defaults are used (~2.5 L target, 250 ml step / 8 fl oz step).`,
		);

		const targetSetting = new Setting(parent)
			.setName(`Daily target (${unit})`)
			.setDesc("Leave blank to use the default. Units follow your weight unit.");

		let targetInput: TextComponent | null = null;
		targetSetting.addText((t) => {
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

		const stepDefault = unit === "ml" ? "250" : "8";
		new Setting(parent)
			.setName(`Step amount (${unit})`)
			.setDesc(
				`How much each tap on the water tracker's +/- buttons adds or removes. Leave blank to use the default (${stepDefault} ${unit}).`,
			)
			.addText((t) => {
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

		const calcWrap = parent.createDiv({ cls: "wp-recommend-block" });
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
	}

	private renderMealFavorites(parent: HTMLElement, settings: SettingsLike): void {
		new Setting(parent).setName("Meal favorites").setHeading();
		const desc = parent.createEl("p", { cls: "setting-item-description" });
		desc.setText(
			"Saved shortcuts shown in the favorite picker on every meals block. Click the star on any meal entry to save it, or add a custom one here.",
		);

		const details = parent.createEl("details", { cls: "wp-collapsible" });
		if (this.favoritesExpanded) details.setAttr("open", "");
		details.addEventListener("toggle", () => {
			this.favoritesExpanded = details.open;
		});

		const total = settings.mealFavorites.length;
		const summary = details.createEl("summary", { cls: "wp-collapsible-summary" });
		summary.setText(total === 0 ? "Favorites (none yet)" : `Favorites (${total})`);

		const list = details.createDiv({ cls: "wp-settings-list" });

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
						this.display();
					},
				).open();
			});
			new ButtonComponent(actions).setButtonText("Delete").setWarning().onClick(async () => {
				settings.mealFavorites = settings.mealFavorites.filter((f) => f.id !== fav.id);
				await this.deps.save();
				this.display();
			});
		}

		new Setting(details).addButton((b) =>
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
						this.display();
					},
				).open();
			}),
		);
	}

	private renderExercises(parent: HTMLElement, settings: SettingsLike): void {
		new Setting(parent).setName("Exercise library").setHeading();
		const desc = parent.createEl("p", { cls: "setting-item-description" });
		desc.setText("Add your own exercises or remove ones you don't use. Built-in entries can be deleted but will be restored if you reset the plugin.");

		const details = parent.createEl("details", { cls: "wp-collapsible" });
		if (this.exercisesExpanded) details.setAttr("open", "");
		details.addEventListener("toggle", () => {
			this.exercisesExpanded = details.open;
		});

		const summary = details.createEl("summary", { cls: "wp-collapsible-summary" });
		const total = settings.exercises.length;
		summary.setText(`Exercises (${total})`);

		const list = details.createDiv({ cls: "wp-settings-list" });

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
					this.display();
				}).open();
			});
			new ButtonComponent(actions).setButtonText("Delete").setWarning().onClick(async () => {
				settings.exercises = settings.exercises.filter((e) => e.id !== exercise.id);
				await this.deps.save();
				this.display();
			});
		}

		new Setting(details)
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
					this.display();
				}).open();
			}));
	}

	private renderTemplates(parent: HTMLElement, settings: SettingsLike): void {
		new Setting(parent).setName("Workout templates").setHeading();
		const desc = parent.createEl("p", { cls: "setting-item-description" });
		desc.setText("Templates appear when you run the `Insert workout` command. Each template lists exercises with target sets, reps, and weight.");

		const list = parent.createDiv({ cls: "wp-settings-list" });

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
					this.display();
				}).open();
			});
			new ButtonComponent(actions).setButtonText("Delete").setWarning().onClick(async () => {
				settings.templates = settings.templates.filter((t) => t.id !== template.id);
				await this.deps.save();
				this.display();
			});
		}

		new Setting(parent).addButton((b) => b.setButtonText("Add template").setCta().onClick(() => {
			const blank: WorkoutTemplate = { id: generateId("tpl"), name: "", exercises: [], cardio: [] };
			new TemplateEditorModal(this.app, blank, settings.exercises, async (created) => {
				if (created.name.trim().length === 0) {
					new Notice("Template name is required.");
					return;
				}
				settings.templates.push(created);
				await this.deps.save();
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
