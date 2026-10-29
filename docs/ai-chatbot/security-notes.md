# Security notes

## Identity and authorization

- Guest history is keyed by a random 256-bit `serenity.chat` cookie; only its SHA-256 hash is stored. The cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/api/chat`, and marked `Secure` in production.
- Authenticated history is associated with the server-derived user ID. Every chat message request checks that the requester owns the conversation. A booking status query filters records by the authenticated customer ID and never accepts a user ID from the message payload.
- Staff/admin identities do not gain customer booking access through the assistant. Booking creation, cancellation, rescheduling, and payment remain behind the existing APIs and roles.

## Input, rendering, and provider boundary

- Messages are text only, trimmed, and capped at 1,200 characters. The server rate limit is 20 messages/minute and five conversation resets/minute per user/guest identity. AI extraction is capped at six provider calls/minute per identity.
- Email and Vietnamese phone patterns are redacted before user messages are persisted or sent to an AI provider. The provider receives at most eight recent chat messages, with personal contact details redacted, and filtered candidate service facts. Structured context stores parsed constraints and filtered keywords, not full prompts.
- Gemini and OpenAI chat generation and criteria extraction are optional and server-only. The client never sees the key. Provider calls have a bounded timeout and output-token limit; a failed request falls back to rules. Criteria are validated against known conversational intents/categories and numeric ranges. AI cannot route a fallback message directly into a booking, availability, or account action.
- AI receives no booking history, user account profile, or direct database tools. It cannot execute SQL, call booking APIs, set prices, select permissions, or create/cancel bookings. Service cards and booking actions are still built from database records and deterministic rules.
- User/assistant strings render through `textContent`. Service data comes from SQLite; images resolve through the existing manifest; actions are restricted to internal hash URLs. Model output is not interpreted as HTML.
- Write actions and slot confirmation continue through existing authenticated server APIs and transactions. The chat never retries a booking write.

## Persistence and retention

- Additive SQLite tables `chat_conversations` and `chat_messages` do not alter the current collection store or booking records.
- Conversations expire after 30 days of inactivity. The active transcript is capped at 80 messages. Expired conversations cascade-delete their messages when the next chat session is opened.
- Starting a new conversation ends the previous active transcript. The chatbot does not intentionally store a phone number, email, or copied booking record in chat metadata.

## Operational limits

- The rate limiter is process-local. A multi-process or horizontally scaled deployment should move rate counters to shared storage before scaling out.
- A configured supported AI provider/model and valid key are required for natural AI responses. Without them, or during provider failure, rule-based chat and database lookups continue.
- HTTPS is required in production so `Secure` cookies and user/provider traffic are protected in transit. Existing same-origin/origin-policy checks remain in force.
