// Generates PWA PNG icons with zero dependencies (Node built-ins only).
// Draws a crescent moon (amber) on a rounded deep-night background.
import zlib from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'public')
mkdirSync(outDir, { recursive: true })

const BG = [11, 15, 26] // #0B0F1A
const MOON = [232, 168, 56] // #E8A838

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function makePNG(size) {
  const px = Buffer.alloc(size * size * 4)
  const R = size
  const radius = size * 0.22 // rounded corners
  // moon geometry
  const cx = size * 0.5
  const cy = size * 0.46
  const rMoon = size * 0.3
  const cx2 = size * 0.62 // cutout circle for crescent
  const cy2 = size * 0.4
  const rCut = size * 0.27

  const inRounded = (x, y) => {
    const dxl = Math.min(x, R - x)
    const dyl = Math.min(y, R - y)
    if (dxl >= radius || dyl >= radius) return true
    const ddx = radius - Math.min(dxl, radius)
    const ddy = radius - Math.min(dyl, radius)
    return ddx * ddx + ddy * ddy <= radius * radius
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (!inRounded(x + 0.5, y + 0.5)) {
        px[i + 3] = 0 // transparent outside rounded corners
        continue
      }
      let col = BG
      const d1 = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const d2 = Math.hypot(x + 0.5 - cx2, y + 0.5 - cy2)
      if (d1 <= rMoon && d2 > rCut) col = MOON
      px[i] = col[0]
      px[i + 1] = col[1]
      px[i + 2] = col[2]
      px[i + 3] = 255
    }
  }

  // raw scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const [name, size] of [
  ['pwa-192.png', 192],
  ['pwa-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(outDir, name), makePNG(size))
  console.log('wrote', name)
}
