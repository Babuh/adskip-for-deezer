// Built from a request captured on deezer.com. Identifiers, signature, key
// and digest are placeholders; the values the extension relies on (ap, o1,
// o2, o3) are the ones that were observed.
const STITCHED_URL =
  'https://files.audiomeans.fr/YWRzdjI/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000001.mp3' +
  '?ap=103591-585080,10792063-11273134' +
  '&o1=16001&o2=102593457&o3=103590' +
  '&aid=11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222' +
  '&at=v,v&ac=RVVSOjEyLjYwLEVVUjoxMi41MA%3D%3D' +
  '&dg=' + '0'.repeat(128) +
  '&Expires=1700000000&Key-Pair-Id=EXAMPLEKEYPAIRID&Signature=EXAMPLE-SIGNATURE';

// Duration of that file, as announced by the URL: (o2 - o3) / o1.
const DURATION = 6405.2;

// Built from a request captured on deezer.com while an episode of a France
// Inter show was playing. Identifiers, the path hash and the geo values are
// placeholders; what the parsing depends on is the /ts/ prefix and the
// `podcast` parameter naming the original file.
const RADIOFRANCE_FILE =
  'podcast09/26774-16.02.2026-ITEMA_00000000-0000F00000S0000-NET_MFI_00000000-0000-4000-8000-000000000000-22-' +
  '0'.repeat(32) + '.mp3';

const RADIOFRANCE_SOURCE_URL = 'https://media.radiofrance-podcast.net/' + RADIOFRANCE_FILE;

const RADIOFRANCE_URL =
  'https://media.radiofrance-podcast.net/ts/podcast09/' + '0'.repeat(32) + '/' +
  RADIOFRANCE_FILE.slice('podcast09/'.length) +
  '?podcast=' + encodeURIComponent(RADIOFRANCE_FILE) +
  '&geoipcountry=FR&geoipzip=00000&provider=deezer' +
  '&cu=00000000-0000-4000-8000-000000000000&itemMasterMid=0000F00000S0000' +
  '&pubDate=1771254009&br=22805&title=Affaires+sensibles&stationname=France+Inter' +
  '&podray=' + '0'.repeat(32) + '&providerTargetspot=deezer';

// The address Deezer gives the player, which redirects to the one above.
const RADIOFRANCE_REDIRECT = 'https://proxycast.radiofrance.fr/00000000-0000-4000-8000-000000000000/' + RADIOFRANCE_FILE;

// Built from a request captured on deezer.com while an episode of a show
// hosted by Acast was playing, and from the manifest served next to it. The
// stitch hash, the listener id and the signature are placeholders; the
// segment list is the one that was observed, with the ad URLs dropped.
const ACAST_HASH = 'a'.repeat(32);

const ACAST_URL =
  'https://stitcher2.acast.com/livestitches/' + ACAST_HASH + '.mp3' +
  '?aid=000000000000000000000000&chid=111111111111111111111111' +
  '&ci=PLACEHOLDER%3D%3D&pf=rss&range=bytes%3D0-&sv=sphinx%401.280.4' +
  '&uid=' + '0'.repeat(32) +
  '&Expires=1790093191&Key-Pair-Id=EXAMPLEKEYPAIRID&Signature=EXAMPLE-SIGNATURE';

const ACAST_MANIFEST_URL = 'https://stitcher2.acast.com/livestitches/' + ACAST_HASH + '.json';

// The address Deezer gives the player, which redirects to the one above.
const ACAST_REDIRECT =
  'https://sphinx.acast.com/p/open/s/111111111111111111111111/e/000000000000000000000000/media.mp3';

