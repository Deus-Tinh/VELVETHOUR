# Serenity Spa chat assistant

The chat assistant is an additive feature in the existing Vanilla JavaScript and Node/SQLite application. It keeps the current booking flow as the only booking write path.

## Capabilities

- Floating, responsive chat window styled with the existing Serenity color and typography tokens. The launcher is lightweight; the conversation module and chat stylesheet load on first open.
- Vietnamese quick replies and rule-based intent parsing for massage, skin care, budget, duration, current Spa information, availability, booking status, support, and booking-management handoff.
- Requests for a specific area such as neck and shoulders, head, feet, or back are matched to the corresponding active services in SQLite. Recommendation cards show service photos and current variant prices; selecting a card sends its service ID and duration back to the API so the conversation stays tied to that service.
- Recommendations use active, bookable service records and current variant prices from SQLite. A maximum budget is a hard filter.
- Lowest-price and “cheaper” requests sort live records by current price; promotion questions read only active, in-date offers with remaining uses.
- Optional server-side Gemini or OpenAI responses for normal conversation and criteria extraction for natural multi-turn messages. General questions do not become service recommendations; a missing or failed provider produces a clear, controlled response.
- Conversation context retains the selected service and the latest service-card IDs so ordinal follow-ups such as “cái thứ hai” remain tied to the displayed cards.
- Server-side slot checks use the existing booking validation rules. The assistant hands off to `#/booking` with the selected service, duration, date, time, and staff. That page rechecks the choice and the booking API validates it again.
- Conversation context and messages are persisted for 30 days after the latest activity, with a limit of 80 stored messages per conversation. Contact details are redacted before user text is persisted or sent to the provider.

## Run locally

Node.js 24 or newer is required, as in the existing project.

```powershell
Copy-Item .env.example .env
# For Gemini, set AI_PROVIDER=gemini, AI_API_KEY (or GEMINI_API_KEY), and AI_MODEL=gemini-3.8-flash.
# AI_FALLBACK_MODEL defaults to gemini-3.5-flash-lite and is used when Gemini reports temporary overload.
# For OpenAI, set AI_PROVIDER=openai, AI_API_KEY, and the API model ID in AI_MODEL.
npm start
```

Open `http://localhost:3001/#/`. Leaving the provider key or `AI_MODEL` blank keeps explicit spa flows in rule-based mode; general questions receive a clear AI-configuration message instead of an unrelated service list. Startup reports provider configuration and model without printing a key. For Gemini, temporary overload responses can fail over to `AI_FALLBACK_MODEL` within the same request timeout. Restart the server after changing `.env`. Do not commit `.env`, paste provider keys into chat, or place provider keys in browser code.

Run the existing and chatbot tests with:

```powershell
npm test
```

## Project notes

- [Architecture audit](architecture-analysis.md)
- [API contract](api-contract.md)
- [Booking flow](booking-flow.md)
- [Test report](test-report.md)
- [Security notes](security-notes.md)

## Current scope limits

The customer-facing assistant's booking flow hands off to the existing sign-in and booking wizard. That wizard submits to `POST /api/bookings`, which remains the only booking write path and rechecks live price and availability. The customer-facing assistant does not create, cancel, or reschedule bookings directly in chat. Admin FAQ editing, chatbot analytics UI, live AI provider verification, and browser-driven mobile/end-to-end checks are not implemented in this increment.

## Admin booking manager agent

The Admin dashboard has a separate **Agent Spa** tab for authenticated admins. It uses the configured server-side `AI_PROVIDER`, `AI_API_KEY` (or provider-specific key), and `AI_MODEL` settings. The manager agent can search/read bookings, list bookable services and specialists, check a slot, create a booking, change a booking status, and reschedule a booking. Creation calls the same server booking validation and write path used by `POST /api/bookings`; status changes preserve the existing transition rules; rescheduling rechecks the current slot rules. Writes are recorded in the audit log.

The manager can delegate verification requests to a read-only auditor with separate read-only tools. The manager endpoint requires the admin session cookie and has its own rate limit. Booking tool results omit customer phone, email, notes, and payment records. Phone numbers and email addresses in chat messages are redacted before provider calls; the original contact values are held in server memory for up to ten minutes so the tool can create a booking without sending those values to the model. Conversation history is kept in server memory for up to one hour and is not stored in SQLite.

To try it, start the shared app, sign in as an admin, open `#/admin`, and select **Agent Spa**. Include the customer's name and phone plus service, date, time, duration, and specialist when asking to create a booking. The agent does not manage refunds or delete bookings; it uses the existing booking status and rescheduling operations.
