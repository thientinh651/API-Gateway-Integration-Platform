import { useEffect } from 'react';
import { Toaster, type ToasterProps } from 'sonner';

/** Sonner stack: double rAF khi rời chuột — browser transition từ mở → gom mượt. */
export function AppToaster(props: ToasterProps) {
  useEffect(() => {
    let collapseRaf = 0;
    let toaster: Element | null = null;

    const onEnter = () => {
      if (collapseRaf) cancelAnimationFrame(collapseRaf);
      toaster?.classList.remove('avaso-toast-collapsing');
    };

    const onLeave = () => {
      if (!toaster) return;
      toaster.classList.add('avaso-toast-collapsing');
      requestAnimationFrame(() => {
        collapseRaf = requestAnimationFrame(() => {
          toaster?.classList.remove('avaso-toast-collapsing');
        });
      });
    };

    const bind = (el: Element) => {
      if (toaster === el) return;
      toaster?.removeEventListener('mouseenter', onEnter);
      toaster?.removeEventListener('mouseleave', onLeave);
      toaster = el;
      toaster.addEventListener('mouseenter', onEnter);
      toaster.addEventListener('mouseleave', onLeave);
    };

    const existing = document.querySelector('[data-sonner-toaster]');
    if (existing) bind(existing);

    const observer = new MutationObserver(() => {
      const el = document.querySelector('[data-sonner-toaster]');
      if (el) bind(el);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (collapseRaf) cancelAnimationFrame(collapseRaf);
      toaster?.removeEventListener('mouseenter', onEnter);
      toaster?.removeEventListener('mouseleave', onLeave);
      observer.disconnect();
    };
  }, []);

  return (
    <Toaster
      className="avaso-toaster"
      gap={12}
      visibleToasts={4}
      toastOptions={{ duration: 6000, closeButton: true, ...(props.toastOptions ?? {}) }}
      {...props}
    />
  );
}
