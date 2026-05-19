import { Notice, Plugin, setIcon } from "obsidian";
import type { RestTimerState } from "../types";
import { formatDuration } from "../utils/format";

export interface RestTimerOptions {
	getDefaultDurationSec: () => number;
	getPlaySound: () => boolean;
	persist: (state: RestTimerState | null) => Promise<void>;
}

export class RestTimerController {
	private plugin: Plugin;
	private opts: RestTimerOptions;
	private state: RestTimerState | null = null;
	private root: HTMLElement | null = null;
	private timeEl: HTMLElement | null = null;
	private labelEl: HTMLElement | null = null;
	private intervalId: number | null = null;
	private notifiedComplete = false;
	private audioCtx: AudioContext | null = null;

	constructor(plugin: Plugin, opts: RestTimerOptions) {
		this.plugin = plugin;
		this.opts = opts;
	}

	hydrate(state: RestTimerState | null): void {
		if (!state) return;
		const elapsed = (Date.now() - state.startedAt) / 1000;
		if (elapsed >= state.durationSec + 60) {
			void this.opts.persist(null);
			return;
		}
		this.state = state;
		this.notifiedComplete = elapsed >= state.durationSec;
		this.ensureWidget();
		this.startTicking();
		this.render();
	}

	start(durationSec?: number, label?: string): void {
		const duration = Math.max(5, Math.round(durationSec ?? this.opts.getDefaultDurationSec()));
		this.state = { startedAt: Date.now(), durationSec: duration, label };
		this.notifiedComplete = false;
		void this.opts.persist(this.state);
		this.ensureWidget();
		this.startTicking();
		this.render();
	}

	cancel(): void {
		this.state = null;
		this.notifiedComplete = false;
		void this.opts.persist(null);
		this.stopTicking();
		this.removeWidget();
	}

	addSeconds(delta: number): void {
		if (!this.state) return;
		this.state = { ...this.state, durationSec: Math.max(5, this.state.durationSec + delta) };
		this.notifiedComplete = false;
		void this.opts.persist(this.state);
		this.render();
	}

	private ensureWidget(): void {
		if (this.root) return;
		const root = activeDocument.body.createDiv({ cls: "wp-rest-timer" });
		const inner = root.createDiv({ cls: "wp-rest-timer-inner" });

		this.labelEl = inner.createDiv({ cls: "wp-rest-timer-label", text: "Break" });
		this.timeEl = inner.createDiv({ cls: "wp-rest-timer-time", text: "0:00" });

		const controls = inner.createDiv({ cls: "wp-rest-timer-controls" });

		const minus = controls.createEl("button", { cls: "wp-rest-timer-btn", text: "-15s" });
		minus.addEventListener("click", () => this.addSeconds(-15));

		const plus = controls.createEl("button", { cls: "wp-rest-timer-btn", text: "+15s" });
		plus.addEventListener("click", () => this.addSeconds(15));

		const close = controls.createEl("button", { cls: "wp-rest-timer-btn wp-rest-timer-btn--close" });
		setIcon(close, "x");
		close.setAttr("aria-label", "Stop between-set timer");
		close.addEventListener("click", () => this.cancel());

		this.root = root;
	}

	private removeWidget(): void {
		this.root?.remove();
		this.root = null;
		this.timeEl = null;
		this.labelEl = null;
	}

	private startTicking(): void {
		if (this.intervalId !== null) return;
		this.intervalId = window.setInterval(() => this.render(), 250);
		this.plugin.registerInterval(this.intervalId);
	}

	private stopTicking(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	private render(): void {
		if (!this.state || !this.timeEl || !this.labelEl) return;
		const elapsed = (Date.now() - this.state.startedAt) / 1000;
		const remaining = this.state.durationSec - elapsed;
		this.labelEl.setText(this.state.label ? `Break · ${this.state.label}` : "Break");
		this.root?.toggleClass("is-complete", remaining <= 0);

		if (remaining <= 0) {
			this.timeEl.setText("Done");
			if (!this.notifiedComplete) {
				this.notifiedComplete = true;
				this.notifyComplete();
			}
			return;
		}
		this.timeEl.setText(formatDuration(remaining));
	}

	private notifyComplete(): void {
		new Notice("Between-set timer finished");
		if (this.opts.getPlaySound()) this.beep();
	}

	private beep(): void {
		try {
			const Ctor: typeof AudioContext | undefined =
				window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!Ctor) return;
			if (!this.audioCtx) this.audioCtx = new Ctor();
			const ctx = this.audioCtx;
			const now = ctx.currentTime;
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "sine";
			osc.frequency.setValueAtTime(880, now);
			gain.gain.setValueAtTime(0.0001, now);
			gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
			gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
			osc.connect(gain).connect(ctx.destination);
			osc.start(now);
			osc.stop(now + 0.55);
		} catch {
			// audio is best-effort; ignore failures (e.g., autoplay restrictions)
		}
	}

	destroy(): void {
		this.stopTicking();
		this.removeWidget();
		if (this.audioCtx) {
			try { void this.audioCtx.close(); } catch { /* noop */ }
			this.audioCtx = null;
		}
	}
}
