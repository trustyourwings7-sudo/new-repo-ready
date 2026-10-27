# Shemmaa — Working Brief

Living memory file. Read at the start of every session, update at the end.
Confidence tags: [Certain] hard evidence · [Likely] strong inference · [Guessing] filling gaps.

## 1. Founder
- Shema Jimmy, Kigali, Rwanda. [Certain]
- Receiving & Dispatching Officer at ISCO (cash-in-transit): authorizes RWF 3–6B/day across I&M, BK, Ecobank, BPR, Access Bank. Ex-teller, 15,000+ transactions, 100% accuracy. [Certain]
- B2B sales: 400-company pipeline, 120 contracts in 4 months at Ramani Travel. [Certain]
- Available hours: works ~4pm–10pm; daytime free for Shemmaa. Wants to commit full time. [Certain]
- Skills: no-code / AI tools (Sheets, Colab, n8n, Claude). No technical co-founder. [Certain]
- Budget: under $100 for the next 6 months, prototype on free/public AI tools. [Certain]

## 2. Origin story
- An accountant at a Rwandan NGO allegedly skimmed small amounts of cash daily
  (5k–5M RWF) for 4–6 years using fake receipts/proof of spend. Discovered by
  the founder through one incident → audit. [Certain that this is the story
  Shema tells; facts unverified]
- Shema has NO access to that organization's founder. [Certain]
- Do NOT name the organization or person publicly without their consent
  (defamation and reputational risk). Use "an NGO in Kigali". [Likely]

## 3. Decisions made
- 2026-10-27: Wedge = **organizations robbed from the inside** (SMEs, NGOs,
  schools, churches, clinics where staff handle cash, petty cash, MoMo).
  NOT consumers/personal budgeting (parked as possible later product). [Decided]
- Day-one problem: early fraud detection + real-time cash visibility for the
  owner/founder/board. [Decided]
- Core first service: **expense & receipt verification + anomaly alerts**
  (duplicate/fake receipts, round-number and just-below-approval-limit spends,
  unapproved payouts, cash-book vs MoMo/bank mismatches) with a weekly owner report. [Proposed]

## 3b. End goal (backcast)
- Ambition: global company, exit target confirmed 2026-10-27 as **$900M–$21B**.
  Keep >=15% founder equity at exit. [Certain]
- $21B exit ≈ $1.5–2B+ ARR (Ramp-scale: ~$1B ARR Aug 2025, valued $22.5–32B in 2025).
  Only reachable by expanding detection → spend control → cards/payments/payroll
  (interchange + float revenue). Detection-only caps near the $900M end. [Likely]
- $900M exit ≈ $90–110M ARR at 8–10x; $21M ≈ $3–4M ARR. [Likely]
- Equity math: solo ≈43% at exit; 50/50 co-founder ≈21% (pre-seed 10%, seed 20%,
  A 20%, B 15%, pool 12%). Extra rounds/bridges risk dropping below 15%. [Likely]
- Global category: internal-fraud detection for cash/mobile-money/paper-receipt
  orgs with no finance team. Beachhead: Rwanda → East Africa → Nigeria/Ghana →
  India/Indonesia/Philippines → global NGO/donor channel. [Proposed]
- Exit comps: Featurespace→Visa (2024, price UNDISCLOSED; reports £700M–~$1B, Forrester est. $350–450M), Expensya→Medius. Direct global
  competitor on receipt fraud: AppZen (enterprise). Also Ramp, Brex, Pleo, Sardine, Sift. [Likely — verify]

## 4. Stage
- Idea only: name, logo, Jarvis helpdesk account (inactive since Aug). No code,
  no customer interviews, no users. Repo was empty before this file. [Certain]

## 5. Market & competitors (to verify)
- Occupational fraud: asset misappropriation (fake expenses, cash skimming) is
  the most common type; small orgs lose proportionally more (ACFE Report to
  the Nations). Exact figures not yet checked. [Likely]
- Expense-control players: Spendesk, Pleo, Ramp, Brex (mostly outside Africa). [Likely]
- African fraud/identity: Smile ID, Youverify, Prembly. Open banking: Mono. [Likely]
- Gap: cash + MoMo + bank reconciliation for small East African orgs without
  finance teams. [Guessing — must validate with interviews]
- TODO: TAM/SAM/SOM for Rwanda → East Africa (count of SMEs/NGOs, willingness to pay).

## 5b. Market sizing (2026-10-27, v1)
- Inputs: ~322M formal MSMEs globally (World Bank MSME-EI, 2019); ACFE 2024: orgs lose
  ~5% revenue to fraud, median loss $141k for <100 employees, 1,921 cases/138 countries;
  fraud detection market $32–55B (2025); spend mgmt software $10–27B (2025);
  AppZen raised $180M Sep 2025, valuation est. $0.5–1.3B. [Certain these are published]
- TAM ≈ $27B/yr: ~45M orgs with staff handling money (≈35M MSMEs with 5+ employees
  + ≈10M NGOs/schools/churches/clinics) × ~$600/yr blended. [Guessing on counts & price]
- SAM ≈ $4.5B/yr: ~15M of those in cash/mobile-money emerging markets, reachable by
  smartphone/MoMo, × ~$300/yr. [Guessing]
- SOM (year 8–10) ≈ $60–120M ARR: 1–2% of SAM, 150–300k orgs × ~$400/yr → matches a
  ~$900M exit at 8–10x. [Guessing]
- Value ceiling: 5% of revenue at risk → pricing should anchor at <0.5% of revenue.

## 6. Open questions
- Who signs the cheque: founder, board treasurer, or donor? (NGO donors may pay for controls.)
- Price point: RWF 20k–50k/month per org? [Guessing — test in interviews]
- Does Shema's ISCO contract restrict side businesses touching bank clients?
- How will staff be made to submit receipts (WhatsApp? MoMo statements upload?)

## 7. Next actions (30 days)
1. Interview 15 SME/NGO/school owners in Kigali: "Have you ever lost money to
   staff? How did you find out? What do you use now? Would you pay X?"
2. Concierge MVP (zero cost): staff send receipt photos via WhatsApp → Google
   Sheet → free AI model extracts amount/date/vendor → rules flag anomalies →
   weekly report to owner. Run manually for 2–3 orgs.
3. Get 1 org to pay anything (even RWF 10k) = first validation signal.

## 8. Session log
- 2026-10-26: Reconstructed context from Drive/Gmail (CV, Formula Africa script, logo email).
- 2026-10-27: Founder interview (8 questions). Wedge chosen, brief created.
- 2026-10-27: Global ambition + exit backcast added.
- 2026-10-27: Exit target confirmed $900M–$21B. Market sized v1 (live sources). Featurespace price corrected to undisclosed.
- 2026-10-27: Discovery Google Form (12 Qs, branching) + Apps Script builder added in research/
