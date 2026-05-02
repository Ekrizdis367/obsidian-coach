import { App, Editor, MarkdownView, Notice } from "obsidian";
import type { WorkoutTemplate } from "../types";
import { buildWorkoutBlockText } from "../data/workout-builder";
import { InsertWorkoutModal } from "../ui/insert-workout-modal";

export function openInsertWorkoutCommand(
	app: App,
	templates: WorkoutTemplate[],
	editor: Editor,
	view: MarkdownView,
): void {
	void view;
	new InsertWorkoutModal(app, templates, (template) => {
		const text = buildWorkoutBlockText(template) + "\n";

		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const prefix = cursor.ch === 0 && line.length === 0 ? "" : "\n";
		editor.replaceRange(prefix + text, cursor);
		new Notice(template ? `Inserted workout: ${template.name}` : "Inserted blank workout");
	}).open();
}
