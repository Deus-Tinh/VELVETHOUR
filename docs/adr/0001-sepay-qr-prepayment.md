# ADR 0001: Use SePay webhook for prepaid appointment confirmation

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Customers must pay the full quoted price before an appointment is confirmed. The selected slot is held for three minutes. A static bank QR cannot carry an order-specific amount and transfer code, and a QR image cannot tell the website that money arrived. The application must also retain an auditable record when a transfer cannot be matched.

## Decision

- Generate a dynamic VietQR transfer image for the owner's Techcombank account, exact amount, and one unique code per booking.
- Use an authenticated SePay inbound-transaction webhook as the confirmation source. Match the destination account, code, amount, transaction time, and current slot; store each provider transaction ID once.
- A newly created booking stays pending until a valid full payment is received. The 180-second hold expires and releases the slot.
- Store unmatched, short, excess, late, and repeated-order transfers for admin reconciliation. These events never confirm a booking automatically. An admin may link an unmatched inbound transfer to the customer's reported booking after verification; linking cancels a still-pending hold, records an audit event, and prepares a customer notice without confirming the booking or refunding the transfer.
- Keep card processing disabled until a payment gateway is selected. Record customer cancellation refunds as 50% of net receipts and have staff send the bank transfer manually, with an admin reference record.
- On reschedule, collect a higher-price difference using the booking's same payment code and a separate 180-second hold; leave the old appointment intact until exact payment arrives. For a lower new price, request a manual refund of 100% of the difference after the customer supplies a destination account.
- Leave overpaid, late, and unavailable-slot transfers in admin review. Admin may decide a manual refund amount no higher than that transaction; underpayments and wrong-code transfers are not refundable.
- Keep payment disabled by default. Enable it only after a public HTTPS webhook URL and the matching SePay API key are configured.

## Consequences

- Booking and payment status are persisted on the server in SQLite; browser state is not authoritative.
- The public site must be served over HTTPS for SePay to reach the webhook safely.
- A local development server cannot receive live SePay notifications without a secure public URL.
- Incorrect transfer content cannot be linked reliably to a specific customer. It is retained for admin review; the admin performs the customer-to-booking association after verification, and the checkout warns that short or mismatched transfers are not refundable.
- Refund transfer execution remains an operational task for staff; the website stores the request, destination, completion time, and transfer reference.

## Sources

- [SePay webhook integration](https://docs.sepay.vn/tich-hop-webhooks.html)
- [SePay dynamic VietQR generation](https://developer.sepay.vn/vi/tien-ich-khac/tao-qr-code)
