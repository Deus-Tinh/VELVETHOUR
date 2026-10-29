# Serenity Spa Catalog and Booking

This context defines the spa's sellable catalog and how customers reserve therapies and treatment packages.

## Catalog and booking

**Liệu trình**:
A standalone spa treatment that a customer can book directly.
_Avoid_: Gói trị liệu

**Gói trị liệu**:
A sellable combination of one or more existing treatments, with its own configured price and duration options. Booking a package reserves one therapist and one continuous appointment for the selected package duration.
_Avoid_: Liệu trình lẻ, combo as a duplicate treatment

**Liệu trình thành phần**:
A standalone treatment referenced by a package to describe what the package includes.
_Avoid_: Copied treatment

**Mức thời lượng gói**:
A duration and price pair configured for a package and selected as one booking option; it is not automatically calculated from component treatment durations.
_Avoid_: Sum of component durations

## Booking payments

**Giữ lịch chờ thanh toán**:
A selected staff slot and room held temporarily while the customer pays the full quoted amount; the hold ends after three minutes if payment is not verified.
_Avoid_: Confirmed booking

**Thanh toán đủ**:
An inbound bank transfer that matches the booking's payment code and exact quoted amount. Only this state confirms a newly prepaid booking.
_Avoid_: Transfer attempted, partial payment

**Giao dịch cần đối soát**:
Money received with a missing or incorrect booking code, a mismatched amount, or after the slot hold ended; it does not confirm a booking automatically.
_Avoid_: Paid booking

**Yêu cầu hoàn tiền**:
A manual bank transfer request created when a customer cancels an already-paid booking; the request is for half of the net amount received.
_Avoid_: Automatic refund

## Display groups for standalone therapies

Standalone therapies use a separate `therapyGroup` field for browsing and booking Step 1. It does not replace the operational `category` field used to match therapists:

1. `body-massage` — Massage toàn thân (Body Massage)
2. `neck-shoulder` — Massage cổ – vai – gáy
3. `foot-massage` — Massage chân (Foot Massage)
4. `head-face` — Massage đầu – mặt
5. `special-combo` — Combo Massage & Liệu trình đặc biệt

Admin selects a display group when creating or editing a standalone therapy. Existing demo records receive a stable default mapping. A group with no active records may show non-bookable example names as a demo hint; examples are not catalog records. Packages remain separate catalog items and are not placed in these therapy groups.
