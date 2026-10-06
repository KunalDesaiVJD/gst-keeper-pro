// The client's registration facts a reply needs (audit U-56-3): legal and trade
// name, constitution, jurisdiction, registration date and certificate from the
// portal profile, beside the firm's own record (owner, portal user ID, contact).
// The four panels the portal sync never fills are gone; a missing profile says
// so and offers to fetch it.
import React from 'react';
import { DownloadCloud, ExternalLink } from 'lucide-react';
import { SectionCard } from '@/components/gstr9/ui';
import { Button } from '@/components/ui/button';
import { WS_BTN } from '@/components/workspace/theme';
import { fmtAgo, fmtDate } from '@/lib/noticeFormat';
import type { ClientExtras, ClientRecord, TaxpayerProfile } from './profileData';

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words text-sm">{children}</dd>
  </>
);

export const ClientProfileCard: React.FC<{
  client: ClientRecord;
  extras: ClientExtras | null;
  profile: TaxpayerProfile | null;
  onFetchProfile?: () => void;
  busy?: boolean;
}> = ({ client, extras, profile, onFetchProfile, busy }) => {
  const jurisdiction = [profile?.jurisdiction_state && `State: ${profile.jurisdiction_state}`, profile?.jurisdiction_centre && `Centre: ${profile.jurisdiction_centre}`]
    .filter(Boolean).join(' · ');
  return (
    <SectionCard title="Profile"
      description={profile ? `From the portal, fetched ${fmtAgo(profile.pulled_at)} · and the firm's record` : "The firm's record · the portal profile is not fetched yet"}
      actions={onFetchProfile && (
        <Button size="sm" variant="outline" className={WS_BTN} onClick={onFetchProfile} disabled={busy}>
          <DownloadCloud className="h-3.5 w-3.5" aria-hidden /> {profile ? 'Fetch again' : 'Fetch profile now'}
        </Button>
      )}>
      <dl className="grid grid-cols-[minmax(6.5rem,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <Row label="Legal name">{profile?.legal_name || client.name}</Row>
        {profile?.trade_name && profile.trade_name !== profile.legal_name && <Row label="Trade name">{profile.trade_name}</Row>}
        <Row label="GSTIN"><span className="font-mono text-xs">{client.gstin}</span></Row>
        {profile?.constitution_of_business && <Row label="Constitution">{profile.constitution_of_business}</Row>}
        {extras?.registration_type && <Row label="Taxpayer type">{extras.registration_type}</Row>}
        <Row label="Registered on">{fmtDate(profile?.registration_date || client.registration_date)}</Row>
        {jurisdiction && <Row label="Jurisdiction">{jurisdiction}</Row>}
        {profile?.principal_place_address && <Row label="Principal place">{profile.principal_place_address}</Row>}
        {profile?.aadhaar_authentication_status && <Row label="Aadhaar authentication">{profile.aadhaar_authentication_status}</Row>}
        {profile?.registration_certificate_url && (
          <Row label="Certificate">
            <a href={profile.registration_certificate_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
              Registration certificate <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </Row>
        )}
        <Row label="Owner">{client.assigned_accountant || <span className="text-muted-foreground">nobody</span>}</Row>
        <Row label="Portal user ID">{client.gst_user_id || <span className="text-muted-foreground">not set</span>}</Row>
        {(client.email || extras?.mobile) && <Row label="Contact">{[client.email, extras?.mobile].filter(Boolean).join(' · ')}</Row>}
      </dl>
      {!profile && (
        <p className="text-xs text-muted-foreground">Constitution, jurisdiction and the registration certificate come from the portal profile; fetching it takes one CAPTCHA.</p>
      )}
    </SectionCard>
  );
};

export default ClientProfileCard;
