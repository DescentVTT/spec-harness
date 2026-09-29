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
