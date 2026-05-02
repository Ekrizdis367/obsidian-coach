import { App, FuzzySuggestModal } from "obsidian";
import type { WorkoutTemplate } from "../types";

const CUSTOM_ID = "__custom__";

export class InsertWorkoutModal extends FuzzySuggestModal<WorkoutTemplate> {
	private templates: WorkoutTemplate[];
	private onChoose: (template: WorkoutTemplate | null) => void;

	constructor(app: App, templates: WorkoutTemplate[], onChoose: (template: WorkoutTemplate | null) => void) {
		super(app);
		this.templates = templates;
		this.onChoose = onChoose;
		this.setPlaceholder("Pick a workout template…");
	}

	getItems(): WorkoutTemplate[] {
		const blank: WorkoutTemplate = { id: CUSTOM_ID, name: "Custom · empty workout", exercises: [], cardio: [] };
		return [blank, ...this.templates];
	}

	getItemText(item: WorkoutTemplate): string {
		return item.name;
	}

	onChooseItem(item: WorkoutTemplate): void {
		if (item.id === CUSTOM_ID) this.onChoose(null);
		else this.onChoose(item);
	}
}
