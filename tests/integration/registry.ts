/**
 * A package registry on the loopback address, serving one made-up package:
 * what npm is pointed at when a test measures what npm fetches.
 *
 * Nothing a test fetches comes from anywhere else, and nothing it fetches is
 * anybody's but the test's: the package is written here, a few lines that say
 * they ran. The registry keeps every request it was sent, which is how a test
 * tells a package that was asked about from one that was downloaded.
 */

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

export interface Registry {
  /** What npm is given as its registry. */
  readonly url: string;
  /** Each request so far, as `GET /path`, the path decoded. */
  readonly requests: string[];
  /** The requests so far that downloaded the package, and not only asked about it. */
  downloads(): string[];
  close(): Promise<void>;
}

/** One file of a tar archive: its header, and its content padded to the archive's 512-byte blocks. */
function tarEntry(path: string, content: string): Buffer {
  const body = Buffer.from(content);
  const header = Buffer.alloc(512);
  const field = (text: string, at: number): void => void header.write(text, at, 'latin1');
  const octal = (value: number, width: number): string => value.toString(8).padStart(width - 1, '0');
  field(path, 0);
  // Executable: npm links a package's command to the file as it was packed.
  field(octal(0o755, 8), 100);
  field(octal(0, 8), 108);
  field(octal(0, 8), 116);
  field(octal(body.length, 12), 124);
  field(octal(0, 12), 136);
  // The checksum is taken with its own field read as spaces.
  field('        ', 148);
  field('0', 156);
  field('ustar', 257);
  field('00', 263);
  field(`${octal(header.reduce((sum, byte) => sum + byte, 0), 7)}\u0000 `, 148);
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

/** A package as a registry hands it out: its files under `package/`, in a gzipped tar archive. */
function tarball(files: Readonly<Record<string, string>>): Buffer {
  const entries = Object.entries(files).map(([path, content]) => tarEntry(`package/${path}`, content));
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

/**
 * Serves `name` at `version`, with a command `command` that runs `script`
 * under node, and answers 404 to everything else. Close it when the test is
 * done.
 */
export async function serve(name: string, version: string, command: string, script: string): Promise<Registry> {
  const manifest = { name, version, bin: { [command]: 'cli.js' } };
  const packed = tarball({ 'package.json': `${JSON.stringify(manifest)}\n`, 'cli.js': `#!/usr/bin/env node\n${script}\n` });
  const file = `/${name}/-/${command}-${version}.tgz`;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const path = decodeURIComponent(request.url ?? '');
    requests.push(`${request.method} ${path}`);
    if (path === `/${name}`) {
      const dist = {
        tarball: `http://127.0.0.1:${(server.address() as AddressInfo).port}${file}`,
        shasum: createHash('sha1').update(packed).digest('hex'),
        integrity: `sha512-${createHash('sha512').update(packed).digest('base64')}`,
      };
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name, 'dist-tags': { latest: version }, versions: { [version]: { ...manifest, dist } } }));
    } else if (path === file) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' }).end(packed);
    } else {
      response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    requests,
    downloads: () => requests.filter((request) => request.endsWith('.tgz')),
    close: () =>
      new Promise((resolve) => {
        // npm keeps its connections open for the next request.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
