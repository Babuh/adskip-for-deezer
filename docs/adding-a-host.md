# Adding a podcast host

Podcast ads are usually stitched in by the hosting platform when the file is downloaded. Some platforms describe what they inserted in the file URL, like Audiomeans does. Supporting a new one means finding that description and writing an adapter that reads it.

## 1. Look at the request

1. Open a podcast from that host on deezer.com.
2. Open the developer tools, go to the **Network** tab, filter on media requests, and start playback.
3. Find the audio request and any redirect before it. Note the domain and every query parameter that isn't obviously a signature.
4. Listen to the episode and write down when the ads start and end. Compare with the parameters: byte offsets, milliseconds, seconds...

Doing this on two or three episodes, with and without ads, usually makes the format clear.

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

Converting, checking against the duration measured by the browser and skipping are shared by all hosts. The adapter only reads the URL.

## 3. Register it

In `extension/manifest.json`:

- add the file to the `js` list of the first content script, after `lib/hosts.js`;
- add the domain to `host_permissions`, so the background script sees requests that reach it through a redirect.

## 4. Test it

Add fixtures and tests next to `test/audiomeans.test.js`: a normal URL, no ads, one ad, several, and malformed values. Replace every identifier, signature and key with a placeholder before committing, and keep only the values the parsing depends on.

Then open a pull request with a short note on how you worked out the format. If you only got as far as step 1, open an issue with the "New podcast host" template instead: that alone is a big help.
