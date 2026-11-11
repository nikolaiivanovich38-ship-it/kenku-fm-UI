import { describe, expect, it } from "vitest";

import { homeNetworkAddress, isHomeNetworkAddress, isPrivateListenAddress, ownNetworkAddresses } from "./homeNetwork";

const v4 = (address: string, internal = false) => ({ address, family: "IPv4" as const, internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: `${address}/24` });
const v6 = (address: string) => ({ address, family: "IPv6" as const, internal: false, netmask: "ffff:ffff:ffff:ffff::", mac: "00:00:00:00:00:00", cidr: `${address}/64`, scopeid: 0 });

describe("the home network's address for the remote control (SEC-4, round 7 Your home network)", () => {
  it("is this computer's private IPv4 address on the local network", () => {
    expect(homeNetworkAddress({ lo: [v4("127.0.0.1", true)], "Wi-Fi": [v6("fe80::1"), v4("192.168.1.20")] })).toBe("192.168.1.20");
    expect(homeNetworkAddress({ Ethernet: [v4("10.0.0.7")] })).toBe("10.0.0.7");
    expect(homeNetworkAddress({ Ethernet: [v4("172.20.4.2")] })).toBe("172.20.4.2");
  });

  it("prefers a 192.168 address (the usual home router) over a 10 or 172.16 one (often a VPN or a virtual machine)", () => {
    expect(homeNetworkAddress({ vEthernet: [v4("172.24.0.1")], Ethernet: [v4("10.8.0.2")], "Wi-Fi": [v4("192.168.0.14")] })).toBe("192.168.0.14");
    expect(homeNetworkAddress({ vEthernet: [v4("172.24.0.1")], Ethernet: [v4("10.8.0.2")] })).toBe("10.8.0.2");
  });

  it("never offers a public address, this computer's own (127.x), a link-local one (169.254.x) or IPv6", () => {
    expect(homeNetworkAddress({ lo: [v4("127.0.0.1", true)] })).toBeNull();
    expect(homeNetworkAddress({ eth0: [v4("192.0.2.2"), v4("81.82.83.84"), v4("169.254.10.1"), v6("fd00::5")] })).toBeNull();
    expect(homeNetworkAddress({ eth0: [v4("172.32.0.1"), v4("172.15.0.1")] })).toBeNull();
    expect(homeNetworkAddress({})).toBeNull();
  });

  it("tells a home-network address from any other", () => {
    for (const ok of ["192.168.1.20", "10.1.2.3", "172.16.0.1", "172.31.255.254"]) expect(isHomeNetworkAddress(ok), ok).toBe(true);
    for (const no of ["127.0.0.1", "0.0.0.0", "8.8.8.8", "172.32.0.1", "192.169.0.1", "::1", "localhost", "192.168.1"]) expect(isHomeNetworkAddress(no), no).toBe(false);
  });
});

describe("CR-2 (review 0.5.0): the addresses the remote control may listen on besides 127.0.0.1", () => {
  it("are private, link-local or IPv6 unique local addresses", () => {
    for (const ok of ["192.168.1.20", "10.0.0.7", "172.31.0.1", "169.254.10.1", "fd00::5", "fc12:3::1", "fe80::1", "fe80::1%eth0"]) expect(isPrivateListenAddress(ok), ok).toBe(true);
    for (const no of ["0.0.0.0", "::", "127.0.0.1", "::1", "8.8.8.8", "2001:db8::1", "::ffff:192.168.1.20", "fec0::1", "localhost", ""]) expect(isPrivateListenAddress(no), no).toBe(false);
  });

  it("this computer's are every network card's address but its loopback, without an IPv6 zone", () => {
    expect(ownNetworkAddresses({ lo: [v4("127.0.0.1", true)], "Wi-Fi": [v6("FE80::1%12"), v4("192.168.1.20")] })).toEqual(["fe80::1", "192.168.1.20"]);
  });
});
