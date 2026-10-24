# India's DPDP Act 2023: what the platform does and what is left to you

This maps the obligations of the Digital Personal Data Protection Act, 2023 (and its Rules) to features of the
platform. It is an engineering note, not legal advice: have counsel confirm it against the Rules in force on the day
you go live.

**Roles.** Each organisation (a school, college or company using the platform) is the _data fiduciary_ for its
learners' and staff's data; the platform operator is its _data processor_. The features below give the
organisation what it needs to meet its duties. Duties that are about people and filings are listed under "Process,
not code".

## Obligations and features

| Obligation                                                                                             | Section    | Feature                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Where                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notice in plain language, with consent asked for specified purposes                                    | 5, 6       | Each organisation defines its **consent purposes** (key, title, plain-language description, required or optional, lawful-basis note for the administrator). People see only the active ones.                                                                                                                                                                                                                                                                                                                                                      | `GET/PUT /api/v1/privacy/consent-purposes`, `GET /api/v1/privacy/consents`                                                                                                            |
| Consent is free, specific, informed and unambiguous; the person can withdraw as easily as they gave it | 6(1), 6(4) | One call grants, one call withdraws, effective at once. A required purpose can be withdrawn too: the answer says what follows, and nothing is erased on the person's behalf.                                                                                                                                                                                                                                                                                                                                                                      | `POST /privacy/consents/:key/grant`, `/withdraw`                                                                                                                                      |
| Proof of consent                                                                                       | 6(10)      | Append-only **consent history**: every answer with the purpose's version and the exact wording shown. The runtime database role can only read and insert; UPDATE and DELETE are revoked (as for the audit trail). Who, from which IP and with which browser is in the audit trail (`CONSENT_GRANTED`, `CONSENT_WITHDRAWN`). A new wording raises the version, and answers to an older wording show as outdated so you can ask again.                                                                                                              | `ConsentRecord`, audit trail                                                                                                                                                          |
| Consent reporting                                                                                      | 6          | Counts per purpose and version: granted, withdrawn, never answered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `GET /privacy/consents/report`                                                                                                                                                        |
| Right to access information about personal data                                                        | 11         | The personal-data export (self-serve, or attached to a fulfilled access request) now includes the person's consent history and guardian status.                                                                                                                                                                                                                                                                                                                                                                                                   | `GET /privacy/me/export`, data-subject request queue                                                                                                                                  |
| Right to correction and erasure; right to nominate                                                     | 12, 14     | Data-subject request queue (30-day deadline, assignment, fulfil or reject with a reason, reminders), erasure that anonymises the person.                                                                                                                                                                                                                                                                                                                                                                                                          | `/api/v1/privacy/requests`                                                                                                                                                            |
| Grievance redressal: a contact and a response time                                                     | 8(10), 13  | The organisation names a **grievance officer** (name, e-mail, phone, address) and its response time in days; the notice is public so it can be linked from the login page and footer.                                                                                                                                                                                                                                                                                                                                                             | `GET` (public) and `PUT /api/v1/privacy/grievance-officer`                                                                                                                            |
| Reasonable security safeguards                                                                         | 8(5)       | Row-level security, encrypted secrets, audit trail, MFA, backups, monitoring (see `docs/deployment/operations.md`).                                                                                                                                                                                                                                                                                                                                                                                                                               | existing                                                                                                                                                                              |
| Personal-data breach: tell the Data Protection Board and each affected person                          | 8(6)       | **Breach register** with a 72-hour clock from detection. Records categories of data, people affected, severity, containment, owner, when the Board and the people were told. The status moves DETECTED, CONTAINED, NOTIFIED, CLOSED; closing needs a Board notification or a written reason none was needed. A job e-mails the administrators once when fewer than 24 hours are left and once when the deadline passes (`BREACH_JOB_INTERVAL_SECONDS`). Every change is audited.                                                                  | `/api/v1/privacy/breaches`                                                                                                                                                            |
| Erase data when its purpose is served; retention                                                       | 8(7)       | Retention policy per organisation (off by default).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `/api/v1/privacy/retention`                                                                                                                                                           |
| Children: verifiable parental consent; no tracking or behavioural monitoring of children               | 9          | A person can be marked **under 18** (by an administrator, or declared by the person; only an administrator can clear it). A minor cannot grant any consent until a guardian has confirmed: the guardian receives a single-use link (only its hash is stored, valid 7 days, three requests a day) on the organisation's own address and confirms on a page there. Proctoring events (camera, microphone, snapshots, tab switches, copy-paste), xAPI statements and at-risk analytics for a minor without guardian consent are refused or left out. | `PUT /privacy/me/minor`, `PUT /privacy/users/:id/minor`, `POST /privacy/me/guardian-consent`, `POST /privacy/users/:id/guardian-consent`, public `GET/POST /privacy/guardian-consent` |

## What erasure keeps, and why

