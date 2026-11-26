const DEFAULT_ADMIN_AVATAR = (() => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">',
    '<rect width="120" height="120" fill="#4f46e5"/>',
    '<text x="60" y="68" font-size="44" font-family="Arial,sans-serif" fill="#fff" text-anchor="middle">AD</text>',
    '</svg>'
  ].join('');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
})();

const PLACEHOLDER_AVATAR = (() => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">',
    '<rect width="120" height="120" fill="#e2e8f0"/>',
    '<circle cx="60" cy="48" r="20" fill="#94a3b8"/>',
    '<path d="M28 104c6-22 58-22 64 0" fill="#94a3b8"/>',
    '</svg>'
  ].join('');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
})();

module.exports = { DEFAULT_ADMIN_AVATAR, PLACEHOLDER_AVATAR };