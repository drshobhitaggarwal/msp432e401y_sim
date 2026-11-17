#!/bin/bash
cd "$(dirname "$0")"
{
  cat head.html
  cat body.html
  echo '<script src="https://cdn.jsdelivr.net/npm/acorn@8.12.1/dist/acorn.js"></script>'
  echo '<script>'
  cat core.js regs.js buses.js api.js parts.js parts2.js compiler.js examples.js ui_parts.js ui_dbg.js ui.js
  echo '</script>'
} > app.html
wc -c app.html

# Standalone page for GitHub Pages or any static host: adds the doctype, charset and viewport that app.html (a fragment) leaves out.
{
  echo '<!doctype html>'
  echo '<html lang="en"><head>'
  echo '<meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width, initial-scale=1">'
  cat head.html
  echo '</head><body>'
  cat body.html
  # acorn is inlined when installed (npm install), so the page works offline and without the CDN
  if [ -f node_modules/acorn/dist/acorn.js ]; then
    echo '<script>'; cat node_modules/acorn/dist/acorn.js; echo '</script>'
  else
    echo '<script src="https://cdn.jsdelivr.net/npm/acorn@8.12.1/dist/acorn.js"></script>'
  fi
  echo '<script>'
  cat core.js regs.js buses.js api.js parts.js parts2.js compiler.js examples.js ui_parts.js ui_dbg.js ui.js
  echo '</script>'
  echo '</body></html>'
} > index.html
wc -c index.html
