# CKW Journey Engine

The customer journey system for Chef KnifeWorks. It's a standalone app with its own database, and it runs every customer through five stages:

```
DISCOVER → RESERVE → EXPERIENCE → DELIGHT → RETURN & REFER
```

**The rule:** every message a customer receives is caused by a *verified event* (booked, checked in, paid, picked up), never by a guess or a bare timer. Every stage is measured from those same events.

## How it works

```
 customer / staff / Square
            │
            ▼
   recordEvent()  ──►  journey_events   (append-only, idempotent)
            │
            ▼
   planForEvent()  ──►  messages outbox  (deduped by key, scheduled)
            │
            ▼
   dispatcher (every 5 min)
     ├─ re-checks live state (guards) ─► skip if no longer relevant
     ├─ holds texts during quiet hours (8pm–9am)
     └─ sends via Quo (SMS) / Resend (email)
```

| Piece | File |
|---|---|
| Journey rules: which event triggers which message | `src/engine/planner.ts` |
| Every word customers read | `src/engine/templates.ts` |
| Send-time checks | `src/engine/guards.ts` |
| Allowed status moves | `src/engine/stateMachine.ts` |
| Event recording and dispatcher | `src/engine/engine.ts` |
| Booking with capacity-safe windows | `src/engine/booking.ts` and the `book_reservation()` SQL function |
| Database schema | `supabase/migrations/` |

### The journey

| Stage | Trigger event | What happens |
|---|---|---|
| Discover | `customer.created` | Source and UTM captured, including referral links (`/r/CODE`) |
| Reserve | `reservation.booked` | Confirmation by text and email · reminder 2h before the window (7pm the night before for early windows) · "missed you" nudge if the customer never checks in |
| Experience | `checked_in` → `in_service` → `ready` → `payment.received` → `picked_up` | Check-in text · ready text and email with Square pay link · pickup nudge after 48h · payment receipt. Pickup requires payment first. |
| Delight | `picked_up` | Aftercare and thank-you after +2h · Google review request after +2 days, once per customer per year, tracked through `/go/review/…` |
| Return & Refer | `picked_up`, `referral.qualified` | Referral invite after +7 days · re-sharpen reminder after +90 days (cancelled automatically if the customer rebooks first) · referrer thanked when a friend's first order completes · seasonal campaigns |

Reminders, referral invites and campaigns go only to customers who ticked the reminders box when booking.

## Screens

- `/` home, `/reserve` booking, `/o/<token>` private order page, `/r/<code>` referral link
- `/staff` board, `/staff/customers` customers and their full journey timelines, `/staff/journey` stage metrics, `/staff/campaigns` seasonal texts

## Setup

1. **Database:** run `supabase/migrations/*.sql` on the Supabase project.
2. **Staff login:** create a user in Supabase Auth, then:
   ```sql
   insert into staff_members (user_id, display_name, role)
   values ('<auth user uuid>', 'Jason', 'owner');
   ```
3. **Environment:** copy `.env.example` into the Vercel project's environment variables.
4. **Square webhook:** subscribe to `payment.updated` at `https://<domain>/api/webhooks/square`.
5. **Drop-off hours:** edit the rows in `drop_windows` (Mon–Sat, five 2-hour windows, 4 bundles each by default). Add closed days to `blackout_dates`.

Before Quo and Resend keys are added, messages wait safely in the outbox. Nothing is lost, and they go out once the keys exist.

## Develop

```bash
npm install
npm run dev
npm run check   # lint + types + tests
```
