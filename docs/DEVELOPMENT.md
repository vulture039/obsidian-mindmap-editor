# Development

## Commands

```bash
npm install
npm run dev    # watch build
npm run build  # type check + production build
npm run lint
npm test       # run the Vitest unit tests (npm run test:watch to watch)
```

## The dev vault

`dev-vault/` is an Obsidian vault kept in the repo. `npm run dev` builds
straight into `dev-vault/.obsidian/plugins/mindmap-editor/`, so there is
nothing to copy: open the folder as a vault once, and every save lands in it.

Set it up once:

1. Install [Hot Reload](https://github.com/pjeby/hot-reload) into the vault. It
   is a developer tool and is not in Obsidian's plugin browser, so clone it:

   ```bash
   git clone https://github.com/pjeby/hot-reload.git \
     dev-vault/.obsidian/plugins/hot-reload
   ```

   It reloads any plugin whose folder holds a `.hotreload` file (or a `.git`
   one) as soon as its `main.js` changes. Ours has the marker.

2. Obsidian → Open folder as vault → pick `dev-vault/`, and turn off Restricted
   mode. Both plugins are listed as enabled already, so there is nothing to
   switch on.

`npm run dev` then gives: save a `.ts` or `styles.css` → esbuild rebuilds →
Hot Reload reloads the plugin, no manual copying and no restart.

`Fixtures.md` in the vault holds one of everything the parser and the map have
to handle — nested lists, tasks, descriptions before and after a child, an
indented code block, a long unbroken URL, links, deep headings. Walk it top to
bottom for a manual pass instead of improvising. `Linked.md` is what its
wikilink points at, so following one can be seen going somewhere.

## Testing

Unit tests (Vitest) exercise the pure logic — Markdown parsing, the
line-editing operations, fold mapping, palette and drop-target rules. The
Obsidian-API-facing code is exercised by hand in the dev vault rather than
mocked.

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
- [Plugin page](https://community.obsidian.md/account/plugins/mindmap-editor) → click "Check for new releases"
