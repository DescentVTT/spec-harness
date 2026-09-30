/**
 * The allowed-signers file, read as OpenSSH reads it (ssh-keygen(1), ALLOWED
 * SIGNERS), to say which signers sign with a key that is not FIDO2.
 *
 * A line is `principals [options] keytype key [comment]`: principals a
 * comma-separated list, which may hold a double-quoted part; options a
 * comma-separated list with no space outside quotes, such as
 * `cert-authority`, `namespaces="git"` or `valid-after="20260101"`, each
 * value in double quotes. The quotes are read as OpenSSH's sshsig.c and
 * misc.c read them, and each function below names the one it follows. A
 * `cert-authority` line holds the key of a certificate authority, not a
 * person's: the keys it certifies are not in the file, so their type cannot
 * be read from it.
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

/** What OpenSSH's `strdelim` skips as whitespace between fields. */
const WHITESPACE = /^[ \t\r\n]*/;

/**
 * The principals field, as OpenSSH's `strdelimw` reads it: up to the first
 * whitespace or double quote. A quote there, at the start or in the middle,
 * is taken out with the next one, and the field ends at that one whatever
 * follows it: `a@example.com,"b@example.com"` is
 * `a@example.com,b@example.com`, and `"a"b` is `a`, with `b` the next field.
 * `null` when the quote is never closed, which makes the line no signer.
 */
function principalsField(text: string): { value: string; rest: string } | null {
  const at = text.search(/[ \t\r\n"]/);
  if (at === -1) return { value: text, rest: '' };
  if (text.charAt(at) !== '"') return { value: text.slice(0, at), rest: text.slice(at).replace(WHITESPACE, '') };
  const close = text.indexOf('"', at + 1);
  if (close === -1) return null;
  return { value: text.slice(0, at) + text.slice(at + 1, close), rest: text.slice(close + 1).replace(WHITESPACE, '') };
}

/**
 * The options field, as OpenSSH's `sshkey_advance_past_options` finds its
 * end: the first space or tab outside double quotes, where `\"` is a quote
 * inside them. `null` when a quote is never closed.
 */
function optionsField(text: string): { value: string; rest: string } | null {
  // Reading one character past the end changes nothing - `charAt` gives the
  // empty string there - so `<=` for `<` is equivalent.
  let quoted = false;
  let i = 0;
  for (; i < text.length && (quoted || (text.charAt(i) !== ' ' && text.charAt(i) !== '\t')); i += 1) {
    if (text.charAt(i) === '\\' && text.charAt(i + 1) === '"') i += 1;
    else if (text.charAt(i) === '"') quoted = !quoted;
  }
  if (quoted) return null;
  return { value: text.slice(0, i), rest: text.slice(i).replace(/^[ \t]*/, '') };
}

/** A key type or a key: up to the next space or tab. */
function word(text: string): { value: string; rest: string } {
  const [, value, rest] = /^([^ \t]*)[ \t]*(.*)$/s.exec(text) as RegExpExecArray;
  return { value: value as string, rest: rest as string };
}

interface Options {
  readonly certAuthority: boolean;
  readonly namespaces: string | null;
  readonly validAfter: string | null;
  readonly validBefore: string | null;
}

const NO_OPTIONS: Options = { certAuthority: false, namespaces: null, validAfter: null, validBefore: null };

/** The options with a value, each of which OpenSSH takes once. */
const VALUED = ['namespaces', 'valid-after', 'valid-before'];

/**
 * The options, as OpenSSH's `sshsigopt_parse` reads them: `cert-authority`
 * alone and `namespaces`, `valid-after` and `valid-before` with a value,
 * separated by commas, a name in any case and a value always in double
 * quotes, `\"` a quote inside one (its `opt_dequote`). Anything else - another
 * option, a value without its quotes or given twice, anything but a comma
 * after an option, a comma with nothing after it - makes the line no signer,
 * as it does for OpenSSH. The times are read as written.
 */
function readOptions(text: string): Options | { refused: string } {
  const values = new Map<string, string>();
  let certAuthority = false;
  let at = 0;
  while (at < text.length) {
    const name = (/^[^,="]*/.exec(text.slice(at)) as RegExpExecArray)[0];
    const key = name.toLowerCase();
    at += name.length;
    const valued = text.charAt(at) === '=';
    if (key === 'cert-authority' && !valued) {
      certAuthority = true;
    } else if (VALUED.includes(key) && valued) {
      // `optionsField` has refused a quote never closed, so a value that
      // opens one closes it.
      const quoted = /^"((?:\\"|[^"])*)"/.exec(text.slice(at + 1));
      if (quoted === null) return { refused: `the value of ${name} is not in double quotes, as OpenSSH needs: write ${name}="..."` };
      if (values.has(key)) return { refused: `it gives ${key} twice, which OpenSSH refuses` };
      values.set(key, (quoted[1] as string).replace(/\\"/g, '"'));
      at += 1 + quoted[0].length;
    } else {
      return { refused: 'OpenSSH reads only cert-authority, namespaces="...", valid-after="..." and valid-before="..." as options' };
    }
    if (at === text.length) break;
    if (text.charAt(at) !== ',') return { refused: 'its options are not separated by commas' };
    at += 1;
    if (at === text.length) return { refused: 'its options end in a comma' };
  }
  return { certAuthority, namespaces: values.get('namespaces') ?? null, validAfter: values.get('valid-after') ?? null, validBefore: values.get('valid-before') ?? null };
}

/** Reads the file's text: every signer, and every line that is not one. */
export function readAllowedSigners(text: string): SignersRead {
  const signers: AllowedSigner[] = [];
  const problems: { line: number; message: string }[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const content = raw.trim();
    if (content === '' || content.startsWith('#')) return;
    const refuse = (message: string): void => {
      problems.push({ line, message });
    };
    const principals = principalsField(content);
    if (principals === null) return refuse('its principals open a double quote that is never closed');
    // OpenSSH reads a key where the key type would be, and options when it
    // cannot: a key type is followed by a key, and options are not.
    let type = word(principals.rest);
    let written: string | null = null;
    if (!KEY.test(word(type.rest).value)) {
      const field = optionsField(principals.rest);
      if (field === null) return refuse('its options open a double quote that is never closed');
      written = field.value;
      type = word(field.rest);
    }
    const key = word(type.rest).value;
    // With no key type, nothing follows it either, and no key is a key.
    if (!KEY.test(key)) return refuse('a signer is its principals, any options, a key type and a key');
    // OpenSSH reads the key before the options, and says first what is wrong with it.
    const options = written === null ? NO_OPTIONS : readOptions(written);
    if ('refused' in options) return refuse(options.refused);
    signers.push({
      line,
      // The field keeps no quote, so every comma parts two principals, as
      // OpenSSH's pattern lists read them.
      principals: principals.value
        .split(',')
        .map((principal) => principal.trim())
        .filter((principal) => principal !== ''),
      certAuthority: options.certAuthority,
      namespaces: options.namespaces === null ? null : options.namespaces.split(',').map((name) => name.trim()),
      validAfter: options.validAfter,
      validBefore: options.validBefore,
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
