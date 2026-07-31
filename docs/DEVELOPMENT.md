# Development

## Commands

```bash
npm install
npm run dev    # watch build
npm run build  # type check + production build
npm run lint
npm test       # run the Vitest unit tests (npm run test:watch to watch)
```

## Testing

Unit tests (Vitest) exercise the pure logic — Markdown parsing, the line-editing operations, palette and drop-target rules.
The Obsidian-API-facing view code is exercised manually in a vault rather than mocked.

To test the plugin in a vault, copy the following files into
`<Vault>/.obsidian/plugins/mindmap-editor/`:

- `main.js`
- `manifest.json`
- `styles.css`

## Issues

- Branch as `feat/issue-<issue-no>` and fix it there
- Open a pull request on GitHub and merge it
- Put `Closes #<issue-no>` in a commit message or in the PR description

## Release

```bash
npm version 1.0.1          # updates package/manifest/versions.json + commits + tags "1.0.1"
git push origin master     # push the commit
git push origin 1.0.1      # push the tag → CI builds and drafts a release
```

- GitHub → Releases → open the "1.0.1" draft
- Write the description
- Click Publish release
