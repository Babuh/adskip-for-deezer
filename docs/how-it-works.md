# How it works

Where podcast ads on Deezer come from, what the extension reads, and the checks it runs before touching the playhead.

## Where the ads come from

The ads you hear in podcasts on Deezer don't come from Deezer. They are added by the platform hosting the podcast: the host picks the ads, stitches them into the MP3 and serves the result, either at the moment the file is requested or ahead of time. This is called dynamic ad insertion. It's why a Premium subscription doesn't remove them, and why ad blockers can't either: the ad and the show are one and the same file.

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

## When the host publishes the answer

Acast does the opposite of hiding it. It assembles a file for each listener, served at `/livestitches/<hash>.mp3` on `stitcher2.acast.com`, and puts the recipe right next to it: the same path with a `.json` extension. No signature is needed to read it, and it answers `Access-Control-Allow-Origin: *`.

The interesting part is `sourceList`, which lays out the file end to end in seconds:

| # | Type | Start | End |
|---|---|---|---|
| 0 | `ad` (preroll) | 0.000 | 12.826 |
| 1 | `audioBreak` | 12.826 | 15.099 |
| 2 | `source` | 15.099 | 2796.880 |
| 3 | `audioBreak` | 2796.880 | 2799.152 |
| 4 | `ad` (midroll) | 2799.152 | 2829.271 |
| 5 | `ad` (midroll) | 2829.271 | 2859.943 |
| ... | | | |
| 13 | `ad` (postroll) | 4524.982 | 4545.386 |

Only `source` is the episode. Everything else was put there by the stitcher: the ads, and the two and a quarter second Acast sting that brackets each block. Segments that touch are joined into one break, which for the episode above gives four: 15.10 s at the start, 65.34 s at 46:37, 34.66 s at 1:03:34, and a post-roll of 22.68 s. A hundred and thirty-eight seconds in all, against four thousand four hundred and eight seconds of show.

Two numbers confirm the reading. The `source` segments add up to 4407.61 s, and Acast's own feed gives the episode a length of 4407 s and the original file a size of 70 522 671 bytes, which at 128 kbit/s is 4407.7 s. They agree.

Since the positions are already in seconds, there is no bitrate to trust and no conversion to check: the only verification left is that the file the manifest describes is as long as the one the browser is playing.

The manifest also lists the tracking URLs the player is expected to call when each ad is heard. The extension reads the segment list and nothing else; it never calls them.

## When the URL says nothing

Radio France doesn't give any of this away. Deezer's player is given an address on `proxycast.radiofrance.fr`, which redirects to a file under a `/ts/` prefix:

```
GET https://media.radiofrance-podcast.net/ts/podcast09/<hash>/<episode>.mp3
    ?podcast=podcast09%2F<episode>.mp3
    &geoipcountry=FR&geoipzip=<postcode>
    &provider=deezer&providerTargetspot=deezer
    &cu=<listener-id>&itemMasterMid=...&pubDate=...&br=...
    &title=...&stationname=France+Inter&podray=...
```

Not one of these parameters says where the ads are. They are targeting (`geoipcountry`, `geoipzip`, `cu`, and `providerTargetspot`, Targetspot being the ad platform) and metadata (`title`, `stationname`, `pubDate`). The file behind the `/ts/` prefix is also static: the same length and the same `ETag` come back whatever country, postcode or provider is asked for, so the ads are baked in ahead of time rather than chosen per listener.

What does help is `podcast`, which names the original episode. That file is still served from the same domain, without the prefix, and it is the episode without the ads. Both files accept range requests and both answer `Access-Control-Allow-Origin: *`.

So for this host the positions aren't read. They are worked out, by comparing the two files.

## Comparing two files without downloading them

The served file is the original with blocks inserted into it, and nothing else changed. Reading both from end to end would settle it, but that means twice the episode in downloads. There is no need: the two files agree everywhere except around the insertions, so the only thing to look for is the positions where they stop agreeing, and that is a binary search.

Four kilobytes are read at the same place in both files. If they match, the insertion is further on; if they don't, it is before. About fourteen rounds place a boundary to within a few kilobytes on a fifty megabyte episode, and a last read gives the exact byte. When there is more than one break, a block of audio from the middle of the undecided stretch is looked for in the served file, which says how far it has drifted there and splits the problem in two.

