export interface SparklinePoint {
	label: string;
	value: number;
}

export interface SparklineOverlay {
	points: SparklinePoint[];
	className?: string;
}

export interface SparklineOptions {
	width?: number;
	height?: number;
	yScale?: "fromZero" | "auto";
	showFill?: boolean;
	showDots?: boolean;
	overlays?: SparklineOverlay[];
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function renderSparkline(
	parent: HTMLElement,
	points: SparklinePoint[],
	options: SparklineOptions = {},
): SVGSVGElement | null {
	const width = options.width ?? 280;
	const height = options.height ?? 80;
	const yScale = options.yScale ?? "fromZero";
	const showFill = options.showFill ?? true;
	const showDots = options.showDots ?? true;
	const overlays = options.overlays ?? [];
	const pad = 6;

	if (points.length === 0) return null;

	const svg = activeDocument.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
	svg.setAttribute("class", "wp-sparkline");
	svg.setAttribute("role", "img");

	const allValues = [
		...points.map((p) => p.value),
		...overlays.flatMap((o) => o.points.map((p) => p.value)),
	];
	const dataMax = Math.max(...allValues, 1);
	const dataMin = Math.min(...allValues);
	let yMin: number;
	let yMax: number;
	if (yScale === "auto") {
		const span = Math.max(dataMax - dataMin, 1);
		const pad = span * 0.15;
		yMin = dataMin - pad;
		yMax = dataMax + pad;
	} else {
		yMin = 0;
		yMax = dataMax;
	}
	const yRange = Math.max(yMax - yMin, 1e-6);

	const innerW = width - pad * 2;
	const innerH = height - pad * 2;

	const projectSeries = (series: SparklinePoint[]): { x: number; y: number }[] => {
		const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;
		return series.map((p, i) => {
			const x = pad + i * stepX;
			const y = pad + innerH - ((p.value - yMin) / yRange) * innerH;
			return { x, y };
		});
	};

	const coords = projectSeries(points);

	if (showFill && coords.length >= 2) {
		const fillPath = [
			`M ${coords[0]?.x ?? 0} ${pad + innerH}`,
			...coords.map((c) => `L ${c.x} ${c.y}`),
			`L ${coords[coords.length - 1]?.x ?? 0} ${pad + innerH}`,
			"Z",
		].join(" ");
		const fill = activeDocument.createElementNS(SVG_NS, "path");
		fill.setAttribute("d", fillPath);
		fill.setAttribute("class", "wp-sparkline-fill");
		svg.appendChild(fill);
	}

	const linePath = coords
		.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`)
		.join(" ");
	const line = activeDocument.createElementNS(SVG_NS, "path");
	line.setAttribute("d", linePath);
	line.setAttribute("class", "wp-sparkline-line");
	line.setAttribute("fill", "none");
	svg.appendChild(line);

	if (showDots) {
		for (const c of coords) {
			const dot = activeDocument.createElementNS(SVG_NS, "circle");
			dot.setAttribute("cx", c.x.toString());
			dot.setAttribute("cy", c.y.toString());
			dot.setAttribute("r", "2");
			dot.setAttribute("class", "wp-sparkline-dot");
			svg.appendChild(dot);
		}
	}

	for (const overlay of overlays) {
		if (overlay.points.length === 0) continue;
		const overlayCoords = projectSeries(overlay.points);
		const overlayPath = overlayCoords
			.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`)
			.join(" ");
		const overlayLine = activeDocument.createElementNS(SVG_NS, "path");
		overlayLine.setAttribute("d", overlayPath);
		overlayLine.setAttribute("class", overlay.className ?? "wp-sparkline-overlay");
		overlayLine.setAttribute("fill", "none");
		svg.appendChild(overlayLine);
	}

	parent.appendChild(svg);
	return svg;
}
