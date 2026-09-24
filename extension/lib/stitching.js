(function (root) {
  'use strict';

  // Not every host says what it inserted. Some serve a file with the ads
  // already baked in and leave the original episode reachable at a
  // neighbouring address. Comparing the two says where the ads are, without
  // having to trust anything the URL claims.
  //
  // The files are identical apart from the inserted blocks, so the comparison
  // is a search for the positions where the alignment between them jumps.
  // Only a few kilobytes are read around each of those positions: at no point
  // is a whole file downloaded.

  const CHUNK = 4096;
  const MAX_PROBES = 400;
  const MAX_WINDOW = 8 * 1024 * 1024;
  // Read in stretches rather than in one piece when looking for where a
  // block of audio ended up: a pre-roll is usually found in the first one.
  const STEP = 512 * 1024;
  // However badly a pair of files behaves, it must never cost more than this.
  const MAX_BYTES = 32 * 1024 * 1024;
  // An MP3 often opens with a Xing or LAME header frame describing the file.
  // A stitcher writes its own, so the first few kilobytes of the original
  // appear nowhere in what it serves. Comparisons start just after.
  const HEADER = 2 * CHUNK;

  // Two boundaries found a chunk or so apart are the two sides of a single
  // insertion; real breaks are minutes away from each other, so anything
  // wider means there is more than one in between.
  const SAME_BOUNDARY = 4 * CHUNK;

  function fail(reason) {
    const error = new Error(reason);
    error.expected = true;
    return error;
  }

  function readLength(value) {
    const length = Number(value);
    if (!Number.isInteger(length) || length <= 0) throw fail('unknown-size');
    return length;
  }

  // The size of a file comes from its own request rather than from the
  // Content-Range of a partial response. That header is not on the CORS
  // safelist, so a page can only read it if the server opts in, and podcast
  // CDNs don't: from deezer.com a 206 exposes nothing but Content-Length,
  // Content-Type and Last-Modified. Content-Length on a HEAD is the one
  // number that is always readable.
  async function fetchSize(url) {
    const response = await follow(url, { method: 'HEAD' });
    if (!response.ok) throw fail('http-' + response.status);
    return readLength(response.headers.get('Content-Length'));
  }

  // A request that hangs without ever answering would leave the episode
  // unhandled until the page is reloaded. A host that stalls rather than
  // refuses has already been seen, so every request is given a limit.
  const PATIENCE = 20000;

  // A redirect is refused rather than followed. A host that assembles an
  // episode per listen answers one with a fresh assembly: different ads, at
  // different positions, in a file of a different length. Following it would
  // hand back bytes that look perfectly valid and belong to another file.
  async function follow(url, options) {
    const giveUp = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = giveUp ? setTimeout(() => giveUp.abort(), PATIENCE) : null;
    try {
      return await fetch(url, {
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        ...(giveUp ? { signal: giveUp.signal } : {}),
        ...options,
      });
    } catch {
      throw fail('redirected-or-unreachable');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Range requests only, and no cookies: the extension reads the same file
  // the browser is already streaming, and identifies nobody doing it.
  async function fetchRange(url, start, length) {
    const response = await follow(url, {
      headers: { Range: 'bytes=' + start + '-' + (start + length - 1) },
    });
    // A server that ignores the range answers 200 with the whole file, which
    // is exactly what this is trying not to download.
    if (response.status !== 206) throw fail(response.ok ? 'no-range-support' : 'http-' + response.status);
    return new Uint8Array(await response.arrayBuffer());
  }

  // Every read goes through here: the same stretch is asked for several times
  // during a search, and a pair of files that doesn't behave must not be able
  // to keep the extension busy forever.
  function createReader(transport) {
    const chunks = new Map();
    const sizes = new Map();
    let probes = 0;

    let taken = 0;

    function spend(length) {
      if (probes >= MAX_PROBES) throw fail('too-many-probes');
      if (taken + length > MAX_BYTES) throw fail('too-much-to-read');
      probes += 1;
      taken += length;
    }

    function remember(store, key, length, work) {
      if (store.has(key)) return store.get(key);
      let started;
      try {
        spend(length);
        started = work();
      } catch (error) {
        return Promise.reject(error);
      }
      store.set(key, started);
      return started;
    }

    return {
      get probes() {
        return probes;
      },
      get taken() {
        return taken;
      },
      size(url) {
        return remember(sizes, url, 0, () => transport.size(url));
      },
      knownSize(url, length) {
        sizes.set(url, Promise.resolve(length));
      },
      read(url, start, length) {
        const from = Math.max(0, start);
        return remember(chunks, url + '|' + from + '|' + length, length, () =>
          transport.range(url, from, length),
        );
      },
    };
  }

  // An MP3 usually starts with an ID3 tag, and the two files don't carry the
  // same one, so the audio doesn't begin at the same offset on both sides.
  function id3Length(bytes) {
    if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
    const size =
      ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    return 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  }

  const MPEG1_LAYER3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const MPEG2_LAYER3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

  // The bitrate is read from the first frame rather than divided out of the
  // file size. lib/timing.js checks it against the duration measured by the
  // browser anyway, and a wrong value here would move the playhead into the
  // show.
  function readBitrate(bytes) {
    for (let i = 0; i + 3 < bytes.length; i++) {
      if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
      const version = (bytes[i + 1] >> 3) & 3;
      const layer = (bytes[i + 1] >> 1) & 3;
      if (version === 1 || layer !== 1) continue;
      const kbps = (version === 3 ? MPEG1_LAYER3 : MPEG2_LAYER3)[(bytes[i + 2] >> 4) & 0xf];
      if (kbps) return (kbps * 1000) / 8;
    }
    return null;
  }

  // Everything the comparison needs is in the first chunk and the size, so
  // this is one round trip. The first audio frame, which only serves to
  // report the bitrate at the very end, is asked for without being waited on:
  // a pre-roll is audible for as long as this takes, so each round trip saved
  // is ad that doesn't play.
  async function readLayout(reader, url, wantsFrame) {
    const [totalBytes, head] = await Promise.all([reader.size(url), reader.read(url, 0, CHUNK)]);
    const audioOffset = id3Length(head);
    if (audioOffset >= totalBytes) throw fail('empty-file');

    let frame = null;
    if (wantsFrame) {
      frame =
        audioOffset + CHUNK <= head.length
          ? Promise.resolve(head.subarray(audioOffset))
          : reader.read(url, audioOffset, CHUNK);
      // Kept quiet here and reported where it is awaited, so that giving up
      // early doesn't leave a rejection nobody listened to.
      frame.catch(() => {});
    }

    return { url, totalBytes, audioOffset, audioBytes: totalBytes - audioOffset, frame };
  }

  function same(a, b) {
    if (a.length === 0 || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function indexOf(haystack, needle) {
    const last = haystack.length - needle.length;
    for (let i = 0; i <= last; i++) {
      let j = 0;
      while (j < needle.length && haystack[i + j] === needle[j]) j++;
      if (j === needle.length) return i;
    }
    return -1;
  }

  async function layoutOf(file) {
    return {
      unit: 'bytes',
      totalBytes: file.totalBytes,
      audioOffset: file.audioOffset,
      bytesPerSecond: readBitrate(await file.frame),
    };
  }

  // What a comparison cost is worth knowing when it fails, not only when it
  // works: an error on its own says what went wrong but not how far it got.
  async function locate(options) {
    const reader = createReader({
      size: options.fetchSize || fetchSize,
      range: options.fetchRange || fetchRange,
    });
    // A size the caller already knows for certain. Some hosts answer a HEAD
    // with a redirect to a different assembly of the same episode, so asking
    // them would not merely cost a request, it would give a wrong answer.
    for (const [url, length] of Object.entries(options.sizes || {})) {
      if (Number.isInteger(length) && length > 0) reader.knownSize(url, length);
    }
    try {
      return await compare(reader, options);
    } catch (error) {
      if (error && typeof error === 'object') {
        error.probes = reader.probes;
        error.bytes = reader.taken;
      }
      throw error;
    }
  }

  async function compare(reader, options) {
    const [origin, served] = await Promise.all([
      readLayout(reader, options.source, false),
      readLayout(reader, options.stitched, true),
    ]);

    const delta = served.audioBytes - origin.audioBytes;
    if (delta === 0) return { ...(await layoutOf(served)), ranges: [], probes: reader.probes };
    if (delta < 0) throw fail('source-not-smaller');
    if (origin.audioBytes < 4 * CHUNK) throw fail('source-too-short');

    // True when the two files carry the same audio at source position `s`,
    // the served one being `k` bytes further along because of what came
    // before. Silence compares equal on both sides, so a boundary landing in
    // a silent stretch can be off by a few frames of silence: inaudible
    // either way, which is why this cheap comparison is enough.
    const agree = async (s, k) => {
      const [left, right] = await Promise.all([
        reader.read(origin.url, origin.audioOffset + s, CHUNK),
        reader.read(served.url, served.audioOffset + s + k, CHUNK),
      ]);
      return same(left, right);
    };

    // How far the served file has drifted at source position `s`, when a
    // plain comparison can't tell. The answer lies somewhere between `low`
    // and `high`, so that stretch is read and searched. It is read a piece at
    // a time, overlapping by a chunk so nothing straddles a seam: a pre-roll
    // is usually found in the first piece, and a stretch of several megabytes
    // is never pulled down when a few hundred kilobytes would do.
    const shiftAt = async (s, low, high, fromEnd) => {
      if (high - low + CHUNK > MAX_WINDOW) throw fail('window-too-wide');
      const needle = await reader.read(origin.url, origin.audioOffset + s, CHUNK);
      const starts = [];
      for (let from = low; from <= high; from += STEP) starts.push(from);
      // Whatever sits after the end of the show is usually one short break,
      // so looking from the far end finds it in the first piece.
      if (fromEnd) starts.reverse();
      for (const from of starts) {
        const width = Math.min(STEP + CHUNK, high - from + CHUNK);
        const window = await reader.read(served.url, served.audioOffset + s + from, width);
        const at = indexOf(window, needle);
        if (at >= 0) return from + at;
      }
      return null;
    };

    // A position in the middle of a stretch holding several insertions,
    // together with the drift there, so the stretch can be cut in two. The
    // middle is only a starting point: a chunk that happens to straddle an
    // insertion appears nowhere in the served file, so a few other positions
    // are tried before giving up.
    const findMiddle = async (from, to, low, high) => {
      const centre = Math.floor((from + to) / 2);
      for (const step of [0, 2, -2, 8, -8, 32, -32]) {
        const at = centre + step * CHUNK;
        if (at <= from || at >= to) continue;
        const shift = await shiftAt(at, low, high);
        if (shift !== null && shift >= low && shift <= high) return { at, shift };
      }
      return null;
    };

    // Where the drift stands at each end of the episode. These three don't
    // depend on each other, and together they settle the common case of a
    // single pre-roll, so they go out at once rather than in turn.
    const first = Math.min(HEADER, Math.floor(origin.audioBytes / 4));
    const last = origin.audioBytes - CHUNK;
    // The end is asked for gently. A host that builds an assembly as it is
    // listened to refuses anything past what it has built so far, and at the
    // moment this runs that is the first few minutes. Letting that failure
    // travel would throw away the pre-roll as well, which is the one break
    // the listener is sitting through right now.
    const [headAgrees, headIsShifted, tailAgrees] = await Promise.all([
      agree(first, 0),
      // A shortcut for the common case of a single pre-roll. It looks far
      // into the file, so it is allowed to fail like the one below: the
      // search that replaces it works from the start.
      agree(first, delta).catch(() => null),
      agree(last, delta).catch(() => null),
    ]);

    let head = 0;
    if (!headAgrees) {
      head = headIsShifted ? delta : await shiftAt(first, 0, delta);
      if (head === null) throw fail('no-common-head');
    }

    // The file does not have to end with the show. Anything inserted after
    // the last of it leaves the tail short of the total, and assuming
    // otherwise is what made a post-roll look like two files with nothing in
    // common.
    let tail = delta;
    let reachable = tailAgrees !== null;
    if (reachable && !tailAgrees) {
      try {
        tail = await shiftAt(last, head, delta, true);
      } catch {
        reachable = false;
      }
      if (reachable && tail === null) throw fail('no-common-tail');
    }
    if (reachable && head > tail) throw fail('inconsistent-alignment');

    // Narrows down one jump at a time. `before` is the last position still
    // aligned at the smaller shift and `after` the first one aligned at the
    // larger. The searches only need to get within a chunk of the boundary,
    // which is what keeps the number of requests down; the exact byte is read
    // off afterwards.
    // What is known so far, handed over as soon as it is. A pre-roll is
    // audible for as long as the whole comparison takes, and finding the
    // mid-rolls costs far more than finding it: waiting for them before
    // saying anything means listening to the pre-roll while they are found.
    const shape = await layoutOf(served);
    const found = [];
    const tell = () => {
      if (!options.onPartial || found.length === 0) return;
      const sorted = [...found].sort((a, b) => a.start - b.start);
      options.onPartial({ ...shape, ranges: sorted.map((ad) => [ad.start, ad.end]) });
    };

    const split = async (from, low, to, high) => {
      if (low === high) return;
      let lo = from;
      let hi = to;
      while (lo + CHUNK < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (await agree(mid, low)) lo = mid;
        else hi = mid;
      }
      const before = lo;
      lo = before;
      hi = to;
      while (lo + CHUNK < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (await agree(mid, high)) hi = mid;
        else lo = mid;
      }
      const after = hi;

      if (after - before > SAME_BOUNDARY) {
        const middle = await findMiddle(before, after, low, high);
        if (!middle) throw fail('ambiguous-alignment');
        await split(before, low, middle.at, middle.shift);
        await split(middle.at, middle.shift, after, high);
        return;
      }

      // The searches place the boundary within a couple of chunks of
      // `before`; the exact byte is the first one where the two files stop
      // agreeing.
      const span = SAME_BOUNDARY + 2 * CHUNK;
      const [left, right] = await Promise.all([
        reader.read(origin.url, origin.audioOffset + before, span),
        reader.read(served.url, served.audioOffset + before + low, span),
      ]);
      let i = 0;
      while (i < left.length && i < right.length && left[i] === right[i]) i++;
      const at = i < left.length ? before + i : after;
      found.push({ start: served.audioOffset + at + low, end: served.audioOffset + at + high });
      tell();
    };

    if (head > 0) found.push({ start: served.audioOffset, end: served.audioOffset + head });

    // Only the start of the file could be read. Where the pre-roll ends is
    // known exactly, and that alone is worth having; nothing in the middle
    // can be placed without the other end to measure against.
    if (!reachable) {
      tell();
      return {
        ...shape,
        ranges: found.map((ad) => [ad.start, ad.end]),
        incomplete: 'unreadable-end',
        probes: reader.probes,
      };
    }

    if (tail < delta) {
      const ends = served.audioOffset + origin.audioBytes + tail;
      found.push({ start: ends, end: served.totalBytes });
    }
    // Both ends are known before any of the middle, and they are the two the
    // listener meets first and last.
    tell();
    await split(first, head, last, tail);

    found.sort((a, b) => a.start - b.start);
    const inserted = found.reduce((total, ad) => total + (ad.end - ad.start), 0);
    if (inserted !== delta) throw fail('incomplete-alignment');
    return { ...shape, ranges: found.map((ad) => [ad.start, ad.end]), probes: reader.probes };
  }

  root.AdSkip = root.AdSkip || {};
  root.AdSkip.stitching = { locate, fetchSize, fetchRange, id3Length, readBitrate, CHUNK };
})(globalThis);
