# Internova style guide (phase B)

One calm, friendly look for every screen, light and dark, desktop and phone.
Only the format changes. Never change a flow, handler, API call, validation, permission or what a button does.
If a restyle seems to need a behaviour change, do not do it: write it in `holes` instead.

## How the look is built (three layers, one palette)

1. `--ui-*` tokens in `src/app/globals.css` (`:root` = light, `.dark` = dark). Plain-CSS components read these.
2. `@theme` in `globals.css` retunes Tailwind's colour scales (slate, blue, emerald, amber, red, purple, ...), radius and shadows. So `text-slate-500`, `bg-blue-50`, `rounded-2xl`, `shadow-sm` already look right everywhere. You do not need to touch colours on a screen you only want consistent.
3. `.dark .bg-white`, `.dark .text-slate-*`, ... in `globals.css` repaint the same utility classes with the dark tokens. Change dark colours there (or in `.dark { --ui-* }`), never per screen.

Kit CSS lives in `components/dash/dash.css` (cards, chips, bars, rows, timeline, avatars) and `components/dash/page.css` (header, buttons, fields, filters, tabs, rows, tables, sheet). Both are in `@layer components`, so Tailwind utilities on a kit element (`hidden`, `sm:w-auto`, `mt-4`, `max-w-4xl`) still win. Import everything from `@/components/dash/page`.

### Tokens (light / dark)
| token | light | dark | use |
|---|---|---|---|
| ground | #f5f7f2 | #0d1424 | page behind cards |
| surface | #ffffff | #141c2e | cards, inputs, sheets |
| soft | #f0f3ee | #1a2438 | wells, hovers, table head |
| line | #e1e5e0 | #26324a | hairlines |
| border | #c3cbc5 | #34425f | input / outline-button border |
| ink | #182031 | #e6ebf5 | body text (16:1 / 14:1) |
| muted | #5d6d6a | #9aa8c0 | secondary text (5.3:1 / 7:1) |
| faint | #5f6e6b | #8493ae | placeholders, icons (5.2:1 / 5.5:1) |
| accent | #1a5fd6 | #6a9bf0 | links, active tab/chip (5.7:1 / 6.1:1) |
| btn | #1a5fd6 | #2c64c8 | solid button, white text (5.7:1 / 5.6:1) |
| ok / warn / risk / info | text on soft tint: #2b7352/#e5f2ea, #8c6018/#f7ecd3, #a84a3a/#f8e4df, #3d5f93/#e4ebf5 | #86c9a8/#1d363d, #dcbb7c/#33312d, #e8a496/#342837, #8fb4f4/#202e49 | status chips, notes, figures (>= 4.7:1) |

Brand stays: Geist / Geist Mono, the logo, navy #254377 (sidebar wordmark), coral #e67d63 only as a rare accent.

## Components (import from `@/components/dash/page`)

| piece | when |
|---|---|
| `Page` (`size`: normal 1120, wide 1360, narrow 760, full) | outermost wrapper of a page; gives rhythm and width |
| `PageHeader title sentence meta back={{href,label}}` + children = action buttons | top of every page. One short human sentence; actions wrap on phones |
| `Section title help action flush` | a card. `flush` = no padding, for tables and row lists |
| `GroupTitle` | heading above several cards |
| `Btn variant primary / secondary / ghost / danger / danger-quiet`, `sm`, `block`, `href` | every button. `btnClass(variant, {sm, block, className})` when the element must stay a `<label>`/custom component |
| `FormField label hint error required` + `Input` / `Select` / `Textarea` | every form control. Label wraps the control |
| `SearchField` | search box with a magnifier |
| `FilterBar` + `Chips` / `Chip on count` | search, selects, status chips above a list |
| `TabStrip tabs active onChange` (or `TabBar` from `ui`) | switch sections of one page |
| `DataList` + `DataRow lead title sub side actions href onClick wrap` | people/item lists (instead of hand-built `<li>`) |
| `KeyValueList items` | label / value details |
| `TableWrap` + `<table className="k-table is-hover">` | wide tables; `is-stack` + `data-label` on `<td>` for phones |
| `SheetFrame title description aside footer onClose onSubmit size` | modal; bottom sheet on phones |
| from `ui`: `Pill`, `Banner`, `ErrorNote`, `EmptyState`, `SkeletonList`, `ProgressBar`, `Avatar`, `Pagination`, `ActionMenu`, `ConfirmDialog` | restyled in place, same props |
| from `dash`: `Card`, `StatStrip`, `SegmentedBar`, `ProgressRow`, `PersonRow`, `StatusChip`, `InitialsAvatar`, `Notice` | dashboards; reuse for figures |

