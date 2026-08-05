import { App, Notice, TFile, normalizePath } from "obsidian";
import { padNumber } from "./pad";

export interface DailyNotesConfig {
	folder: string;
	format: string;
	template: string;
}

/**
 * Read core Daily Notes settings. Falls back to YYYY-MM-DD in the vault root
 * when the plugin is disabled or unset.
 */
export function getDailyNotesConfig(app: App): DailyNotesConfig {
	const options = readDailyNotesOptions(app);
	return {
		folder: typeof options.folder === "string" ? options.folder.trim() : "",
		format: typeof options.format === "string" && options.format.trim().length > 0
			? options.format.trim()
			: "YYYY-MM-DD",
		template: typeof options.template === "string" ? options.template.trim() : "",
	};
}

function readDailyNotesOptions(app: App): Record<string, unknown> {
	try {
		const internal = (app as unknown as {
			internalPlugins?: {
				getPluginById?: (id: string) => { instance?: { options?: Record<string, unknown> } } | null;
			};
		}).internalPlugins;
		const plugin = internal?.getPluginById?.("daily-notes");
		const options = plugin?.instance?.options;
		if (options && typeof options === "object") return options;
	} catch {
		/* fall through */
	}
	return {};
}

/** Absolute vault path (with `.md`) for today's daily note per Daily Notes settings. */
export function todayDailyNotePath(app: App, now: Date = new Date()): string {
	const { folder, format } = getDailyNotesConfig(app);
	const basename = formatWithMoment(format, now);
	const withExt = basename.endsWith(".md") ? basename : `${basename}.md`;
	if (!folder) return normalizePath(withExt);
	return normalizePath(`${folder}/${withExt}`);
}

export function findTodayDailyNote(app: App, now: Date = new Date()): TFile | null {
	const path = todayDailyNotePath(app, now);
	const file = app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? file : null;
}

/**
 * Create (or open) today's daily note via the core Daily Notes command so
 * folder / format / template / Templater hooks all still apply.
 */
export async function createTodayDailyNote(app: App): Promise<TFile | null> {
	const existing = findTodayDailyNote(app);
	if (existing) {
		await app.workspace.getLeaf(false).openFile(existing);
		return existing;
	}

	const commands = (app as unknown as {
		commands?: { executeCommandById?: (id: string) => boolean };
	}).commands;

	const ran = commands?.executeCommandById?.("daily-notes") === true;
	if (!ran) {
		new Notice("Enable the core daily notes plugin to create today's note.");
		return null;
	}

	// Core command creates asynchronously; give Templater / the vault a beat.
	await sleep(400);
	return findTodayDailyNote(app);
}

function formatWithMoment(format: string, date: Date): string {
	const momentFn = (window as unknown as {
		moment?: (input?: Date) => { format: (fmt: string) => string };
	}).moment;
	if (typeof momentFn === "function") {
		return momentFn(date).format(format);
	}
	// Fallback when moment isn't on window (shouldn't happen inside Obsidian).
	const y = date.getFullYear();
	const m = padNumber(date.getMonth() + 1, 2);
	const d = padNumber(date.getDate(), 2);
	return `${y}-${m}-${d}`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
