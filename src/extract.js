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
  const usedBy = Number(raw._usedby) || 0;

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
    usedBy,
  };
}

