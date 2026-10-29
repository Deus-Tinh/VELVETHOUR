# Chat API contract

All routes are served by the existing Node server on port 3001. Requests use same-origin cookies (`credentials: include`). Responses are JSON with `Cache-Control: no-store`. No AI credentials are accepted from the browser. Gemini (`AI_PROVIDER=gemini`) and OpenAI (`AI_PROVIDER=openai`) are supported as server-side providers.

## `GET /api/chat/session`

Create or restore the current conversation and return up to 80 messages. Anonymous callers receive an opaque `HttpOnly; SameSite=Lax` `serenity.chat` cookie scoped to `/api/chat`. Signed-in conversations are associated with the authenticated user's ID; guest conversations are scoped to a hash of the cookie value.

Example response:

```json
{
  "conversationId": "chat_<uuid>",
  "context": {
    "intent": "GREETING",
    "service_category": null,
    "service_id": null,
    "budget_min": null,
    "budget_max": null,
    "desired_duration": null,
    "preferred_date": null,
    "preferred_time": null,
    "employee_preference": null,
    "booking_state": "idle",
    "conversation_state": "greeting",
    "keywords": []
  },
  "messages": [],
  "aiAvailable": false
}
```

Messages have `role`, `type`, `text`, `quickReplies`, `actions`, `services`, and `bookings`. Service and booking data is rehydrated from the current database when a conversation is restored; old prices are not trusted as current prices.

## `POST /api/chat/messages`

Send one user message. The endpoint checks origin, session ownership, message type/length, and a per-user or guest rate limit before processing.

```json
{
  "conversationId": "chat_<uuid>",
  "message": "Mình muốn thư giãn, ngân sách khoảng 300.000đ – 500.000đ."
}
```

The service-card “Kiểm tra lịch” action may also include a `serviceId` and `serviceDuration`. The server verifies both against the active catalog before using them as the selected service and variant; the client never supplies a trusted price.

Maximum message length is 1,200 characters. A successful response includes the updated context and the user/assistant message pair:

```json
{
  "conversationId": "chat_<uuid>",
  "context": { "intent": "BUDGET_FILTER", "budget_min": 300000, "budget_max": 500000 },
  "aiUsed": false,
  "aiFailed": false,
  "messages": []
}
```

Service cards contain a database service ID, current name/description, image ID, selected variant price, and duration. The frontend renders text with DOM text nodes and resolves images through the existing image manifest. Actions are limited to internal hash routes.

## `POST /api/chat/reset`

Ends the current active conversation for this guest/user and creates a fresh one with the welcome message. Limited to five resets per minute per guest/user.

## Errors

Errors retain the existing API shape `{ "error": "...", "code": "..." }`. Relevant status codes include 400 for invalid input, 404 for unavailable or unowned conversations, 413 for oversized messages, and 429 for rate limits. A successful configured AI request can provide the conversational response and extracted service criteria (`aiUsed: true`). A failed AI provider request does not fail the chat request; the response marks `aiFailed` and returns a controlled message for general questions rather than a service recommendation. Explicit service, availability, account, and support requests remain on deterministic backend paths.

## Existing API handoffs

- Booking: `POST /api/bookings`, still requires the existing authenticated customer/admin and contact validation.
- Booking and schedule ownership: existing `/api/bookings` routes and customer UI.
- Support contact: `#/contact` and existing `/api/contacts` workflow.
- Service/bootstrap data: `/api/bootstrap`; chatbot server reads the corresponding SQLite-backed collections directly.
