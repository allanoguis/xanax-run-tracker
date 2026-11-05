# Torn theme reference

Source: [Torn public homepage](https://www.torn.com/), captured and visually inspected on 2026-11-05 at a 1440 px desktop viewport. [Reference screenshot](docs/torn-home-reference.png). The public homepage was used because the tracker does not have an authenticated Torn page to reference. The screenshot showed a centered content column, dark textured top bar, light gray page surface, charcoal gradient panel headers, compact Arial labels, gray table rows, and a muted gold primary action.

## Observed design language

| Role | Reference observation | Tracker treatment |
| --- | --- | --- |
| Header | Near-black charcoal with subtle horizontal texture and inset highlights | Charcoal gradient and fine CSS stripes |
| Page | Desaturated light gray with faint texture | CSS radial gray background and fine stripes |
| Panels | Pale gray content with dark beveled title bars | Gray cards and dark gradient ledger header |
| Data | Small Arial text, close row spacing, thin gray dividers | Compact ledger typography and alternating rows |
| Action | Warm yellow-gold call to action | Gold primary button; gray secondary controls |
| Geometry | Narrow centered content, small corner radius | 1110 px maximum content width and 3–5 px corners |

The reference's branding extraction reported Arial body text, `#333333` primary text, a light gray background, and approximately 5 px input corners. Exact spacing, gradients, and texture above are visual estimates from the screenshot. The tracker uses its own mark and content; it does not use Torn's logo or imagery.

Torn is the initial appearance and is applied through `html[data-theme="torn"]`, with the selection stored in browser local storage. Retired stored theme values migrate to Torn. The public desktop screenshot does not establish Torn's authenticated views, mobile layout, or interaction behavior, so the tracker keeps its own responsive and accessible controls.

## Discord dark theme reference

Source: [Discord's official appearance guide](https://support.discord.com/hc/en-us/articles/207260127-How-to-Change-Discord-Color-Themes-and-Customize-Appearance-Settings), inspected on 2026-11-05. [Official desktop theme example](docs/discord-dark-reference.gif). Discord lists **Dark** as a dark gray interface with white text, distinct from its blacker **Onyx** option. The example shows a near-black side area, charcoal main area, lighter gray raised surfaces, muted secondary text, and a blue-violet action color.

Additional references: [Discord's own chat UI image](https://discord.com/ads/quests) ([local capture](docs/discord-chat-reference.jpg)) and the [desktop search guide](https://support.discord.com/hc/en-us/articles/115000468588-How-to-Use-Search-on-Discord). The chat image shows the narrow server rail, roughly 230 px channel sidebar, slim channel header, broad central pane, dense message spacing, and bottom user area. The search example confirms the compact channel rows and a search field in the header. These are layout observations; the search example uses a different dark variant, so it is not the palette reference.

The tracker approximates those visible roles with `#1e1f22` page, `#151519` top bar, `#2b2d31` panels, `#f2f3f5` primary text, and `#5865f2` actions. These values are implementation choices estimated from the examples, not extracted Discord design tokens. On the connected desktop workspace, the tracker uses a server rail and channel sidebar for its real Overview and Run Ledger anchors, a channel-style header with search and refresh, a central ledger, and a right activity pane containing the three run metrics. Narrow screens collapse the right pane and then the navigation.

Discord uses its custom [gg sans](https://support.discord.com/hc/en-us/articles/9507780972951-gg-sans-Font-Update-FAQ), which its font FAQ says third-party projects cannot use. The tracker bundles the open Noto Sans Variable font for a similar compact sans-serif rhythm. The theme applies through `html[data-theme="discord"]`; the tracker's branding and data remain its own.
