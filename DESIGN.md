# Notipo App — DESIGN.md

This file documents the admin UI's design system. The base system (colors, type scale, spacing, radius, motion, voice) is inherited verbatim from the marketing repo: see `notipo-site/DESIGN.md` for the canonical reference.

This document covers admin-specific overrides, product-UI patterns (data tables, status indicators, empty states), and shadcn integration notes.

---

## 0. Inherited from notipo-site/DESIGN.md

The admin uses the same:
- Canvas (`#0C0B10`), card (`#1A1A1A`), card-hover (`#242323`)
- Single chromatic accent (`accent-purple` / `#A855F7`)
- Atmospheric-only `accent-pink` and `accent-blue` (admin uses these rarely — mostly the Auth screens)
- Type scale (DM Sans, 500/600 only — never bold)
- Spacing rhythm (4px base, `gap-6` / `lg:gap-8` for grids)
- Radius (`rounded-lg` for buttons, `rounded-xl` for cards, `rounded-full` for pills)
- Motion (no hover-translate, no drop shadows, transitions 200ms)
- Voice (plain-spoken, second-person, banned filler words)

**All forbidden patterns from `notipo-site/DESIGN.md` §10 apply here.** In particular: never hand-roll raw `violet-*` Tailwind classes; use the `accent-purple` token.

---

## 1. shadcn integration

