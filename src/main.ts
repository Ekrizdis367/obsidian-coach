import { MarkdownView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import type { RestTimerState } from "./types";
import {
	DEFAULT_SETTINGS,
	clampSupersetTransition,
	migrateTemplate,
	normalizeBodyData,
	normalizeFitnessGoal,
	normalizeGoalWeight,
	normalizeMealFavorites,
	normalizeNutritionGoals,
	normalizeRecipesFolders,
	normalizeWaterStep,
	normalizeWaterTarget,
	normalizeWeeklySchedule,
	type WorkoutSettings,
} from "./settings";
import { HistoryIndex } from "./data/history-index";
import { RecipeIndex } from "./data/recipe-index";
import { RestTimerController } from "./ui/rest-timer";
import { registerWorkoutBlockProcessor } from "./ui/workout-renderer";
import { registerMealsBlockProcessor } from "./ui/meals-renderer";
import { registerWaterBlockProcessor } from "./ui/water-renderer";
import { ANALYTICS_VIEW_TYPE, AnalyticsView } from "./ui/analytics-view";
import { WorkoutSettingsTab } from "./ui/settings-tab";
import { effectiveWeight } from "./utils/body-stats";
import { openInsertWorkoutCommand } from "./commands/insert-workout";
import { openInsertExerciseCommand } from "./commands/insert-exercise";
import { openInsertMealLogCommand } from "./commands/insert-meal-log";
import { openInsertWaterLogCommand } from "./commands/insert-water-log";
import { openInsertWeeklyReviewCommand } from "./commands/weekly-review";
import { createWorkoutApi, type WorkoutPlannerApi } from "./api";

interface SavedData {
	settings: WorkoutSettings;
	restTimer: RestTimerState | null;
	/** Per-note workout block collapsed state (file path → collapsed). */
	workoutCollapsed?: Record<string, boolean>;
}

const DEFAULT_SAVED: SavedData = {
	settings: DEFAULT_SETTINGS,
	restTimer: null,
	workoutCollapsed: {},
};

export default class CoachPlugin extends Plugin {
	settings!: WorkoutSettings;
	api!: WorkoutPlannerApi;
	private restTimerState: RestTimerState | null = null;
	private workoutCollapsed: Record<string, boolean> = {};
	private historyIndex!: HistoryIndex;
	private recipeIndex!: RecipeIndex;
	private restTimer!: RestTimerController;

	async onload(): Promise<void> {
		await this.loadStoredData();

		this.api = createWorkoutApi(() => this.settings);

		this.historyIndex = new HistoryIndex(this.app);
		this.recipeIndex = new RecipeIndex(this.app, {
			getFolders: () => this.settings.recipesFolders,
			onChanged: () => this.refreshAnalyticsViews(),
		});
		this.restTimer = new RestTimerController(this, {
			getDefaultDurationSec: () => this.settings.restDurationSec,
			getPlaySound: () => this.settings.playSoundOnRest,
			persist: async (state) => {
				this.restTimerState = state;
				await this.persistData();
			},
		});

		registerWorkoutBlockProcessor(
			(language, handler) => this.registerMarkdownCodeBlockProcessor(language, handler),
			{
				app: this.app,
				getUnit: () => this.settings.weightUnit,
				getDefaultRestSec: () => this.settings.restDurationSec,
				getSupersetTransitionSec: () => this.settings.supersetTransitionSec,
				getAutoStartRest: () => this.settings.autoStartRest,
				getShowAddSetButton: () => this.settings.showAddSetButton,
				historyIndex: this.historyIndex,
				restTimer: this.restTimer,
				getWorkoutCollapsed: (path) => this.workoutCollapsed[path] === true,
				setWorkoutCollapsed: (path, collapsed) => {
					if (collapsed) this.workoutCollapsed[path] = true;
					else delete this.workoutCollapsed[path];
					void this.persistData();
				},
			},
		);

		registerMealsBlockProcessor(
			(language, handler) => this.registerMarkdownCodeBlockProcessor(language, handler),
			{
				app: this.app,
				recipes: this.recipeIndex,
				getGoals: () => this.settings.nutritionGoals,
				getRecipesFolders: () => this.settings.recipesFolders,
				getTrackFiber: () => this.settings.trackFiber,
				getWeightUnit: () => this.settings.weightUnit,
				getWaterTarget: () => this.settings.waterTarget,
				getWaterStep: () => this.settings.waterStep,
				getMealFavorites: () => this.settings.mealFavorites,
				saveMealFavorites: async (next) => {
					this.settings.mealFavorites = next;
					await this.persistData();
				},
			},
		);

		registerWaterBlockProcessor(
			(language, handler) => this.registerMarkdownCodeBlockProcessor(language, handler),
			{
				app: this.app,
				getWeightUnit: () => this.settings.weightUnit,
				getDailyTarget: () => this.settings.waterTarget,
				getStep: () => this.settings.waterStep,
			},
		);

		this.registerView(
			ANALYTICS_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new AnalyticsView(leaf, {
				historyIndex: this.historyIndex,
				recipes: this.recipeIndex,
				getUnit: () => this.settings.weightUnit,
				getGoals: () => this.settings.nutritionGoals,
				getGoalWeight: () => this.settings.goalWeight,
				getSchedule: () => this.settings.weeklySchedule,
				getBodyData: () => this.settings.bodyData,
				getFitnessGoal: () => this.settings.fitnessGoal,
				getTrackFiber: () => this.settings.trackFiber,
				getWaterTarget: () => this.settings.waterTarget,
			}),
		);

		this.addCommand({
			id: "insert-workout",
			name: "Insert workout",
			editorCallback: (editor, view) => {
				if (view instanceof MarkdownView) {
					openInsertWorkoutCommand(this.app, this.settings.templates, editor, view);
				}
			},
		});

		this.addCommand({
			id: "insert-exercise",
			name: "Insert exercise",
			editorCallback: (editor) => {
				openInsertExerciseCommand(this.app, this.settings.exercises, editor);
			},
		});

		this.addCommand({
			id: "insert-meal-log",
			name: "Insert meal log",
			editorCallback: (editor) => {
				openInsertMealLogCommand(editor);
			},
		});

		this.addCommand({
			id: "insert-water-log",
			name: "Insert water log",
			editorCallback: (editor) => {
				openInsertWaterLogCommand(editor, {
					getDailyTarget: () => this.settings.waterTarget,
				});
			},
		});

		this.addCommand({
			id: "insert-weekly-review",
			name: "Insert weekly review",
			editorCallback: (editor) => {
				openInsertWeeklyReviewCommand(editor, {
					historyIndex: this.historyIndex,
					recipes: this.recipeIndex,
					getWeightUnit: () => this.settings.weightUnit,
					getGoals: () => this.settings.nutritionGoals,
					getSchedule: () => this.settings.weeklySchedule,
					getTrackFiber: () => this.settings.trackFiber,
				});
			},
		});

		this.addCommand({
			id: "open-analytics",
			name: "Open workout analytics",
			callback: () => this.activateAnalyticsView(),
		});

		this.addCommand({
			id: "start-rest-timer",
			name: "Start between-set timer",
			callback: () => this.restTimer.start(this.settings.restDurationSec),
		});

		this.addCommand({
			id: "cancel-rest-timer",
			name: "Cancel between-set timer",
			callback: () => this.restTimer.cancel(),
		});

		this.addSettingTab(
			new WorkoutSettingsTab(this.app, this, {
				getSettings: () => this.settings,
				save: () => this.persistData(),
				rebuildRecipes: () => this.recipeIndex.rebuild(),
				getEffectiveWeight: () => effectiveWeight(
					this.historyIndex.getBodyweightEntries(),
					this.settings.bodyData.weight,
				),
			}),
		);

		this.app.workspace.onLayoutReady(() => {
			void this.historyIndex.build();
			this.recipeIndex.rebuild();
			this.restTimer.hydrate(this.restTimerState);
			this.refreshAnalyticsViews();
		});

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					void this.historyIndex.onFileChange(file);
					this.recipeIndex.onFileChange(file);
					this.refreshAnalyticsViews();
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					void this.historyIndex.onFileChange(file);
					this.recipeIndex.onFileChange(file);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.historyIndex.onFileDelete(file.path);
				this.recipeIndex.onFileDelete(file.path);
				this.refreshAnalyticsViews();
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					this.historyIndex.onFileRename(oldPath, file);
					this.recipeIndex.onFileRename(oldPath, file);
				}
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.recipeIndex.onFileChange(file);
				}
			}),
		);
	}

	onunload(): void {
		this.restTimer?.destroy();
	}

	private async loadStoredData(): Promise<void> {
		const raw = (await this.loadData()) as Partial<SavedData> | null;
		const merged: SavedData = {
			settings: { ...DEFAULT_SAVED.settings, ...(raw?.settings ?? {}) },
			restTimer: raw?.restTimer ?? null,
			workoutCollapsed: raw?.workoutCollapsed ?? {},
		};
		if (!merged.settings.exercises || merged.settings.exercises.length === 0) {
			merged.settings.exercises = DEFAULT_SETTINGS.exercises;
		}
		if (!merged.settings.templates) {
			merged.settings.templates = DEFAULT_SETTINGS.templates;
		}
		merged.settings.templates = merged.settings.templates.map(migrateTemplate);
		merged.settings.nutritionGoals = normalizeNutritionGoals(merged.settings.nutritionGoals);
		const rawSettings = (raw?.settings ?? {}) as Record<string, unknown>;
		merged.settings.recipesFolders = normalizeRecipesFolders(
			merged.settings.recipesFolders,
			rawSettings["recipesFolder"],
		);
		merged.settings.weeklySchedule = normalizeWeeklySchedule(
			merged.settings.weeklySchedule,
			merged.settings.templates,
		);
		merged.settings.goalWeight = normalizeGoalWeight(merged.settings.goalWeight);
		merged.settings.bodyData = normalizeBodyData(
			merged.settings.bodyData,
			merged.settings.weightUnit,
		);
		merged.settings.fitnessGoal = normalizeFitnessGoal(merged.settings.fitnessGoal);
		merged.settings.supersetTransitionSec = clampSupersetTransition(
			typeof merged.settings.supersetTransitionSec === "number"
				? merged.settings.supersetTransitionSec
				: DEFAULT_SETTINGS.supersetTransitionSec,
		);
		merged.settings.waterTarget = normalizeWaterTarget(merged.settings.waterTarget);
		merged.settings.waterStep = normalizeWaterStep(merged.settings.waterStep);
		merged.settings.mealFavorites = normalizeMealFavorites(merged.settings.mealFavorites);
		merged.settings.trackFiber = typeof merged.settings.trackFiber === "boolean"
			? merged.settings.trackFiber
			: false;
		this.settings = merged.settings;
		this.restTimerState = merged.restTimer;
		this.workoutCollapsed = merged.workoutCollapsed ?? {};
	}

	private async persistData(): Promise<void> {
		const data: SavedData = {
			settings: this.settings,
			restTimer: this.restTimerState,
			workoutCollapsed: this.workoutCollapsed,
		};
		await this.saveData(data);
	}

	private async activateAnalyticsView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(ANALYTICS_VIEW_TYPE);
		if (existing.length > 0) {
			const leaf = existing[0];
			if (leaf) {
				await workspace.revealLeaf(leaf);
				return;
			}
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: ANALYTICS_VIEW_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}

	private refreshAnalyticsViews(): void {
		const leaves = this.app.workspace.getLeavesOfType(ANALYTICS_VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof AnalyticsView) view.scheduleRender();
		}
	}
}
