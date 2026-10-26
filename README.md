# Platinas

PWA to read game guides and strike items off while playing. Plain HTML/CSS/JS, no build step. Data stays in the browser (`localStorage`) and works offline.

## Guide format

- `# Title` starts a section
- `> text` is a note (not strikeable)
- any other line is an item you tap to strike

## Deploy on Cloudflare Pages

Connect this repo in Cloudflare Pages (Workers & Pages > Create > Pages > Connect to Git). Framework preset: none. Build command: empty. Output directory: `/`.

Or from the CLI: `npx wrangler pages deploy . --project-name platinas`.

When changing cached files, bump `CACHE` in `sw.js`.
