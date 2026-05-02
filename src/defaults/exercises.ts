import type { Exercise } from "../types";

function ex(
	id: string,
	name: string,
	category: Exercise["category"],
	equipment: Exercise["equipment"],
): Exercise {
	return { id, name, category, equipment, custom: false };
}

export const DEFAULT_EXERCISES: Exercise[] = [
	ex("bench-press", "Bench Press", "push", "barbell"),
	ex("incline-bench-press", "Incline Bench Press", "push", "barbell"),
	ex("dumbbell-bench-press", "Dumbbell Bench Press", "push", "dumbbell"),
	ex("overhead-press", "Overhead Press", "push", "barbell"),
	ex("dumbbell-shoulder-press", "Dumbbell Shoulder Press", "push", "dumbbell"),
	ex("lateral-raise", "Lateral Raise", "push", "dumbbell"),
	ex("triceps-pushdown", "Triceps Pushdown", "push", "cable"),
	ex("dips", "Dips", "push", "bodyweight"),
	ex("push-up", "Push-Up", "push", "bodyweight"),

	ex("deadlift", "Deadlift", "pull", "barbell"),
	ex("barbell-row", "Barbell Row", "pull", "barbell"),
	ex("dumbbell-row", "Dumbbell Row", "pull", "dumbbell"),
	ex("pull-up", "Pull-Up", "pull", "bodyweight"),
	ex("chin-up", "Chin-Up", "pull", "bodyweight"),
	ex("lat-pulldown", "Lat Pulldown", "pull", "cable"),
	ex("seated-cable-row", "Seated Cable Row", "pull", "cable"),
	ex("face-pull", "Face Pull", "pull", "cable"),
	ex("barbell-curl", "Barbell Curl", "pull", "barbell"),
	ex("dumbbell-curl", "Dumbbell Curl", "pull", "dumbbell"),

	ex("back-squat", "Back Squat", "legs", "barbell"),
	ex("front-squat", "Front Squat", "legs", "barbell"),
	ex("romanian-deadlift", "Romanian Deadlift", "legs", "barbell"),
	ex("leg-press", "Leg Press", "legs", "machine"),
	ex("leg-extension", "Leg Extension", "legs", "machine"),
	ex("leg-curl", "Leg Curl", "legs", "machine"),
	ex("walking-lunge", "Walking Lunge", "legs", "dumbbell"),
	ex("calf-raise", "Calf Raise", "legs", "machine"),
	ex("hip-thrust", "Hip Thrust", "legs", "barbell"),

	ex("plank", "Plank", "core", "bodyweight"),
	ex("hanging-leg-raise", "Hanging Leg Raise", "core", "bodyweight"),
	ex("ab-wheel", "Ab Wheel Rollout", "core", "other"),
	ex("cable-crunch", "Cable Crunch", "core", "cable"),

	ex("treadmill", "Treadmill", "cardio", "machine"),
	ex("rowing-machine", "Rowing Machine", "cardio", "machine"),
	ex("cycling", "Cycling", "cardio", "machine"),
];
