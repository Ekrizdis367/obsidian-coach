const EMBED_WRAPPER_SELECTOR = "pre, .el-pre, .cm-embed-block";

/** Strip Obsidian code-block chrome by tagging the outer embed wrapper. */
export function markEmbedWrapper(el: HTMLElement): void {
	const wrapper = el.closest(EMBED_WRAPPER_SELECTOR);
	if (wrapper) wrapper.addClass("wp-embed-host");
}
