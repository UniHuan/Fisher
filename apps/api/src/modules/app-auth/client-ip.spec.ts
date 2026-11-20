import { maskClientIp } from './client-ip';

describe('maskClientIp', () => {
  it('keeps only the IPv4 /24', () => {
    expect(maskClientIp('203.0.113.9')).toBe('203.0.113.0');
    expect(maskClientIp('127.0.0.1')).toBe('127.0.0.0');
    expect(maskClientIp(' 198.51.100.42 ')).toBe('198.51.100.0');
  });

  it('unwraps IPv4-mapped IPv6 addresses before masking', () => {
    expect(maskClientIp('::ffff:203.0.113.9')).toBe('203.0.113.0');
    // Same address in the hexadecimal mapped form used by some stacks.
    expect(maskClientIp('::ffff:cb00:7109')).toBe('203.0.113.0');
    expect(maskClientIp('::ffff:127.0.0.1')).toBe('127.0.0.0');
  });

  it('keeps only the IPv6 /48', () => {
    expect(maskClientIp('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::');
    expect(maskClientIp('2001:0db8:abcd:0012:0000:0000:0000:0001')).toBe('2001:db8:abcd::');
    expect(maskClientIp('::1')).toBe('0:0:0::');
    expect(maskClientIp('fe80::1%en0')).toBe('fe80:0:0::');
    expect(maskClientIp('2001:db8::192.0.2.1')).toBe('2001:db8:0::');
  });

  it('never returns the full client address', () => {
    const full = '203.0.113.9';
    expect(maskClientIp(full)).not.toBe(full);
    const fullV6 = '2001:db8:abcd:12::1';
    expect(maskClientIp(fullV6)).not.toBe(fullV6);
  });

  it('returns null for missing or unparseable input', () => {
    expect(maskClientIp(undefined)).toBeNull();
    expect(maskClientIp(null)).toBeNull();
    expect(maskClientIp('')).toBeNull();
    expect(maskClientIp('   ')).toBeNull();
    expect(maskClientIp('not-an-ip')).toBeNull();
    expect(maskClientIp('::ffff:not-an-ip')).toBeNull();
    expect(maskClientIp('999.1.1.1')).toBeNull();
  });
});
