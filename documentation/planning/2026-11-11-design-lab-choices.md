# Design Lab choices — Ben, 11 Nov 2026

Source: the "Copy my choices" report from the Design Lab (dev server only, `apps/web/src/components/DesignLab.tsx`). The same
values are kept in code as `SEED` / `SEED_DECIDED` in `apps/web/src/lib/designLab.ts`, so a cleared browser, another port
(the Lab stores choices per address, so `localhost:5173` and `localhost:5174` do not share them) or another machine starts from
them, and the Lab has a built-in preset "Ben's saved choices (11 Nov)" to get back to them at any time.

**These are not baked into the real theme yet.** The real theme (`theme.css`, `styles.css`) still has the earlier picks: graphite
palette, extra-large headings, 16px text. Ben said he is not sure about most of the options below, so they stay in the Lab until he
confirms. Nothing here is a product decision for a customer: it is the look of the app.

## Decided by Ben (18): he clicked these himself

| Area | Option | Value |
|---|---|---|
| Colour | Palette | Custom (sliders) |
| Colour | Custom brand hue / intensity | 80° / 0.02 (almost grey, warm) |
| Colour | Custom background tint hue | 130° |
| Colour | Custom accent hue | 83° |
| Colour | App icon colours | Brand colour |
| Colour | Page background | Star lattice |
| Home | Hero banner | Pattern banner (also the default) |
| Data | Table style | Striped |
| Data | Table header | Dark |
| Controls | Primary buttons | Gradient |
| Controls | Button size | Normal (also the default) |
| Controls | Links | No underline |
| Controls | Scrollbars | Browser (also the default) |
| Controls | Motion | Full (also the default) |
| Navigation | Sidebar "All apps" label | Hide |
| Navigation | Company name in top bar | Show (also the default) |
| Navigation | Menu item shape | Follow corner radius (also the default) |

## Kept but not deliberate (12): they differ from the defaults, but Ben did not click them (set by an earlier preset or Surprise)

Treat these as **unconfirmed**: Shape / Corner radius = Subtle; Card style = Floating shadow; Shadow strength = Strong; Exact table row
height = 0.5rem; Content width = Narrow (1100); Navigation / Exact sidebar width = 204px; Group headings = Hide; Logo shape = Sharp;
Home / App tiles = Big cards; Tile accent edge = None; Data / Stat cards = Filled brand; Status chips = Text only.

## Never touched (no opinion)

All other options (about 49 of the 79): headings and body font, heading size and weight, text size, line spacing, border strength,
selection colour, density, icon line weight, avatar shape, sidebar style, sidebar item spacing, active page marker, top bar,
breadcrumbs, row hover, inputs, focus ring and the options added on 11 Nov (accent colour, text contrast, sidebar surface, hero
glow, checkboxes, small-heading case, letter spacing, form labels, table and stat sizes, page margins, chip shape, input height,
empty-list icon, page entrance, tile hover, pop-up backdrop, top bar height, sidebar app header, hero height and alignment, tile
size, Home group headings). The baked-in default applies to all of them.

## The exact settings (paste into the Lab with Import…)

```json
{"palette":"custom","lhue":"80","lchroma":"0.02","lbg":"130","lacc":"83","appcolor":"brand","bg":"lattice","border":"hairline","selection":"default","hfont":"plex","bfont":"plex","hsize":"xl","hweight":"normal","tsize":"large","fspx":"","lheight":"normal","numfont":"mono","titlealign":"start","radius":"subtle","rpx":"","cards":"shadow","shadow":"strong","density":"comfy","rowpad":"0.5","width":"narrow","cwpx":"","iconw":"normal","avatar":"circle","sidebar":"dark","sbw":"normal","sbwpx":"204","navactive":"marker","navspace":"normal","navicons":"on","navgroups":"off","topbar":"paper","crumbs":"on","logo":"sharp","hero":"banner","tiles":"big","tilebar":"none","stats":"filled","table":"striped","thead":"dark","rowhover":"saffron","chips":"text","btn":"gradient","btnsize":"normal","inputs":"boxed","link":"plain","focus":"normal","scroll":"default","motion":"full","accent":"palette","contrast":"normal","sidetint":"flat","heroglow":"on","checks":"brand","caps":"upper","tracking":"normal","labels":"muted","tablefont":"normal","statsize":"normal","pagepad":"normal","badge":"pill","inputh":"normal","empty":"on","pageanim":"rise","cardhover":"lift","modalback":"dim","topbarh":"normal","brandtext":"off","appheader":"card","orgname":"on","navradius":"follow","herosize":"normal","heroalign":"start","tilecols":"normal","suitehead":"line"}
```

## How the choices were made (change log, 30 entries, 8:25 to 11:12 PM)

Controls and Navigation were reviewed first (Motion Subtle to Full, Links Default to Accent underline to No underline, Table style
and header tried Striped, Full grid, Borderless, Underline only and settled on Striped and Dark, "All apps" label hidden), then
Colour: Graphite to Custom, brand hue 187 to 282 to 80, intensity 0.06 to 0.085 to 0.02, background tint 0 to 255 to 130, accent hue
159 to 103 to 83, App icon colours By app to Brand colour, Page background kept as Star lattice.

## Open questions for Ben

- Confirm or drop each of the 12 unconfirmed options above.
- The custom palette is almost grey (intensity 0.02): check contrast in the Lab (the panel's WCAG section) before baking it in.
- When confirmed: bake the winners into `theme.css` / `styles.css`, delete the Lab (`components/DesignLab.tsx`, `lib/designLab.ts`,
  `design-lab.css`, the line in `main.tsx`).