Classes you may use directly: `dash-card`, `dash-strip` + `dash-fig` (a figure; `button.dash-fig.is-on` for a filter figure), `dash-note`, `k-note is-ok|warn|risk` (message strip), `k-pill is-ok|warn|risk|info`, `k-seg` (two or three exclusive views), `k-item` (padding of a plain `<li>` in a flush card), `k-pad`, `k-input`, `k-hint`, `k-error`, `k-bar`.

## Recipes by page type

**List page with filters and pagination** (template: `app/coordinator/interns/InternMonitoring.jsx`)
`Page` > `PageHeader` (+ `Btn primary`, `ActionMenu`) > optional `k-note is-warn` link banner > figure strip (`dash-strip`, buttons if they filter) > `FilterBar` (SearchField, selects, `Chips`) > `Banner`/`ErrorNote` > `Section flush` containing skeleton / `EmptyState` / the rows or table, then `Pagination`.
Phones: search on its own row, selects two per row (or the page's own "Filters" toggle), chips scroll sideways, rows become cards.

**Detail page with sections** (template: `app/dean/interns/[deploymentId]/InternDetail.jsx`)
`PageHeader back title(+Pill) sentence meta` > figure strip with `Bar` > `Cols` of `Section`s > `TabBar` > tab content in `dash-card is-flush` + `k-list` / `k-item`, or `dash-card` blocks. Quiet footer note at the end.

**Form page / settings hub** (templates: `components/settings/SettingsHub.jsx`, `app/supervisor/settings/AttendanceSettings.jsx`)
Hub: `Page className="max-w-4xl"` > `PageHeader` > one `Section flush` per group with `DataRow href` rows (plain muted icon, title, description, arrow). No icon tiles.
Form: `PageHeader`, `Banner` for result, `FormField`+`Input`, selectable cards keep their `role="radio"`, one primary `Btn` bottom right (full width on phones).

**Table-heavy page** (template: `app/dean/interns/DeanInterns.jsx` + `components/dean/InternTable.jsx`, `components/coordinator/InternRoster.jsx`)
`dash-card is-flush` > `k-tablewrap` > `table.k-table.is-hover`. Header cells are plain `<th>` (kit styles them); no `px-*/py-*` on `th/td`. Sort buttons inside `th`. Status as `Pill`. On phones either cards (as the roster does) or `k-table is-stack` with `data-label`.

**Modal / sheet** (template: `components/AddInternModal.jsx`)
`SheetFrame` with `footer` buttons (`Btn`; cancel first, primary last; they stack on phones, primary on top). Multi-step: change `footer` and body per step. Use `onSubmit` to make the panel a form. Keep your own open/close and dismiss rules (`dismissOnOverlay` only if the old modal had it).

**Empty / loading / error**: `EmptyState icon title text action`; `SkeletonList`; `ErrorNote onRetry`. Never leave a blank card. Say what to do next.

**Chat / messenger**: surfaces use `bg-white` / `bg-slate-*` tokens already; own bubbles `bg-blue-600 text-white`; keep input 16px on phones.

**Report / print pages**: print stays black on white; do not apply dark tokens (`print:bg-white`), no shadows, no card borders needed.

## Risky actions, errors and small helpers (added in the S4 fix pass)
- Anything that rejects, deletes or marks money as received goes through `ConfirmDialog` (say what will happen; Cancel does nothing). A reason that the API accepts goes in a `SheetFrame` with a `Textarea` (see `RejectSheet` in `app/coordinator/documents/DocumentMonitoring.jsx`), never `window.prompt`.
- A save that fails must say so and put the old value back (see `updateInquiry` in `app/superadmin/inquiries/PlanInquiries.jsx`). Never `.catch(console.error)` on something the user thinks was saved.
- A dashboard that fails shows `Notice onRetry` and hides its figures; never a row of zeros.
- Exactly one `h1` per screen: the `PageHeader`/`DashHeader` title. The shell's sidebar brand and top-bar title are plain `<p>`.
- `Avatar tone="self"` pins the blue tint (own profile pages); the initials sit under the photo so a slow or broken photo still shows a circle.
- Photos that fail to load show a "No photo" tile (`AttendanceSelfies`, `PhotoViewer`, `OfflineImage`).
- Super Admin toasts: `const [toast, showToast] = useSaToast()` (`app/superadmin/SaToast.jsx`), the timer is restarted by a newer toast.
- `lib/billingConstants.js` holds the bank details, list prices and the test-mode flag that no API returns yet (the Super Admin approve form reads live prices from `plans-features` first).
- Layouts show `components/ui/ShellSkeleton` while the session check runs (never a blank screen).

## Long lists (never load everything)
- The server pages every list that can pass ~25 rows (`page`, `per_page` clamped to 50; answer carries `total`, `page`, `per_page`, `last_page`, `has_more`; backend helper `App\Support\Paging`). Search and filters run on the server over the whole set, and a changed filter or search goes back to page 1 (ignore stale answers with a request counter).
- Feed-like lists (newest first, no need to jump): `<LoadMore shown total hasMore loading onClick />` from `@/components/Pagination` under the list (activities, attendance, logs, task History).
- Tables and rosters: `<Pagination page totalPages total loading onPageChange />` (same file) inside the `Section flush`, and keep the old rows on screen while the next page loads.
- Both footers use `.k-pager` (44px buttons on phones, no overflow at 390). Small bounded lists (companies, supervisors, a person's own documents) stay unpaged.

## Phone recipes (390 wide first, check 360 and 320)
- Touch targets are 44px tall: `Btn`, chips, tabs, menu items, icon buttons already are on phones. For a hand-made button add `max-sm:min-h-[44px]` (the spacing scale is shrunk on phones, so `h-11` is only 40px).
- Inputs are 16px (no iOS zoom). Use `Input/Select/Textarea` (`k-input`).
- **Stacked table rows**: `<table className="k-table is-stack">`, `<td data-label="Hours">`, first cell `className="is-title"`, last cell `className="is-actions"`. Or render a separate card list below `md` as `InternRoster` does.
- **Filters**: `FilterBar` wraps; for many selects keep the "Filters" toggle button (`sm:hidden`) and a `hidden sm:flex` group, as the Interns page does.
- **Bottom sheet**: `SheetFrame`. It sits at the bottom, has a scrolling body and a sticky footer that respects the home bar and the keyboard (`.sheet-overlay` rules in globals.css).
- **Action row**: put buttons as direct children of `PageHeader` / `.k-actions` (they wrap and grow on phones) or in `DataRow actions` (they drop under the text on phones).
- No horizontal page scroll: long words need `min-w-0` + `truncate` or `break-words`; wide tables go inside `k-tablewrap`.
- Sticky bars must not hide content: keep them in normal flow unless there is a reason, and add bottom padding.

## Do
- Soft tinted chips, hairlines, 14px card radius, one accent blue, calm figures (value in ink, tone only for status).
- Lucide icons through `NavIcon` only; plain muted icons, no coloured tiles.
- One short sentence under a title instead of a banner.
- Text >= 4.5:1 on its surface in both themes (use tokens, they are tuned).
- Semantic headings (`h1` in `PageHeader`, `h2` in `Section`), labels on every control, `aria-pressed` on toggles.

## Don't
- No gradient banners, no emoji, no rows of identical coloured-icon tiles, no saturated bordered coloured boxes, no neon, no glow or heavy shadows.
- No pure white text on dark, no charcoal/grey dark (dark is the blue family), no `bg-black` panels.
- No hard-coded hex colours in screens; no `dark:` variants (tokens already handle dark).
- Do not change props, state, requests, validation, routes or wording (except a heading replaced to fit the layout, same meaning).
- Do not nest a card in a card; do not put a link inside a button.

## Checking your work
Screenshots in light and dark at 1440 and 390 (also 320 for overflow), the contrast scan and the overflow check from the scratchpad (`shots.mjs`, `contrast.mjs`), `npx eslint <files>`, and read your `git diff`: it must show markup/class changes only.
