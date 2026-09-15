# How it works

Where podcast ads on Deezer come from, what the extension reads, and the checks it runs before touching the playhead.

## Where the ads come from

The ads you hear in podcasts on Deezer don't come from Deezer. They are added by the platform hosting the podcast, at the moment the file is requested: the host picks ads for this listener, stitches them into the MP3 and serves the result. This is called dynamic ad insertion. It's why a Premium subscription doesn't remove them, and why ad blockers can't either: the ad and the show are one and the same file.

What makes this project possible is that Deezer doesn't proxy podcast audio. The browser downloads the episode straight from the host's CDN, so the request, and whatever the host puts in its URL, is visible from the page. Spotify, by comparison, re-hosts podcast audio and inserts ads on its own servers, so nothing of the sort reaches the client.

## What the URL says

Here is a request captured in the Firefox developer tools while playing an episode hosted by Audiomeans, with identifiers replaced by placeholders:

```
GET https://files.audiomeans.fr/YWRzdjI/<show-id>/<file-id>.mp3
    ?ap=103591-585080,10792063-11273134
    &o1=16001
    &o2=102593457
    &o3=103590
    &aid=<creative-id>,<creative-id>
    &at=v,v
    &ac=RVVSOjEyLjYwLEVVUjoxMi41MA==
    &dg=<128 hex characters>
    &Expires=...&Key-Pair-Id=...&Signature=...
```

| Parameter | Observed value | Meaning |
|---|---|---|
| `ap` | `103591-585080,10792063-11273134` | Byte ranges of the ads, `start-end`, comma separated |
| `o1` | `16001` | Bytes per second, about 128 kbit/s at a constant bitrate |
| `o2` | `102593457` | Total size of the file in bytes |
| `o3` | `103590` | Offset where the audio starts, which is the size of the ID3 tag |
| `aid` | two UUIDs | Identifiers of the two ad creatives |
| `at` | `v,v` | Type of each creative |
| `ac` | base64 | Decodes to `EUR:12.60,EUR:12.50`, the CPM of each ad |
| `dg` | hex digest | Probably an integrity check on the parameters |
| `Expires`, `Key-Pair-Id`, `Signature` | | CloudFront signature |

Other details confirm the picture. The path prefix `YWRzdjI` is base64 for `adsv2`, the output bucket of the stitcher. The response carries an `x-amz-expiration` header, so the file is a temporary object generated for this listen. And the request has `Sec-Fetch-Dest: audio`: it comes from a regular `<audio>` element, not from `fetch()` or Media Source Extensions.

## From bytes to seconds

The file is a constant bitrate MP3, so a position in bytes and a position in time are on a straight line:

```js
seconds = (byte - o3) / o1
```

With the values above:

| | Byte | Time |
|---|---|---|
| First ad starts | 103591 | 0.00 s |
| First ad ends | 585080 | 30.09 s |
| Second ad starts | 10792063 | 667.99 s (11:08) |
| Second ad ends | 11273134 | 698.05 s (11:38) |
| End of file | 102593457 | 6405.2 s (1:46:45) |

Two 30 second slots, a pre-roll and a mid-roll, in an episode of plausible length.

## Not trusting it blindly

Moving the playhead to the wrong place would cut into the show, which is much worse than letting an ad play. So before skipping anything, the extension checks the model against the duration measured by the browser:

1. The duration announced by the URL, `(o2 - o3) / o1`, must be within 2 seconds of `audio.duration`. If it is, the declared bitrate is used.
2. If it isn't, the bitrate is recomputed from the real duration. It is kept only if it matches a standard MP3 bitrate within 1%. Anything else suggests a variable bitrate, where bytes and time aren't proportional, and the episode is left alone.
3. The breaks must look sane: in order, not overlapping, inside the episode, between 1 second and 10 minutes long, and less than half of the episode in total.

If any of this fails, nothing is skipped in that episode and the popup says why.

## Finding the player

Deezer plays podcasts with an `<audio>` element that is never added to the page: `document.querySelector('audio')` returns `null` while an episode is playing. A regular content script can't reach it.

So part of the extension runs in the page itself (a content script in the `MAIN` world) and wraps two members of `HTMLMediaElement.prototype`: the `src` setter and `play()`. Whenever the player gives an element a source or starts it, the extension starts watching that element. The wrappers call the original methods unchanged, and errors on the extension's side are caught so they can't break playback.

## Finding the URL

Deezer doesn't give the player the stitched file directly. The element's `src` is an address on `audio.audiomeans.fr`, which redirects to the stitched file on `files.audiomeans.fr`, and `src` keeps the first address. The ad positions only appear after the redirect.

So the background script watches requests sent to known hosts (`webRequest`, observation only) and passes their URLs to the tab. Deezer keeps several players around (one of them is for music), so a URL is only matched to an element whose measured duration agrees with the one announced by the URL.

There are two more twists. Once Deezer's service worker controls the page, it makes the audio request on the page's behalf, so the request belongs to no tab: the URL is then passed to every Deezer tab, and the duration check sorts it out. And Chrome only reports a request to an extension that may access both its URL and the page that made it, which is why `www.deezer.com` is part of the host permissions.

If a host serves the stitched file directly, the element's `src` is read as well.

## Skipping

The page script listens to the element's events:

- `loadedmetadata` and `durationchange`: the duration is known, so the model can be checked. A pre-roll is skipped right away, before playback even starts.
- `timeupdate` (about four times per second), `seeked` and `playing`: if the current time is inside a break, jump to its end.

A few margins take care of the details. The skip triggers 0.15 s before the theoretical start, since `timeupdate` isn't continuous, and lands 0.05 s after the end so the last frame of the ad isn't heard. Nothing happens in the last 0.3 s of a break. If a jump lands back inside the same break, it is retried at most twice, a second apart, so it can never loop. Going back before a break and playing through it again skips it again.

## What it never does

- **Change a request.** The URL is signed and any change would get a 403. The file is played as served, only the playhead moves.
- **Send anything anywhere.** No analytics, no server. The only things stored are the settings and a counter, locally.
- **Touch music.** Songs on Deezer are encrypted and played through a different path. The extension only acts on files from a supported podcast host.
- **Skip host-read sponsorships.** `ap` only covers what the stitcher inserted. Sponsor messages read by the hosts are part of the recording and, for many independent shows, their main income. Settings keep ad categories separate, so anything detected later can be opt in.
