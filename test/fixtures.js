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

function withParams(changes) {
  const url = new URL(STITCHED_URL);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  return url.href;
}

module.exports = { STITCHED_URL, DURATION, withParams };