Three details decide whether this works on a real file rather than a tidy one.

The comparison does not start at the first byte of audio. An MP3 usually opens with a Xing or LAME header frame describing the file, and a stitcher writes its own, so the opening kilobytes of the original appear nowhere in what is served. Starting a few kilobytes in steps over it.

The file does not have to end with the show. An episode can close on a post-roll, and then the last of the original sits short of the end of what is served. The drift at the end is looked for rather than assumed, and whatever lies beyond it is a break like any other. Assuming otherwise is what once made a post-roll look like two files with nothing in common.

Both ends are handed over as soon as they are known, before anything has been done about the middle. A pre-roll is audible for exactly as long as the comparison takes, and finding the mid-rolls costs far more than finding the two ends: waiting for them before saying anything means listening to the pre-roll while they are found. Whatever is known is always in order and never overlapping, so it can be acted on on its own.

Looking for where a block of audio ended up means reading a stretch of the served file, which can run to megabytes. It is read in half megabyte pieces, overlapping by a chunk so nothing straddles a seam, and stops at the first match: a pre-roll turns up in the first piece. The search for what follows the show runs from the far end instead, for the same reason. A whole comparison is capped at thirty two megabytes and four hundred requests, and gives up rather than exceed either.

The size of each file has to be asked for separately, with a `HEAD` request. The obvious place to read it would be the `Content-Range` of a partial response, but that header is not on the CORS safelist: from a page on deezer.com, a 206 from the CDN exposes `Content-Length`, `Content-Type` and `Last-Modified`, and nothing else. `Content-Length` on a `HEAD` is the one number that is always readable.

Here is the episode of *Affaires sensibles* this was built from:

| | Bytes |
|---|---|
| Original, ID3 tag | 12 341 |
| Original, audio | 46 081 670 |
| Served, ID3 tag | 57 154 |
| Served, audio | 46 554 183 |
| Inserted | 472 513 |

The two files differ from the very first byte of audio, and the original matches the served file again 472 513 bytes further along. One insertion, at the head: a pre-roll from 0 to 29.53 s, and nothing else in 48 minutes. Nine requests, 32 kB read.

How long that takes is not a detail. A pre-roll plays for exactly as long as the comparison does, so what counts is the number of round trips on the critical path, not the number of requests. The sizes and the first chunk of both files go out together, then the three comparisons that settle the common case of a single pre-roll go out together too, and the first audio frame, which only serves to report the bitrate at the end, is fetched without being waited on. Two round trips instead of five, measured at 52 ms against 104 ms on the same connection.

The comparison is by bytes, so it can't tell silence from silence. A boundary landing in a silent stretch can be off by a few frames, which is inaudible either way. Everything else is exact.

## When the page isn't allowed to look

Simplecast is the awkward one. It assembles a file for each listen, says nothing about what went into it, and publishes no manifest. The original episode is reachable, on a different domain, so the two could be compared. Except that the assembled file cannot be read from the page at all:

```
fetch(assembled, { headers: { Range: 'bytes=0-4095' } })
  -> TypeError: Failed to fetch
fetch(original,  { headers: { Range: 'bytes=0-4095' } })
  -> 206, 4096 bytes
```

The CDN serving the assembly doesn't put an `Access-Control-Allow-Origin` header on its partial responses, so a page on deezer.com is refused. Passing the range as the `x-access-range` parameter the URL already carries doesn't help either: the request never returns its headers.

A request the extension makes from its background isn't subject to those rules, as long as the address belongs to a host the extension has permission for. So for this one host, and only for the assembled file, the bytes are read there and handed back to the page. The original stays a normal read from the page, which is what keeps this from needing permission over the whole of Simplecast.

The assembly is read by its address alone, with the query thrown away. That query carries the listening session, and the server keeps a read position against it: reading the very file the player is streaming, under the player's own session, moves that cursor under its feet. The path serves the same bytes and disturbs nothing, and it hands nobody's identity back to the server.

Only one file is ever worked out at a time. A page can be handed several addresses at once, Deezer asks for more than one, and comparisons running together would compete for bandwidth with the audio the player is trying to stream.

