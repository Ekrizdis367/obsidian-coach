import { Editor, Notice } from "obsidian";
import { formatIsoDate } from "../data/history-index";
import { buildWaterBlockText } from "../ui/water-renderer";

export interface InsertWaterDeps {
	getDailyTarget: () => number | null;
}

export function openInsertWaterLogCommand(editor: Editor, deps: InsertWaterDeps): void {
	const today = formatIsoDate(new Date());
	const target = deps.getDailyTarget();
	const text = buildWaterBlockText(today, target ?? undefined) + "\n";

	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	const prefix = cursor.ch === 0 && line.length === 0 ? "" : "\n";
	editor.replaceRange(prefix + text, cursor);
	new Notice("Inserted water log");
}
