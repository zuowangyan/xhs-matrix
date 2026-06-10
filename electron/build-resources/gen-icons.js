// 从 logo.svg 生成多尺寸 PNG + Windows .ico + 前端用图标
const sharp = require("sharp");
const pngToIco = require("png-to-ico");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const svgPath = path.join(dir, "logo.svg");
const svg = fs.readFileSync(svgPath);
const frontendAssets = path.join(dir, "..", "..", "frontend", "src", "assets");
fs.mkdirSync(frontendAssets, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256, 512];

(async () => {
  // 多尺寸 PNG
  const pngPaths = [];
  for (const s of sizes) {
    const out = path.join(dir, `icon-${s}.png`);
    await sharp(svg, { density: 384 }).resize(s, s).png().toFile(out);
    pngPaths.push(out);
  }
  // 主图标 png
  fs.copyFileSync(path.join(dir, "icon-512.png"), path.join(dir, "icon.png"));

  // Windows .ico（多尺寸打包，任务栏/exe 用）
  const icoSizes = [16, 24, 32, 48, 64, 128, 256].map((s) => path.join(dir, `icon-${s}.png`));
  const ico = await pngToIco(icoSizes);
  fs.writeFileSync(path.join(dir, "icon.ico"), ico);

  // 前端用：svg + 256 png
  fs.copyFileSync(svgPath, path.join(frontendAssets, "logo.svg"));
  fs.copyFileSync(path.join(dir, "icon-256.png"), path.join(frontendAssets, "logo.png"));

  console.log("生成完成:", "icon.ico, icon.png, icon-*.png, frontend/src/assets/logo.svg|png");
})();
