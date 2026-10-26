# Platinas

PWA to read game guides and strike items off while playing. Plain HTML/CSS/JS, no build step. Data stays in the browser (`localStorage`) and works offline.

## Guide format

- `# Title` starts a section
- `> text` is a note (not strikeable)
- any other line is an item you tap to strike

## Deploy on GitHub Pages

Repo Settings > Pages > Source: "Deploy from a branch". Pick the branch (for example `main`) and folder `/ (root)`. The site goes live at `https://<user>.github.io/platinas/`.

## Deploy on Cloudflare Pages (alternative)

Connect the repo in Cloudflare Pages. Framework preset: none. Build command: empty. Output directory: `/`.

When changing cached files, bump `CACHE` in `sw.js`.
