/**
 * Normalize a URL for deduplication purposes.
 * Strips tracking params, trailing slashes, and normalizes hostname to lowercase.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hostname = u.hostname.toLowerCase()
    // Remove www. prefix
    if (u.hostname.startsWith("www.")) {
      u.hostname = u.hostname.slice(4)
    }
    // Strip tracking params
    const trackingParams = [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "ref", "source", "fbclid", "gclid", "ref_src", "ref_url",
    ]
    for (const key of [...u.searchParams.keys()]) {
      if (trackingParams.includes(key.toLowerCase())) {
        u.searchParams.delete(key)
      }
    }
    // Sort remaining params for consistency
    u.searchParams.sort()
    // Strip trailing slash
    let path = u.pathname.replace(/\/+$/, "")
    // Keep hash if meaningful
    if (u.hash && u.hash !== "#" && u.hash !== "#/") {
      path += u.hash
    }
    const query = u.search ? u.search : ""
    return `${u.hostname}${path}${query}`
  } catch {
    return url.toLowerCase().replace(/\/+$/, "")
  }
}