Erasing a person anonymises the account (name, e-mail, sign-in, uploads, free text) and removes a minor's guardian
address and pending guardian links. It **keeps** their rows in the consent history. Those rows hold no contact
details: only the anonymised user id, the purpose key and version, the wording, whether it was granted or withdrawn,
and the date. They are the organisation's evidence of what the person agreed to and withdrew, retained to establish,
exercise or defend legal claims (DPDP Act s.8(7) and the Rules; GDPR Art. 7(1) and 17(3)(e)). They are removed with
the organisation when it is deleted. The audit trail keeps user id, IP and user agent as before.

## Current limits

- **Guardian withdrawal.** The confirmation e-mail carries a signed withdrawal link (`/guardian-consent/withdraw`). Withdrawing clears the
  guardian consent and withdraws every purpose the minor had agreed to. An administrator can also clear the under-18 mark.
- **Age.** There is no date of birth: "under 18" is a flag set by an administrator or the person. Registration does not
  ask for age yet. An integration with the organisation's student records can set the flag in bulk through the API.
- **Tracking of minors.** Until a guardian has consented, a minor is left out of all behavioural tracking: every proctoring event
  (camera, microphone, snapshots, tab switches, copy-paste, full-screen exits) is refused (403), no xAPI learning-activity
  statements are stored, and the person is left out of the at-risk analytics. The Rules exempt educational institutions for
  educational purposes and safety; if the organisation relies on that exemption, this is stricter than the law requires and
  can be relaxed in `lib/guardian.ts` (`minorMonitoringBlocked`), `lib/xapi.ts` and `lib/risk.ts`.
- **Consent gate.** The web app asks for the required purposes at first sign-in and has a public privacy notice. There is still no registration step that asks for age.
- **Breach e-mails to people.** `POST /privacy/breaches/:id/notify-people` e-mails the notice (what happened, data involved, when,
  what was done, plus the consequences, advice and contact the administrator writes) to everyone with an active account and to
  minors' guardians, after a dry run that counts recipients. It marks the breach as people-notified, is sent once unless
  `resend` is set, and is audited. Targeting only some people (`audience: USERS`) is available through the API.

## For the web pass (endpoints to build screens on)

- First sign-in / settings: `GET /privacy/consents` (list with status), `POST /privacy/consents/:key/grant|withdraw`
  (show `consequence` when withdrawing a required purpose).
- Administration, Security & compliance: consent purposes editor (`GET/PUT /privacy/consent-purposes`) and report
  (`GET /privacy/consents/report`); breach register (`/privacy/breaches`, with `hoursLeft` and `overdue` for the
  badges); grievance officer form (`PUT /privacy/grievance-officer`); under-18 toggle and "ask guardian" on a person
  (`PUT /privacy/users/:id/minor`, `POST /privacy/users/:id/guardian-consent`).
- Public pages on the organisation's address: a privacy notice showing `GET /privacy/grievance-officer`, and
  `/guardian-consent?token=` calling `GET` (shows organisation and the child's first name) then `POST` to confirm. The
  e-mailed link points at this page.
- Learner: "I am under 18" (`PUT /privacy/me/minor`) with a guardian e-mail form (`POST /privacy/me/guardian-consent`).

## Process, not code

These are for the organisation and the operator, and no feature substitutes for them.

1. **Appoint and publish a grievance officer.** Set it under Security & compliance, and link the public notice.
2. **Registration with the Data Protection Board and breach filings.** When a breach occurs the Board is told through
   its channel (the Rules require an initial notice without delay and a detailed report within 72 hours). The register
   tracks the deadline; filing is a person's job. Keep a template and an on-call owner.
3. **Significant Data Fiduciary duties** (s.10), if the Government notifies an organisation as one: a Data Protection
   Officer based in India, an independent data auditor, periodic data protection impact assessments. A large
   university or a platform operator processing many people's data is a plausible candidate; monitor notifications.
4. **Cross-border transfers** (s.16). Transfers are allowed except to countries the Government restricts. Check where
   the database, backups (`BACKUP_S3_*`), e-mail, AI providers, Copyleaks, LiveKit and Turnstile run, and keep
   `Tenant.dataRegion` honest. Contracts with processors should bind them to the same safeguards.
5. **Processor agreement.** A data processing agreement between each organisation and the operator.
6. **Retention schedule.** Decide per data class how long it is kept (the retention policy implements the choices for
   notifications, tokens, proctoring evidence, support passes, infected uploads). Grades, certificates and submissions
   are academic records governed by the institution's own rules: set that period in writing.
7. **Verifiable parental consent** beyond a link in an e-mail, if your regulator expects stronger verification
   (e.g. identity checks through the school). The platform records who confirmed and when; it does not verify who they are.
8. **Staff training, access reviews, an incident runbook, and a penetration test** before launch (`docs/deployment/operations.md`).
