// WebOS — "install WebOS as an app" (PWA) support.
let deferred = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f());

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  emit();
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  emit();
});

export const canInstall = () => !!deferred;
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const onInstallChange = (fn) => (subs.add(fn), () => subs.delete(fn));
export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const r = await deferred.userChoice;
  deferred = null;
  emit();
  return r.outcome === 'accepted';
}
