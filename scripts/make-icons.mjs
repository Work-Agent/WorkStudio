#!/usr/bin/env node
/**
 * 应用图标生成器：`build/icon.svg`（设计交付的矢量稿）→ 打包与开发态所需的位图。
 *
 * 产物（全部提交，打包与 CI 不再需要设计工具或光栅化环境）：
 *
 * - `build/icon.icns`             macOS 应用图标（1024 画布，824 内容区，radius 185）
 * - `build/icon.ico`              Windows 应用图标（满版，16→256 多尺寸）
 * - `build/icon.png`              512 macOS 构图（开发态 Dock 图标读这一份）
 * - `build/icons/<size>x<size>.png` Linux 多尺寸图标集
 *
 * 光栅化依赖 rsvg-convert（macOS：`brew install librsvg`）。.icns / .ico 由本脚本
 * 直接写出（ICNS 与 PNG-in-ICO 都是容器格式），不依赖 iconutil 或打包器。
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'build');
const SOURCE = join(BUILD, 'icon.svg');

/** 图标墨色：设计稿的主体色，也用于给白色底版描一条极淡的边。 */
const INK = '#0A1F40';

/**
 * 设计稿里 mark 的包围盒（1024 画布坐标系，实测：x 152→871，y 324→699）。
 * 构图时按包围盒居中，而不是按画布居中——设计稿四周的空白不参与缩放。
 */
const MARK = { x: 152, y: 324, width: 720, height: 376 };

/**
 * macOS 图标网格：内容区 824 居中位于 1024 画布，圆角 185（Big Sur 之后的规范）；
 * 满版构图给 Windows / Linux。mark 宽 1.915 的扁比例，两种构图都按「宽度占内容区
 * 约 87%」定尺，纵向留白是比例本身带来的，不靠居中补偿。
 */
const LAYOUT = {
  mac: { plate: { x: 100, y: 100, size: 824, radius: 185 }, markWidth: 720 },
  bleed: { plate: { x: 0, y: 0, size: 1024, radius: 185 }, markWidth: 880 },
};

const ICNS_TYPES = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32],
  ['icp6', 64],
  ['ic12', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic13', 512],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic14', 1024],
];

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512];

/** 取出设计稿顶层 `<g>` 的内容（保持原有 path / ellipse 与填充规则不变）。 */
function readMark() {
  const svg = readFileSync(SOURCE, 'utf8');
  const open = svg.indexOf('<g ');
  const close = svg.lastIndexOf('</g>');
  if (open < 0 || close < open) {
    throw new Error(`${SOURCE}: 期望单个顶层 <g> 包裹图形`);
  }
  return svg.slice(svg.indexOf('>', open) + 1, close).trim();
}

/** 合成一份构图：底版 + 居中缩放的 mark。 */
function compose(mark, layout) {
  const { plate, markWidth } = layout;
  const scale = markWidth / MARK.width;
  const tx = 512 - (MARK.x + MARK.width / 2) * scale;
  const ty = 512 - (MARK.y + MARK.height / 2) * scale;
  const inset = plate.radius === 0 ? 0 : 0.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
<rect x="${plate.x}" y="${plate.y}" width="${plate.size}" height="${plate.size}" rx="${plate.radius}" fill="#FFFFFF"/>
<rect x="${plate.x + inset}" y="${plate.y + inset}" width="${plate.size - inset * 2}" height="${plate.size - inset * 2}" rx="${Math.max(plate.radius - inset, 0)}" fill="none" stroke="${INK}" stroke-opacity="0.08" stroke-width="1"/>
<g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(6)})">${mark}</g>
</svg>`;
}

/** 光栅化：返回该尺寸的 PNG 字节。 */
function rasterize(workDir, svg, size) {
  const svgFile = join(workDir, 'source.svg');
  writeFileSync(svgFile, svg);
  const pngFile = join(workDir, `${size}.png`);
  try {
    execFileSync(
      'rsvg-convert',
      ['-w', String(size), '-h', String(size), '-o', pngFile, svgFile],
      {
        stdio: 'pipe',
      },
    );
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        '缺少 rsvg-convert：macOS 执行 `brew install librsvg` 后重试',
      );
    }
    throw error;
  }
  return readFileSync(pngFile);
}

/** ICNS：8 字节头 + 若干 `type/length/data` 块（PNG 直接内嵌）。 */
function writeIcns(images) {
  const chunks = ICNS_TYPES.map(([type, size]) => {
    const data = images.get(size);
    if (!data) throw new Error(`icns 缺少 ${size}px`);
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((sum, c) => sum + c.length, 0), 4);
  writeFileSync(join(BUILD, 'icon.icns'), Buffer.concat([header, ...chunks]));
}

/** ICO：6 字节头 + 16 字节目录项 + PNG 数据（Vista 起支持 PNG 内嵌）。 */
function writeIco(images) {
  const sizes = ICO_SIZES.filter((size) => images.has(size));
  const entries = [];
  let offset = 6 + sizes.length * 16;
  for (const size of sizes) {
    const data = images.get(size);
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 表示 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // 调色板颜色数
    entry.writeUInt8(0, 3); // 保留
    entry.writeUInt16LE(1, 4); // 色平面
    entry.writeUInt16LE(32, 6); // 位深
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = 图标
  header.writeUInt16LE(sizes.length, 4);
  writeFileSync(
    join(BUILD, 'icon.ico'),
    Buffer.concat([
      header,
      ...entries,
      ...sizes.map((size) => images.get(size)),
    ]),
  );
}

function main() {
  if (!existsSync(SOURCE)) throw new Error(`缺少设计源文件 ${SOURCE}`);
  const mark = readMark();
  const workDir = mkdtempSync(join(tmpdir(), 'work-studio-icons-'));
  try {
    const mac = compose(mark, LAYOUT.mac);
    const bleed = compose(mark, LAYOUT.bleed);

    // 同尺寸只光栅化一次：icns 与 ico 都复用同一份位图。
    const renderSize = (svg, size) => {
      const key = `${svg === mac ? 'mac' : 'bleed'}`;
      const dir = join(workDir, `${key}-${size}`);
      mkdirSync(dir, { recursive: true });
      return rasterize(dir, svg, size);
    };

    const macImages = new Map(
      ICNS_TYPES.map(([, size]) => [size, renderSize(mac, size)]),
    );
    const bleedImages = new Map(
      ICO_SIZES.map((size) => [size, renderSize(bleed, size)]),
    );

    writeIcns(macImages);
    writeIco(bleedImages);
    writeFileSync(join(BUILD, 'icon.png'), macImages.get(512));

    const iconsDir = join(BUILD, 'icons');
    rmSync(iconsDir, { recursive: true, force: true });
    mkdirSync(iconsDir, { recursive: true });
    for (const size of LINUX_SIZES) {
      const data = bleedImages.get(size) ?? renderSize(bleed, size);
      writeFileSync(join(iconsDir, `${size}x${size}.png`), data);
    }

    const stat = (file) =>
      `${(readFileSync(file).length / 1024).toFixed(1)} KB`;
    console.log(`build/icon.icns        ${stat(join(BUILD, 'icon.icns'))}`);
    console.log(`build/icon.ico         ${stat(join(BUILD, 'icon.ico'))}`);
    console.log(`build/icon.png         ${stat(join(BUILD, 'icon.png'))}`);
    console.log(`build/icons/           ${readdirSync(iconsDir).join(' ')}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main();
