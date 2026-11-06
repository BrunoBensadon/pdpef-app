"use strict";
// Minimal .xlsx writer: one worksheet of strings, optional bold header rows. No dependencies.
// An .xlsx file is a zip of XML parts; the zip is written with the STORE method (no compression).

const enc = new TextEncoder();
let CRC_TABLE = null;

export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function xmlEscape(s) {
  return String(s == null ? "" : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
}

function colName(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

function sheetXml(rows, headerRows) {
  const body = rows.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((v, c) => {
    if (v === "" || v == null) return "";
    return '<c r="' + colName(c) + (r + 1) + '" t="inlineStr"' + (r < headerRows ? ' s="1"' : "") +
      '><is><t xml:space="preserve">' + xmlEscape(v) + "</t></is></c>";
  }).join("") + "</row>").join("");
  return XML + '<worksheet xmlns="' + NS + '"><sheetData>' + body + "</sheetData></worksheet>";
}

function parts(rows, headerRows, sheetName) {
  const name = xmlEscape(String(sheetName || "Sheet1").replace(/[\\/:*?[\]]/g, "-").slice(0, 31) || "Sheet1");
  return [
    ["[Content_Types].xml", XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ["_rels/.rels", XML + '<Relationships xmlns="' + PKG + '"><Relationship Id="rId1" Type="' + REL +
      '/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", XML + '<workbook xmlns="' + NS + '" xmlns:r="' + REL + '"><sheets><sheet name="' + name +
      '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", XML + '<Relationships xmlns="' + PKG + '"><Relationship Id="rId1" Type="' + REL +
      '/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + REL + '/styles" Target="styles.xml"/></Relationships>'],
    ["xl/styles.xml", XML + '<styleSheet xmlns="' + NS + '"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ["xl/worksheets/sheet1.xml", sheetXml(rows, headerRows)],
  ].map(([n, s]) => ({ name: n, data: enc.encode(s) }));
}

function zip(files) {
  const u16 = n => [n & 255, (n >>> 8) & 255];
  const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const time = 0, date = ((2026 - 1980) << 9) | (1 << 5) | 1; // fixed: 2026-01-01, deterministic output
  const chunks = [], central = [];
  let offset = 0;
  files.forEach(f => {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)]);
    chunks.push(local, name, f.data);
    central.push(new Uint8Array([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + size;
  });
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = chunks.concat(central, [end]);
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  all.forEach(c => { out.set(c, p); p += c.length; });
  return out;
}

export function buildXlsx(rows, { headerRows = 0, sheetName = "Sheet1" } = {}) {
  return zip(parts(rows, headerRows, sheetName));
}
