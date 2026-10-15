/**
 * Blunt matching of anything token-shaped. A false positive (a refused line, a file
 * migrate will not touch) is cheaper than a key copied into a file that gets committed or
 * backed up, but not free: a file full of them makes migrate refuse for no reason, and an
 * agent cannot log "password: reset flow". So a token shape is a hit wherever it appears,
 * while a credential word followed by a value is a hit only when the value is shaped like a
 * secret rather than a word. The token shapes are carried over from the v2 engine; the JWT
 * pattern alone was changed, to read a long line in linear time.
 */
const TOKEN_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic / Stripe style
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained PAT
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub classic PAT / OAuth / refresh
  /\bnpm_[A-Za-z0-9]{30,}/g, // npm automation + granular tokens
  /\bglpat-[A-Za-z0-9_-]{16,}/g, // GitLab PAT
  /\bpypi-[A-Za-z0-9_-]{16,}/g, // PyPI upload token
  /\bdop_v1_[a-f0-9]{32,}/g, // DigitalOcean
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, // Slack
  // JWT. Not `\beyJ`: a `-` is both a word boundary and part of a segment, so a long run of
  // "-eyJ" restarted the scan at every piece and each restart ran to the end of the line.
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  // Package-manager config (`//registry/:_authToken=…`, `_auth=…`): nobody writes this in a
  // sentence, so any value is a hit. Not after a letter or digit: `MAIL_PASSWORD=` is a variable name.
  /((?<![A-Za-z0-9])(?:_authToken|_auth|_password)\s*=\s*)\S+/gi,
];

/** One quoted string (closed or not), or one run of non-space. */
const VALUE = String.raw`("[^"]*"?|'[^']*'?|\S+)`;
/** A credential word and its value: group 1 runs up to the value, group 2 is the value. */
const ASSIGNMENT_PATTERNS: RegExp[] = [
  new RegExp(String.raw`(--(?:password|token|api[-_]?key|secret)[= ])${VALUE}`, 'gi'),
  new RegExp(String.raw`((?:AUTHORIZATION\s*[:=]\s*(?:(?:Bearer|Basic|Token)\s+)?|(?:BEARER|PASSWORD|SECRET|TOKEN|API[_-]?KEY|(?<![A-Za-z])PIN)\s*[:=]\s*))${VALUE}`, 'gi'),
];
/** After `Authorization: Bearer` (or Basic, Token) any value is a credential unless it is a placeholder. */
const AUTH_SCHEME = /AUTHORIZATION\s*[:=]\s*(?:Bearer|Basic|Token)\s+$/i;

/** A value that names or points at a secret instead of being one. */
function isPlaceholder(w: string): boolean {
  return (
    /^\$\{?\w+\}?$/.test(w) || // $VAR, ${VAR}
    /^`[^`]+`$/.test(w) || // `DEPLOY_TOKEN`
    /^<[^<>]+>$/.test(w) || // <token>
    /^\d{4}-\d{2}-\d{2}\b/.test(w) || // an ISO date
    /^https?:\/\//i.test(w)
  );
}

/**
 * A value shaped like a secret rather than a word: some word of it has 6 or more characters
 * and a digit or a symbol in it (a hyphen or apostrophe between letters is still a word), or
 * is one unbroken run of 16 or more token characters. A quoted value is also judged with its
 * spaces taken out (`"ab12 cd34 ef56"`), unless every word in it is lower-case letters (a
 * placeholder phrase: `"put the real one here"`). Brackets and quotes around a word, and one
 * full stop or comma after it, do not count: `Spring1!` keeps its `!`. A `$VAR`, a backticked
 * name, a `<placeholder>`, an ISO date and a link are not secrets. Not caught, because they
 * read like prose: a password of letters only shorter than 16, a value under 6 characters,
 * and a passphrase of lower-case words.
 */
export function isSecretValue(value: string): boolean {
  const quoted = /^["']/.test(value);
  const inner = quoted ? value.slice(1).replace(/["']$/, '') : value;
  const words = inner.split(/\s+/).filter(Boolean).map((raw) => raw.replace(/^[(["']+/, '').replace(/[.,]$/, '').replace(/[)\]"']+$/, ''));
  if (quoted && words.length > 1 && words.every((w) => /^\p{Ll}+$/u.test(w))) return false;
  if (quoted && words.length > 1) words.push(words.join(''));
  return words.some((w) => !isPlaceholder(w) && ((w.length >= 6 && /[^\p{L}'-]/u.test(w)) || /^[A-Za-z0-9_+=/-]{16,}$/.test(w)));
}

export function redact(s: string): string {
  let out = s;
  // A pattern with no capture group hands the match's offset, a number, where the prefix would be.
  for (const re of TOKEN_PATTERNS) out = out.replace(re, (_match, prefix: unknown) => `${typeof prefix === 'string' ? prefix : ''}«redacted»`);
  for (const re of ASSIGNMENT_PATTERNS) {
    out = out.replace(re, (match, prefix: string, value: string) => {
      const secret = AUTH_SCHEME.test(prefix) ? !isPlaceholder(value.replace(/^["']|["']$/g, '')) : isSecretValue(value);
      return secret ? `${prefix}«redacted»` : match;
    });
  }
  return out;
}

/** True when the string contains anything token-shaped. */
export function hasSecret(s: string): boolean {
  return redact(s) !== s;
}

/** 1-based numbers of the lines that contain something token-shaped. Never the value. */
export function secretLines(text: string): number[] {
  const out: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (hasSecret(line)) out.push(i + 1);
  });
  return out;
}
