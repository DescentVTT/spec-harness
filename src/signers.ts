/**
 * The allowed-signers file, read as OpenSSH reads it (ssh-keygen(1), ALLOWED
 * SIGNERS), to say which signers sign with a key that is not FIDO2.
 *
 * A line is `principals [options] keytype key [comment]`: principals a
 * comma-separated list, quoted or not; options a comma-separated list with no
 * space outside quotes, such as `cert-authority`, `namespaces="git"` or
 * `valid-after="20260101"`. A `cert-authority` line holds the key of a
 * certificate authority, not a person's: the keys it certifies are not in the
 * file, so their type cannot be read from it.
 *
 * Pure: doctor reads the file from the base and passes the text.
 */

/** The key types of a FIDO2 security key: a signature needs a touch no process can supply (ADR-0006). */
export const FIDO2_KEY_TYPES: readonly string[] = ['sk-ssh-ed25519@openssh.com', 'sk-ecdsa-sha2-nistp256@openssh.com'];

export interface AllowedSigner {
  /** 1-based. */
  readonly line: number;
  readonly principals: readonly string[];
  /** Whether the key is a certificate authority's. */
  readonly certAuthority: boolean;
  /** The namespaces the key may sign in, or `null` for any. */
  readonly namespaces: readonly string[] | null;
  readonly validAfter: string | null;
  readonly validBefore: string | null;
  readonly keyType: string;
  readonly key: string;
}

export interface SignersRead {
  readonly signers: readonly AllowedSigner[];
  /** Lines that are not a signer, with why. */
  readonly problems: readonly { readonly line: number; readonly message: string }[];
}

/**
 * A key as the file writes it: base64 of the key's wire form, which starts
 * with the four-byte length of its type's name, so with `AAAA`. OpenSSH tells
 * options from a key type by trying to read a key after it; a key type is
 * followed by a key, and options by a key type, which is not one. So a key
 * type OpenSSH adds later is read as one, as OpenSSH reads it.
 */
const KEY = /^AAAA[A-Za-z0-9+/]+={0,2}$/;

/** The next field and what follows it: up to the first space outside double quotes. */
function field(text: string): { value: string; rest: string } {
  let quoted = false;
  let i = 0;
  for (; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === ' ' || ch === '\t')) break;
  }
  return { value: text.slice(0, i), rest: text.slice(i).trimStart() };
}

/** Splits on commas outside double quotes. */
function commas(text: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

/** Reads the file's text: every signer, and every line that is not one. */
export function readAllowedSigners(text: string): SignersRead {
  const signers: AllowedSigner[] = [];
  const problems: { line: number; message: string }[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const content = raw.trim();
    if (content === '' || content.startsWith('#')) return;
    const principals = field(content);
    let type = field(principals.rest);
    let options: string[] = [];
    if (!KEY.test(field(type.rest).value)) {
      options = commas(type.value);
      type = field(type.rest);
    }
    const key = field(type.rest).value;
    if (type.value === '' || !KEY.test(key)) {
      problems.push({ line, message: 'a signer is its principals, any options, a key type and a key' });
      return;
    }
    const option = (name: string): string | null => {
      const found = options.find((item) => item.toLowerCase().startsWith(`${name}=`));
      return found === undefined ? null : unquote(found.slice(name.length + 1));
    };
    const namespaces = option('namespaces');
    signers.push({
      line,
      principals: commas(unquote(principals.value))
        .map((principal) => principal.trim())
        .filter((principal) => principal !== ''),
      certAuthority: options.some((item) => item.toLowerCase() === 'cert-authority'),
      namespaces: namespaces === null ? null : namespaces.split(',').map((name) => name.trim()),
      validAfter: option('valid-after'),
      validBefore: option('valid-before'),
      keyType: type.value,
      key,
    });
  });
  return { signers, problems };
}

/**
 * The signers whose own key is not a FIDO2 security key's. A certificate
 * authority's line is left out: the keys it vouches for are not in the file.
 */
export function notFido2(signers: readonly AllowedSigner[]): AllowedSigner[] {
  return signers.filter((signer) => !signer.certAuthority && !FIDO2_KEY_TYPES.includes(signer.keyType));
}
