import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button } from '../ui/button';

const SCROLL_THRESHOLD = 280;

type ScrollToTopButtonProps = {
  scrollRoot: RefObject<HTMLElement | null>;
  threshold?: number;
};

export function ScrollToTopButton({ scrollRoot, threshold = SCROLL_THRESHOLD }: ScrollToTopButtonProps) {
  const [visible, setVisible] = useState(false);
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;

  useEffect(() => {
    const el = scrollRoot.current;
    if (!el) return;
    const onScroll = () => setVisible(el.scrollTop > thresholdRef.current);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRoot]);

  if (!visible) return null;

  return (
    <Button
      type="button"
      size="icon"
      aria-label="Lên đầu trang"
      onClick={() => {
        const el = scrollRoot.current;
        if (!el) return;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      }}
      className="fixed bottom-6 right-6 z-30 h-11 w-11 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:bg-primary/90"
    >
      <ArrowUp className="w-5 h-5" />
    </Button>
  );
}
