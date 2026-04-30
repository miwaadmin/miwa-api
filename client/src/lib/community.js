/**
 * Community link config — single source of truth for the Discord (or other)
 * invite URL used by the sidebar nav, dashboard banner, and public footer.
 *
 * Set `VITE_COMMUNITY_URL` in the build environment to enable the link
 * everywhere it's referenced. When the env var isn't set (or is blank),
 * every consumer hides its community CTA, so the UI doesn't link to a
 * "join community" button that goes nowhere.
 */
const RAW = (import.meta.env.VITE_COMMUNITY_URL || '').trim()

// Basic sanity: must be http(s) so we don't accidentally render a typo URL.
const VALID = /^https?:\/\//i.test(RAW)

export const COMMUNITY_URL = VALID ? RAW : ''
export const HAS_COMMUNITY = !!COMMUNITY_URL

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
