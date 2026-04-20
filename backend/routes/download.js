// GET /download              → latest Mac universal .dmg (Intel + Apple Silicon)
// GET /download/mac           → same as /download
// GET /download/mac/arm64     → latest Apple Silicon .dmg
// GET /download/latest-mac.yml → electron-updater manifest (not strictly needed —
//                                the desktop app's auto-updater hits GitHub directly —
//                                but handy for debugging and future-proofing)
//
// All routes resolve the asset URL from GitHub's Releases API at request time and
// 302-redirect to the `browser_download_url`. The public link never has to change
// when a new version ships — drop the new DMGs into a GitHub Release and the
// website picks them up automatically.

var express = require('express');
var router = express.Router();

var GITHUB_REPO = process.env.GITHUB_RELEASE_REPO || 'scoutsystems-js/sales-overlay';
var RELEASES_PAGE = 'https://github.com/' + GITHUB_REPO + '/releases/latest';
var CACHE_TTL_MS = 5 * 60 * 1000;  // 5 min — GitHub API allows 60/hr unauthenticated

var cache = { fetchedAt: 0, release: null };

// Fetch the latest release from the GitHub API with a 5-minute in-memory cache.
// Falls back to stale cache on API failure so a transient GitHub outage doesn't
// break the download button.
async function getLatestRelease() {
  var now = Date.now();
  if (cache.release && (now - cache.fetchedAt) < CACHE_TTL_MS) {
    return cache.release;
  }

  var url = 'https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest';
  var headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'scout-systems-backend',
  };
  // If a GITHUB_TOKEN is set, authenticate so we can query private repos and
  // use the 5000/hr rate limit instead of the 60/hr unauthenticated cap.
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  }

  try {
    var resp = await fetch(url, { headers: headers });
    if (!resp.ok) {
      console.error('[download] GitHub API returned ' + resp.status);
      // Serve stale cache if we have it, otherwise bubble up null
      return cache.release;
    }
    var data = await resp.json();
    cache = { fetchedAt: now, release: data };
    return data;
  } catch (err) {
    console.error('[download] GitHub API fetch failed:', err.message);
    return cache.release;  // stale-while-error
  }
}

// Find the first asset whose name matches the predicate. Returns the
// browser_download_url or null.
function findAssetUrl(release, predicate) {
  if (!release || !Array.isArray(release.assets)) return null;
  for (var i = 0; i < release.assets.length; i++) {
    var asset = release.assets[i];
    if (predicate(asset.name)) return asset.browser_download_url;
  }
  return null;
}

// Asset name patterns shipped by electron-builder:
//   Scout-1.0.2.dmg           → universal DMG (Intel + Apple Silicon)
//   Scout-1.0.2-arm64.dmg     → Apple Silicon only
//   Scout-1.0.2-mac.zip       → universal zip (auto-updater diff base)
//   Scout-1.0.2-arm64-mac.zip → arm64 zip
//   latest-mac.yml            → electron-updater manifest

function isUniversalDmg(name) {
  return /\.dmg$/i.test(name) && !/arm64/i.test(name) && !/x64/i.test(name);
}
function isArm64Dmg(name) {
  return /\.dmg$/i.test(name) && /arm64/i.test(name);
}
function isLatestMacYml(name) {
  return name === 'latest-mac.yml';
}

// Redirect helper: 302 to the asset URL, or 302 to the Releases page as a
// graceful fallback if resolution fails. A user who hits that fallback can
// still manually grab the DMG — better than a dead-end error page.
function sendDownload(res, url) {
  if (url) {
    res.redirect(302, url);
  } else {
    res.redirect(302, RELEASES_PAGE);
  }
}

// Default: Mac universal (safest — works on Intel + Apple Silicon).
// Later, if we add Windows builds, change this to detect platform from
// User-Agent and branch accordingly.
router.get('/', async function(req, res) {
  var release = await getLatestRelease();
  sendDownload(res, findAssetUrl(release, isUniversalDmg));
});

router.get('/mac', async function(req, res) {
  var release = await getLatestRelease();
  sendDownload(res, findAssetUrl(release, isUniversalDmg));
});

router.get('/mac/arm64', async function(req, res) {
  var release = await getLatestRelease();
  sendDownload(res, findAssetUrl(release, isArm64Dmg));
});

router.get('/latest-mac.yml', async function(req, res) {
  var release = await getLatestRelease();
  sendDownload(res, findAssetUrl(release, isLatestMacYml));
});

// Optional JSON endpoint — handy for the landing page to show the current
// version ("Scout v1.0.2") dynamically instead of hardcoding it.
router.get('/version', async function(req, res) {
  var release = await getLatestRelease();
  if (!release) {
    res.status(503).json({ error: 'Unable to reach GitHub Releases' });
    return;
  }
  res.json({
    version: release.tag_name,
    name: release.name,
    publishedAt: release.published_at,
    releaseUrl: release.html_url,
  });
});

module.exports = router;
