import { useCallback, useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchOpportunityTemplates,
  updateOpportunityTemplates,
  type OpportunityTemplateConfig,
  type OpportunityTemplateRule,
} from '../../../lib/api';
import { toastApiError } from '../../../lib/apiClientError';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

type RuleDraft = OpportunityTemplateRule & {
  keywordsText: string;
  tasksText: string;
};

function linesToText(lines: string[]) {
  return lines.join('\n');
}

function textToLines(text: string) {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function toDraft(config: OpportunityTemplateConfig): {
  enabled: boolean;
  fallbackText: string;
  rules: RuleDraft[];
} {
  return {
    enabled: config.enabled,
    fallbackText: linesToText(config.fallback_tasks),
    rules: config.rules.map((r) => ({
      ...r,
      keywordsText: linesToText(r.keywords),
      tasksText: linesToText(r.tasks),
    })),
  };
}

export function OpportunityTemplates({ isAdmin }: { isAdmin: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [fallbackText, setFallbackText] = useState('Họp triển khai\nKhai báo hạ tầng');
  const [rules, setRules] = useState<RuleDraft[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchOpportunityTemplates();
      const draft = toDraft(res);
      setEnabled(draft.enabled);
      setFallbackText(draft.fallbackText);
      setRules(draft.rules);
      setUpdatedAt(res.updated_at ?? null);
      setUpdatedBy(res.updated_by ?? null);
    } catch (e) {
      toastApiError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchRule = (idx: number, patch: Partial<RuleDraft>) => {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRule = () => {
    const n = rules.length + 1;
    setRules((prev) => [
      ...prev,
      {
        id: `template_${n}`,
        label: `Template ${n}`,
        enabled: true,
        keywords: [],
        tasks: [],
        keywordsText: '',
        tasksText: '',
      },
    ]);
  };

  const removeRule = (idx: number) => {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    const body: OpportunityTemplateConfig = {
      enabled,
      fallback_tasks: textToLines(fallbackText),
      rules: rules.map((r) => ({
        id: r.id.trim(),
        label: r.label.trim(),
        enabled: r.enabled,
        keywords: textToLines(r.keywordsText),
        tasks: textToLines(r.tasksText),
      })),
    };
    if (body.rules.length === 0) {
      toast.error('Cần ít nhất 1 template');
      return;
    }
    if (body.fallback_tasks.length === 0) {
      toast.error('Thiếu fallback task');
      return;
    }
    const invalidRule = body.rules.find((r) => r.keywords.length === 0 || r.tasks.length === 0);
    if (invalidRule) {
      toast.error('Template thiếu keywords hoặc tasks');
      return;
    }
    setSaving(true);
    try {
      const res = await updateOpportunityTemplates(body);
      const draft = toDraft(res);
      setEnabled(draft.enabled);
      setFallbackText(draft.fallbackText);
      setRules(draft.rules);
      setUpdatedAt(res.updated_at ?? null);
      setUpdatedBy(res.updated_by ?? null);
      toast.success('Đã lưu template');
    } catch (e) {
      toastApiError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6 bg-card/80 border-border space-y-4 scroll-mt-24" id="section-opportunity-templates">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">Sales-to-Delivery Templates</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Opportunity Closed Won → chọn template tạo Project + Task tự động.
          </p>
          {updatedAt ? (
            <p className="text-[11px] text-muted-foreground mt-1">
              Cập nhật: {updatedAt}
              {updatedBy ? ` bởi ${updatedBy}` : ''}
            </p>
          ) : null}
        </div>
        {isAdmin ? (
          <Button onClick={() => void save()} disabled={saving || loading}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Đang lưu…' : 'Lưu template'}
          </Button>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Đang tải…</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!isAdmin}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Bật auto template theo gói dịch vụ
          </label>

          <div className="space-y-3">
            {rules.map((r, idx) => (
              <div key={`${r.id}-${idx}`} className="rounded-lg border border-border p-3 space-y-2">
                <div className="grid sm:grid-cols-2 gap-2">
                  <div>
                    <Label>ID</Label>
                    <Input value={r.id} disabled={!isAdmin} onChange={(e) => patchRule(idx, { id: e.target.value })} />
                  </div>
                  <div>
                    <Label>Tên template</Label>
                    <Input
                      value={r.label}
                      disabled={!isAdmin}
                      onChange={(e) => patchRule(idx, { label: e.target.value })}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    disabled={!isAdmin}
                    onChange={(e) => patchRule(idx, { enabled: e.target.checked })}
                  />
                  Kích hoạt template này
                </label>
                <div className="grid sm:grid-cols-2 gap-2">
                  <div>
                    <Label>Keywords match (mỗi dòng 1 từ)</Label>
                    <textarea
                      className="w-full min-h-24 rounded-md border border-border bg-input p-2 text-xs"
                      value={r.keywordsText}
                      disabled={!isAdmin}
                      onChange={(e) => patchRule(idx, { keywordsText: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>Tasks auto-create (mỗi dòng 1 task)</Label>
                    <textarea
                      className="w-full min-h-24 rounded-md border border-border bg-input p-2 text-xs"
                      value={r.tasksText}
                      disabled={!isAdmin}
                      onChange={(e) => patchRule(idx, { tasksText: e.target.value })}
                    />
                  </div>
                </div>
                {isAdmin ? (
                  <Button variant="outline" size="sm" className="border-border" onClick={() => removeRule(idx)}>
                    <Trash2 className="w-4 h-4 mr-1" />
                    Xóa template
                  </Button>
                ) : null}
              </div>
            ))}
          </div>

          {isAdmin ? (
            <Button variant="outline" className="border-border" onClick={addRule}>
              <Plus className="w-4 h-4 mr-2" />
              Thêm template
            </Button>
          ) : null}

          <div>
            <Label>Fallback tasks (không match template)</Label>
            <textarea
              className="w-full min-h-24 rounded-md border border-border bg-input p-2 text-xs mt-1"
              value={fallbackText}
              disabled={!isAdmin}
              onChange={(e) => setFallbackText(e.target.value)}
            />
          </div>
        </>
      )}
    </Card>
  );
}
