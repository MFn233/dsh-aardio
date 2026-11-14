# Releasing dsh-aardio

One npm package, one git tag per release. The plugin has no build step: `index.js`,
`client.js`, `lib/`, `bridge/`, `skills/`, `locale/`, and `docs/` are shipped as they are.

## 1. Pre-flight

```powershell
cd <repo>
npm test                       # 107 offline tests, no DSH needed
npm run check                  # node --check on the two entry points
npm pack --dry-run             # must list 28 files, about 95 kB packed
```

`package.json` `files` decides the tarball. If you add a runtime folder, add it there and
extend `test/package.test.js`, which asserts every shipped path exists.

## 2. Version and changelog

- Bump `version` in `package.json`.
- Add a `CHANGELOG.md` entry under a new `## x.y.z` heading. Write what a user observes,
  not which file changed.
- The Plugin Manager reads `locale/*.json` for the description and `docs/DETAIL*.md` for the
  detail page. `DETAIL` files contain exactly one image line — usage text goes in
  `meta.description`, not there.

## 3. Commit, tag, push

```powershell
git add -A
git commit -m "release: x.y.z"
git tag -a vx.y.z -m "dsh-aardio x.y.z"
git push origin main --follow-tags
```

Deleting or moving a published tag is a destructive operation and some tooling blocks it;
do that by hand if a tag has to be re-pointed:

```powershell
git tag -d vx.y.z
git push origin :refs/tags/vx.y.z
git tag -a vx.y.z -m "dsh-aardio x.y.z"
git push origin vx.y.z
```

## 4. Publish to npm

The default registry in this environment is a mirror (`registry.npmmirror.com`), so always
name the public registry explicitly. Accounts with 2FA either pass a one-time password or
use a granular access token with **Bypass 2FA** enabled.

```powershell
# one-time password
npm publish --registry https://registry.npmjs.org --access public --otp <code>

# or a bypass token without writing it into the repo
"//registry.npmjs.org/:_authToken=<token>" | Out-File -Encoding ascii "$env:TEMP\npmrc-dsh"
npm publish --registry https://registry.npmjs.org --access public --userconfig "$env:TEMP\npmrc-dsh"
Remove-Item "$env:TEMP\npmrc-dsh"
```

npm 11 may hold a version in a staging area instead of publishing immediately. A `409
Cannot publish over previously staged version` means it is waiting there:

```powershell
npm stage list dsh-aardio --registry https://registry.npmjs.org
npm stage view <stage-id> --registry https://registry.npmjs.org
npm stage approve <stage-id> --registry https://registry.npmjs.org --otp <code>
# or, to rebuild from the current tree instead:
npm stage reject <stage-id> --registry https://registry.npmjs.org --otp <code>
npm publish --registry https://registry.npmjs.org --access public --otp <code>
```

## 5. Verify the published artifact

```powershell
npm view dsh-aardio version --registry https://registry.npmjs.org
npm view dsh-aardio@x.y.z dist.fileCount dist.unpackedSize dist.shasum --registry https://registry.npmjs.org
```

`fileCount` must match the `npm pack --dry-run` count and `dist.shasum` must equal the
`shasum` line from that same run. To inspect the real tarball:

```powershell
npm pack dsh-aardio@x.y.z --registry https://registry.npmjs.org --pack-destination $env:TEMP
tar -tzf "$env:TEMP\dsh-aardio-x.y.z.tgz"
```

## What needs restarting after a change

| Changed | Takes effect after |
| --- | --- |
| `index.js`, `lib/*.js` (host half) | restart DeepSeek Harness |
| `client.js` (browser half) | refresh the page; the HMR receiver only helps while `pnpm run dev:web` runs in the DSH checkout |
| `bridge/aardioBridge.aardio` | press F5 in the aardio IDE |
| `skills/`, `locale/`, `docs/`, `package.json` metadata | restart DeepSeek Harness |

## Bridge protocol changes

The bridge talks over `%TEMP%\dsh-aardio-bridge\`. Both halves carry a protocol number:
`BRIDGE_PROTOCOL_VERSION` in `lib/bridge.js` and `version` written into `bridge.json` by
`bridge/aardioBridge.aardio`. Bump both together; a mismatch is refused with a message
naming both numbers. Because the host half only loads on a DSH restart and the bridge only
loads on F5, tell users to do **both** after a protocol bump.

Per-client files: the host writes `request-<pid>-<id>.json` and names its reply in
`replyTo`; the bridge answers `response-<pid>-<id>.json`. Two DSH instances share one bridge
without touching each other's files. `web-state.json` in the same folder records whether
the window, the host object, the resize border, and the rounded region were created — read
it first when the bridge window looks wrong.
