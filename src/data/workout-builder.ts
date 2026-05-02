import type { WorkoutBlock, WorkoutTemplate } from "../types";
import { serializeWorkoutBlock } from "./workout-block";
import { formatIsoDate } from "./history-index";

export function templateToBlock(
	template: WorkoutTemplate | null,
	date: string,
): WorkoutBlock {
	if (!template) {
		return { template: undefined, date, exercises: [], cardio: [] };
	}
	return {
		template: template.name,
		date,
		exercises: template.exercises.map((ex) => ({
			name: ex.name,
			target: { sets: ex.sets, reps: ex.reps, weight: ex.weight },
			log: [],
			...(ex.tracksWeight === false ? { tracksWeight: false } : {}),
			...(ex.group ? { group: ex.group } : {}),
			...(ex.dropSet === true ? { dropSet: true } : {}),
			...(ex.toFailure === true ? { toFailure: true } : {}),
		})),
		cardio: (template.cardio ?? []).map((c) => ({
			name: c.name,
			target: {
				minutes: c.minutes,
				...(typeof c.distance === "number" && c.distance > 0
					? { distance: c.distance, distanceUnit: c.distanceUnit ?? "km" }
					: {}),
			},
			log: null,
			...(c.trackDistance === false ? { trackDistance: false } : {}),
		})),
	};
}

export function buildWorkoutBlockText(
	template: WorkoutTemplate | null,
	date: Date | string = new Date(),
): string {
	const iso = typeof date === "string" ? date : formatIsoDate(date);
	const block = templateToBlock(template, iso);
	const yaml = serializeWorkoutBlock(block).trimEnd();
	return "```workout\n" + yaml + "\n```";
}
