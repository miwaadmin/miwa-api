# Admin UI primitives

Six reusable components that all admin pages must use for visual consistency.
Import everything from the barrel: `import { AdminButton, AdminCard, … } from '../../components/admin'`

---

## Components

### `AdminButton`
A button with three variants and two sizes. Use it for every clickable action in admin — no inline button class strings.

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `variant` | `'primary' \| 'secondary' \| 'danger'` | `'secondary'` | primary = amber (admin brand), danger = red |
| `size` | `'sm' \| 'md'` | `'md'` | sm for in-card actions, md for modal/standalone |
| `loading` | boolean | `false` | Shows a spinner; disables the button |
| `disabled` | boolean | `false` | |
| `onClick` | function | — | |
| `type` | string | `'button'` | Pass `'submit'` for form buttons |

```jsx
<AdminButton variant="primary" size="sm" onClick={save} loading={saving}>
  Save
</AdminButton>
<AdminButton variant="danger" size="sm" onClick={() => setConfirmOpen(true)}>
  Delete account
</AdminButton>
```

---

### `AdminCard`
A white card panel with an optional header (title + subtitle + right-side action) and an optional footer. Use it for every panel on every admin page.

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `title` | string | — | Renders as `<h2>` inside the card header |
| `subtitle` | string | — | Muted sub-line below the title |
| `action` | ReactNode | — | Right side of the header (buttons, badges, etc.) |
| `footer` | ReactNode | — | Muted footer bar with gray background |
| `highlight` | `'none' \| 'success' \| 'warning' \| 'danger'` | `'none'` | Changes border + background tint |

```jsx
<AdminCard
  title="Accounts"
  subtitle="All registered therapists."
  action={<AdminButton size="sm">Export</AdminButton>}
>
  {/* card body */}
</AdminCard>

<AdminCard highlight="danger">
  {/* danger-zone destructive action */}
</AdminCard>
```

---

### `AdminPageHeader`
The page-level heading block. Place it at the very top of every admin page, above everything else.

| Prop | Type | Notes |
|------|------|-------|
| `title` | string | Renders as `<h1>`, `text-xl font-bold` |
| `subtitle` | string | Muted one-liner below the title |
| `actions` | ReactNode | Right-aligned slot — put primary page actions here |

```jsx
<AdminPageHeader
  title="Accounts"
  subtitle="All registered therapists and their subscription status."
  actions={<AdminButton variant="primary" size="sm">Invite therapist</AdminButton>}
/>
```

---

### `AdminStat`
A labeled-number widget. When `onClick` is passed it renders as a `<button>` with hover treatment; otherwise it's a plain `<div>`.

| Prop | Type | Notes |
|------|------|-------|
| `label` | string | Uppercase tracking label above the number |
| `value` | string \| number | The big number |
| `onClick` | function | Optional — makes the stat clickable (e.g. navigate to the detail page) |

```jsx
<div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
  <AdminStat label="Total accounts" value={stats.total} onClick={() => navigate('/admin/accounts')} />
  <AdminStat label="Paid" value={stats.paid} onClick={() => navigate('/admin/billing')} />
</div>
```

---

### `AdminStatusBadge`
A small pill badge for status values. Used for readiness check results, account states, and feature flags.

Built-in statuses: `pass`, `warn`, `fail`, `active`, `suspended`, `trial`, `past_due`.
Unknown statuses fall back to the `warn` style.

| Prop | Type | Notes |
|------|------|-------|
| `status` | string | One of the built-in values above |
| `label` | string | Optional override for the display text |

```jsx
<AdminStatusBadge status="pass" />
<AdminStatusBadge status="trial" label="In trial" />
<AdminStatusBadge status={account.status} />
```

---

### `ConfirmModal`
A modal for destructive or high-stakes actions. Replaces `window.confirm` and `window.prompt`.

