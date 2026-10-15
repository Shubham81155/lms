"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, Copy, KeyRound, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAction, useApiData } from "@/hooks/useApiData";
import { daysUntil } from "@/lib/forms";

const input =
  "w-full bg-canvas border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-brand";
const primaryBtn =
  "px-4 py-2 bg-brand hover:bg-brand-hover disabled:opacity-50 text-on-brand rounded-xl text-xs font-bold transition-all";
const ghostBtn =
  "px-3 py-1.5 bg-surface hover:bg-raised border border-line text-ink rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50";

export const Banner: React.FC<{ kind: "error" | "ok"; children: React.ReactNode }> = ({ kind, children }) => (
  <div
    role={kind === "error" ? "alert" : "status"}
    className={`p-3 rounded-xl text-xs border ${
      kind === "error" ? "bg-danger/10 border-danger/30 text-danger" : "bg-success/10 border-success/30 text-success"
    }`}
  >
    {children}
  </div>
);

/** A secret that is shown exactly once, with a copy button. */
export const OnceSecret: React.FC<{ label: string; value: string; onDismiss: () => void }> = ({ label, value, onDismiss }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="p-4 rounded-2xl border border-accent/60 bg-accent/10 space-y-2">
      <div className="text-xs font-bold text-accent">{label}</div>
      <p className="text-[11px] text-accent/80">Copy it now. It cannot be shown again.</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-canvas border border-line rounded-lg px-3 py-2 text-[11px] text-accent break-all select-all">
          {value}
        </code>
        <button
          className={ghostBtn}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              /* clipboard may be unavailable; the value is selectable */
            }
          }}
        >
          <Copy className="h-3.5 w-3.5 inline mr-1" />
          {copied ? "Copied" : "Copy"}
        </button>
        <button className={ghostBtn} onClick={onDismiss}>
          Done
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// OpenID Connect
// ---------------------------------------------------------------------------

interface SsoView {
  issuer: string;
  clientId: string;
  enabled: boolean;
  allowedDomains: string[];
  hasSecret: boolean;
  redirectUris: string[];
}

export const SsoPanel: React.FC<{ available: boolean }> = ({ available }) => {
  const { data, isLoading, error, reload } = useApiData<{ data: SsoView | null; redirectUris: string[] }>("/api/v1/admin/sso");
  const { busy, error: actionError, run, clearError } = useAction();
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [domains, setDomains] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState(false);

  const conn = data?.data ?? null;
  useEffect(() => {
    if (conn) {
      setIssuer(conn.issuer);
      setClientId(conn.clientId);
      setDomains(conn.allowedDomains.join(", "));
      setEnabled(conn.enabled);
    }
  }, [conn]);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    run(async () => {
      await api.put("/api/v1/admin/sso", {
        issuer: issuer.trim(),
        clientId: clientId.trim(),
        enabled,
        allowedDomains: domains.split(/[\s,]+/).filter(Boolean),
        ...(clientSecret ? { clientSecret } : {}),
      });
      setClientSecret("");
      setSaved(true);
      await reload();
    });
  };

  const remove = () => {
    if (!window.confirm("Remove the single sign-on connection? Users will sign in with their passwords.")) return;
    run(async () => {
      await api.delete("/api/v1/admin/sso");
      setIssuer("");
      setClientId("");
      setDomains("");
      setEnabled(false);
      await reload();
    });
  };

  return (
    <section className="space-y-4" aria-labelledby="sso-heading">
      <div>
        <h3 id="sso-heading" className="font-bold text-base text-ink">OpenID Connect sign-in</h3>
        <p className="text-xs text-ink-muted">
          Let people sign in with your identity provider (Okta, Microsoft Entra ID, Google Workspace and others).
          Accounts must already exist; sign-in never creates them.
        </p>
      </div>

      {!available && <Banner kind="error">Single sign-on is not included in this organisation's plan.</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      {actionError && <Banner kind="error">{actionError}</Banner>}
      {saved && <Banner kind="ok">Settings saved.</Banner>}

      <div className="text-[11px] text-ink-muted bg-canvas border border-line rounded-xl p-3 space-y-1">
        <div>
          Register {(data?.redirectUris?.length ?? 0) > 1 ? "all of these redirect URIs" : "this redirect URI"} at your provider
          {(data?.redirectUris?.length ?? 0) > 1 ? " (people sign in from either address)" : ""}:
        </div>
        {(data?.redirectUris ?? []).map((u) => (
          <code key={u} className="block text-brand-fg select-all break-all">{u}</code>
        ))}
        {!data && <span>…</span>}
      </div>

      <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-4" onChange={clearError}>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          Issuer URL
          <input className={input} type="url" required placeholder="https://login.example.com" value={issuer} onChange={(e) => setIssuer(e.target.value)} disabled={!available} />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          Client ID
          <input className={input} required value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!available} />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          Client secret
          <input
            className={input}
            type="password"
            autoComplete="new-password"
            required={!conn}
            placeholder={conn?.hasSecret ? "Leave blank to keep the current secret" : ""}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={!available}
          />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          Allowed e-mail domains (optional)
          <input className={input} placeholder="university.edu, partner.org" value={domains} onChange={(e) => setDomains(e.target.value)} disabled={!available} />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink md:col-span-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!available} className="rounded border-line bg-canvas text-brand-fg" />
          Enable single sign-on on the login page
        </label>
        <div className="md:col-span-2 flex items-center gap-3">
          <button className={primaryBtn} disabled={busy || isLoading || !available}>{busy ? "Saving…" : "Save"}</button>
          {conn && (
            <button type="button" className={ghostBtn} onClick={remove} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5 inline mr-1" />
              Remove connection
            </button>
          )}
          {conn?.enabled && (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> Active
            </span>
          )}
        </div>
      </form>
    </section>
  );
};

