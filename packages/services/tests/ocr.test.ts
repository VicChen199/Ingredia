// OCR seam contract: unset OCR_CONNECTION_STRING returns the sample label;
// a set one must name an endpoint and a key before any engine call is made.
import { afterEach, describe, expect, it } from "vitest";
import { SAMPLE_LABEL_TEXT, parseOcrConnectionString, readLabelText } from "../src/ocr";

const IMAGE = new Uint8Array([1, 2, 3]);

describe("parseOcrConnectionString", () => {
  it("reads endpoint and key, case-insensitively and in any order", () => {
    expect(parseOcrConnectionString("key=abc;ENDPOINT=https://ocr.example.com/")).toEqual({
      endpoint: "https://ocr.example.com/",
      key: "abc",
    });
  });

  it("keeps '=' inside a value", () => {
    expect(parseOcrConnectionString("Endpoint=https://x/;Key=a=b==").key).toBe("a=b==");
  });

  it.each(["", "Endpoint=https://x/", "Key=abc", "garbage"])("rejects %j", (value) => {
    expect(() => parseOcrConnectionString(value)).toThrow(/Endpoint= and Key=/);
  });
});

describe("readLabelText", () => {
  const original = process.env.OCR_CONNECTION_STRING;
  afterEach(() => {
    if (original === undefined) delete process.env.OCR_CONNECTION_STRING;
    else process.env.OCR_CONNECTION_STRING = original;
  });

  it.each([undefined, "", "   "])("returns the sample label when the env var is %j", async (value) => {
    if (value === undefined) delete process.env.OCR_CONNECTION_STRING;
    else process.env.OCR_CONNECTION_STRING = value;

    await expect(readLabelText(IMAGE, "image/png")).resolves.toBe(SAMPLE_LABEL_TEXT);
  });

  it("fails without calling the engine when the connection string is malformed", async () => {
    process.env.OCR_CONNECTION_STRING = "Endpoint=https://ocr.example.com/";

    await expect(readLabelText(IMAGE, "image/png")).rejects.toThrow(/Endpoint= and Key=/);
  });
});
