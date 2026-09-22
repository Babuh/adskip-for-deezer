// Builds pairs of MP3 files the way a host that stitches ads in does: one
// original, and one with blocks inserted at chosen positions. The audio is
// filler, but the parts lib/stitching.js reads for real are real: an ID3 tag
// of the right length and a first frame header announcing 128 kbit/s.
const FRAME = [0xff, 0xfb, 0x90, 0x00];
const BYTES_PER_SECOND = 16000;

function id3(length) {
  const tag = new Uint8Array(length);
  tag.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
  const size = length - 10;
  tag[6] = (size >> 21) & 0x7f;
  tag[7] = (size >> 14) & 0x7f;
  tag[8] = (size >> 7) & 0x7f;
  tag[9] = size & 0x7f;
  return tag;
}

// Deterministic filler that never emits 0xff, so the only frame header in a
// block is the one at its start.
function filler(length, seed) {
  const bytes = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[i] = (state >>> 16) % 255;
  }
  bytes.set(FRAME);
  return bytes;
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// `ads` are { at, length } in positions of the original audio.
function build({ audioBytes = 3_000_000, sourceTag = 2048, servedTag = 40_000, ads = [] } = {}) {
  const audio = filler(audioBytes, 1);
  const source = concat([id3(sourceTag), audio]);

  const parts = [id3(servedTag)];
  const expected = [];
  let at = 0;
  let shift = 0;
  for (const [index, ad] of ads.entries()) {
    parts.push(audio.subarray(at, ad.at));
    parts.push(filler(ad.length, 100 + index));
    expected.push([servedTag + ad.at + shift, servedTag + ad.at + shift + ad.length]);
    shift += ad.length;
    at = ad.at;
  }
  parts.push(audio.subarray(at));

  return { source, served: concat(parts), expected, sourceTag, servedTag, audioBytes };
}

// Stands in for the two requests lib/stitching.js makes, and counts what
// they cost. The size comes from its own call, the way it does in a browser:
// a partial response never exposes Content-Range across origins.
function reader(files) {
  const stats = { requests: 0, bytes: 0 };
  async function fetchSize(url) {
    const file = files[url];
    if (!file) throw new Error('http-404');
    stats.requests += 1;
    return file.length;
  }
  async function fetchRange(url, start, length) {
    const file = files[url];
    if (!file) throw new Error('http-404');
    const bytes = file.subarray(start, Math.min(file.length, start + length));
    stats.requests += 1;
    stats.bytes += bytes.length;
    return bytes;
  }
  return { fetchSize, fetchRange, stats };
}

module.exports = { build, reader, id3, filler, BYTES_PER_SECOND };
