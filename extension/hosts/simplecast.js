(function (root) {
  'use strict';

  // Simplecast assembles a file for each listen and says nothing about what
  // went into it: no positions in the URL, no manifest next to the file. The
  // original episode is reachable, so the two can be compared, but with one
  // difficulty the other hosts don't have: the assembled file is served
  // without an Access-Control-Allow-Origin header on partial responses, so
  // the page cannot read it at all. That one is read through the background
  // instead. docs/how-it-works.md has the details.
  const { stitching } = root.AdSkip;

  // .../episodes/<id>/audio/<bitrate>/default.mp3/<assembly>.mp3
  const STITCH = /\/episodes\/([0-9a-f-]+)\/audio\/\d+\/default\.mp3\/[^/]+\.mp3$/;
  const EPISODE = 'https://api.simplecast.com/episodes/';

  function matches(url) {
    return url.hostname === 'simplecastaudio.com' || url.hostname.endsWith('.simplecastaudio.com');
  }

  function readInteger(value) {
    return value !== null && /^\d+$/.test(value) ? Number(value) : null;
  }

  function parse(url) {
    const found = STITCH.exec(url.pathname);
    // The generic address, which redirects here, names no assembly and is
    // left alone: asking for it again would produce a different one.
    if (!found) return null;

    const episode = url.searchParams.get('awEpisodeId') || found[1];
    // The size of the file being played, which the URL states outright. It
    // has to come from here: a HEAD on this address follows a redirect and
    // lands on another assembly of the same episode, with other ads and
    // another length.
    const totalBytes = readInteger(url.searchParams.get('x-total-bytes'));
    if (!episode || totalBytes === null) return null;

    return {
      unit: 'bytes',
      category: 'inserted',
      pending: true,
      paramNames: [...new Set(url.searchParams.keys())].sort(),
      // Read by path alone. The query carries the listening session, and the
      // server tracks a read position against it: reading the very file the
      // player is streaming, under its own session, moves that cursor under
      // the player's feet. The path serves the same bytes and disturbs
      // nothing, and it re-asserts nobody's identity along the way.
      resolve: (tools) => compare(url.origin + url.pathname, episode, totalBytes, tools),
    };
  }

  // The original episode sits on a different domain, which does answer
  // ordinary cross-origin reads, so only the assembled file needs the
  // background. Keeping it that way is what stops this from needing
  // permission over the whole of Simplecast.
  async function compare(stitched, episode, totalBytes, tools) {
    const background = tools && tools.background;
    if (!background) throw new Error('no-background');

    const response = await fetch(EPISODE + episode, { credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error(`http-${response.status}`);
    const data = await response.json();

    const source = originalFile(data);
    if (!source) throw new Error('no-original-file');

    const sizes = { [stitched]: totalBytes };
    if (Number.isInteger(data.audio_file_size) && data.audio_file_size > 0) {
      sizes[source] = data.audio_file_size;
    }

    return stitching.locate({
      stitched,
      source,
      sizes,
      onPartial: tools.onPartial,
      fetchSize: (url) => (url === stitched ? background.fetchSize(url) : stitching.fetchSize(url)),
      fetchRange: (url, start, length) =>
        url === stitched ? background.fetchRange(url, start, length) : stitching.fetchRange(url, start, length),
    });
  }

  // The episode as it was uploaded, on the content CDN. Its address is the
  // one the waveform is served from, with the extension changed; failing
  // that, the stored path says where it lives.
  function originalFile(data) {
    const waveform = data.waveform_json;
    if (typeof waveform === 'string' && waveform.endsWith('.json')) {
      return `${waveform.slice(0, -'.json'.length)}.mp3`;
    }
    const path = data.audio_file_path_tc;
    if (typeof path === 'string' && path.endsWith('.mp3')) {
      try {
        return new URL(path.replace(/^\/prod\//, '/'), 'https://cdn.simplecast.com').href;
      } catch {
        return null;
      }
    }
    return null;
  }

  root.AdSkip.hosts.register({ id: 'simplecast', matches, parse });
})(globalThis);
