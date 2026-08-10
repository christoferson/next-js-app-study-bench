# UI-GUIDELINES — StudyBench

Product feel, mobile study, accessibility, and styling.

**Read before:** building or changing any user-facing view.

**Authority:** below `SPEC.md` and `PROGRESS.md`. See `CLAUDE.md` section 3.

Moved verbatim from `CLAUDE.md` sections 20 and 21.

---

## 1. UI and accessibility standards

### 1.1 Product feel

The home experience should feel like a personal application dashboard, not a
marketing landing page.

Use:

- Clear hierarchy
- Restrained visual design
- Study-oriented language
- Useful empty states
- Direct calls to action
- Consistent status labels

Avoid:

- Excessive gradients
- Promotional claims
- Fake testimonials
- Fabricated progress
- Disabled future-feature controls
- Non-functional navigation

### 1.2 Mobile study

Study experiences must work at approximately a 360-pixel viewport width.

Requirements include:

- No normal-content horizontal scrolling
- Large touch targets
- Readable answer choices
- Clear current-item progress
- Accessible audio controls
- Autosave feedback where relevant
- Explanation text readable without zooming

### 1.3 Accessibility

All implemented UI must provide:

- Semantic headings
- Form labels
- Keyboard navigation
- Visible focus states
- Accessible names for icon-only controls
- Sufficient color contrast
- Errors associated with relevant fields
- Status information not communicated by color alone

Use semantic HTML before adding ARIA.

### 1.4 No dead controls

Do not display:

- Buttons with no action
- Navigation to unimplemented routes
- Disabled controls advertising future features
- Empty placeholder panels for later milestones

If a feature is not implemented, omit it.

---

## 2. Styling rules

Use the styling approach already established in the repository.

For D1:

- Prefer a small maintainable stylesheet.
- Do not add a large component library solely for the demo catalog.
- Do not add a design-system dependency without current need.
- Use reusable design tokens through CSS custom properties where useful.
- Support light mode at minimum.
- Do not spend milestone scope on elaborate theming.

If a styling framework is already present, use it consistently rather than adding
a competing approach.
