import { describe, expect, it } from "vitest";

import {
  audioFileType,
  fileExtension,
  hasAudioExtension,
  imageFileType,
  isAcceptedFile,
  isAudioFile,
  isSystemFile,
} from "./fileTypes";

describe("isAudioFile (BUG-10)", () => {
  it.each([
    ["song.mp3", "audio/mpeg", true],
    ["song.mp3", "", true],
    ["song.MP3", "", true],
    ["song.m4a", "audio/x-m4a", true],
    ["song.m4a", "audio/mp4", true],
    ["song.flac", "audio/x-flac", true],
    ["song.flac", "", true],
    ["song.wav", "audio/x-wav", true],
    ["song.wav", "audio/wav", true],
    ["song.ogg", "audio/ogg", true],
    ["song.oga", "", true],
    ["song.opus", "audio/opus", true],
    ["song.aac", "audio/aac", true],
    ["song.webm", "video/webm", true],
    ["song.weba", "", true],
    ["song.mp4", "video/mp4", true],
    ["no-extension", "audio/mpeg", true],
    ["no-extension", "audio/ogg; codecs=opus", true],
    ["cover.jpg", "image/jpeg", false],
    ["notes.txt", "text/plain", false],
    ["song.mid", "audio/midi", false],
    ["song.wma", "audio/x-ms-wma", false],
    ["no-extension", "", false],
    [".mp3", "", false],
  ])("%s (%s) -> %s", (name, type, expected) => {
    expect(isAudioFile({ name, type })).toBe(expected);
  });
});

describe("isAcceptedFile with images", () => {
  it.each([
    ["map.png", "image/png", true],
    ["map.webp", "", true],
    ["map.JPG", "", true],
    ["map.svg", "image/svg+xml", true],
    ["song.mp3", "audio/mpeg", false],
    ["map", "", false],
  ])("%s (%s) -> %s", (name, type, expected) => {
    expect(isAcceptedFile({ name, type }, imageFileType)).toBe(expected);
  });
});

describe("fileExtension", () => {
  it.each([
    ["a.mp3", "mp3"],
    ["a.b.FLAC", "flac"],
    ["C:\\Music\\a.wav", "wav"],
    ["file:///Music/My%20Song.ogg", "ogg"],
    ["https://host/a.mp3?dl=1#t=3", "mp3"],
    ["https://host.example/stream", ""],
    ["README", ""],
    [".hidden", ""],
  ])("%s -> %s", (input, expected) => {
    expect(fileExtension(input)).toBe(expected);
  });
});

describe("hasAudioExtension", () => {
  it.each([
    ["file:///Music/a.m4a", true],
    ["https://host/a.mpeg", true],
    ["https://host/a.3gp", true],
    ["https://host/page", false],
    ["file:///a.jpg", false],
  ])("%s -> %s", (input, expected) => {
    expect(hasAudioExtension(input)).toBe(expected);
  });
});

describe("audioFileType.accept", () => {
  it("lists every accepted extension for the file picker", () => {
    expect(audioFileType.accept.split(",")).toEqual(
      audioFileType.extensions.map((extension) => `.${extension}`)
    );
  });
});

describe("isSystemFile", () => {
  it.each([
    [".DS_Store", true],
    ["Thumbs.db", true],
    ["desktop.ini", true],
    ["cover.jpg", false],
  ])("%s -> %s", (name, expected) => {
    expect(isSystemFile(name)).toBe(expected);
  });
});
