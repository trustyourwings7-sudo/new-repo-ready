# Shemmaa Discovery Form — "Where did the money go? 💸"

**12 questions · ~4 minutes · branching** (people who say "no theft" skip Q6–8, so the form takes them ~3 minutes).
Build it automatically with [`shemmaa_form.gs`](shemmaa_form.gs) (instructions at the top of that file).

## Questions
| # | Question | Why it's there |
|---|---|---|
| 1 | What kind of organization do you run? | Segment: which vertical feels the most pain |
| 2 | How many people work with you? | Fraud needs staff; sizes the TAM assumption (5+ staff) |
| 3 | How does money move? (cash / MoMo / bank / cards) | Validates the "cash + mobile money" gap |
| 4 | 1–5: how well do you know where every franc went? | Measures the visibility pain |
| 5 | Have you or an owner you know lost money to an insider? | "Someone I know" lowers shame, so answers are more honest |
| 6 | How was it done? | Tells you which detection rules to build first |
| 7 | How long before anyone noticed? | Shows the cost of late detection, for the pitch |
| 8 | Roughly how much was lost? | Gives the ROI story and grounds pricing |
| 9 | What do you use today? | Real competitor = notebook / Excel / "trust" |
| 10 | Magic wand: one thing the app should do | Picks the core feature from customer votes |
| 11 | What would you pay per month? | First price signal (treat as an upper bound) |
| 12 | Join the free 1-month pilot? + WhatsApp | Lead capture: the real goal of the form |

## How to use it
- **Distribute:** WhatsApp status, owner groups, walk-ins with a QR code on your phone. Aim for 50+ responses.
- **The real interview:** WhatsApp everyone who answered Q5 = "Yes" **and** left a number, and book a 15–20 min call.
  On the call, ask: *"Tell me about the last time money went missing. What happened, step by step?"*
  Then: *"What did you do after? What did it cost you?"* Don't pitch until the end.
- **Success signal:** 10+ "Yes, count me in" sign-ups and at least 3 Q11 answers of 10,000+ RWF.
- **Going global:** duplicate the form and change `CURRENCY` + the amount bands for Kenya, Nigeria, India, etc.
  Translate to Kinyarwanda/French/Swahili for higher response rates.

## Ethics
Never ask respondents to name the person who stole. Never publish individual stories without consent.
