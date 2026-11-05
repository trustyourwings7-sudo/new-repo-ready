---
name: opportunity-qualification
description: Score a researched opportunity against the PIES owner's verified profile using the fixed 100-point rubric, with mandatory eligibility overrides and an explanation. Use after opportunity-research, or when asked whether an opportunity is a good fit.
---

# Opportunity qualification (deterministic rubric)

Input: an opportunity block from `pies/intel/` (or one the owner pastes), plus verified profile facts only.

## Rubric (100 points)
| Dimension | Max | Score from evidence |
|---|---|---|
| Eligibility & accessibility | 25 | Every stated requirement checked against verified facts |
| Experience alignment | 20 | Overlap with recorded experience (ISCO operations, Ramani Travel sales/marketing, JAMOF founder, athletics) |
| Financial / career value | 20 | Stated value or career impact; "not stated" scores at most 5 |
| Strategic relevance | 15 | Fit with the owner's projects: career, education-funding, jamof, shemmaa, ai-consulting, lead-generation |
| Decision-maker accessibility | 10 | Is there a public, official contact or application route? |
| Timing & feasibility | 10 | Days to deadline versus preparation effort |

## Mandatory overrides
- If any **mandatory** requirement is clearly not met (nationality, degree, age, work authorization, residency), the result is `eligibility_status = ineligible`, whatever the score. State the requirement and its source quote.
- If a requirement cannot be checked from verified facts, set `needs_review` and list it under missing information. **Never infer eligibility from incomplete information.**

## Output (append under the opportunity in the same intel file)
```
Qualification (rubric v1):
- Eligibility: x/25: <reason>
- Experience: x/20: <reason>
- Value: x/20: <reason>
- Strategic: x/15: <project slug>: <reason>
- Access: x/10: <reason>
- Timing: x/10: <reason>
- Total: NN/100 [AI estimate]
- eligibility_status: eligible|partially_eligible|ineligible|needs_review|unknown
- Missing information: <list>
- Recommended next action [recommendation]: <one concrete step>
```

Label totals as `[AI estimate]` and actions as `[recommendation]`, as the dashboard does.
