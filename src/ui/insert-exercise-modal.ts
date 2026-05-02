import { App, FuzzySuggestModal } from "obsidian";
import type { Exercise } from "../types";

export class InsertExerciseModal extends FuzzySuggestModal<Exercise> {
	private exercises: Exercise[];
	private onChoose: (exercise: Exercise) => void;

	constructor(app: App, exercises: Exercise[], onChoose: (exercise: Exercise) => void) {
		super(app);
		this.exercises = exercises;
		this.onChoose = onChoose;
		this.setPlaceholder("Pick an exercise…");
	}

	getItems(): Exercise[] {
		return [...this.exercises].sort((a, b) => a.name.localeCompare(b.name));
	}

	getItemText(item: Exercise): string {
		return `${item.name} · ${item.category} · ${item.equipment}`;
	}

	onChooseItem(item: Exercise): void {
		this.onChoose(item);
	}
}
