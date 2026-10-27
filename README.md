# Platinas

PWA to read game guides and strike items off while playing. Plain HTML/CSS/JS, no build step. Data stays in the browser (`localStorage`) and works offline.

## Structure

Games are folders. Each folder holds guides. Inside a guide, groups open and close (closed by default) and show a done/total counter. Tap the checkbox to strike an item; tap the item text (or the info icon) to read its detail. Open groups and progress are remembered. Data lives in IndexedDB on the device.

## Guide format (text)

- `#`, `##`, `###` start a group, nested by depth
- `- text` is an item you can strike (a bare line works too, `[x] text` starts it done)
- `> text` is detail for the item above it (or for the group, before its first item)

Use "Importar" to load a `.txt` guide or a `.json` backup. "Backup" downloads everything, progress included.

## Steam guide converter

`tools/steam_guide_to_text.py <guide.html|URL> <out.txt>` converts the Steam "100% Achievement Guide: The Witcher 3" (by Cynical Guides) into the text format above.

## Gwent card guide

`tools/build_gwent_guide.py` builds `guides/gwent.txt` (cards by faction, with art) from `guides/witcher3.txt`. Card art is loaded at runtime from the Witcher wiki (Fandom) and cached on the device; it is not stored in this repo. Cards link to their entry in the main guide (`> @link guide:n`), so ticking one ticks the other. Item art is set with `> @img <url>`.

## Bundled guides

Files listed in `guides/index.json` are imported automatically the first time the app opens (a guide you delete is not re-imported). The Witcher 3 text in `guides/` belongs to its author; it is included here by the repo owner's choice.

## Deploy on GitHub Pages

Repo Settings > Pages > Source: "Deploy from a branch". Pick the branch (for example `main`) and folder `/ (root)`. The site goes live at `https://<user>.github.io/platinas/`.

## Deploy on Cloudflare Pages (alternative)

Connect the repo in Cloudflare Pages. Framework preset: none. Build command: empty. Output directory: `/`.

When changing cached files, bump `CACHE` in `sw.js`.
