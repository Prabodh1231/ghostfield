# Deploy: bass app on GitHub Pages

## Change
Only `.github/workflows/pages.yml`. It now builds both apps, copies them into one `site/` folder, and uploads that folder:

- `site/` = Wi-Fi app
- `site/bass/` = bass app

No Vite change was needed. The bass app already uses `base: "./"`, so its paths work under `/bass/`.

## URLs (after the PR merges and the Pages run passes)
- Wi-Fi: https://prabodh1231.github.io/ghostfield/
- Bass: https://prabodh1231.github.io/ghostfield/bass/

## Checked
- Built both apps locally, one at a time. Both succeeded.
- Bass `dist/index.html` uses `./assets/...` paths. The worker is in `dist/assets`.
- Built the same `site/` layout by hand. It had `index.html`, `assets/`, `bass/index.html`, `bass/assets/`.

## Not done
- No link between the apps. Both are React apps, so a link means editing app code.
- Not opened in a browser. Not run on GitHub yet (it runs on merge to main).

## Undo
Revert the PR. The next Pages run puts back the Wi-Fi-only site.
