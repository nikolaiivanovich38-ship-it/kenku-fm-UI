import { describe, expect, it } from "vitest";

import { fileAddress } from "./media";

describe("fileAddress: a file path as the address the player loads", () => {
  it("writes a Windows path with forward slashes and escapes what an address would misread", () => {
    expect(fileAddress("H:\\Audio\\Scores\\Hans Zimmer\\Gladiator\\03 The Battle.flac")).toBe("file:///H:/Audio/Scores/Hans%20Zimmer/Gladiator/03%20The%20Battle.flac");
    expect(fileAddress("C:\\Sounds\\50% rain #2?.wav")).toBe("file:///C:/Sounds/50%25%20rain%20%232%3F.wav");
  });

  it("keeps a network share's server and a Mac or Linux path", () => {
    expect(fileAddress("\\\\nas\\audio\\bell.wav")).toBe("file://nas/audio/bell.wav");
    expect(fileAddress("/home/nik/Music/bell.wav")).toBe("file:///home/nik/Music/bell.wav");
  });
});
