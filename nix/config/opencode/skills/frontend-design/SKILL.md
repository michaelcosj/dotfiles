---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
compatibility: opencode
metadata:
  audience: maintainers
  workflow: github
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

Preserve the existing design system unless redesign is requested: reuse its tokens, typography, components, and interaction conventions. For new interfaces, choose a distinctive direction appropriate to the product, accessibility requirements, performance, and requested scope.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and choose a clear visual direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Choose a style that fits the audience and product, such as minimal, editorial, playful, refined, or utilitarian. Treat these as options, not requirements to make every interface extreme.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: Where would a distinctive detail improve this interface without disrupting familiar workflows?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Prioritize legibility and a clear hierarchy. Keep established fonts in existing products; for new designs, consider a distinctive display font where it fits. System fonts and common families are valid choices.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animation when it clarifies state changes or adds appropriate polish. Prefer CSS where sufficient, respect reduced-motion preferences, and avoid adding libraries solely for decorative effects.
- **Spatial Composition**: Use spacing, alignment, and density to support hierarchy and usability. Explore asymmetry or unusual layouts only when they serve the content.
- **Backgrounds & Visual Details**: Use color, depth, or texture where they reinforce the visual direction. Solid backgrounds are appropriate when they keep the content clear; avoid decoration that harms contrast or performance.

Avoid cookie-cutter styling that ignores the product's context. Familiar fonts, layouts, and components are useful when they support consistency and usability.

For new designs, make intentional choices rather than repeating the same aesthetic across unrelated products. For existing products, consistency matters more than novelty.

Match implementation complexity to the requested scope. Use the simplest code that achieves the visual direction, with careful attention to spacing, typography, accessibility, and performance.
