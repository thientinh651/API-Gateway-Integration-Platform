import type { ApiErrorTarget } from './apiErrorTarget';

const HIGHLIGHT_CLASS = 'avaso-error-highlight';

type NavigateFn = (route: string, sectionId?: string) => void;

let navigateFn: NavigateFn | null = null;

export function registerToastNavigator(fn: NavigateFn) {
  navigateFn = fn;
}

export function scrollToAppSection(sectionId: string) {
  const run = () => {
    const el = document.getElementById(sectionId);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.remove(HIGHLIGHT_CLASS);
    void el.offsetWidth;
    el.classList.add(HIGHLIGHT_CLASS);
    window.setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), 2600);
    return true;
  };
  if (run()) return;
  window.setTimeout(() => run(), 200);
}

export function goToApiErrorTarget(target: ApiErrorTarget) {
  if (navigateFn) {
    navigateFn(target.route, target.sectionId);
    return;
  }
  const hash = target.sectionId ? `#${target.sectionId}` : '';
  window.location.assign(`${target.route}${hash}`);
}
