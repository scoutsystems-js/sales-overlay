/**
 * WOFF2 CHARACTER COVERAGE — which codepoints can a self-hosted font actually draw?
 *
 * ⚠⚠ WHY THIS EXISTS. `archivo-expanded-700.woff2` shipped on 2026-08-18 and was
 * believed to be the login wordmark and the welcome-overlay title for two days.
 * It contains TWO printable glyphs: SPACE and "A". "SCOUT SYSTEMS" contains no
 * "A", so EVERY VISIBLE LETTER fell back to the system face — on both surfaces,
 * on every load, with nothing anywhere reporting it.
 *
 * ⚠ NOTHING THAT WAS BEING CHECKED COULD HAVE CAUGHT IT, and that is the point:
 *   document.fonts lists the face          -> status 'loaded'   (the FILE loaded)
 *   getComputedStyle(el).fontFamily        -> 'Archivo Expanded' (the REQUEST)
 *   the network                            -> 200, font/woff2   (the BYTES arrived)
 * All three are true of a font with no glyphs in it. Loading a file and being
 * able to DRAW A LETTER WITH IT are different facts, and only the second one is
 * what a wordmark needs. This module measures the second.
 *
 * ⚠ AND `document.fonts.check()` IS NOT THE ANSWER EITHER — it returns true for
 * a face that never loaded at all (it did exactly that for Montserrat here for
 * months, recorded in CLAUDE.md). It answers "can this text be rendered by
 * SOMETHING", which is always yes.
 *
 * Node built-ins only — no fontTools, no new dependency. WOFF2 is a header, a
 * table directory, then one brotli stream holding the tables end to end; `cmap`
 * is not one of the transformed tables, so it can be read straight out.
 */

'use strict';

const fs = require('fs');
const zlib = require('zlib');

/** WOFF2 known-table index → tag. Order is fixed by the spec, not by us. */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm',
  'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern',
  'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty',
  'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];

function readUIntBase128(buf, cursor) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[cursor.offset++];
    if (byte === undefined) throw new Error('truncated UIntBase128');
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return value >>> 0;
  }
  throw new Error('malformed UIntBase128');
}

/** Parse the container and return {tag: {offset, length}} into the decompressed stream. */
function readTables(buffer) {
  if (buffer.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  const numTables = buffer.readUInt16BE(12);
  const cursor = { offset: 48 };                       // fixed 48-byte header
  const directory = [];

  for (let i = 0; i < numTables; i++) {
    const flags = buffer[cursor.offset++];
    const knownIndex = flags & 0x3f;
    let tag;
    if (knownIndex === 63) {                           // 63 = "an arbitrary tag follows"
      tag = buffer.toString('latin1', cursor.offset, cursor.offset + 4);
      cursor.offset += 4;
    } else {
      tag = KNOWN_TAGS[knownIndex];
    }
    const transformVersion = (flags >> 6) & 0x03;
    const originalLength = readUIntBase128(buffer, cursor);

    // ⚠ THE PRESENCE RULE IS INVERTED FOR glyf/loca. transformLength is present
    // when the version is ZERO for those two and NON-ZERO for everything else.
    // Getting it backwards desynchronises every later table offset silently.
    const isGlyfOrLoca = (tag === 'glyf' || tag === 'loca');
    const hasTransformLength = isGlyfOrLoca ? (transformVersion === 0) : (transformVersion !== 0);
    const transformLength = hasTransformLength ? readUIntBase128(buffer, cursor) : null;

    directory.push({ tag, length: transformLength === null ? originalLength : transformLength });
  }

  const stream = zlib.brotliDecompressSync(buffer.subarray(cursor.offset));
  const tables = {};
  let offset = 0;
  for (const entry of directory) {
    tables[entry.tag] = { offset, length: entry.length };
    offset += entry.length;
  }
  return { tables, stream, tags: directory.map((d) => d.tag) };
}

function readCmap(stream, table) {
  const cmap = stream.subarray(table.offset, table.offset + table.length);
  const subtableCount = cmap.readUInt16BE(2);
  const codepoints = new Set();

  for (let i = 0; i < subtableCount; i++) {
    const offset = cmap.readUInt32BE(4 + i * 8 + 4);
    if (offset + 4 > cmap.length) continue;
    const format = cmap.readUInt16BE(offset);

    if (format === 4) {
      const segCountX2 = cmap.readUInt16BE(offset + 6);
      const segCount = segCountX2 / 2;
      const endsAt = offset + 14;
      const startsAt = endsAt + segCountX2 + 2;
      const deltasAt = startsAt + segCountX2;
      const rangesAt = deltasAt + segCountX2;
      for (let s = 0; s < segCount; s++) {
        const end = cmap.readUInt16BE(endsAt + s * 2);
        const start = cmap.readUInt16BE(startsAt + s * 2);
        if (start === 0xffff) continue;
        const delta = cmap.readInt16BE(deltasAt + s * 2);
        const rangeOffset = cmap.readUInt16BE(rangesAt + s * 2);
        for (let u = start; u <= end && u !== 0xffff; u++) {
          let glyph;
          if (rangeOffset === 0) {
            glyph = (u + delta) & 0xffff;
          } else {
            const at = rangesAt + s * 2 + rangeOffset + (u - start) * 2;
            if (at + 1 >= cmap.length) continue;
            glyph = cmap.readUInt16BE(at);
            if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
          }
          // ⚠ glyph 0 is .notdef — a mapping to it is NOT coverage.
          if (glyph !== 0) codepoints.add(u);
        }
      }
    } else if (format === 12) {
      const groupCount = cmap.readUInt32BE(offset + 12);
      for (let g = 0; g < groupCount; g++) {
        const at = offset + 16 + g * 12;
        const start = cmap.readUInt32BE(at);
        const end = cmap.readUInt32BE(at + 4);
        for (let u = start; u <= end; u++) codepoints.add(u);
      }
    }
  }
  return codepoints;
}

/** Every codepoint the file can actually draw a glyph for. */
function coveredCodepoints(filePath) {
  const { tables, stream } = readTables(fs.readFileSync(filePath));
  if (!tables.cmap) throw new Error('no cmap table in ' + filePath);
  return readCmap(stream, tables.cmap);
}

/** The printable-ASCII slice, as a sorted string — the readable form for a report. */
function printableAscii(filePath) {
  const covered = coveredCodepoints(filePath);
  return [...covered]
    .filter((u) => u >= 0x20 && u < 0x7f)
    .sort((a, b) => a - b)
    .map((u) => String.fromCodePoint(u))
    .join('');
}

/** Which of `text`'s characters the file CANNOT draw. Empty array = fully covered. */
function missingFrom(filePath, text) {
  const covered = coveredCodepoints(filePath);
  const missing = [];
  for (const ch of text) {
    const u = ch.codePointAt(0);
    if (!covered.has(u) && !missing.includes(ch)) missing.push(ch);
  }
  return missing;
}

module.exports = { coveredCodepoints, printableAscii, missingFrom, KNOWN_TAGS };
