// Customers whose official website was confirmed, matched however the files spell them
// ("DEC", "DEC-THÊU", "DECATHON QT", "DECENTE", "SPORRT MASTER"…). Unconfirmed customers
// (local factories, unknown names) keep their initials rather than a guessed logo.
const BRANDS = [
  { name: 'Decathlon', domain: 'decathlon.com', pattern: /^(DEC|DECATHLON|DECATHON)(\b|$)/i },
  { name: 'Arena', domain: 'arenasport.com', pattern: /^ARENA\b/i },
  { name: 'Le Coq Sportif', domain: 'lecoqsportif.com', pattern: /^LE\s*COQ/i },
  { name: 'Lacoste', domain: 'lacoste.com', pattern: /^LACOSTE\b/i },
  { name: 'Descente', domain: 'descente.com', pattern: /^DES?CENTE\b/i },
  { name: 'Coolmate', domain: 'coolmate.me', pattern: /^COOLMATE\b/i },
  { name: 'Sportmaster', domain: 'sportmaster.com', pattern: /^SPOR+T\s*MAST/i },
  { name: 'Haddad', domain: 'haddad.com', pattern: /^HADDAD\b/i }
];

export function brandOf(customer) {
  const name = String(customer ?? '').trim();
  return BRANDS.find((brand) => brand.pattern.test(name)) || null;
}

// The brand's own site icon, served by Google's favicon service (only the domain is sent).
export function logoUrl(brand, size = 64) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(brand.domain)}&sz=${size}`;
}
