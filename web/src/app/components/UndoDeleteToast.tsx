import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Button } from './ui/button';

type Props = {
  message: string;
  durationMs: number;
  onUndo: () => void;
};

/** Toast xóa có hoàn tác: đếm ngược + thanh tiến trình. */
export function UndoDeleteToast({ message, durationMs, onUndo }: Props) {
  const [remainingMs, setRemainingMs] = useState(durationMs);

  useEffect(() => {
    const started = Date.now();
    let raf = 0;
    const tick = () => {
      const left = Math.max(0, durationMs - (Date.now() - started));
      setRemainingMs(left);
      if (left > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);

  const secs = Math.max(1, Math.ceil(remainingMs / 1000));
  const progress = durationMs > 0 ? (remainingMs / durationMs) * 100 : 0;

  return (
    <div className="w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur-md overflow-hidden">
      <div className="flex items-center gap-3 px-3.5 pt-3 pb-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white leading-snug truncate">{message}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
            Xóa hoàn toàn sau {secs}s
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 border-border h-8 gap-1.5 font-medium"
          onClick={onUndo}
        >
          <Undo2 className="w-3.5 h-3.5" />
          Hoàn tác
        </Button>
      </div>
      <div className="h-1 w-full bg-primary/15">
        <div
          className="h-full bg-primary transition-[width] duration-75 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
