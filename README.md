<p align="center">
  <img src="extension/icons/icon-128.png" width="88" alt="">
</p>

<h1 align="center">AdSkip for Deezer</h1>

<p align="center">
  Skips the ads that podcast hosts insert into the episodes you play on deezer.com.<br>
  No crowdsourcing, no server, no tracking.
</p>

<p align="center">
  <img alt="Firefox 128+" src="https://img.shields.io/badge/Firefox-128%2B-FF7139?logo=firefoxbrowser&logoColor=white">
  <img alt="Chrome 121+" src="https://img.shields.io/badge/Chrome-121%2B-4285F4?logo=googlechrome&logoColor=white">
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-2f7d4f">
</p>

## Why

You pay for Deezer Premium, you start a podcast, and the episode opens with a 30 second ad. Premium can't do anything about it, because those ads don't come from Deezer. They are added by the company hosting the podcast, directly into the MP3, right before the file is sent to you. For an ad blocker, the ad and the show are the same file: there is nothing to block.

It turns out the host usually tells your browser exactly where it put them, one way or another.

## How it works

When Deezer plays an episode hosted on Audiomeans, the audio comes from a URL that looks like this (shortened):

```
https://files.audiomeans.fr/YWRzdjI/.../....mp3
    ?ap=103591-585080,10792063-11273134
    &o1=16001
    &o2=102593457
    &o3=103590
    &Expires=...&Key-Pair-Id=...&Signature=...
```

| Parameter | Meaning |
|---|---|
| `ap` | Byte ranges of each ad, `start-end`, comma separated |
| `o1` | Bytes per second (here 128 kbit/s, constant bitrate) |
| `o2` | Total size of the file |
| `o3` | Where the audio starts, right after the ID3 tag |

With a constant bitrate, turning a byte into a timestamp is a single division: `(byte - o3) / o1`. For the URL above, that's a 30 second ad at 0:00 and another one from 11:08 to 11:38, in an episode of 1:46:45.

Acast is even more forthcoming. It assembles a file for each listener and publishes the recipe next to it, at the same address with a `.json` extension: every segment, in seconds, marked as either the episode or something the stitcher added. On one episode of *Legend* that comes to four breaks and 2 minutes 18 of ads, read in a single request, with nothing to measure.

Simplecast says nothing and publishes nothing, but its API names the original episode, so the assembled file and the original can be compared. That one comes with a catch, described under Limitations.

Radio France says nothing of the sort either, but the URL it serves names the original episode, which is still downloadable without the ads. The extension compares the two files: it reads four kilobytes at the same place in each, and depending on whether they match, looks earlier or later. About fifteen of those narrow down where a block was inserted. On a 48 minute episode of *Affaires sensibles*, seven range requests and 28 kB were enough to place a 29.5 second pre-roll, before playback started.

Nothing is downloaded twice, and neither file is ever fetched whole.

The extension reads those values, checks them against the duration measured by the browser, and moves the playhead past each ad when playback reaches it. The file and the request are left untouched: the URL is signed, and the ads are simply jumped over.

The full analysis, including everything that keeps it from cutting into the show, is in [docs/how-it-works.md](docs/how-it-works.md).

## Install

The extension isn't on the Firefox and Chrome stores yet. In the meantime it loads from source in a minute.

**Firefox** (128 or later)

1. Download or clone this repository.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and pick `extension/manifest.json`.

Temporary add-ons are removed when Firefox restarts.

**Chrome, Edge, Brave and other Chromium browsers** (121 or later)

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the `extension` folder.

