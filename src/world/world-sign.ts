import * as THREE from 'three';
const fontStack =
  '"Barlow Condensed", "Noto Sans Arabic", "Noto Sans Devanagari", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR", system-ui, sans-serif';
export function createWorldSign() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!,
    texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2), new THREE.MeshBasicMaterial({map: texture}));
  let key = '';
  const line = (text: string, y: number, size: number, color: string) => {
    ctx.direction = /[\u0590-\u08ff]/.test(text) ? 'rtl' : 'ltr';
    ctx.fillStyle = color;
    ctx.font = `600 ${size}px ${fontStack}`;
    while (size > 16 && ctx.measureText(text).width > 470) {
      size -= 2;
      ctx.font = `600 ${size}px ${fontStack}`;
    }
    ctx.fillText(text, 256, y, 470);
  };
  return {
    mesh,
    invalidate() {
      key = '';
    },
    draw(top: string, value: string, bottom: string) {
      const next = [top, value, bottom].join('|');
      if (next === key) return;
      key = next;
      ctx.fillStyle = '#11202c';
      ctx.fillRect(0, 0, 512, 320);
      ctx.strokeStyle = '#e8ba70';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, 504, 312);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      line(top, 60, 38, '#e7e6dc');
      line(value, 158, 92, '#f8c668');
      line(bottom, 260, 30, '#a9bac3');
      texture.needsUpdate = true;
    },
  };
}