Key behaviour: the Confirm button stays disabled until the user satisfies both the `confirmWord` check (typed text must match exactly) and the `reasonMinLength` check. The `onConfirm` callback receives `{ typed, reason }`. If `onConfirm` throws, the modal stays open and the spinner clears — the caller handles its own error display.

| Prop | Type | Default | Notes |
|------|------|---------|-------|
| `isOpen` | boolean | — | Controlled |
| `onClose` | function | — | Called on Escape, backdrop click, or Cancel |
| `onConfirm` | async function | — | Receives `{ typed, reason }` |
| `title` | string | `'Confirm action'` | |
| `body` | string | — | Warning description shown in the modal |
| `confirmWord` | string | — | If set, user must type this exactly |
| `reasonLabel` | string | `'Reason'` | Label for the reason textarea |
| `reasonMinLength` | number | `0` | Min chars for the reason field; `0` = no field shown |
| `variant` | `'danger' \| 'primary'` | `'danger'` | Controls Confirm button color |

```jsx
const [open, setOpen] = useState(false)

<AdminButton variant="danger" size="sm" onClick={() => setOpen(true)}>
  Delete account
</AdminButton>

<ConfirmModal
  isOpen={open}
  onClose={() => setOpen(false)}
  onConfirm={async ({ reason }) => {
    await deleteAccount(id, reason)
    setOpen(false)
  }}
  title="Delete account"
  body="This permanently removes the account and all associated data."
  confirmWord={`DELETE ${account.email}`}
  reasonLabel="Reason for deletion"
  reasonMinLength={12}
/>
```

---

## Design tokens

These Tailwind classes define the admin look. Do not introduce new color or spacing choices — use these.

| Token | Class | Usage |
|-------|-------|-------|
| Page padding | `p-8` | Outer wrapper on every admin page |
| Card padding | `px-6 py-5` (body), `px-6 py-4` (header) | Applied inside `AdminCard` — do not add extra padding to children |
| Page title | `text-xl font-bold text-gray-900 tracking-tight` | Applied by `AdminPageHeader` |
| Section heading | `text-sm font-semibold text-gray-900` | Applied by `AdminCard` title |
| Body | `text-sm text-gray-700` | General content |
| Muted label | `text-xs text-gray-500` | Subtitles, descriptions |
| Metric label | `text-xs uppercase tracking-wide text-gray-400 font-medium` | Applied by `AdminStat` |
| Admin primary | `bg-amber-500 hover:bg-amber-600` | AdminButton `primary` variant |
| Status green | `bg-emerald-50 text-emerald-700 border-emerald-200` | `pass` / `active` badges |
| Status amber | `bg-amber-50 text-amber-700 border-amber-200` | `warn` / `trial` badges |
| Status red | `bg-red-50 text-red-700 border-red-200` | `fail` / `suspended` badges |
| Section divider | `text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3` | Section labels like "Danger zone" |
| Stat grid gap | `gap-4` | Between `AdminStat` cells |

---

## How to apply this to a new admin page

**Step 1 — page shell.** Wrap the page content in `<div className="p-8 max-w-7xl mx-auto space-y-6">`. Place `<AdminPageHeader>` first, then `<AdminBanners error={error} />` (which already exists in `adminUtils.js`), then your sections.

**Step 2 — sections.** Each distinct section (a table, a form, a list of ops buttons) goes inside an `<AdminCard>` with a `title` and, if needed, a `subtitle` and an `action` slot. Use `highlight="danger"` only for the danger zone panel at the bottom of the page. Put the danger zone last, preceded by a `<p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Danger zone</p>` label. Any destructive action that currently uses `window.confirm` or `window.prompt` should use `<ConfirmModal>` instead. Use `AdminButton` for every button — no inline class strings. Use `AdminStatusBadge` for any pill/badge that signals a state.

See [AdminOverview.jsx](../../pages/admin/AdminOverview.jsx) as the reference implementation.