// ---------------------------------------------------------------------------
// SCIM provisioning tokens
// ---------------------------------------------------------------------------

interface ScimToken {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}

export const ScimPanel: React.FC<{ available: boolean }> = ({ available }) => {
  const { data, error, reload } = useApiData<{ data: ScimToken[] }>("/api/v1/admin/scim-tokens");
  const { busy, error: actionError, run } = useAction();
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api.post<{ data: { token: string } }>("/api/v1/admin/scim-tokens", { label: label.trim() });
      setFresh(r.data.token);
      setLabel("");
      await reload();
    });
  };

  const revoke = (t: ScimToken) => {
    if (!window.confirm(`Revoke "${t.label}"? The directory sync using it will stop working.`)) return;
    run(async () => {
      await api.delete(`/api/v1/admin/scim-tokens/${t.id}`);
      await reload();
    });
  };

  const base = typeof window !== "undefined" ? `${window.location.origin}/api/v1/scim/v2` : "/api/v1/scim/v2";

  return (
    <section className="space-y-4" aria-labelledby="scim-heading">
      <div>
        <h3 id="scim-heading" className="font-bold text-base text-ink">SCIM user provisioning</h3>
        <p className="text-xs text-ink-muted">
          Your directory creates, updates and deactivates accounts automatically. SCIM never changes administrator accounts.
        </p>
      </div>

      {!available && <Banner kind="error">SCIM is not included in this organisation's plan.</Banner>}
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}
      <div className="text-[11px] text-ink-muted bg-canvas border border-line rounded-xl p-3">
        SCIM base URL: <code className="text-brand-fg select-all break-all">{base}</code> (authentication: bearer token)
      </div>

      {fresh && <OnceSecret label="New SCIM token" value={fresh} onDismiss={() => setFresh(null)} />}

      <form onSubmit={create} className="flex items-end gap-3">
        <label className="flex-1 space-y-1 text-xs text-ink-muted font-semibold">
          Token label
          <input className={input} required maxLength={100} placeholder="e.g. Okta production" value={label} onChange={(e) => setLabel(e.target.value)} disabled={!available} />
        </label>
        <button className={primaryBtn} disabled={busy || !available || !label.trim()}>
          <KeyRound className="h-3.5 w-3.5 inline mr-1" />
          Create token
        </button>
      </form>

      <ul className="space-y-2">
        {(data?.data ?? []).length === 0 && <li className="text-xs text-ink-subtle">No tokens yet.</li>}
        {(data?.data ?? []).map((t) => (
          <li key={t.id} className="bg-canvas border border-line rounded-xl p-3 flex items-center justify-between text-xs">
            <div>
              <strong className="text-ink">{t.label}</strong>
              <span className="text-ink-subtle ml-2">created {new Date(t.createdAt).toLocaleDateString()}</span>
            </div>
            {t.revokedAt ? (
              <span className="text-ink-subtle">Revoked</span>
            ) : (
              <button className={ghostBtn} onClick={() => revoke(t)} disabled={busy}>Revoke</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

// ---------------------------------------------------------------------------
// SAML 2.0
// ---------------------------------------------------------------------------

interface SamlView {
  entryPoint: string;
  idpIssuer: string;
  emailAttribute: string;
  enabled: boolean;
  allowedDomains: string[];
  keyKind: "CERTIFICATE" | "PUBLIC KEY" | null;
  keyFingerprint: string | null;
  keyExpires: string | null;
}
interface SamlSp {
  entityIds: string[];
  acsUrls: string[];
  metadataUrls: string[];
}

const CopyList: React.FC<{ label: string; values: string[] }> = ({ label, values }) => (
  <div>
    <div className="text-ink-subtle">{label}</div>
    {values.map((v) => (
      <code key={v} className="block text-brand-fg select-all break-all">{v}</code>
    ))}
  </div>
);

export const SamlPanel: React.FC<{ available: boolean }> = ({ available }) => {
  const { data, isLoading, error, reload } = useApiData<{ data: SamlView | null; sp: SamlSp }>("/api/v1/admin/saml");
  const { busy, error: actionError, run, clearError } = useAction();
  const [entryPoint, setEntryPoint] = useState("");
  const [issuer, setIssuer] = useState("");
  const [cert, setCert] = useState("");
  const [emailAttr, setEmailAttr] = useState("email");
  const [domains, setDomains] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saved, setSaved] = useState(false);

  const conn = data?.data ?? null;
  useEffect(() => {
    if (!conn) return;
    setEntryPoint(conn.entryPoint);
    setIssuer(conn.idpIssuer);
    setEmailAttr(conn.emailAttribute);
    setDomains(conn.allowedDomains.join(", "));
    setEnabled(conn.enabled);
  }, [conn]);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(false);
    run(async () => {
      await api.put("/api/v1/admin/saml", {
        entryPoint: entryPoint.trim(),
        idpIssuer: issuer.trim(),
        emailAttribute: emailAttr.trim() || "email",
        enabled,
        allowedDomains: domains.split(/[\s,]+/).filter(Boolean),
        ...(cert.trim() ? { idpCert: cert.trim() } : {}),
      });
      setCert("");
      setSaved(true);
      await reload();
    });
  };

  const remove = () => {
    if (!window.confirm("Remove the SAML connection? People will sign in another way.")) return;
    run(async () => {
      await api.delete("/api/v1/admin/saml");
      setEntryPoint("");
      setIssuer("");
      setDomains("");
      setEnabled(false);
      await reload();
    });
  };

  const left = daysUntil(conn?.keyExpires ?? null);

  return (
    <section className="space-y-4" aria-labelledby="saml-h">
      <div>
        <h3 id="saml-h" className="font-bold text-base text-ink">SAML 2.0 sign-in</h3>
        <p className="text-xs text-ink-muted">
          For identity providers that use SAML (ADFS, Shibboleth, Okta SAML and others). Accounts must already exist; sign-in never creates them.
          Assertions must be signed by the certificate you paste here.
        </p>
      </div>

      {!available && <Banner kind="error">Single sign-on is not included in this organisation's plan.</Banner>}
      {(error || actionError) && <Banner kind="error">{error || actionError}</Banner>}
      {saved && <Banner kind="ok">Settings saved.</Banner>}
      {left !== null && left < 0 && <Banner kind="error">The pinned certificate has expired. Sign-in will fail until you paste the new one.</Banner>}
      {left !== null && left >= 0 && left <= 30 && <Banner kind="error">The pinned certificate expires in {left} day(s). Ask your identity provider for the new one and paste it before then.</Banner>}

      <div className="text-[11px] text-ink-muted bg-canvas border border-line rounded-xl p-3 space-y-2">
        <div>Give these to your identity provider (or import the metadata URL):</div>
        <CopyList label="Entity ID (audience)" values={data?.sp.entityIds ?? []} />
        <CopyList label="Assertion consumer service URL (HTTP-POST)" values={data?.sp.acsUrls ?? []} />
        <CopyList label="Metadata URL" values={data?.sp.metadataUrls ?? []} />
        {(data?.sp.entityIds.length ?? 0) > 1 && <div className="text-ink-subtle">People can sign in from either address, so register both.</div>}
      </div>

      <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-4" onChange={() => { clearError(); setSaved(false); }}>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          Identity provider sign-in URL
          <input className={input} type="url" required placeholder="https://idp.example.com/sso" value={entryPoint} onChange={(e) => setEntryPoint(e.target.value)} disabled={!available} />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          Identity provider entity ID (issuer)
          <input className={input} required value={issuer} onChange={(e) => setIssuer(e.target.value)} disabled={!available} />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold md:col-span-2">
          Signing certificate (PEM, or the base64 from the provider's metadata)
          <textarea
            className={`${input} font-mono`}
            rows={4}
            required={!conn}
            placeholder={conn ? "Leave blank to keep the pinned certificate" : "-----BEGIN CERTIFICATE-----"}
            value={cert}
            onChange={(e) => setCert(e.target.value)}
            disabled={!available}
          />
        </label>
        {conn?.keyFingerprint && (
          <p className="md:col-span-2 text-[11px] text-ink-subtle">
            Pinned {conn.keyKind === "CERTIFICATE" ? "certificate" : "public key"} SHA-256: <span className="font-mono text-ink break-all">{conn.keyFingerprint}</span>
            {conn.keyExpires ? ` · expires ${new Date(conn.keyExpires).toLocaleDateString()}` : ""}
          </p>
        )}
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          E-mail attribute
          <input className={input} value={emailAttr} onChange={(e) => setEmailAttr(e.target.value)} disabled={!available} />
        </label>
        <label className="space-y-1 text-xs text-ink-muted font-semibold">
          Allowed e-mail domains (optional)
          <input className={input} placeholder="university.edu, partner.org" value={domains} onChange={(e) => setDomains(e.target.value)} disabled={!available} />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink md:col-span-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!available} className="rounded border-line bg-canvas text-brand-fg" />
          Enable SAML sign-in on the login page
        </label>
        <div className="md:col-span-2 flex items-center gap-3">
          <button className={primaryBtn} disabled={busy || isLoading || !available}>{busy ? "Saving…" : "Save"}</button>
          {conn && (
            <button type="button" className={ghostBtn} onClick={remove} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5 inline mr-1" />
              Remove connection
            </button>
          )}
          {conn?.enabled && (
            <span className="text-xs text-success flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" /> Active
            </span>
          )}
        </div>
      </form>
    </section>
  );
};
