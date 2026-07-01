#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const rootDir = path.resolve(__dirname, "..");
const sourceIcon = path.join(rootDir, "build", "second-brain-app-icon.PNG");
const outputPng = path.join(rootDir, "build", "icon.png");
const outputIco = path.join(rootDir, "build", "icon.ico");
const outputIcns = path.join(rootDir, "build", "icon.icns");

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icnsEntries = [
  { type: "icp4", size: 16 },
  { type: "icp5", size: 32 },
  { type: "icp6", size: 64 },
  { type: "ic07", size: 128 },
  { type: "ic08", size: 256 },
  { type: "ic09", size: 512 },
  { type: "ic10", size: 1024 }
];

async function resizedPng(size) {
  return sharp(sourceIcon)
    .resize(size, size, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function uint32be(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

async function writePng() {
  await sharp(sourceIcon)
    .resize(1024, 1024, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(outputPng);
}

async function writeIco() {
  const images = await Promise.all(
    icoSizes.map(async (size) => ({
      size,
      data: await resizedPng(size)
    }))
  );

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = header.length + images.length * 16;
  const directory = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  await fs.writeFile(outputIco, Buffer.concat([header, ...directory, ...images.map((image) => image.data)]));
}

async function writeIcns() {
  const entries = await Promise.all(
    icnsEntries.map(async ({ type, size }) => ({
      type,
      data: await resizedPng(size)
    }))
  );

  const body = entries.flatMap(({ type, data }) => [
    Buffer.from(type, "ascii"),
    uint32be(data.length + 8),
    data
  ]);
  const totalLength = 8 + body.reduce((sum, chunk) => sum + chunk.length, 0);

  await fs.writeFile(outputIcns, Buffer.concat([Buffer.from("icns", "ascii"), uint32be(totalLength), ...body]));
}

async function main() {
  await fs.access(sourceIcon);
  await writePng();
  await writeIco();
  await writeIcns();
  console.log(`Generated app icons from ${path.relative(rootDir, sourceIcon)}`);
  console.log(`- ${path.relative(rootDir, outputPng)}`);
  console.log(`- ${path.relative(rootDir, outputIco)}`);
  console.log(`- ${path.relative(rootDir, outputIcns)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
