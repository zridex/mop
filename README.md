# Shadow Priest Static Deploy

This folder is a separate static deployment package. It does not modify the main repo or the working executable build.

## What is inside

- `mop/`
  - Shared bundled app files, assets, workers, and `lib.wasm`
  - A custom `mop/index.html` landing page with only the Shadow Priest entry point
  - Only the `mop/priest/shadow/` sim page from the generated site
- `index.html`
  - Redirects the site root to `./mop/`
- `404.html`
  - Redirect helper for static hosts

## Deploy

Upload the contents of this folder as the site root on a static host such as:

- GitHub Pages
- Cloudflare Pages
- Netlify

The important URL after deploy is:

- `/mop/`
- `/mop/priest/shadow/`

## Important note

This is a static browser-hosted version, so simulations run through the browser/WASM path. It is convenient and free to host, but it will not be as fast as the native `wowsimmop-windows.exe` build.
