# @dcmjs/docs

Documentation site for dcmjs, built with [Docusaurus](https://docusaurus.io/).

From the repository root:

```bash
pnpm --filter @dcmjs/docs start   # dev server with live reload
pnpm --filter @dcmjs/docs build   # production build into packages/docs/build
pnpm --filter @dcmjs/docs serve   # serve the production build locally
```

Content lives in `docs/` (Markdown), navigation in `sidebars.js`, site config in
`docusaurus.config.js`. Internal links use relative `.md` paths and broken links
fail the build (`onBrokenLinks: "throw"`), so run a build before committing
content changes.
