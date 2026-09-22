# Adding a podcast host

Podcast ads are stitched into the episode by the hosting platform. Three shapes have turned up so far:

- the positions are in the file URL, as with Audiomeans;
- they are in a manifest served next to the file, as with Acast;
- nothing says where they are, but the original episode is still reachable, as with Radio France, and the two files can be compared;
- the same, except the page isn't allowed to read the file being played, as with Simplecast, and the reading is done from the background.

Supporting a new platform means working out which of the four it is, and writing an adapter for it.

## 1. Look at the request

1. Open a podcast from that host on deezer.com.
2. Open the developer tools, go to the **Network** tab, filter on media requests, and start playback.
3. Find the audio request and any redirect before it. Note the domain and every query parameter that isn't obviously a signature.
4. Listen to the episode and write down when the ads start and end. Compare with the parameters: byte offsets, milliseconds, seconds...

Doing this on two or three episodes, with and without ads, usually makes the format clear.

If nothing in the URL lines up with what you heard, look at the other requests the page made first: a manifest, a `.json` next to the media file, or an API call carrying the episode id often describes the assembled file outright. Failing that, look for the original episode. A parameter naming a path, a prefix in the path that looks like a stitcher's output, or a slightly different address on the same domain are all worth trying: fetch the candidate and compare its `Content-Length` with the one served to Deezer. A difference of about 16 kB per second of ad means you have found it.

## 2. Write the adapter

Create `extension/hosts/<name>.js`, using `hosts/audiomeans.js` as a model. An adapter registers itself with three members:

```js
root.AdSkip.hosts.register({
  id: 'example',
  matches(url) {},  // url is a URL object: true if this adapter handles it
  parse(url) {},    // null, or a description of the ads
});
```

`parse` returns `null` when the URL isn't a file with inserted ads (for instance the address that redirects to one). Otherwise it returns an object with:

| Field | |
|---|---|
| `unit` | `'bytes'` or `'seconds'` |
| `ranges` | `[[start, end], ...]` in that unit, empty if the episode has no ads |
| `category` | `'inserted'` for ads added by the host |
| `bytesPerSecond`, `totalBytes`, `audioOffset` | Required with `'bytes'`. Used to convert, and to check the model against the real duration |
| `paramNames` | Names of the URL parameters, shown in the debug info |
| `error` | Set instead of returning ranges when the URL doesn't look as expected |

Converting, checking against the duration measured by the browser and skipping are shared by all hosts.

### When the URL isn't enough

An adapter that can't answer from the URL alone returns `pending: true` and a `resolve()` returning a promise, whose result is merged into the source. `lib/hosts.js` runs it once per address, keeps the answer and tells the page when it lands, so `parse` itself stays immediate. An address that didn't work out isn't tried again in that page.

`lib/stitching.js` does the comparison for hosts that leave the original episode reachable, and fills in `ranges`, `totalBytes`, `audioOffset` and `bytesPerSecond` on its own:

```js
resolve: () => stitching.locate({ stitched: url.href, source: original.href }),
```

It reads both files with range requests, a few kilobytes at a time, and throws with a short reason when the pair doesn't make sense. `hosts/radiofrance.js` is fifteen lines on top of it. Capture the `stitching` module in the adapter's closure: `content/page.js` clears the global once everything is loaded.

`resolve` is handed a set of tools. `tools.background` reads a file through the background script, for a host whose CDN refuses cross-origin reads, and the manifest needs the domain in `host_permissions` for that to be allowed. Use it only for the files that need it: `hosts/simplecast.js` sends the assembled file that way and reads the original straight from the page.

`locate` also takes `sizes`, a length per address that the caller already knows for certain. Pass one when asking the file itself would be wrong rather than merely slow.

## 3. Register it

In `extension/manifest.json`:

- add the file to the `js` list of the first content script, after `lib/hosts.js`;
- add the domain to `host_permissions`, so the background script sees requests that reach it through a redirect.

## 4. Test it

Add fixtures and tests next to `test/audiomeans.test.js`: a normal URL, no ads, one ad, several, and malformed values. Replace every identifier, signature and key with a placeholder before committing, and keep only the values the parsing depends on.

For an adapter that compares two files, `test/stitched.js` builds a pair with the ads where you ask for them, and `test/radiofrance.test.js` shows how to answer the range requests without touching the network.

Then open a pull request with a short note on how you worked out the format. If you only got as far as step 1, open an issue with the "New podcast host" template instead: that alone is a big help.
