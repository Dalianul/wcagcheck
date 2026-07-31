import { describe, it, expect } from 'vitest';
import { isBlockedHost } from '../src/scan.js';

// The scanner fetches user-supplied URLs, so this guard is the only thing
// standing between the endpoint and internal addresses. Each blocked case below
// bypassed the original regex implementation.
describe('isBlockedHost', () => {
  const blocked = [
    ['localhost', 'plain loopback name'],
    ['localhost.', 'trailing dot defeats an anchored regex'],
    ['LOCALHOST', 'case'],
    ['app.localhost', 'localhost subdomain'],
    ['printer.local', 'mDNS'],
    ['db.internal', 'internal TLD'],
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'rest of 127/8'],
    ['0.0.0.0', 'this host'],
    ['10.1.2.3', 'private class A'],
    ['172.16.0.1', 'private class B lower bound'],
    ['172.31.255.255', 'private class B upper bound'],
    ['192.168.1.1', 'private class C'],
    ['169.254.169.254', 'cloud metadata endpoint'],
    ['100.64.0.1', 'CGNAT range'],
    ['198.18.0.1', 'benchmarking range'],
    ['224.0.0.1', 'multicast'],
    ['[::1]', 'IPv6 loopback keeps its brackets in URL.hostname'],
    ['::1', 'IPv6 loopback unbracketed'],
    ['[::ffff:127.0.0.1]', 'IPv4-mapped IPv6 smuggles v4 through v6 syntax'],
    ['[fc00::1]', 'IPv6 unique local'],
    ['[fe80::1]', 'IPv6 link-local'],
    ['2130706433', 'decimal integer form of 127.0.0.1'],
    ['0x7f000001', 'hex integer form'],
    ['intranet', 'bare label is not a public domain'],
    ['999.999.999.999', 'octet overflow'],
  ];

  for (const [host, why] of blocked) {
    it(`blocks ${host} — ${why}`, () => {
      expect(isBlockedHost(host)).toBe(true);
    });
  }

  const allowed = [
    'example.com',
    'www.w3.org',
    'sub.domain.co.uk',
    'emag.ro',
    '8.8.8.8',
    '93.184.216.34',
    '172.15.0.1', // just below the private block
    '172.32.0.1', // just above it
    '100.63.0.1', // just below CGNAT
    '100.128.0.1', // just above CGNAT
  ];

  for (const host of allowed) {
    it(`allows ${host}`, () => {
      expect(isBlockedHost(host)).toBe(false);
    });
  }
});
