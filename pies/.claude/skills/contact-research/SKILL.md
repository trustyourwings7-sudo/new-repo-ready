---
name: contact-research
description: Find publicly listed decision-makers and official business contact channels for an organization tied to a PIES opportunity or lead, each with a source URL. Use when asked who to contact at an organization.
---

# Contact research (privacy-first)

## Allowed sources
- The organization's own website: team, about, leadership, contact and press pages.
- Official registries and press releases.
- A person's own public professional page, only if it is linked from the organization's site.

## Forbidden
- **Guessing or pattern-generating email addresses** (for example firstname@domain). The PIES database rejects any email without a source URL; do not try to get around this.
- Scraping LinkedIn or any site whose terms forbid automated collection.
- Logging in, bypassing access controls, or using people-search or data-broker sites.
- Personal or sensitive data: home addresses, personal phones, family, health, religion, political views, photos.

## Output (append to the relevant `pies/intel/` file)
```
#### Contacts: <Organization>
- <Full name>, <Role> [decision-maker: yes/no]
  - Source: <url> (retrieved YYYY-MM-DD)
  - Public business channel: <email/phone/form> (source: <url>) | none published
```
If nothing is published, say "no public contact; use the official application or contact form at <url>". That is a valid result.
