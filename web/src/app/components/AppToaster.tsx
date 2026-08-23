import { useEffect } from 'react';
import { Toaster, type ToasterProps } from 'sonner';
import { applySonnerAutoDismiss, TOAST_DURATION_SUCCESS_MS } from '../../lib/sonnerToast';

applySonnerAutoDismiss();

const EXPANDED = 'avaso-toast-expanded';
const COLLAPSING = 'avaso-toast-collapsing';
const LEAVE_MS = 120;

/** Sonner stack: class JS thay :hover — tránh nhảy khi chuột ở viền toast. */
export function AppToaster(props: ToasterProps) {
  useEffect(() => {
    let collapseRaf = 0;
    let leaveTimer = 0;
    let toaster: Element | null = null;

    const setExpanded = (on: boolean) => {
      if (!toaster) return;
      if (on) {
        if (leaveTimer) {
          window.clearTimeout(leaveTimer);
          leaveTimer = 0;
        }
        if (collapseRaf) cancelAnimationFrame(collapseRaf);
        toaster.classList.remove(COLLAPSING);
        toaster.classList.add(EXPANDED);
        return;
      }
      toaster.classList.remove(EXPANDED);
      toaster.classList.add(COLLAPSING);
      requestAnimationFrame(() => {
        collapseRaf = requestAnimationFrame(() => {
          toaster?.classList.remove(COLLAPSING);
        });
      });
    };

    const onOver = (e: Event) => {
      const target = e.target as Element | null;
      if (target?.closest('[data-sonner-toast]')) setExpanded(true);
    };

    const onOut = (e: Event) => {
      const related = (e as MouseEvent).relatedTarget as Node | null;
      if (related && toaster?.contains(related)) return;
      if (leaveTimer) window.clearTimeout(leaveTimer);
      leaveTimer = window.setTimeout(() => setExpanded(false), LEAVE_MS);
    };

    const bind = (el: Element) => {
      if (toaster === el) return;
      toaster?.removeEventListener('mouseover', onOver);
      toaster?.removeEventListener('mouseout', onOut);
      toaster = el;
      toaster.addEventListener('mouseover', onOver);
      toaster.addEventListener('mouseout', onOut);
    };

    const existing = document.querySelector('[data-sonner-toaster]');
    if (existing) bind(existing);

    const observer = new MutationObserver(() => {
      const el = document.querySelector('[data-sonner-toaster]');
      if (el) bind(el);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (leaveTimer) window.clearTimeout(leaveTimer);
      if (collapseRaf) cancelAnimationFrame(collapseRaf);
      toaster?.removeEventListener('mouseover', onOver);
      toaster?.removeEventListener('mouseout', onOut);
      observer.disconnect();
    };
  }, []);

  const { toastOptions, ...rest } = props;

  return (
    <Toaster
      className="avaso-toaster"
      gap={12}
      visibleToasts={4}
      offset={{ top: '1.5rem', right: '2.5rem' }}
      mobileOffset={{ top: '1rem', right: '1.25rem', left: '1.25rem' }}
      {...rest}
      duration={TOAST_DURATION_SUCCESS_MS}
      closeButton
      toastOptions={{
        duration: TOAST_DURATION_SUCCESS_MS,
        closeButton: true,
        ...toastOptions,
      }}
    />
  );
}
