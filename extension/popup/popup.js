const api = globalThis.browser || globalThis.chrome;
const { withDefaults } = AdSkip.settings;

const $ = (id) => document.getElementById(id);
const categoryInputs = [...document.querySelectorAll('[data-category]')];

const MESSAGES = {
  unavailable: 'Open a podcast on deezer.com to see its ads here.',
  idle: 'No podcast from a supported host is playing.',
  waiting: 'Episode found, waiting for the player.',
  'no-ads': 'No inserted ads in this episode.',
  error: 'This episode has ads, but their position could not be verified. Nothing will be skipped.',
};

let settings = withDefaults();
let tabId = null;
let current = null;

function clock(seconds) {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

function amount(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

function render(response) {
  current = response || null;
  const state = current ? current.state : null;
  const status = state ? state.status : 'unavailable';
  const list = $('breaks');

  list.replaceChildren();
  $('tab-count').textContent = current ? current.skipped : 0;
  $('detail').hidden = true;
  document.body.classList.toggle('paused', !settings.enabled);

  if (status !== 'active') {
    $('status').textContent = MESSAGES[status] || MESSAGES.idle;
    if (status === 'error' && state.problem) {
      $('detail').textContent = `Reason: ${state.problem}`;
      $('detail').hidden = false;
    }
    return;
  }

  const count = state.breaks.length;
  const paused = settings.enabled ? '' : ' Skipping is paused.';
  $('status').textContent = `${count} inserted ${count === 1 ? 'ad' : 'ads'} in this episode.${paused}`;
  for (const ad of state.breaks) {
    const item = document.createElement('li');
    const time = document.createElement('span');
    time.textContent = `${clock(ad.start)} to ${clock(ad.end)}`;
    const tag = document.createElement('span');
    tag.className = ad.skipped ? 'tag done' : 'tag';
    tag.textContent = ad.skipped ? 'skipped' : amount(ad.end - ad.start);
    item.append(time, tag);
    list.append(item);
  }
}

async function renderStats() {
  const { stats } = await api.storage.local.get('stats');
  $('total-count').textContent = stats ? stats.skipped : 0;
  $('total-time').textContent = amount(stats ? stats.seconds : 0);
}

async function save(changes) {
  settings = withDefaults({ ...settings, ...changes });
  await api.storage.local.set({ settings });
  render(current);
}

$('enabled').addEventListener('change', (event) => save({ enabled: event.target.checked }));

for (const input of categoryInputs) {
  input.addEventListener('change', () => {
    save({ categories: { ...settings.categories, [input.dataset.category]: input.checked } });
  });
}

$('copy').addEventListener('click', async () => {
  const button = $('copy');
  const info = {
    version: api.runtime.getManifest().version,
    browser: navigator.userAgent,
    settings,
    tab: current,
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(info, null, 2));
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Could not copy';
  }
  setTimeout(() => {
    button.textContent = 'Copy debug info';
  }, 1500);
});

api.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'state' && sender.tab && sender.tab.id === tabId) render(message);
});

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.stats) renderStats();
});

async function init() {
  const stored = await api.storage.local.get('settings');
  settings = withDefaults(stored.settings);
  $('enabled').checked = settings.enabled;
  for (const input of categoryInputs) {
    input.checked = settings.categories[input.dataset.category] !== false;
  }
  renderStats();

  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  tabId = tab ? tab.id : null;
  try {
    render(await api.tabs.sendMessage(tabId, { type: 'get-state' }));
  } catch {
    render(null);
  }
}

init();
