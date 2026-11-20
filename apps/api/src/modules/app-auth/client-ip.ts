import { isIP } from 'node:net';

const IPV4_MAPPED_PREFIX = '::ffff:';

function maskIpv4(address: string): string | null {
  const parts = address.split('.');
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  const [first, second, third] = octets;
  if (first === undefined || second === undefined || third === undefined) {
    return null;
  }
  // Design 12.2: IPv4 keeps only the first three segments (/24).
  return `${first}.${second}.${third}.0`;
}

function truncateIpv6(address: string): string | null {
  let value = address.toLowerCase();
  const zoneIndex = value.indexOf('%');
  if (zoneIndex !== -1) {
    value = value.slice(0, zoneIndex);
  }

  // Convert a dotted IPv4 tail (e.g. 2001:db8::192.0.2.1) into two hex groups.
  const tail = value.slice(value.lastIndexOf(':') + 1);
  if (tail.includes('.')) {
    if (isIP(tail) !== 4) {
      return null;
    }
    const octets = tail.split('.').map((part) => Number(part));
    const [first, second, third, fourth] = octets;
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined
    ) {
      return null;
    }
    const high = (first << 8) | second;
    const low = (third << 8) | fourth;
    value = `${value.slice(0, value.lastIndexOf(':') + 1)}${high.toString(16)}:${low.toString(16)}`;
  }

  const [left, right] = value.split('::');
  const leftGroups = left === undefined || left === '' ? [] : left.split(':');
  const rightGroups = right === undefined || right === '' ? [] : right.split(':');
  const missing = 8 - leftGroups.length - rightGroups.length;
  // `value.split('::')` yields one entry when the address is not compressed.
  if (right !== undefined && missing < 0) {
    return null;
  }
  const groups =
    right === undefined
      ? leftGroups
      : [...leftGroups, ...Array<string>(Math.max(0, missing)).fill('0'), ...rightGroups];
  if (groups.length !== 8) {
    return null;
  }

  const parsed: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null;
    }
    parsed.push(Number.parseInt(group, 16));
  }
  const [first, second, third] = parsed;
  if (first === undefined || second === undefined || third === undefined) {
    return null;
  }
  // Design 12.2: IPv6 keeps only the first 48 bits (/48).
  return `${first.toString(16)}:${second.toString(16)}:${third.toString(16)}::`;
}

/**
 * Minimal session IP retained for abuse analysis (design 12.2): IPv4 keeps /24,
 * IPv6 keeps /48. IPv4-mapped IPv6 (`::ffff:a.b.c.d` and `::ffff:xxxx:xxxx`)
 * is unwrapped first so dual-stack loopback is masked as IPv4.
 * Returns null for empty or unparseable input rather than storing plaintext.
 */
export function maskClientIp(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value.length === 0) {
    return null;
  }

  if (value.toLowerCase().startsWith(IPV4_MAPPED_PREFIX)) {
    const mapped = value.slice(IPV4_MAPPED_PREFIX.length);
    const dotted = maskIpv4(mapped);
    if (dotted !== null) {
      return dotted;
    }
    const groups = mapped.split(':');
    if (groups.length === 2) {
      const [highText, lowText] = groups;
      if (
        highText !== undefined &&
        lowText !== undefined &&
        /^[0-9a-f]{1,4}$/i.test(highText) &&
        /^[0-9a-f]{1,4}$/i.test(lowText)
      ) {
        const high = Number.parseInt(highText, 16);
        const low = Number.parseInt(lowText, 16);
        return `${high >> 8}.${high & 0xff}.${low >> 8}.0`;
      }
    }
    return null;
  }

  if (isIP(value) === 4) {
    return maskIpv4(value);
  }
  if (isIP(value) === 6) {
    return truncateIpv6(value);
  }
  return null;
}
