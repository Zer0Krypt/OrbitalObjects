import { toOMM, type SatObject } from '../data/catalog';
import { KM } from './astro';
import type { SimClock } from './clock';

/**
 * Keeps an SGP4 snapshot of every object, refreshed continuously by a worker.
 * Between snapshots each object is advanced on its instantaneous orbital
 * circle: p(t) = r·cos(ωΔt) + b·sin(ωΔt), with b = k×r and ω = |r×v|/|r|².
 * That is exact for circular orbits and very close for short Δt, and it runs
 * on the GPU (see satellites.ts) so the catalog animates at full frame rate.
 */
export class Propagator {
  readonly count: number;
  /** Scene-frame snapshot data (Earth radii). */
  readonly r: Float32Array;
  readonly b: Float32Array;
  readonly w: Float32Array; // rad / ms
  readonly valid: Uint8Array;
  snapshotTime = 0;
  version = 0;
  ready: Promise<void>;
  private worker: Worker;
  private spare: { pos: Float32Array; vel: Float32Array } | null = null;
  private listeners = new Set<() => void>();
  private inFlight = false;
  private urgent = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(objects: SatObject[], private clock: SimClock) {
    this.count = objects.length;
    this.r = new Float32Array(this.count * 3);
    this.b = new Float32Array(this.count * 3);
    this.w = new Float32Array(this.count);
    this.valid = new Uint8Array(this.count);
    this.worker = new Worker(new URL('./propagator.worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve) => {
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') {
          resolve();
          this.request();
        } else if (m.type === 'state') {
          this.ingest(m.time, m.pos, m.vel);
          this.spare = { pos: m.pos, vel: m.vel };
          this.inFlight = false;
          this.schedule(this.urgent ? 0 : this.interval());
          this.urgent = false;
        }
      };
    });
    this.worker.postMessage({ type: 'init', omms: objects.map(toOMM) });
    // Seeking or changing rate needs a fresh snapshot straight away.
    clock.onChange(() => {
      if (this.inFlight) this.urgent = true;
      else this.schedule(0);
    });
  }

  /** Real-time gap between snapshots: frequent under time warp, relaxed at 1× or paused. */
  private interval() {
    if (this.clock.paused) return 600;
    return Math.min(1000, Math.max(33, 1500 / Math.abs(this.clock.rate)));
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.request(), ms);
  }

  onUpdate(fn: () => void) {
    this.listeners.add(fn);
  }

  private request() {
    if (this.inFlight) return;
    this.inFlight = true;
    const msg: Record<string, unknown> = { type: 'step', time: this.clock.now() };
    const transfer: Transferable[] = [];
    if (this.spare) {
      msg.pos = this.spare.pos;
      msg.vel = this.spare.vel;
      transfer.push(this.spare.pos.buffer, this.spare.vel.buffer);
      this.spare = null;
    }
    this.worker.postMessage(msg, transfer);
  }

  private ingest(time: number, pos: Float32Array, vel: Float32Array) {
    const { r, b, w, valid } = this;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      // TEME (x, y, z) -> scene (x, z, -y)
      const rx = pos[k] * KM;
      const ry = pos[k + 2] * KM;
      const rz = -pos[k + 1] * KM;
      if (!Number.isFinite(rx)) {
        valid[i] = 0;
        r[k] = r[k + 1] = r[k + 2] = 0;
        b[k] = b[k + 1] = b[k + 2] = 0;
        w[i] = 0;
        continue;
      }
      const vx = vel[k] * KM;
      const vy = vel[k + 2] * KM;
      const vz = -vel[k + 1] * KM;
      // h = r × v
      const hx = ry * vz - rz * vy;
      const hy = rz * vx - rx * vz;
      const hz = rx * vy - ry * vx;
      const hl = Math.hypot(hx, hy, hz) || 1;
      const r2 = rx * rx + ry * ry + rz * rz;
      const kx = hx / hl;
      const ky = hy / hl;
      const kz = hz / hl;
      r[k] = rx;
      r[k + 1] = ry;
      r[k + 2] = rz;
      b[k] = ky * rz - kz * ry;
      b[k + 1] = kz * rx - kx * rz;
      b[k + 2] = kx * ry - ky * rx;
      w[i] = hl / r2 / 1000; // per ms
      valid[i] = 1;
    }
    this.snapshotTime = time;
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Approximate scene position of object i at sim time t (same model as the GPU). */
  position(i: number, t: number, out: { x: number; y: number; z: number }) {
    const k = i * 3;
    const a = this.w[i] * (t - this.snapshotTime);
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.x = this.r[k] * c + this.b[k] * s;
    out.y = this.r[k + 1] * c + this.b[k + 1] * s;
    out.z = this.r[k + 2] * c + this.b[k + 2] * s;
    return out;
  }
}