The admin uses [shadcn/ui](https://ui.shadcn.com/) primitives in `apps/web/src/components/ui/`. Two notes:

### 1.1 CardTitle has a defaulted size

`components/ui/card.tsx` overrides shadcn's stock `CardTitle` to default to `text-base font-semibold` (16px). Without that, consumers had drifted to `text-sm font-medium` and lost hierarchy with body copy.

```tsx
// Default CardTitle — preferred
<CardTitle>Recent Posts</CardTitle>

// Override only when you need a larger card title (e.g. dashboard hero card)
<CardTitle className="text-lg font-semibold">Welcome back</CardTitle>
```

Don't override it back to `text-sm`. If you need a label that small, use `<p className="text-xs uppercase tracking-wider text-text-muted">` (caption) instead.

### 1.2 Badge variants

Use shadcn's `Badge` primitive with `variant`:

| Variant | Use |
|---|---|
| `default` | Pro plan, success states (white-on-near-black, brightest pixel) |
| `secondary` | Neutral metadata (category, count) |
| `outline` | Status pills (running, pending) — combine with accent-purple text |
| `destructive` | Errors, deletion confirmation |

**Don't** introduce ad-hoc background colors via `className` on Badge. If a new state is needed, add a variant in `badge.tsx`.

---

## 2. Page hierarchy

### 2.1 Page H1

Every admin page leads with:

```tsx
<h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
```

30px, semibold, tight tracking. This is **bigger than card titles** (`text-base`) and clearly distinct. Don't use `text-2xl` here — that's the old pattern that flattened hierarchy.

### 2.2 Stat / metric values

For dashboard StatCards, post counts, billing usage:

```tsx
<p className="text-3xl md:text-4xl font-semibold tracking-tight tabular-nums">
  {count}
</p>
```

`tabular-nums` is required so digits don't jitter when the value updates.

---

## 3. Status & state indicators

### 3.1 Job / post status

Three buckets only:

| Status | Variant | Visual |
|---|---|---|
| Success (PUBLISHED, COMPLETED) | `default` (or green semantic) | Filled |
| In progress (RUNNING, SYNCING, PUBLISHING) | `outline` + `text-accent-purple border-accent-purple/30` + animated pulse dot | Outlined with motion |
| Failed (FAILED) | `destructive` | Filled |

**Forbidden:** the previous 6-color status palette (green / blue / red / yellow / violet / orange). Reduces cognitive load and keeps the canvas calm.

### 3.2 Pulse dot pattern (active state)

```tsx
<span className="relative flex h-2 w-2">
  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-purple opacity-75" />
  <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-purple" />
</span>
```

Used on RUNNING jobs and live SSE indicators. Always `accent-purple` — never green/yellow.

---

## 4. Forms

### 4.1 Inputs

shadcn `Input`, `Select`, `Textarea` defaults are correct. Don't override colors. Validation errors show below the field with `text-sm text-destructive`.

### 4.2 Form layout

- Single-column for ≤4 fields
- Two-column for ≥6 fields, with labels above each field (not inline)
- Use `space-y-4` between fields, `space-y-6` between form sections
- Submit button is a primary `Button` aligned right at the end of the form

---

## 5. Empty states

```tsx
<div className="rounded-xl border border-border-card bg-bg-card p-12 text-center">
  <Icon className="w-10 h-10 text-text-muted mx-auto mb-4" />
  <h3 className="text-lg font-semibold mb-2">No posts yet</h3>
  <p className="text-text-secondary text-sm mb-6 max-w-sm mx-auto">
    Connect your WordPress site and create your first post.
  </p>
  <Button asChild>
    <Link href="/admin/write">Write your first post</Link>
  </Button>
</div>
```

Always end with a single primary CTA. Don't stack multiple actions in empty states.

---

## 6. Data tables

The admin uses card-based mobile layouts and proper tables on desktop:

```tsx
<>
  {/* Mobile: card list */}
  <div className="md:hidden space-y-3">
    {rows.map(r => <RowCard key={r.id} {...r} />)}
  </div>

  {/* Desktop: table */}
  <div className="hidden md:block">
    <table className="w-full text-sm">...</table>
  </div>
</>
```

Pattern: `md:hidden` for mobile cards, `hidden md:block` for desktop tables. Don't try to render the same node responsively — the structures differ enough that branching is cleaner.

---

## 7. Impersonation banner (admin-only)

The admin top bar shows a hairline + accent-purple tinted banner when an admin impersonates a tenant:

```tsx
<div className="border-y border-accent-purple/40 bg-accent-purple/10 text-accent-purple text-sm px-4 py-2">
  Viewing as <strong>{tenantName}</strong>
</div>
```

**Forbidden:** the previous `bg-amber-600 text-white` solid amber treatment. That introduced an off-system color (amber) for a state that's already adequately signaled by the muted accent-purple tint.

---

## 8. Auth screens

The login / signup / verify / reset pages have a simpler chrome (no sidebar, centered card). They:

- Use the same canvas (`#0C0B10`) — set explicitly via `<SetDarkMeta>` for the iOS chrome bar
- Center a `max-w-sm` card with the brand mark above and a single primary CTA
- Don't render the full nav

Auth-screen card titles can use `text-xl font-semibold` (slightly larger than admin CardTitle default) since they're the only foreground content on the page.

---

## 9. Keyboard / desktop affordances

The admin is keyboard-friendly:

- Every actionable element is a `<button>` or `<a>`, never a clickable `<div>`
- Focus rings: `focus-visible:ring-2 focus-visible:ring-accent-purple/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary`
- Cmd/Ctrl+S in the editor saves the post (caught in `/admin/write`)
- The editor traps `beforeunload` when the user has unsaved content

Don't ship UI that requires hover. Mobile sees the same product without it.

---

## 10. Forbidden in the admin (additions to site DESIGN.md §10)

| ✘ Don't | ✓ Do |
|---|---|
| Hand-roll raw `bg-violet-600`, `text-violet-400`, `border-violet-500/30` | Use `bg-accent-purple`, `text-accent-purple`, `border-accent-purple/30` |
| 6-color status palette | 3-state pattern (success / in-progress / failed) |
| Solid `bg-amber-600` warning banners | Hairline + accent-purple tint |
| `<CardTitle className="text-sm font-medium">` | Default `<CardTitle>` (text-base font-semibold) |
| Hard-coded `#0a0a0a` canvas in auth screens | Use `#0C0B10` (matches marketing canvas — no jump on /admin) |
| Stack multiple primary actions in empty states | One primary CTA |
| Render the same DOM responsively for tables | Branch via `md:hidden` / `hidden md:block` |
| Clickable `<div>` for actions | `<button>` or `<a>` — keyboard-accessible by default |

---

## How this file is used

Same as the marketing repo: AI agents read this before generating admin UI; humans copy nearest patterns from §3–8; reviewers cite §10 when blocking. When the marketing site updates `notipo-site/DESIGN.md`, sync the inherited rules here in the same PR.
