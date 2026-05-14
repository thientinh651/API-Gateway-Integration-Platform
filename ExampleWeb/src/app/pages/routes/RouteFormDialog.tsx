import type { Dispatch, SetStateAction } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Plus } from 'lucide-react';
import type { UiRoute } from './routeTypes';

export type RouteFormState = {
  method: string;
  path: string;
  upstream: string;
  timeout: string;
  rateLimit: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingRoute: UiRoute | null;
  formData: RouteFormState;
  setFormData: Dispatch<SetStateAction<RouteFormState>>;
  onSubmit: () => void;
};

export function RouteFormDialog({
  open,
  onOpenChange,
  editingRoute,
  formData,
  setFormData,
  onSubmit,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-primary hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" />
          Thêm Route
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-white">
            {editingRoute ? 'Chỉnh sửa Route' : 'Tạo Route mới'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label className="text-foreground">HTTP Method</Label>
            <Select value={formData.method} onValueChange={(v) => setFormData((p) => ({ ...p, method: v }))}>
              <SelectTrigger className="bg-input border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
                <SelectItem value="PATCH">PATCH</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-foreground">Path</Label>
            <Input
              placeholder="/api/example"
              value={formData.path}
              onChange={(e) => setFormData((p) => ({ ...p, path: e.target.value }))}
              className="bg-input border-border text-foreground"
            />
          </div>
          <div>
            <Label className="text-foreground">Upstream URL</Label>
            <Input
              placeholder="http://localhost:3000/endpoint"
              value={formData.upstream}
              onChange={(e) => setFormData((p) => ({ ...p, upstream: e.target.value }))}
              className="bg-input border-border text-foreground"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-foreground">Timeout (s)</Label>
              <Input
                type="number"
                value={formData.timeout}
                onChange={(e) => setFormData((p) => ({ ...p, timeout: e.target.value }))}
                className="bg-input border-border text-foreground"
              />
            </div>
            <div>
              <Label className="text-foreground">Rate Limit (req/min)</Label>
              <Input
                type="number"
                value={formData.rateLimit}
                onChange={(e) => setFormData((p) => ({ ...p, rateLimit: e.target.value }))}
                className="bg-input border-border text-foreground"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <Button onClick={onSubmit} className="flex-1 bg-primary hover:bg-primary/90">
              {editingRoute ? 'Cập nhật' : 'Tạo'}
            </Button>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 border-border"
            >
              Hủy
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
