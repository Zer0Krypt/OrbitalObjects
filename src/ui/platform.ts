import type { App } from '../app';
import { fmtAgo, h } from './dom';

/** Register the service worker (production builds only). */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((err) => console.warn('Service worker not registered:', err));
  });
}

/** A slow or metered connection: skip optional heavy downloads. */
export function lightMode() {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (!!c.saveData || /(^|-)2g|3g/.test(c.effectiveType ?? ''));
}

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Install button, iOS "Add to Home Screen" hint and the offline banner. */
export function mountPlatform(app: App) {
  const btn = document.getElementById('btn-install') as HTMLButtonElement;
  let deferred: InstallEvent | null = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    btn.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    btn.hidden = true;
  });
  // Safari has no install prompt; explain how instead.
  const iosHint = isIos() && !standalone();
  if (iosHint) btn.hidden = false;
  btn.onclick = async () => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') btn.hidden = true;
      deferred = null;
      return;
    }
    if (iosHint) app.alerts?.toast('Install on iPhone or iPad', 'Tap the Share button in Safari, then “Add to Home Screen”. It opens full screen and works offline with the last data it loaded.');
  };

  // Offline: say which data is showing.
  const banner = document.getElementById('offline-banner')!;
  const sync = () => {
    const off = !navigator.onLine || !!app.cat.offline;
    banner.hidden = !off;
    if (off) banner.replaceChildren(h('b', null, 'Offline'), ` · showing the catalogue saved on this device, built ${fmtAgo(Date.now() - Date.parse(app.cat.generated))}`);
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
}
