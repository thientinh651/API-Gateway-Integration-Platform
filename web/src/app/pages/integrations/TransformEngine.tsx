import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, GitMerge, Play, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchSnapshotRecords,
  fetchTransformProfile,
  previewTransform,
  syncContactSfToZoho,
  type SnapshotContactRow,
} from '../../../lib/api';
import { formatApiErrorToast, isMissingBackendApi, toastApiError } from '../../../lib/apiClientError';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

type Props = {
  isAdmin: boolean;
  sfConnected: boolean;
  zohoConnected: boolean;
  sfSyncKey?: string | null;
};

type TransformPanels = {
  sfIn: Record<string, unknown> | null;
  canonical: Record<string, unknown> | null;
  zohoOut: Record<string, unknown> | null;
};

function snapshotToSfPayload(contact: SnapshotContactRow): Record<string, unknown> {
  const parts = (contact.name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.slice(1).join(' ');
  const out: Record<string, unknown> = {};
  if (contact.id?.trim()) out.Id = contact.id.trim();
  if (first) out.FirstName = first;
  if (last) out.LastName = last;
  if (contact.email?.trim()) out.Email = contact.email.trim();
  return out;
}

function canonicalToZohoTask(canonical: Record<string, unknown>): Record<string, unknown> {
  const name = String(canonical.name ?? '').trim() || 'Contact';
  const email = String(canonical.email ?? '').trim();
  const phone = String(canonical.phone ?? '').trim();
  return {
    name,
    description: `email: ${email || '—'} | phone: ${phone || '—'}`,
  };
}

function panelJson(data: Record<string, unknown> | null) {
  return data ? JSON.stringify(data, null, 2) : '—';
}

function looksLikeSfContactId(id: string) {
  return id.trim().startsWith('003');
}

export function TransformEngine({ isAdmin, sfConnected, zohoConnected, sfSyncKey }: Props) {
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [panels, setPanels] = useState<TransformPanels>({
    sfIn: null,
    canonical: null,
    zohoOut: null,
  });
  const [sfContactId, setSfContactId] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileUnavailable, setProfileUnavailable] = useState(false);
  const [contacts, setContacts] = useState<SnapshotContactRow[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  const loadContacts = useCallback(async () => {
    if (!sfConnected) {
      setContacts([]);
      return;
    }
    setContactsLoading(true);
    try {
      const res = await fetchSnapshotRecords('salesforce', 'contact');
      setContacts(res.records.filter((c) => c.id?.trim()));
    } catch {
      setContacts([]);
    } finally {
      setContactsLoading(false);
    }
  }, [sfConnected]);

  const load = useCallback(async (opts?: { toast?: boolean }) => {
    setLoading(true);
    setProfileError(null);
    try {
      await fetchTransformProfile();
      setProfileUnavailable(false);
    } catch (e) {
      const msg = formatApiErrorToast(e);
      setProfileError(msg);
      const missing = isMissingBackendApi(e);
      if (missing) setProfileUnavailable(true);
      if (opts?.toast && !missing) toastApiError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({ toast: false });
  }, [load]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts, sfSyncKey]);

  const resolveSnapshotContact = () => {
    const id = sfContactId.trim();
    if (!id) return null;
    return contacts.find((c) => c.id === id) ?? null;
  };

  const runPreview = async () => {
    if (profileUnavailable) return;
    const contact = resolveSnapshotContact();
    if (!contact) {
      toast.error('Chọn Contact từ Snapshot');
      return;
    }
    const payload = snapshotToSfPayload(contact);
    if (Object.keys(payload).length === 0) {
      toast.error('Contact không có dữ liệu');
      return;
    }
    setPreviewing(true);
    try {
      const res = await previewTransform({
        provider: 'salesforce',
        entity: 'contact',
        payload,
      });
      const canonical = res.canonical as Record<string, unknown>;
      setPanels({
        sfIn: payload,
        canonical,
        zohoOut: canonicalToZohoTask(canonical),
      });
      toast.success('OK');
    } catch (e) {
      if (isMissingBackendApi(e)) {
        setProfileUnavailable(true);
        setProfileError(formatApiErrorToast(e));
      } else {
        toastApiError(e);
      }
    } finally {
      setPreviewing(false);
    }
  };

  const runSync = async () => {
    const contactId = sfContactId.trim();
    if (!contactId) {
      toast.error('Contact Id');
      return;
    }
    if (!looksLikeSfContactId(contactId)) {
      toast.error('Contact Id sai (cần 003...)');
      return;
    }
    setSyncing(true);
    try {
      const res = await syncContactSfToZoho({ salesforce_contact_id: contactId });
      const sfRaw = (res.salesforce as { raw?: Record<string, unknown> } | undefined)?.raw ?? null;
      const canonical = res.canonical as Record<string, unknown>;
      const zohoReq = (res.zoho as { request?: Record<string, unknown> } | undefined)?.request ?? null;
      setPanels({
        sfIn: sfRaw,
        canonical,
        zohoOut: zohoReq ?? canonicalToZohoTask(canonical),
      });
      toast.success('OK');
    } catch (e) {
      if (isMissingBackendApi(e)) {
        setProfileError(formatApiErrorToast(e));
      } else {
        toastApiError(e);
      }
    } finally {
      setSyncing(false);
    }
  };

  const previewReady = Boolean(resolveSnapshotContact());

  return (
    <Card className="p-5 sm:p-6 bg-card/80 border-border space-y-4 scroll-mt-24" id="section-transform-engine">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-white">Transformation Engine</h3>
        <Button type="button" variant="outline" size="sm" onClick={() => void load({ toast: true })} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {profileError ? <p className="text-xs text-amber-400">{profileError}</p> : null}

      <div className="grid gap-3 lg:grid-cols-3 text-sm">
        <div className="rounded-lg border border-border p-3">
          <p className="text-[10px] font-medium uppercase text-muted-foreground mb-2">Salesforce</p>
          <pre className="text-xs text-slate-300 overflow-x-auto">{panelJson(panels.sfIn)}</pre>
        </div>
        <div className="flex items-center justify-center text-muted-foreground">
          <ArrowRight className="w-5 h-5" />
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-[10px] font-medium uppercase text-muted-foreground mb-2">Canonical</p>
          <pre className="text-xs text-slate-300 overflow-x-auto">{panelJson(panels.canonical)}</pre>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="text-[10px] font-medium uppercase text-muted-foreground mb-2">Zoho Projects</p>
        <pre className="text-xs text-slate-300 overflow-x-auto">{panelJson(panels.zohoOut)}</pre>
      </div>

      <Button
        type="button"
        size="sm"
        onClick={() => void runPreview()}
        disabled={!isAdmin || previewing || profileUnavailable || !previewReady}
      >
        <Play className="w-4 h-4 mr-1" />
        Preview
      </Button>

      <div className="border-t border-border pt-4 flex flex-col sm:flex-row gap-2 sm:items-end max-w-xl">
        <div className="flex-1 min-w-0 space-y-2">
          <Label htmlFor="sf-contact-id" className="text-xs text-muted-foreground">
            Contact Id
          </Label>
          {sfConnected && contacts.length > 0 ? (
            <select
              className="w-full h-9 rounded-md border border-border bg-input text-foreground text-xs px-2 font-mono"
              value=""
              disabled={!isAdmin || contactsLoading}
              onChange={(e) => {
                const id = e.target.value;
                if (id) {
                  setSfContactId(id);
                  setPanels({ sfIn: null, canonical: null, zohoOut: null });
                }
              }}
            >
              <option value="">{contactsLoading ? '…' : 'Snapshot'}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ? `${c.name} · ` : ''}
                  {c.id}
                </option>
              ))}
            </select>
          ) : null}
          <Input
            id="sf-contact-id"
            value={sfContactId}
            onChange={(e) => {
              setSfContactId(e.target.value);
              setPanels({ sfIn: null, canonical: null, zohoOut: null });
            }}
            disabled={!isAdmin}
            placeholder="003…"
            className="font-mono text-xs"
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => void runSync()}
          disabled={!isAdmin || syncing || !sfConnected || !zohoConnected}
        >
          {syncing ? '…' : 'Sync'}
        </Button>
      </div>
    </Card>
  );
}
