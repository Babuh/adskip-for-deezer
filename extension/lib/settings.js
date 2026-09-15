(function (root) {
  'use strict';

  // Ads are grouped by category so each kind can be turned on or off on its
  // own. Only "inserted" exists for now: ads stitched in by the podcast host.
  const DEFAULTS = { enabled: true, categories: { inserted: true } };

  function withDefaults(stored) {
    const settings = stored || {};
    return {
      enabled: settings.enabled !== false,
      categories: { ...DEFAULTS.categories, ...settings.categories },
    };
  }

  root.AdSkip = root.AdSkip || {};
  root.AdSkip.settings = { DEFAULTS, withDefaults };
})(globalThis);
