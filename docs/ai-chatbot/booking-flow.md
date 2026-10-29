# Chat-to-booking flow

## Service discovery

1. The guest chooses a quick reply or sends a Vietnamese request.
2. Server rules extract explicit category, budget, duration, date, and time. Longer messages may also be sent to the configured provider for structured criteria only.
3. The recommendation code filters active SQLite service records and their current price variants. A customer's maximum budget is treated as a hard limit. The model cannot supply services or prices.
4. The chat card links to the current service detail route and current booking route. It can also ask the server to check availability.

## Availability and handoff

1. The assistant identifies a selected service and asks for a date when necessary.
2. The server enumerates candidate starts for active qualified staff and passes each candidate through the same `assertSlot()` validation used by booking creation. This includes Spa/staff hours, working days, breaks, closed dates, lead time, advance limit, service variants, staff conflicts, and room capacity.
3. After a guest chooses a returned time, the server checks it again and returns a handoff URL containing service, duration, date, time, and staff.
4. `demo.js` passes those query values to `renderBookingPage()`. The existing wizard preselects the values only if its current availability calculation still considers the exact slot available. If not, the guest chooses again.
5. The existing booking form requires its normal customer sign-in and contact data. On confirmation, `POST /api/bookings` repeats authoritative validation in a database transaction, creates the existing `Pending` booking, snapshots the current price, and applies its existing idempotency key.
6. The chat never creates a booking or claims success before the booking API does. A customer may use `#/my-bookings` to view the resulting record.

## Existing business rules preserved

- `Pending`, `Confirmed`, and `CheckedIn` bookings occupy staff slots.
- Staff and room conflicts, rounded staff lock time, working shifts, Spa hours, breaks, same-day lead time, closed days, and advance limits remain server-validated.
- Existing booking creation requires a signed-in customer or admin and valid contact fields. Guests may use chat and view public services, but booking continues through the existing login gate.
- The price is taken from the current service/variant record and snapshotted by the existing booking API.

## Booking management and support

The assistant does not cancel or reschedule a booking. It links authenticated customers to `#/my-bookings`, where the existing owner checks, cancellation notice period, confirmation, and state transitions apply. A guest who asks for staff assistance is directed to the existing `#/contact` form.
