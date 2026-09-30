import { describe, expect, it } from 'vitest';

import { FIDO2_KEY_TYPES, notFido2, readAllowedSigners } from '../../src/signers.js';

// Made-up keys: the reader never decodes one, it only needs base64.
const ED = 'AAAAC3NzaC1lZDI1NTE5AAAAIGb0mVx1Vt1yZ1U0dG1uZm9yZXhhbXBsZW9ubHk=';
const SK = 'AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIE1hZGUrdXArZm9yK2E+dGVzdA==';

describe('the allowed-signers file', () => {
  it('reads principals, options, the key type and the key, skipping comments and blank lines', () => {
    const text = [
      '# the maintainers',
      '',
      `a@example.com ssh-ed25519 ${ED} a laptop`,
      `"b@example.com,c@example.com" namespaces="git,file",valid-after="20260101" sk-ssh-ed25519@openssh.com ${SK}`,
      `  *@example.com Cert-Authority,namespaces="git" ssh-ed25519 ${ED}`,
      `d@example.com VALID-BEFORE="20270101",Namespaces="git" ecdsa-sha2-nistp256 ${ED}`,
    ].join('\r\n');
    const { signers, problems } = readAllowedSigners(text);
    expect(problems).toEqual([]);
    expect(signers).toEqual([
      { line: 3, principals: ['a@example.com'], certAuthority: false, namespaces: null, validAfter: null, validBefore: null, keyType: 'ssh-ed25519', key: ED },
      {
        line: 4,
        principals: ['b@example.com', 'c@example.com'],
        certAuthority: false,
        namespaces: ['git', 'file'],
        validAfter: '20260101',
        validBefore: null,
        keyType: 'sk-ssh-ed25519@openssh.com',
        key: SK,
      },
      { line: 5, principals: ['*@example.com'], certAuthority: true, namespaces: ['git'], validAfter: null, validBefore: null, keyType: 'ssh-ed25519', key: ED },
      { line: 6, principals: ['d@example.com'], certAuthority: false, namespaces: ['git'], validAfter: null, validBefore: '20270101', keyType: 'ecdsa-sha2-nistp256', key: ED },
    ]);
  });

  it('reads quoted principals and options as one field each, spaces and all', () => {
    const { signers, problems } = readAllowedSigners(`"f@example.com, g@example.com" namespaces="git, file" ssh-ed25519 ${ED}`);
    expect(problems).toEqual([]);
    expect(signers[0]).toMatchObject({ principals: ['f@example.com', 'g@example.com'], namespaces: ['git', 'file'], keyType: 'ssh-ed25519', key: ED });
  });

  it('reads a key type OpenSSH has added since, told from options by the key after it', () => {
    expect(readAllowedSigners(`e@example.com ssh-mldsa65@openssh.com ${ED}`).signers[0]).toMatchObject({ keyType: 'ssh-mldsa65@openssh.com', key: ED });
  });

  it('names a line that is not a signer, and reads the rest', () => {
    const { signers, problems } = readAllowedSigners(
      [`a@example.com ssh-ed25519`, 'b@example.com', `c@example.com ssh-ed25519 ${ED}`, `d@example.com namespaces="git" ssh-ed25519 not-base64!`, 'three plain words', 'e@example.com ssh-ed25519 QUJDRA=='].join('\n'),
    );
    const problem = 'a signer is its principals, any options, a key type and a key';
    // A key is base64 that starts with AAAA, the length of its type's name: a word is not one.
    expect(problems).toEqual([
      { line: 1, message: problem },
      { line: 2, message: problem },
      { line: 4, message: problem },
      { line: 5, message: problem },
      { line: 6, message: problem },
    ]);
    expect(signers.map((signer) => signer.line)).toEqual([3]);
  });

  it('reads fields apart at a tab as at a space, as OpenSSH does', () => {
    expect(readAllowedSigners(`a@example.com\tnamespaces="git"\tssh-ed25519\t${ED}`)).toEqual({
      signers: [{ line: 1, principals: ['a@example.com'], certAuthority: false, namespaces: ['git'], validAfter: null, validBefore: null, keyType: 'ssh-ed25519', key: ED }],
      problems: [],
    });
  });

  it('reads a key only as a whole field of base64 that starts with AAAA', () => {
    const problem = 'a signer is its principals, any options, a key type and a key';
    const { signers, problems } = readAllowedSigners([`a@example.com ssh-ed25519 x${ED}`, `b@example.com ssh-ed25519 ${ED}!`].join('\n'));
    expect(signers).toEqual([]);
    expect(problems).toEqual([
      { line: 1, message: problem },
      { line: 2, message: problem },
    ]);
  });

  it('names no principal for an empty name, between commas or quoted', () => {
    expect(readAllowedSigners(`a@example.com,,b@example.com, ssh-ed25519 ${ED}`).signers[0]?.principals).toEqual(['a@example.com', 'b@example.com']);
    expect(readAllowedSigners(`"" ssh-ed25519 ${ED}`).signers[0]?.principals).toEqual([]);
  });

  it('takes out the first pair of double quotes in the principals, wherever it opens, and ends the field at the second, as OpenSSH does', () => {
    // OpenSSH's strdelim: the first quote is taken out with the next one, and
    // the field ends there, so a quote in the middle quotes the rest of a name.
    expect(readAllowedSigners(`a@example.com,"b@example.com" ssh-ed25519 ${ED}`).signers[0]?.principals).toEqual(['a@example.com', 'b@example.com']);
    expect(readAllowedSigners(`a@example.com,"b@example.com c@example.com" ssh-ed25519 ${ED}`).signers[0]?.principals).toEqual(['a@example.com', 'b@example.com c@example.com']);
    // What follows the closing quote is the next field: here it is read as options, which OpenSSH refuses.
    const options = 'OpenSSH reads only cert-authority, namespaces="...", valid-after="..." and valid-before="..." as options';
    expect(readAllowedSigners(`"a@example.com"b@example.com ssh-ed25519 ${ED}`)).toEqual({ signers: [], problems: [{ line: 1, message: options }] });
    expect(readAllowedSigners(`a@example.com,"b@example.com",c@example.com ssh-ed25519 ${ED}`)).toEqual({ signers: [], problems: [{ line: 1, message: options }] });
    expect(readAllowedSigners(`"a@example.com ssh-ed25519 ${ED}`)).toEqual({ signers: [], problems: [{ line: 1, message: 'its principals open a double quote that is never closed' }] });
  });

  it('reads an option\'s value only in double quotes, where \\" is a quote, as OpenSSH does', () => {
    expect(readAllowedSigners(`a@example.com namespaces="git,\\"file\\"",valid-after="20260101" ssh-ed25519 ${ED}`).signers[0]).toMatchObject({
      namespaces: ['git', '"file"'],
      validAfter: '20260101',
      keyType: 'ssh-ed25519',
    });
    expect(readAllowedSigners(`a@example.com namespaces="a \\"b c\\"" ssh-ed25519 ${ED}`).signers[0]).toMatchObject({ namespaces: ['a "b c"'], key: ED });
    const problem = (line: string): string | undefined => readAllowedSigners(line).problems[0]?.message;
    expect(problem(`a@example.com namespaces=git ssh-ed25519 ${ED}`)).toBe('the value of namespaces is not in double quotes, as OpenSSH needs: write namespaces="..."');
    expect(problem(`a@example.com Valid-Before=20270101 ssh-ed25519 ${ED}`)).toBe('the value of Valid-Before is not in double quotes, as OpenSSH needs: write Valid-Before="..."');
    expect(problem(`a@example.com namespaces="git ssh-ed25519 ${ED}`)).toBe('its options open a double quote that is never closed');
    expect(problem(`a@example.com namespaces="git\\" ssh-ed25519 ${ED}`)).toBe('its options open a double quote that is never closed');
  });

  it('refuses the options OpenSSH refuses: another option, one written wrong, a value given twice, a separator that is no comma', () => {
    const problem = (options: string): string | undefined => readAllowedSigners(`a@example.com ${options} ssh-ed25519 ${ED}`).problems[0]?.message;
    const only = 'OpenSSH reads only cert-authority, namespaces="...", valid-after="..." and valid-before="..." as options';
    for (const options of ['no-touch-required', 'cert-authority="yes"', 'namespaces', 'cert-authority,,namespaces="git"']) expect(problem(options), options).toBe(only);
    expect(problem('namespaces="git",NAMESPACES="file"')).toBe('it gives namespaces twice, which OpenSSH refuses');
    expect(problem('valid-after="20260101",valid-after="20260102"')).toBe('it gives valid-after twice, which OpenSSH refuses');
    expect(problem('namespaces="git"x')).toBe('its options are not separated by commas');
    // OpenSSH matches cert-authority as a prefix, and then wants a comma.
    expect(problem('cert-authority"x"')).toBe('its options are not separated by commas');
    expect(problem('cert-authority,')).toBe('its options end in a comma');
    // The key is read first, and what is wrong with it is said first.
    expect(readAllowedSigners('a@example.com no-touch-required ssh-ed25519 not-a-key').problems[0]?.message).toBe('a signer is its principals, any options, a key type and a key');
  });

  it('reads cert-authority beside a valued option, in any order and case', () => {
    expect(readAllowedSigners(`*@example.com namespaces="git",CERT-AUTHORITY,valid-before="20270101" ssh-ed25519 ${ED}`).signers[0]).toMatchObject({
      certAuthority: true,
      namespaces: ['git'],
      validBefore: '20270101',
    });
  });

  it('reads an empty file as no signer', () => {
    expect(readAllowedSigners('')).toEqual({ signers: [], problems: [] });
    expect(readAllowedSigners('# nobody yet\n\n')).toEqual({ signers: [], problems: [] });
  });
});

describe('a signer whose key is not FIDO2', () => {
  it('is one whose key type is not a security key\'s, a certificate authority left out', () => {
    expect(FIDO2_KEY_TYPES).toEqual(['sk-ssh-ed25519@openssh.com', 'sk-ecdsa-sha2-nistp256@openssh.com']);
    const { signers } = readAllowedSigners(
      [
        `a@example.com ssh-ed25519 ${ED}`,
        `b@example.com sk-ssh-ed25519@openssh.com ${SK}`,
        `c@example.com sk-ecdsa-sha2-nistp256@openssh.com ${SK}`,
        `d@example.com ssh-rsa ${ED}`,
        `*@example.com cert-authority ssh-ed25519 ${ED}`,
        `e@example.com ecdsa-sha2-nistp384 ${ED}`,
      ].join('\n'),
    );
    expect(notFido2(signers).map((signer) => [signer.principals.join(','), signer.keyType])).toEqual([
      ['a@example.com', 'ssh-ed25519'],
      ['d@example.com', 'ssh-rsa'],
      ['e@example.com', 'ecdsa-sha2-nistp384'],
    ]);
  });
});
