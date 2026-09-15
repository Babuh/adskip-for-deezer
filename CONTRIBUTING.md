# Contributing

Thanks for taking the time. Issues and pull requests are welcome, small ones included.

## Setup

Node 20 or later is only needed to run the tests. The extension itself is plain JavaScript loaded as is by the browser: no bundler, no dependency, no build step.

```bash
git clone https://github.com/Babuh/adskip-for-deezer.git
cd adskip-for-deezer
npm test
```

To try your changes, load the `extension` folder in your browser as described in the [README](README.md#install). With [web-ext](https://github.com/mozilla/web-ext) you can also start a clean browser profile that reloads the extension whenever a file changes:

```bash
cd extension
npx web-ext run
```

Add `-t chromium` to use Chrome instead of Firefox.

## Project layout

```
extension/
  manifest.json
  background.js       watches audio requests to known hosts, badge
  content/page.js     runs in the page: finds the player and skips the ads
  content/bridge.js   links the page script to settings, statistics and badge
  lib/                shared logic: host registry, byte to time model, skip decisions
  hosts/              one adapter per podcast host
  popup/              toolbar popup
test/                 unit tests, run with node:test
docs/                 how it works, how to add a host
```

## Debugging

Open the browser console on deezer.com and show debug or verbose messages: everything the extension does is logged with the `[AdSkip]` prefix. The **Copy debug info** button in the popup gives the current state, the detected breaks and the names of the URL parameters (not their values).

If nothing happens in Firefox, check that the extension is allowed on deezer.com and audiomeans.fr: open `about:addons`, then AdSkip for Deezer, then the **Permissions** tab.

## Guidelines

- Keep `lib/` and `hosts/` free of extension APIs so they stay testable with plain Node. New logic comes with tests.
- When in doubt, don't skip. Cutting into the show is far worse than letting an ad play: if a value looks off, give up for that episode.
- Test fixtures must not contain real identifiers. Replace UUIDs, signatures, keys and digests with placeholders, and keep only the values the parsing depends on.
- No telemetry, no remote server, no remote code. Nothing leaves the browser.
- The extension never acts on music or on anything protected by DRM.
- Code style: 2 spaces, single quotes, semicolons, and comments that explain why rather than what.

## Reporting a problem

Use the bug report template and paste the output of **Copy debug info**. Please don't paste full audio URLs: they contain a signature tied to your session.
