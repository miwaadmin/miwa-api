/**
 * Community link config — single source of truth for the Discord (or other)
 * invite URL used by the sidebar nav, dashboard banner, and public footer.
 *
 * Set `VITE_COMMUNITY_URL` in the build environment to enable the link
 * everywhere it's referenced. When the env var isn't set (or is blank),
 * every consumer hides its community CTA, so the UI doesn't link to a
 * "join community" button that goes nowhere.
 */
// Be forgiving about how the secret was pasted: strip leading/trailing
// whitespace, optional surrounding quotes, and auto-prepend https:// if
// it looks like a bare host. The CTAs only render when we end up with
// something that LOOKS like a URL, so a typo never produces a broken link.
function normalizeUrl(raw) {
  let v = String(raw || '').trim()
  // Strip wrapping quotes (some env editors paste them verbatim).
  v = v.replace(/^['"]+|['"]+$/g, '').trim()
  if (!v) return ''
  // Already a real URL → keep as-is.
  if (/^https?:\/\//i.test(v)) return v
  // Bare host like "discord.gg/abc123" — prepend https://
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(v)) return `https://${v}`
  return ''
}

const RAW = import.meta.env.VITE_COMMUNITY_URL
export const COMMUNITY_URL = normalizeUrl(RAW)
export const HAS_COMMUNITY = !!COMMUNITY_URL

// One-time console signal so it's obvious from devtools whether the URL
// made it through the build. Only logs in dev mode (or when explicitly
// asked via ?debug=community) to avoid noise for real users.
if (typeof window !== 'undefined') {
  const wantDebug = import.meta.env.DEV
    || (typeof window.location !== 'undefined' && window.location.search.includes('debug=community'))
  if (wantDebug) {
    // eslint-disable-next-line no-console
    console.info('[miwa.community]', {
      raw: RAW,
      normalized: COMMUNITY_URL,
      enabled: HAS_COMMUNITY,
    })
  }
}

// Optional human-readable label override for the link target — useful if you
// move from Discord to Slack or Circle later. Defaults based on the URL host.
export const COMMUNITY_LABEL = (() => {
  const override = (import.meta.env.VITE_COMMUNITY_LABEL || '').trim()
  if (override) return override
  if (!HAS_COMMUNITY) return 'Community'
  try {
    const host = new URL(COMMUNITY_URL).hostname.toLowerCase()
    if (host.includes('discord')) return 'Discord'
    if (host.includes('slack'))   return 'Slack'
    if (host.includes('circle'))  return 'Circle'
  } catch {}
  return 'Community'
})()
