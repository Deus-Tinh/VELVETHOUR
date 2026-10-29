# Serenity Spa chatbot architecture audit

## Scope and approach

This audit is based on the checked-in source files and project documentation. The workspace is a working folder rather than a Git checkout: there is no `.git` directory here, so the current branch and Git working tree could not be verified. Existing SQLite files under `server/data/` were inspected only by filename; no live data was changed.

## Existing architecture

- **Frontend:** Vanilla JavaScript ES modules, HTML5, and CSS3. The app uses hash routes and renders pages into `#appRoot`; the current project stylesheet defines the brown/cream visual system and loads Lora and Roboto.
- **Backend:** Node.js 24 HTTP server in `server/server.js`, serving both the static app and `/api/*` routes on port 3001. There is no Express or other web framework.
- **Database:** Node's built-in `node:sqlite` `DatabaseSync`, with the existing `collection_records` JSON record store and small relational tables for sessions, deduplication, invites, and audit logs. There is no ORM or separate migration runner. Safe schema additions belong in the server's additive `CREATE TABLE IF NOT EXISTS` initialization.
- **Authentication:** Hashed server-side session tokens in the `sessions` table, exposed as an `HttpOnly; SameSite=Lax` `serenity.sid` cookie. The API derives user identity and role on the server.
- **Frontend data access:** `apiClient.js` synchronizes the local UI cache with `/api/bootstrap`; `serviceService.js` reads the service collection; `bookingService.js` calculates displayed slots. The server's `assertSlot()` repeats authoritative validation during booking creation.
- **Tests:** Existing Node tests use isolated SQLite files through `SERENITY_DB_PATH`; `npm test` runs the browser-independent business suite and API/auth tests.

## Booking and service flows

- Services, categories, staff, settings, users, bookings, and contacts are records in `collection_records`. Service prices are stored on each service and its duration variants; active services have `active !== false`.
- `GET /api/bootstrap` supplies the current user's permitted collections. `POST /api/bookings` is the existing write path. It requires an authenticated customer/admin, validates contact data, re-reads current service/staff/settings, checks working days and hours, breaks, closed dates, advance limits, staff and room conflicts, snapshots prices, uses a deduplication key, and commits within a transaction.
- Booking statuses `Pending`, `Confirmed`, and `CheckedIn` occupy a slot. Booking queries enforce ownership. The app's booking route is `#/booking?service=<id>` and preserves the existing sign-in gate.
- The UI currently calculates available slots from its synchronized cache, but the server has no public availability endpoint. The chatbot must calculate availability on the server using the same `assertSlot()` rules; final booking still goes through `/api/bookings`, which revalidates it.
- Business settings include the Spa name, address, contact fields, opening/closing times, closed dates, and booking limits. These are the source for chatbot Spa information.

## Existing API and modules to reuse

| Need | Existing source |
|---|---|
| Current services/categories/prices | `/api/bootstrap`, `serviceService.js`, SQLite-backed `services` and `categories` collections |
| Current user/role | `/api/auth/session`, `serenity.sid`, `actorFrom()` |
| Booking creation/cancel/reschedule | `/api/bookings` and existing booking routes/services |
| Booking access rules | `actorFrom()`, `/api/bookings`, owner checks |
| Contact/human support | Existing contact page and `/api/contacts` workflow |
| Spa hours/address | `settings/main` record |
| Brand styles and service images | `assets/css/style.css`, `assets/js/imageManifest.js` |

## Change plan

- Add a small floating launcher to the existing page and dynamically import the chat window code and its stylesheet only when opened.
- Add a browser `chatbotService` wrapper that uses same-origin, credentialed requests.
- Add a server-side hybrid orchestrator: deterministic Vietnamese rules first, optional server-only OpenAI extraction for longer natural messages, and backend ranking over active services. AI output is treated as untrusted criteria and never controls prices, permissions, or writes.
- Add isolated chat session/conversation/message tables using additive DDL. Anonymous conversations are scoped to a random `HttpOnly` chat cookie; signed-in conversations are scoped to their authenticated user. Redact email/phone patterns before persistence or provider requests, expire conversations, cap message size/history, and rate-limit requests.
- Add server-only chat endpoints for session restore and messages, including actual service lookup, Spa information, owner-only booking status, and availability checks. Booking buttons hand off to the existing booking page with the selected service; no second booking engine is introduced.
- Add architecture, API, booking, test, and security notes in `docs/ai-chatbot/`.

## Risks and safeguards

- Prices and service availability can change between chat and booking. Cards use current DB values; `/api/bookings` remains authoritative and users confirm in the current booking wizard.
- Anonymous chat content may contain personal data. The server redacts contact patterns before storing or sending text to an AI provider, applies retention and size limits, and binds access to an opaque cookie.
- An AI key may not be configured or a provider may time out. The rule-based path remains available and AI failure falls back without retrying.
- The existing app requires customer login for booking. The chat CTA must respect the booking page's existing authentication gate.
- No dashboard surface for FAQ management or chatbot analytics was identified as a suitable minimal integration point. Those are deferred and documented as follow-up scope.

## Safe deployment strategy

Keep the current Node/SQLite/session/booking architecture. Add only non-destructive chatbot tables and new `/api/chat/*` endpoints. Use isolated test databases, do not invoke the demo reset path, and do not create test bookings in the project's shared SQLite files. Configure AI only through server environment variables. Recheck a slot through the existing booking API at the final confirmation step.
