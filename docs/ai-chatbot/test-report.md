# Chatbot implementation verification

Date: 2026-10-15

## Automated checks

- `npm test` — passed (exit code 0).
- Existing application suite — 62/62 checks passed.
- Node test runner — 23 passed, 0 failed, 0 skipped.
- Chatbot regression checks cover fallback after a Gemini overload response or primary-model timeout, and no retry for an authentication error.
- The chatbot API suite uses a temporary SQLite database.

Coverage includes Vietnamese budget/duration parsing, multi-turn context, service and price filtering, PII redaction, guest conversation persistence and isolation, reset behavior, slot validation, and booking ownership boundaries.

## Live Gemini check

- `gemini-3.8-flash` returned HTTP 503 `UNAVAILABLE` during one request and timed out during another; neither indicated exhausted quota.
- `gemini-3.5-flash-lite` returned a usable response with the same server-side key when called directly and as fallback.
- The running server on port 3001 was restarted after the fix. A live chat API request returned `aiUsed: true`, `aiFailed: false`, and a natural Vietnamese reply.

## Not verified in this run

- Live OpenAI provider behavior.
- Browser-driven visual and mobile checks.
- Performance improvement as a measured benchmark. The chat window and its stylesheet are deferred until the user opens the launcher; no before/after timing was collected.
