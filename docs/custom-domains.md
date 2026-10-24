# Custom domains

Every organisation has an address on the platform, `<slug>.<TENANT_BASE_DOMAIN>` (or `APP_URL` on a
single-organisation install). It can also use a domain of its own, such as `learn.university.edu`. A custom
domain only works once the organisation has proved it controls the domain's DNS.

## How it works

1. An administrator of the organisation (Administration → Organisation → Custom domain), or the platform
   operator for any organisation (platform console → Organisations → Domain), enters the domain.
2. The domain now **waits for verification** (`Tenant.pendingCustomDomain`). It never resolves to the
   organisation while it waits, and the platform will not get a certificate for it.
3. The organisation adds a DNS TXT record (the admin panel shows the exact values, with copy buttons):

   | Type | Name                               | Value                |
   | ---- | ---------------------------------- | -------------------- |
   | TXT  | `_lms-verify.learn.university.edu` | `lms-verify=<token>` |

4. They press **Check now** (`POST /api/v1/admin/custom-domain/verify`). When the record is found the domain
   becomes **live** (`Tenant.customDomain`): requests on that host belong to the organisation, links in e-mails
   use it, and SSO redirect URIs on it are accepted. When it is not found, the reason is shown (no record, a
   different value, a DNS timeout) and the domain keeps waiting.
5. They point the domain at the platform with a CNAME record to `CUSTOM_DOMAIN_TARGET` (e.g.
   `tenants.lms.example.com`). The check reports whether this is done, as a hint only: verification needs just
   the TXT record, so the record can be proved before traffic is moved.

Changing to a new domain keeps the old one live until the new one verifies. Removing the custom domain takes
effect straight away; the organisation's platform address always keeps working. Every request, verification,
cancellation and removal is in the organisation's audit trail (and the operator's, when the operator acted):
`CUSTOM_DOMAIN_REQUESTED`, `CUSTOM_DOMAIN_VERIFIED`, `CUSTOM_DOMAIN_REQUEST_CANCELLED`, `CUSTOM_DOMAIN_REMOVED`.

Rules:

- Domains under `TENANT_BASE_DOMAIN`, the base domain itself and the platform's own hosts (`APP_URL`,
  `API_PUBLIC_URL`, `SCORM_CONTENT_ORIGIN`, ...) are refused. Hosts under the base domain are only ever matched
  by subdomain.
- A domain live at one organisation cannot be asked for by another (409); the platform operator can remove it
  first. A domain another organisation is verifying is refused for a week; after a week unverified, a new
  request takes it over (`CUSTOM_DOMAIN_REQUEST_LAPSED` in the first organisation's trail).
- "Check now" is limited to 20 checks per person per 10 minutes. DNS lookups time out after
  `CUSTOM_DOMAIN_DNS_TIMEOUT_MS` (default 5 s).
- A domain is verified once. Removing the TXT record afterwards does not take the domain away; the record can
  be deleted, or kept for a later re-check.
- Organisations created by the operator with a custom domain start with it waiting, like any other request.
- Domains that were set before verification existed were kept live (the migration
  `20261102000000_custom_domain_verification` marks them verified).

## Configuration

| Variable                       |                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `CUSTOM_DOMAIN_TARGET`         | Host organisations point their CNAME at, shown in the admin panel. Optional. |
| `TLS_ASK_SECRET`               | Turns on `GET /internal/tls/allowed` (below). At least 16 characters.        |
| `CUSTOM_DOMAIN_DNS_TIMEOUT_MS` | One DNS lookup's timeout, default 5000.                                      |

## TLS certificates (Caddy on-demand TLS)

Custom domains cannot be listed in a proxy configuration in advance, so the reverse proxy gets certificates
on demand. Before it asks a CA for a certificate for a new host, Caddy asks the API whether the host is one
of ours:

```
GET /internal/tls/allowed?domain=<host>
```

- **200** for a verified custom domain, or `<slug>.<TENANT_BASE_DOMAIN>` of an existing organisation that is
  not archived (suspended organisations keep theirs, so people see why they cannot sign in).
- **404** for anything else: pending domains, unknown hosts, archived organisations. Also for everything when
  `TLS_ASK_SECRET` is not set.
- **403** without the right secret, sent as the `X-TLS-Ask-Secret` header or the `secret` query parameter
  (Caddy's `ask` can only send the query parameter). Limited to 300 requests a minute per address.

It is outside `/api/v1` and is meant for the proxy only: call it on the internal network, and make the public
site answer 404 for `/internal/*` so the secret is never needed from outside.

```caddyfile
{
	# Caddy adds ?domain=<host> to this URL.
	on_demand_tls {
		ask http://api:4000/internal/tls/allowed?secret={$TLS_ASK_SECRET}
	}
}

# The platform's own hosts: ordinary certificates.
lms.example.com, api.lms.example.com {
	reverse_proxy web:3000
}

# Organisation subdomains and custom domains: certificates on demand, each one approved by the API.
https:// {
	tls {
		on_demand
	}
	@internal path /internal/*
	respond @internal 404
	reverse_proxy web:3000
}
```

`tenants.lms.example.com` (the `CUSTOM_DOMAIN_TARGET`) should resolve to this proxy. Set `TRUST_PROXY` so the
API believes the `X-Forwarded-Host` the proxy and the web app pass on, which is how it tells organisations apart.
