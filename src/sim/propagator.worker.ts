/// <reference lib="webworker" />
// Propagates the whole catalog with SGP4 off the main thread. Each 'step'
// returns TEME position (km) and velocity (km/s) for every object; objects that
// fail to propagate (decayed, bad elements) come back as NaN.
import { json2satrec, sgp4, type SatRec } from 'satellite.js';

type InitMsg = { type: 'init'; omms: Parameters<typeof json2satrec>[0][] };
type StepMsg = { type: 'step'; time: number; pos?: Float32Array; vel?: Float32Array };

let recs: (SatRec | null)[] = [];

self.onmessage = (e: MessageEvent<InitMsg | StepMsg>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    let failed = 0;
    recs = msg.omms.map((omm) => {
      try {
        const r = json2satrec(omm);
        if (r.error) {
          failed++;
          return null;
        }
        return r;
      } catch {
        failed++;
        return null;
      }
    });
    (self as DedicatedWorkerGlobalScope).postMessage({ type: 'ready', failed });
    return;
  }
  if (msg.type === 'step') {
    const n = recs.length;
    const pos = msg.pos && msg.pos.length === n * 3 ? msg.pos : new Float32Array(n * 3);
    const vel = msg.vel && msg.vel.length === n * 3 ? msg.vel : new Float32Array(n * 3);
    const jd = msg.time / 86400000 + 2440587.5;
    for (let i = 0; i < n; i++) {
      const r = recs[i];
      const k = i * 3;
      let ok = false;
      if (r) {
        const res = sgp4(r, (jd - r.jdsatepoch) * 1440);
        if (res && res.position && Number.isFinite(res.position.x)) {
          pos[k] = res.position.x;
          pos[k + 1] = res.position.y;
          pos[k + 2] = res.position.z;
          vel[k] = res.velocity.x;
          vel[k + 1] = res.velocity.y;
          vel[k + 2] = res.velocity.z;
          ok = true;
        }
      }
      if (!ok) {
        pos[k] = pos[k + 1] = pos[k + 2] = NaN;
        vel[k] = vel[k + 1] = vel[k + 2] = 0;
      }
    }
    (self as DedicatedWorkerGlobalScope).postMessage({ type: 'state', time: msg.time, pos, vel }, [pos.buffer, vel.buffer]);
  }
};
