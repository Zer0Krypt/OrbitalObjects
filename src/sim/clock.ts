/** Simulation clock: real time scaled by a warp factor, pausable and seekable. */
export class SimClock {
  private baseSim = Date.now();
  private baseReal = performance.now();
  private _rate = 1;
  private _paused = false;
  private listeners = new Set<() => void>();

  get rate() {
    return this._rate;
  }
  get paused() {
    return this._paused;
  }

  now() {
    if (this._paused) return this.baseSim;
    return this.baseSim + (performance.now() - this.baseReal) * this._rate;
  }

  private rebase() {
    this.baseSim = this.now();
    this.baseReal = performance.now();
  }

  setRate(rate: number) {
    this.rebase();
    this._rate = rate;
    this.emit();
  }

  setPaused(p: boolean) {
    this.rebase();
    this._paused = p;
    this.emit();
  }

  set(ms: number) {
    this.baseSim = ms;
    this.baseReal = performance.now();
    this.emit();
  }

  resetToNow() {
    this._rate = 1;
    this._paused = false;
    this.set(Date.now());
  }

  /** True when the simulation is tracking wall-clock time. */
  get isLive() {
    return !this._paused && this._rate === 1 && Math.abs(this.now() - Date.now()) < 2000;
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
