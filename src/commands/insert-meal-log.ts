import { Editor, Notice } from "obsidian";
import { serializeMealsBlock } from "../data/meals-block";
import { formatIsoDate } from "../data/history-index";

export function openInsertMealLogCommand(editor: Editor): void {
	const today = formatIsoDate(new Date());
	const yaml = serializeMealsBlock({ date: today, entries: [] }).trimEnd();
	const text = "```meals\n" + yaml + "\n```\n";

	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	const prefix = cursor.ch === 0 && line.length === 0 ? "" : "\n";
	editor.replaceRange(prefix + text, cursor);
	new Notice("Inserted meal log");
}
