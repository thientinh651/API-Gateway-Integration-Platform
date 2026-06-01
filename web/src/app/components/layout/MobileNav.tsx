import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '../ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '../ui/sheet';
import { SidebarNav } from './SidebarNav';

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="lg:hidden shrink-0 border-border h-10 w-10 touch-manipulation"
          aria-label="Mở menu điều hướng"
        >
          <Menu className="w-5 h-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[min(100vw-2rem,18rem)] p-0 bg-slate-950 border-border gap-0 [&>button]:text-slate-300 tech-grid-bg"
      >
        <SheetTitle className="sr-only">Menu điều hướng</SheetTitle>
        <SidebarNav onNavigate={() => setOpen(false)} className="pt-2" />
      </SheetContent>
    </Sheet>
  );
}