const ACAST_MANIFEST = {
  hash: ACAST_HASH,
  contentLength: 72741221,
  sourceList: [
    { type: 'ad', placement: 'preroll', start: 0, end: 12.826122, duration: 12.826122 },
    { type: 'audioBreak', start: 12.826122, end: 15.098775, duration: 2.272653 },
    { type: 'source', start: 15.098775, end: 2796.8795455, duration: 2781.7807705 },
    { type: 'audioBreak', start: 2796.8795455, end: 2799.1521985, duration: 2.272653 },
    { type: 'ad', placement: 'midroll', start: 2799.1521985, end: 2829.2713825, duration: 30.119184 },
    { type: 'ad', placement: 'midroll', start: 2829.2713825, end: 2859.9433825, duration: 30.672 },
    { type: 'audioBreak', start: 2859.9433825, end: 2862.2160355, duration: 2.272653 },
    { type: 'source', start: 2862.2160355, end: 3814.4670355, duration: 952.251 },
    { type: 'audioBreak', start: 3814.4670355, end: 3816.7396885, duration: 2.272653 },
    { type: 'ad', placement: 'midroll', start: 3816.7396885, end: 3846.8588725, duration: 30.119184 },
    { type: 'audioBreak', start: 3846.8588725, end: 3849.1315255, duration: 2.272653 },
    { type: 'source', start: 3849.1315255, end: 4522.7095255, duration: 673.578 },
    { type: 'audioBreak', start: 4522.7095255, end: 4524.9821785, duration: 2.272653 },
    { type: 'ad', placement: 'postroll', start: 4524.9821785, end: 4545.3855625, duration: 20.403384 },
  ],
};

// What the browser measured on that file.
const ACAST_DURATION = 4546.302438;

// Built from a request captured on deezer.com while an episode hosted by
// Simplecast was playing, and from what its API answered. The collection and
// episode ids, the assembly hash and the session id are placeholders; the
// shape of the path and the parameters the parsing reads are the observed
// ones.
const SIMPLECAST_COLLECTION = '00000000-0000-4000-8000-000000000001';
const SIMPLECAST_EPISODE = '00000000-0000-4000-8000-000000000002';
const SIMPLECAST_AUDIO = '00000000-0000-4000-8000-000000000003';

const SIMPLECAST_BASE =
  'https://altice.simplecastaudio.com/' + SIMPLECAST_COLLECTION + '/episodes/' + SIMPLECAST_EPISODE + '/audio/128';

const SIMPLECAST_TOTAL = 65422343;

const SIMPLECAST_URL =
  SIMPLECAST_BASE + '/default.mp3/default.mp3_placeholder_' + '0'.repeat(32) + '_' + SIMPLECAST_TOTAL + '.mp3' +
  '?aid=rss_feed&awCollectionId=' + SIMPLECAST_COLLECTION +
  '&awEpisodeId=' + SIMPLECAST_EPISODE +
  '&category=Sports%2CNews&feed=PLACEHOLDER&network=&podcast_title=Example' +
  '&hash_redirect=1&x-total-bytes=' + SIMPLECAST_TOTAL +
  '&x-ais-classified=streaming&x-access-range=0-&listeningSessionID=' + '0'.repeat(40);

// The generic address the player is given, which redirects to an assembly.
const SIMPLECAST_REDIRECT = SIMPLECAST_BASE + '/default.mp3';

const SIMPLECAST_API = 'https://api.simplecast.com/episodes/' + SIMPLECAST_EPISODE;

const SIMPLECAST_CDN =
  'https://cdn.simplecast.com/audio/' + SIMPLECAST_COLLECTION + '/episodes/' + SIMPLECAST_EPISODE +
  '/audio/' + SIMPLECAST_AUDIO + '/default_tc';

const SIMPLECAST_EPISODE_JSON = {
  id: SIMPLECAST_EPISODE,
  duration: 3902,
  audio_file_size: 62447742,
  audio_file_path_tc:
    '/prod/audio/' + SIMPLECAST_COLLECTION + '/episodes/' + SIMPLECAST_EPISODE +
    '/audio/' + SIMPLECAST_AUDIO + '/default_tc.mp3',
  waveform_json: SIMPLECAST_CDN + '.json',
};

function withParams(changes) {
  const url = new URL(STITCHED_URL);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  return url.href;
}

module.exports = {
  STITCHED_URL,
  DURATION,
  withParams,
  RADIOFRANCE_FILE,
  RADIOFRANCE_SOURCE_URL,
  RADIOFRANCE_URL,
  RADIOFRANCE_REDIRECT,
  ACAST_HASH,
  ACAST_URL,
  ACAST_MANIFEST_URL,
  ACAST_MANIFEST,
  ACAST_REDIRECT,
  ACAST_DURATION,
  SIMPLECAST_URL,
  SIMPLECAST_REDIRECT,
  SIMPLECAST_API,
  SIMPLECAST_CDN,
  SIMPLECAST_EPISODE_JSON,
  SIMPLECAST_TOTAL,
};