Then open a podcast on [deezer.com](https://www.deezer.com) and press play. The toolbar badge counts the ads skipped in the tab, and the popup lists the ones found in the current episode.

## What it skips, and what it doesn't

- **Skipped:** ads inserted by the podcast host when the file is downloaded (dynamic ad insertion). They're the ones that change from one listen to the next.
- **Never skipped:** sponsor messages read by the hosts themselves. They're part of the recording, and for many independent shows they're what pays the bills. The settings keep ad categories separate in case a way to detect those shows up one day, and it would stay opt in.
- **Never touched:** music. Songs on Deezer are protected and played through a different path. The extension only acts on podcast files from a supported host.

## Supported

| | |
|---|---|
| Browsers | Firefox 128+, Chrome 121+ and other Chromium browsers |
| Player | Deezer web player, www.deezer.com |
| Podcast hosts | Audiomeans, Acast, Radio France |

The Deezer desktop and mobile apps are not supported: they can't run browser extensions.

## Limitations

This works because of how the hosts happen to serve their files: one puts the ad positions in the URL, one publishes a manifest, one leaves the original episode reachable. Those are details of their implementations, not promises. If any of them changes, the extension will stop skipping (it's built to do nothing rather than guess) until the adapter is updated.

Also worth knowing:

- Only podcasts from supported hosts are handled. Plenty of shows on Deezer use other hosts, like Acast, Ausha, Megaphone or ART19, whose URLs haven't been studied yet.
- **Simplecast is written but not yet seen working.** Reading the file being played needs the background, since a page isn't allowed to read it at all, and working out where the breaks are costs a few megabytes rather than a few kilobytes. Both ends of a real episode have been read and its structure measured, but no listen has yet been sat through end to end, so it stays out of the list above until one has.
- A host that neither describes its ads nor leaves the original episode reachable can't be supported this way at all.
- A post-roll is skipped like any other break, which lands the playhead at the end of the episode.
- If a file turns out to be variable bitrate, bytes can't be turned into timestamps reliably, and the episode is left alone.
- The playhead jumps over the ads, so they still show on the progress bar.

## Contributing

Anyone can help, and a few things would make a big difference:

- **Testing** on the podcasts you listen to, and reporting what you see. The popup has a **Copy debug info** button that gives everything an issue needs, without the signed URL.
- **Adding podcast hosts.** Each host is a small adapter that reads a URL and returns the ad positions. [docs/adding-a-host.md](docs/adding-a-host.md) explains how to study a host and write one. Even just documenting what a host's URLs look like, in an issue, is useful.
- **Fixing things** when a host or Deezer changes something.

See [CONTRIBUTING.md](CONTRIBUTING.md) to get set up. There is no build step and no dependency, `npm test` runs the tests with Node's built-in runner.

## Privacy

Nothing leaves your browser: no analytics, no account, no server. The extension stores two things locally, your settings and the number of ads skipped.

For hosts that publish a manifest, the extension reads that one file. For hosts that have to be compared against the original episode, it reads a few kilobytes from the same CDNs your browser is already talking to. Both are done with cookies left out, and a redirect is always refused rather than followed. Nothing about you is sent anywhere.

One host serves the file being played in a way a page isn't allowed to read, so those few kilobytes are read by the extension's background script instead. It will only read from the podcast hosts listed below: an address a web page made up is refused, and so is a read large enough to be a download.

Acast manifests also list the tracking URLs a player is expected to call when each ad is heard. The extension reads the segment list and ignores them.

| Permission | Why |
|---|---|
| `www.deezer.com` | Find the podcast player and move its playhead. Chrome also needs it to report the audio requests made by the page |
| `*.audiomeans.fr`, `*.acast.com`, `media.radiofrance-podcast.net`, `*.simplecastaudio.com` and `webRequest` | Read the address of the audio file, which Deezer's player reaches through a redirect, and for one host read a few kilobytes of it. The player's own requests are only observed, never blocked or changed |
| `storage` | Keep your settings and the counter |

## A word for podcasters

Skipping ads isn't free for the shows people love, and that's why the line is drawn where it is: ads stitched in by an ad network are skipped, the hosts' own sponsor reads are not. If you make a podcast and think this should work differently, open an issue. That feedback is welcome.

## License

[MIT](LICENSE). This project is not affiliated with Deezer, Audiomeans, Acast, Radio France or Simplecast.
