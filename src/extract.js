/**
 * Pull the fields we care about out of the raw r-universe API JSON.
 * The output is a stable shape that the renderer consumes, so we never
 * sprinkle `?.` chains through the layout code.
 */
export function extractCardData(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('extractCardData: expected an object');
  }

  const pkg = raw.Package || raw._nocasepkg || '';
  const title = (raw.Title || '').replace(/\s+/g, ' ').trim();
  const version = raw.Version || '';
  const logo = raw._pkglogo || null;
  const userBio = raw._userbio || {};
  const ownerLogin = raw._user || '';
  const ownerIsOrg = userBio.type === 'organization';
  const ownerDescription = userBio.description || '';
  // GitHub user/org UUID — when available we can fetch the avatar straight
  // from avatars.githubusercontent.com and skip the github.com redirect.
  const ownerUuid = Number.isFinite(userBio.uuid) ? userBio.uuid : null;

  // Topics → tags. Strip duplicates and very long tags that won't fit.
  const topics = Array.isArray(raw._topics) ? raw._topics : [];
  const tags = [...new Set(topics.map((t) => String(t).toLowerCase()))]
    .filter((t) => t && t.length <= 24);

  // Maintainer: prefer the structured `_maintainer`, fall back to the text
  // form in DESCRIPTION's `Maintainer:` field.
  let maintainer = null;
  if (raw._maintainer && raw._maintainer.name) {
    maintainer = { name: raw._maintainer.name, login: raw._maintainer.login || '' };
  } else if (typeof raw.Maintainer === 'string') {
    // Strip a trailing email address: "Name <email>" → "Name".
    const m = raw.Maintainer.match(/^\s*([^<]+?)\s*(?:<[^>]*>)?\s*$/);
    if (m && m[1]) maintainer = { name: m[1], login: '' };
  }

  const stars = Number(raw._stars) || 0;
  const downloads = (raw._downloads && Number(raw._downloads.count)) || 0;
  const vignettes = Array.isArray(raw._vignettes) ? raw._vignettes.length : 0;
  const contributors = Array.isArray(raw._contributors) ? raw._contributors.length : 0;

  return {
    package: pkg,
    title,
    version,
    logo,
    ownerIsOrg,
    ownerLogin,
    ownerUuid,
    tags,
    maintainer,
    stars,
    downloads,
    vignettes,
    contributors,
  };
}

/**
 * Pull the fields needed by the universe (per-org / per-user) card out of
 * the two upstream APIs:
 *
 *   summary  — https://{login}.r-universe.dev/api/summary
 *
 * `summary` carries the universe's name, description, GitHub UUID and the
 * type (user vs organization) directly, so we no longer hit api.github.com.
 * `topics` is optional — a missing or empty array just means no tag row.
 */
export function extractUniverseData(summary) {
  const ownerLogin = summary.universe || '';
  if (!ownerLogin) {
    throw new TypeError('extractUniverseData: a login is required');
  }
  // r-universe summaries for first-party orgs (rOpenSci, tidyverse, jeroen…)
  // include `type`, `name`, `description`, `uuid`. Pseudo-universes such as
  // `cran` and `bioc` ship a leaner summary without these — fall back to
  // the login / org assumption in that case.
  const isOrg = (summary.type || 'organization').toLowerCase() === 'organization';
  const name = summary.name || ownerLogin;
  const description = (summary.description || '').replace(/\s+/g, ' ').trim();
  const ownerUuid = Number.isFinite(summary.uuid) ? summary.uuid : null;

  const tags = [...new Set(
    (Array.isArray(summary.topics) ? summary.topics : [])
      .map((t) => String(t.topic || t).toLowerCase()),
  )].filter((t) => t && t.length <= 24);

  return {
    // Shared with the package card's shape so resolveLogo / ownerAvatarUrl
    // can treat both objects identically.
    ownerLogin,
    ownerIsOrg: isOrg,
    name,
    description,
    ownerUuid,
    tags,
    packages: Number(summary.packages) || 0,
    maintainers: Number(summary.maintainers) || 0,
    organizations: Number(summary.organizations) || 0,
    contributors: Number(summary.contributors) || 0,
    articles: Number(summary.articles) || 0,
    datasets: Number(summary.datasets) || 0,
  };
}
