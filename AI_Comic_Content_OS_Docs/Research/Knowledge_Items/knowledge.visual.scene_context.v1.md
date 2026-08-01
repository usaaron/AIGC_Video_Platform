---
knowledge_id: knowledge.visual.scene_context.v1
version: v1
category: visual_narrative
principle: Give each production-facing scene enough context to establish interior or exterior space, location, and relevant time condition before action unfolds.
rationale: A stable scene context improves readability and future production mapping without dictating shots or vendor syntax.
when_to_use:
  - Preparing structured scripts for human review or future handoff.
  - Detecting unexplained location or time jumps.
when_not_to_use:
  - To force traditional screenplay typography into the MasterScript schema.
  - When a continuous sequence intentionally preserves the prior scene context.
application_rules:
  - Represent spatial and temporal context semantically, independent of export format.
  - Mark a transition when context changes in a way that affects action or comprehension.
anti_patterns:
  - Characters appear in a new place without transition or causal explanation.
  - Production syntax is embedded as prose and becomes impossible to parse.
examples:
  - weak: Later, they meet somewhere dark.
  - stronger: Night, interior, closed archive room; emergency lights isolate the only unlocked terminal.
source_reference:
  source_title: Screenplay Format
  source_author_or_organization: Matt Carless; BBC Writersroom
  source_url: https://downloads.bbc.co.uk/writersroom/scripts/screenplay.pdf
  publication_reference: BBC Writersroom screenplay-format guide, updated 2004-02-06; scene-heading guidance.
  source_type: professional_production_guide
  authority_level: broadcaster_professional_guidance
  extraction_confidence: high
confidence: high
---

