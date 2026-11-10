/**
 * SEC-4, round 7 (Settings › Remote control › Your home network): the address a phone or tablet on the same Wi-Fi
 * uses to reach Lyre. Only a private IPv4 address of this computer (RFC 1918: 192.168.x.x, 10.x.x.x,
 * 172.16.x.x to 172.31.x.x) is offered, never a public one and never "every address" (0.0.0.0): the remote control
 * then listens on the home network and nowhere else. A 192.168 address comes first, because a home router gives one
 * and a VPN or a virtual machine's network card often has a 10 or 172 one.
 */
import type { NetworkInterfaceInfo } from "os";

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

const PRIVATE: readonly RegExp[] = [/^192\.168\.\d{1,3}\.\d{1,3}$/, /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/];

/** Whether an address is a private IPv4 address of a home or office network. */
export function isHomeNetworkAddress(address: string): boolean {
  if (!PRIVATE.some((pattern) => pattern.test(address))) return false;
  return address.split(".").every((part) => Number(part) <= 255);
}

/** This computer's address on its home network (os.networkInterfaces()), or null when it has none. */
export function homeNetworkAddress(interfaces: Interfaces): string | null {
  const found: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const info of list ?? []) {
      if (info.family === "IPv4" && !info.internal && isHomeNetworkAddress(info.address)) found.push(info.address);
    }
  }
  // The pattern order is the preference order.
  for (const pattern of PRIVATE) {
    const match = found.find((address) => pattern.test(address));
    if (match) return match;
  }
  return null;
}
