import { parseYaml as obsidianParseYaml, stringifyYaml as obsidianStringifyYaml } from "obsidian";

/**
 * Obsidian types `parseYaml` as returning `any`. Wrap at the boundary so the
 * rest of the plugin can treat YAML as `unknown` and narrow explicitly.
 */
export function parseYamlUnknown(source: string): unknown {
	return obsidianParseYaml(source) as unknown;
}

/**
 * Obsidian types `stringifyYaml`'s argument as `any`. Accept `unknown` here and
 * only cast at this single boundary.
 */
export function stringifyYamlValue(value: unknown): string {
	return obsidianStringifyYaml(value as never);
}
