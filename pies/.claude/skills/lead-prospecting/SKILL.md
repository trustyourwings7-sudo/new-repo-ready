---
name: lead-prospecting
description: Find and qualify potential paying clients for the owner's AI automation, CRM, SEO and GEO services (private schools, training institutions, clinics, travel and hospitality), with evidence of pain points and labelled deal-value assumptions. Use when asked for commercial leads or prospects.
---

# Commercial lead prospecting

## Target segments
private_school, training_institution, clinic, healthcare, travel, hospitality, other. Default geography: Kigali and Rwanda first, unless the owner says otherwise.

## Method
1. Discover organizations from official directories and the organizations' own websites (WebSearch/WebFetch; Playwright MCP only if JavaScript is required).
2. Collect **observable** pain-point evidence, quoted or with a URL, for example:
   - no online booking or enquiry form
   - broken or slow site, missing meta titles or descriptions
   - no Google Business profile link
   - an unanswered contact form promise
3. Map each pain point to a service: CRM setup, SEO, GEO (AI-answer visibility), workflow automation.
4. Fit score (0–100) with the reasons shown. Deal value is optional and **must** list its assumptions, for example: "assumes 1 site rebuild at RWF X based on <comparable>". Mark it `[AI estimate]`.

## Output: `pies/intel/YYYY-MM-DD-leads-<segment>.md`
```
### <Organization> (<segment>, <city>)
- Website: <url>  · Source of listing: <url>
- Pain points (evidence): 1) "<quote/observation>" (<url>) ...
- Recommended services [recommendation]: ...
- Fit score [AI estimate]: NN/100: <reasons>
- Deal value [AI estimate]: <amount currency>: assumptions: ...
- Public contact channel: <from contact-research or "not yet researched">
```

Do not contact anyone. Do not record personal data about staff beyond name and role published by the organization.
