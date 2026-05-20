import { TFile, TFolder } from "obsidian";

/** Collect markdown files under a folder without calling vault.getMarkdownFiles(). */
export function collectMarkdownFiles(folder: TFolder): TFile[] {
	const files: TFile[] = [];
	for (const child of folder.children) {
		if (child instanceof TFile && child.extension === "md") {
			files.push(child);
		} else if (child instanceof TFolder) {
			files.push(...collectMarkdownFiles(child));
		}
	}
	return files;
}
