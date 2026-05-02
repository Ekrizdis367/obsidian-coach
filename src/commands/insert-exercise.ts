import { App, Editor, Notice } from "obsidian";
import type { Exercise } from "../types";
import {
	parseWorkoutBlock,
	serializeWorkoutBlock,
} from "../data/workout-block";
import { formatIsoDate } from "../data/history-index";
import { InsertExerciseModal } from "../ui/insert-exercise-modal";

const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})\s*workout\s*$/;

export function openInsertExerciseCommand(
	app: App,
	exercises: Exercise[],
	editor: Editor,
): void {
	new InsertExerciseModal(app, exercises, (exercise) => {
		const enclosing = findEnclosingWorkoutBlock(editor);
		if (enclosing) {
			appendToBlock(editor, enclosing, exercise);
			new Notice(`Added ${exercise.name} to workout`);
		} else {
			insertNewBlock(editor, exercise);
			new Notice(`Inserted workout with ${exercise.name}`);
		}
	}).open();
}

interface EnclosingBlock {
	openLine: number;
	closeLine: number;
	fence: string;
}

function findEnclosingWorkoutBlock(editor: Editor): EnclosingBlock | null {
	const total = editor.lineCount();
	const cursorLine = editor.getCursor().line;

	let openLine = -1;
	let fence = "";
	for (let i = cursorLine; i >= 0; i--) {
		const line = editor.getLine(i);
		const match = line.match(FENCE_OPEN_RE);
		if (match) {
			openLine = i;
			fence = match[1] ?? "";
			break;
		}
	}
	if (openLine === -1) return null;

	const fenceFirst = fence.charAt(0);
	const closeRe = new RegExp(`^[ \\t]*${escapeRegex(fenceFirst)}{${fence.length},}\\s*$`);
	let closeLine = -1;
	for (let i = openLine + 1; i < total; i++) {
		if (closeRe.test(editor.getLine(i))) {
			closeLine = i;
			break;
		}
	}
	if (closeLine === -1 || cursorLine > closeLine) return null;

	return { openLine, closeLine, fence };
}

function appendToBlock(editor: Editor, enclosing: EnclosingBlock, exercise: Exercise): void {
	const innerLines: string[] = [];
	for (let i = enclosing.openLine + 1; i < enclosing.closeLine; i++) {
		innerLines.push(editor.getLine(i));
	}
	const inner = innerLines.join("\n");

	let block;
	try {
		block = parseWorkoutBlock(inner);
	} catch {
		new Notice("Could not parse current workout block.");
		return;
	}

	if (exercise.category === "cardio") {
		block.cardio.push({
			name: exercise.name,
			target: { minutes: 20 },
			log: null,
		});
	} else {
		const isBodyweight = exercise.equipment === "bodyweight";
		block.exercises.push({
			name: exercise.name,
			target: { sets: 3, reps: isBodyweight ? 12 : 8, weight: 0 },
			log: [],
			...(isBodyweight ? { tracksWeight: false } : {}),
		});
	}

	const newInner = serializeWorkoutBlock(block).trimEnd();
	const innerEndCh = editor.getLine(enclosing.closeLine - 1).length;
	editor.replaceRange(
		newInner,
		{ line: enclosing.openLine + 1, ch: 0 },
		{ line: enclosing.closeLine - 1, ch: innerEndCh },
	);
}

function insertNewBlock(editor: Editor, exercise: Exercise): void {
	const isCardio = exercise.category === "cardio";
	const isBodyweight = exercise.equipment === "bodyweight";
	const block = {
		date: formatIsoDate(new Date()),
		exercises: isCardio
			? []
			: [
				{
					name: exercise.name,
					target: { sets: 3, reps: isBodyweight ? 12 : 8, weight: 0 },
					log: [],
					...(isBodyweight ? { tracksWeight: false } : {}),
				},
			],
		cardio: isCardio
			? [
				{
					name: exercise.name,
					target: { minutes: 20 },
					log: null,
				},
			]
			: [],
	};
	const yaml = serializeWorkoutBlock(block).trimEnd();
	const text = "```workout\n" + yaml + "\n```\n";
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	const prefix = cursor.ch === 0 && line.length === 0 ? "" : "\n";
	editor.replaceRange(prefix + text, cursor);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