Which makes it all the more important that none of them can wait forever. A request that hangs rather than refuses, or a background script shut down between the question and its answer, would otherwise hold that queue closed for as long as the page stays open, and the extension would do nothing at all until it was reloaded. Every request gives up after twenty seconds, every read waiting on the background gives up after twenty, and a whole comparison gives up after forty five. Giving up is reported like any other failure.

The background will only read from the podcast hosts. An address the page made up is refused, so this can't become a way to fetch anything at all, and a read large enough to be a download is refused too.

Two traps are worth knowing about, and they are the same trap twice.

Asking the assembled file how long it is, with a `HEAD`, does not fail: it follows a redirect and answers about **another** assembly of the same episode, with different ads and a different length. The number would be wrong rather than missing, and every position derived from it would land in the show. The length is taken from `x-total-bytes` in the URL instead, which states it outright, and `lib/stitching.js` accepts sizes the caller already knows so that question is never asked.

The same thing happens to a range request past the first megabyte or two of an assembly: a `302` back to the generic address, which hands out a fresh assembly. Followed, it returns bytes that are perfectly valid and belong to a different file. Every read the extension makes now refuses redirects outright, for every host: reading somewhere else is worse than not reading at all.

An assembly is not readable all at once. It appears to be built as it is listened to: the beginning answers, and anything past what has been built so far is refused with the same redirect. How far that reaches varies, and an assembly left alone for an hour stops answering altogether.

So the end of the file may simply not be there yet when this runs, and asking for it must not cost anything else. A refusal at either end is caught rather than allowed to travel: where the pre-roll ends is worked out from the start of the file alone, and it is handed over on its own. The mid-rolls and whatever follows the show need both ends to be measured against, and are given up on when only one is there. The popup says as much rather than implying the episode has one ad in it.

That episode is also the one that showed what a real stitched file looks like: a thirty second pre-roll, a little over two minutes of mid-rolls, and a fifteen second post-roll, a hundred and eighty six seconds in all.

## Not trusting it blindly

Moving the playhead to the wrong place would cut into the show, which is much worse than letting an ad play. So before skipping anything, the extension checks the model against the duration measured by the browser:

1. The duration the file works out to, `(totalBytes - audioOffset) / bytesPerSecond`, must be within 2 seconds of `audio.duration`. If it is, the declared bitrate is used.
2. If it isn't, the bitrate is recomputed from the real duration. It is kept only if it matches a standard MP3 bitrate within 1%. Anything else suggests a variable bitrate, where bytes and time aren't proportional, and the episode is left alone.
3. The breaks must look sane: in order, not overlapping, inside the episode, between 1 second and 10 minutes long, and less than half of the episode in total.

Positions already given in seconds skip the first two steps, since there is nothing to convert, but the file they describe still has to be within 2 seconds of the one being played. A manifest belonging to another episode would otherwise drop its breaks in the middle of this one.

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
- a timer set for the moment the playhead reaches the next break. Four events a second means a mid-roll could otherwise be a quarter of a second under way before anything looked at it. The timer only calls the same check, which decides on its own terms, so if it never fires nothing changes.

A few margins take care of the details. The skip triggers 0.15 s before the theoretical start, since `timeupdate` isn't continuous, and lands 0.05 s after the end so the last frame of the ad isn't heard. Nothing happens in the last 0.3 s of a break. If a jump lands back inside the same break, it is retried at most twice, a second apart, so it can never loop. Going back before a break and playing through it again skips it again.

## What it never does

- **Change a request.** The file is played exactly as served, only the playhead moves. Files the extension reads for itself are separate requests, for reading only.
- **Send anything anywhere.** No analytics, no server. The only things stored are the settings and a counter, locally. What the extension reads for itself, a manifest or a few kilobytes of a file, comes from the same podcast hosts the browser is already talking to, with cookies left out.
- **Touch music.** Songs on Deezer are encrypted and played through a different path. The extension only acts on files from a supported podcast host.
- **Skip host-read sponsorships.** `ap` only covers what the stitcher inserted. Sponsor messages read by the hosts are part of the recording and, for many independent shows, their main income. Settings keep ad categories separate, so anything detected later can be opt in.
