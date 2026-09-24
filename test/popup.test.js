const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source } = require('./load.js');

const HOSTS = ['https://www.deezer.com/*', '*://*.acast.com/*', '*://*.simplecastaudio.com/*'];

// A stand-in for the popup's document: every element the script reaches for,
// and nothing else.
function papier() {
  const made = new Map();
  const element = () => ({
    textContent: '',
    hidden: false,
    checked: false,
    className: '',
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {},
    replaceChildren() {},
    append() {},
  });
  return {
    get: (id) => {
      if (!made.has(id)) made.set(id, element());
      return made.get(id);
    },
    document: {
      getElementById: (id) => {
        if (!made.has(id)) made.set(id, element());
        return made.get(id);
      },
      querySelectorAll: () => [],
      createElement: element,
      body: { classList: { toggle() {} } },
    },
  };
}

// Opens the popup against a browser that allows the given sites.
async function openPopup(granted) {
  const page = papier();
  const api = {
    runtime: {
      getManifest: () => ({ version: '0.0.0', host_permissions: HOSTS }),
      onMessage: { addListener() {} },
    },
    storage: {
      local: { get: () => Promise.resolve({}) },
      onChanged: { addListener() {} },
    },
    tabs: {
      query: () => Promise.resolve([{ id: 1 }]),
      sendMessage: () => Promise.reject(new Error('no content script')),
    },
    permissions: {
      contains: ({ origins }) => Promise.resolve(granted.includes(origins[0])),
    },
  };

  const context = vm.createContext({
    browser: api,
    document: page.document,
    navigator: { userAgent: 'test' },
    setTimeout,
    clearTimeout,
    console: { debug() {} },
  });
  vm.runInContext(source('lib/settings.js'), context, { filename: 'lib/settings.js' });
  vm.runInContext(source('popup/popup.js'), context, { filename: 'popup/popup.js' });

  for (let i = 0; i < 20; i++) await new Promise((done) => setImmediate(done));
  return page;
}

test('says nothing when every site is allowed', async () => {
  const page = await openPopup(HOSTS);
  assert.equal(page.get('blocked').hidden, true);
});

test('names the sites Firefox is withholding', async () => {
  const page = await openPopup(['https://www.deezer.com/*', '*://*.acast.com/*']);
  const line = page.get('blocked');
  assert.equal(line.hidden, false);
  assert.match(line.textContent, /simplecastaudio\.com/);
  assert.doesNotMatch(line.textContent, /acast/, 'only the ones actually missing');
  assert.match(line.textContent, /Permissions/, 'and where to put it right');
});

test('the one that has bitten twice is the page itself', async () => {
  const page = await openPopup(['*://*.acast.com/*', '*://*.simplecastaudio.com/*']);
  assert.equal(page.get('blocked').hidden, false);
  assert.match(page.get('blocked').textContent, /deezer\.com/);
});
