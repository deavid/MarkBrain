import { describe, it, expect } from 'vitest';
import { createTar, createTarGz, parseTar, parseTarGz, sanitizeTarPath } from '../utils/tarGz';

describe('tarGz — POSIX ustar tar writer/reader', () => {
  it('round-trips entries with exact byte equality', () => {
    const entries = [
      { path: 'a.txt', data: new TextEncoder().encode('hello world') },
      { path: 'nested/dir/b.bin', data: new Uint8Array([0, 1, 2, 3, 255, 254]) },
    ];
    const tar = createTar(entries);
    const parsed = parseTar(tar);
    expect(parsed.length).toBe(2);
    expect(parsed[0].path).toBe('a.txt');
    expect(new TextDecoder().decode(parsed[0].data)).toBe('hello world');
    expect(parsed[1].path).toBe('nested/dir/b.bin');
    expect(Array.from(parsed[1].data)).toEqual([0, 1, 2, 3, 255, 254]);
  });

  it('writes 512-byte headers with a valid checksum that GNU tar accepts structurally', () => {
    const tar = createTar([{ path: 'x.txt', data: new Uint8Array([1]) }]);
    expect(tar.length % 512).toBe(0);
    // name field
    expect(new TextDecoder().decode(tar.subarray(0, 5))).toBe('x.txt');
    // mode field: '0000644\0'
    expect(new TextDecoder().decode(tar.subarray(100, 108))).toBe('0000644\0');
    // typeflag
    expect(String.fromCharCode(tar[156])).toBe('0');
    // magic + version: 'ustar\0' + '00'
    expect(new TextDecoder().decode(tar.subarray(257, 265))).toBe('ustar\0' + '00');
    // size field: octal '1'
    const sizeStr = new TextDecoder().decode(tar.subarray(124, 136)).replace(/\0.*$/, '');
    expect(parseInt(sizeStr, 8)).toBe(1);
    // checksum verification: sum of all header bytes with chksum field as spaces
    const saved = tar.slice(148, 156);
    tar.fill(0x20, 148, 156);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += tar[i];
    const storedSum = parseInt(new TextDecoder().decode(saved).replace(/\0.*$/, '').trim(), 8);
    expect(storedSum).toBe(sum);
    tar.set(saved, 148);
    // file content padded to 512, then two zero blocks
    const content = tar.subarray(512, 1024);
    expect(content[0]).toBe(1);
    expect(content.length).toBe(512);
    const trailer = tar.subarray(1024);
    expect(trailer.every((b) => b === 0)).toBe(true);
  });

  it('pads file content to 512-byte blocks', () => {
    const data = new Uint8Array(600); // 600 % 512 = 88 → padded to 1024
    const tar = createTar([{ path: 'p.bin', data }]);
    // 1 header (512) + 1024 content + 1024 trailer (two zero blocks) = 2560
    expect(tar.length).toBe(2560);
    const parsed = parseTar(tar);
    expect(parsed[0].data.length).toBe(600);
    expect(parsed[0].data).toEqual(data);
  });

  it('handles exact multiples of 512 without adding a padding block', () => {
    const data = new Uint8Array(512);
    const tar = createTar([{ path: 'exact.bin', data }]);
    expect(tar.length).toBe(512 + 512 + 1024);
    const parsed = parseTar(tar);
    expect(parsed[0].data.length).toBe(512);
  });

  it('round-trips Unicode filenames and content', () => {
    const entries = [
      { path: 'project—üñï/🧠-note.md', data: new TextEncoder().encode('📚 héllo wörld — 你好 — emoji 🎉') },
    ];
    const parsed = parseTar(createTar(entries));
    expect(parsed[0].path).toBe('project—üñï/🧠-note.md');
    expect(new TextDecoder().decode(parsed[0].data)).toBe('📚 héllo wörld — 你好 — emoji 🎉');
  });

  it('rejects path traversal and absolute paths on write', () => {
    expect(() => createTar([{ path: '../evil.txt', data: new Uint8Array() }])).toThrow();
    expect(() => createTar([{ path: 'a/../../evil.txt', data: new Uint8Array() }])).toThrow();
    expect(() => createTar([{ path: '/absolute/evil.txt', data: new Uint8Array() }])).toThrow();
  });

  it('sanitizeTarPath rejects ../, absolute paths, and backslashes', () => {
    expect(() => sanitizeTarPath('../evil')).toThrow();
    expect(() => sanitizeTarPath('a/../evil')).toThrow();
    expect(() => sanitizeTarPath('/etc/passwd')).toThrow();
    expect(() => sanitizeTarPath('windows\\path')).toThrow();
    expect(() => sanitizeTarPath('')).toThrow();
    expect(sanitizeTarPath('ok/path/file.md')).toBe('ok/path/file.md');
  });

  it('gzip round-trip via createTarGz / parseTarGz is byte-exact', async () => {
    const entries = [
      { path: 'proj-x/project.json', data: new TextEncoder().encode('{"projectId":"proj-x"}\n') },
      { path: 'proj-x/threads/t1.json', data: new TextEncoder().encode('{"thread":{"id":"t1"},"turns":[],"chapters":[]}\n') },
    ];
    const gz = await createTarGz(entries);
    const parsed = await parseTarGz(gz);
    expect(parsed.length).toBe(2);
    expect(parsed[0].path).toBe('proj-x/project.json');
    expect(new TextDecoder().decode(parsed[1].data)).toBe(
      '{"thread":{"id":"t1"},"turns":[],"chapters":[]}\n'
    );
  });

  it('handles empty file entries (zero-length data)', () => {
    const parsed = parseTar(createTar([{ path: 'empty.txt', data: new Uint8Array(0) }]));
    expect(parsed[0].path).toBe('empty.txt');
    expect(parsed[0].data.length).toBe(0);
  });
});
