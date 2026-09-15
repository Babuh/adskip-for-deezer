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

It turns out the host tells your browser exactly where it put them.

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
| Podcast hosts | Audiomeans |

The Deezer desktop and mobile apps are not supported: they can't run browser extensions.

## Limitations

This works because a podcast host happens to put the ad positions in the file URL. That's a detail of their implementation, not a promise. If it changes, the extension will stop skipping (it's built to do nothing rather than guess) until the adapter is updated.

Also worth knowing:

- Only podcasts from supported hosts are handled. Plenty of shows on Deezer use other hosts, like Acast, Ausha, Megaphone or ART19, whose URLs haven't been studied yet.
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

| Permission | Why |
|---|---|
| `www.deezer.com` | Find the podcast player and move its playhead. Chrome also needs it to report the audio requests made by the page |
| `*.audiomeans.fr` and `webRequest` | Read the address of the audio file, which Deezer's player reaches through a redirect. Requests are only observed, never blocked or changed |
| `storage` | Keep your settings and the counter |

## A word for podcasters

Skipping ads isn't free for the shows people love, and that's why the line is drawn where it is: ads stitched in by an ad network are skipped, the hosts' own sponsor reads are not. If you make a podcast and think this should work differently, open an issue. That feedback is welcome.

## License

[MIT](LICENSE). This project is not affiliated with Deezer or Audiomeans.
