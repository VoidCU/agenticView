import { useEffect, useState } from "react";
import * as THREE from "three";

export type SceneTheme = "light" | "dark";

function currentTheme(): SceneTheme {
  if (typeof document === "undefined") return "dark";
  const forced = document.documentElement.getAttribute("data-theme");
  if (forced === "light" || forced === "dark") return forced;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Follows the app theme: an explicit data-theme on <html>, else the OS preference. */
export function useSceneTheme(): SceneTheme {
  const [theme, setTheme] = useState<SceneTheme>(currentTheme);
  useEffect(() => {
    const update = () => setTheme(currentTheme());
    const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : undefined;
    mq?.addEventListener("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq?.removeEventListener("change", update);
      mo.disconnect();
    };
  }, []);
  return theme;
}

/**
 * Art direction: a Scandinavian studio office. Pale oak and warm walnut, oatmeal felt, sage partitions,
 * one brand amber accent. Day mode is bright and airy; night mode keeps the same materials under warm lamps.
 */
export interface Palette {
  bg: string;
  ground: string;
  fog: [number, number];
  sky: string;
  groundLight: string;
  hemi: number;
  ambient: number;
  sun: string;
  sunIntensity: number;
  fill: string;
  fillIntensity: number;
  lamps: number;
  wood: string;
  walnut: string;
  carpetPod: string;
  carpetMeeting: string;
  floorEdge: string;
  wallBase: string;
  glass: string;
  glassOpacity: number;
  alu: string;
  deskTop: string;
  deskLeg: string;
  felt: string;
  bezel: string;
  screenOff: string;
  keyboard: string;
  chair: string;
  chairBase: string;
  pot: string;
  potDark: string;
  leaf: string;
  leaf2: string;
  shelf: string;
  books: string[];
  sofa: string;
  sofa2: string;
  cushion: string;
  rugOffice: string;
  rugLounge: string;
  rugLounge2: string;
  whiteboard: string;
  lampGlow: string;
  accent: string;
  hover: string;
  dropOk: string;
}

export const PALETTES: Record<SceneTheme, Palette> = {
  light: {
    bg: "#e8e6e1",
    ground: "#d3d0c8",
    fog: [48, 95],
    sky: "#f4f1ea",
    groundLight: "#8c8373",
    hemi: 1.05,
    ambient: 0.35,
    sun: "#fff4e3",
    sunIntensity: 2.4,
    fill: "#cfe0ff",
    fillIntensity: 0.55,
    lamps: 0,
    wood: "#cfae86",
    walnut: "#8a5e3c",
    carpetPod: "#c7c2b8",
    carpetMeeting: "#6f8a92",
    floorEdge: "#a39c8f",
    wallBase: "#f3efe7",
    glass: "#d9ecf2",
    glassOpacity: 0.28,
    alu: "#a9adb2",
    deskTop: "#f6f3ee",
    deskLeg: "#3a3d43",
    felt: "#9fb39a",
    bezel: "#1d1f24",
    screenOff: "#2a2e36",
    keyboard: "#d9d9dc",
    chair: "#3c4048",
    chairBase: "#25272c",
    pot: "#e9e4dc",
    potDark: "#b86b4b",
    leaf: "#4f8a55",
    leaf2: "#6fa864",
    shelf: "#c89f73",
    books: ["#d9644a", "#3f6f8f", "#e4b04a", "#6b8f71", "#efe7da", "#7b5ea7"],
    sofa: "#c9785a",
    sofa2: "#5d7f79",
    cushion: "#efd9a7",
    rugOffice: "#35456b",
    rugLounge: "#e1c7a0",
    rugLounge2: "#c9785a",
    whiteboard: "#fbfbf8",
    lampGlow: "#ffe2a8",
    accent: "#e8a93a",
    hover: "#3d7bff",
    dropOk: "#e8a93a",
  },
  dark: {
    bg: "#0d1016",
    ground: "#141820",
    fog: [44, 88],
    sky: "#7d8fc4",
    groundLight: "#1a1512",
    hemi: 0.75,
    ambient: 0.22,
    sun: "#ffe1b8",
    sunIntensity: 1.7,
    fill: "#6f8cff",
    fillIntensity: 0.35,
    lamps: 1,
    wood: "#8f7050",
    walnut: "#5e3f29",
    carpetPod: "#3b4049",
    carpetMeeting: "#2c4650",
    floorEdge: "#232830",
    wallBase: "#2d323b",
    glass: "#a9d4ff",
    glassOpacity: 0.14,
    alu: "#7c838d",
    deskTop: "#d9d4cb",
    deskLeg: "#1f2126",
    felt: "#5f7560",
    bezel: "#0b0c0f",
    screenOff: "#141820",
    keyboard: "#8e9096",
    chair: "#2b2f37",
    chairBase: "#17191d",
    pot: "#c9c2b7",
    potDark: "#8f4f36",
    leaf: "#3e7446",
    leaf2: "#5a9152",
    shelf: "#7a5a3c",
    books: ["#b5503b", "#2f5670", "#c29236", "#52735a", "#cfc6b6", "#634b8a"],
    sofa: "#9c5a43",
    sofa2: "#3f5d58",
    cushion: "#c9b183",
    rugOffice: "#26314f",
    rugLounge: "#7d6a52",
    rugLounge2: "#8a4f3b",
    whiteboard: "#dcdcd6",
    lampGlow: "#ffc978",
    accent: "#ffc14d",
    hover: "#6f9bff",
    dropOk: "#ffc14d",
  },
};

// ---------- procedural floor textures (cached per colour) ----------

const texCache = new Map<string, THREE.Texture>();

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}

function finish(c: HTMLCanvasElement, repeat: number): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Herringbone-free, honest plank floor: staggered boards with faint grain and seams. */
export function woodTexture(base: string): THREE.Texture {
  const key = `wood:${base}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const size = 512;
  const [c, g] = canvas(size);
  const rand = rng(7);
  const rows = 8;
  const h = size / rows;
  for (let row = 0; row < rows; row++) {
    let x = -rand() * size * 0.5;
    while (x < size) {
      const len = size * (0.35 + rand() * 0.45);
      g.fillStyle = shade(base, (rand() - 0.5) * 0.07);
      g.fillRect(x, row * h, len, h);
      g.globalAlpha = 0.18;
      for (let k = 0; k < 7; k++) {
        g.strokeStyle = shade(base, -0.08 - rand() * 0.06);
        g.lineWidth = 0.6 + rand();
        g.beginPath();
        const y = row * h + rand() * h;
        g.moveTo(x, y);
        g.bezierCurveTo(x + len * 0.3, y + (rand() - 0.5) * 6, x + len * 0.7, y + (rand() - 0.5) * 6, x + len, y + (rand() - 0.5) * 4);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = shade(base, -0.16);
      g.fillRect(x, row * h, 1.5, h);
      x += len;
    }
    g.fillStyle = shade(base, -0.14);
    g.fillRect(0, row * h, size, 1.5);
  }
  const t = finish(c, 3);
  texCache.set(key, t);
  return t;
}

/** Carpet tiles laid quarter-turn: soft speckle plus a hint of tile edges. */
export function carpetTexture(base: string): THREE.Texture {
  const key = `carpet:${base}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const size = 512;
  const [c, g] = canvas(size);
  const rand = rng(11);
  const tiles = 4;
  const ts = size / tiles;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      g.fillStyle = shade(base, (i + j) % 2 === 0 ? 0.006 : -0.006);
      g.fillRect(i * ts, j * ts, ts, ts);
      const vertical = (i + j) % 2 === 0;
      g.globalAlpha = 0.05;
      g.strokeStyle = shade(base, -0.1);
      for (let k = 4; k < ts; k += 6) {
        g.beginPath();
        if (vertical) {
          g.moveTo(i * ts + k, j * ts);
          g.lineTo(i * ts + k, j * ts + ts);
        } else {
          g.moveTo(i * ts, j * ts + k);
          g.lineTo(i * ts + ts, j * ts + k);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    }
  }
  for (let k = 0; k < 9000; k++) {
    g.fillStyle = shade(base, (rand() - 0.5) * 0.14);
    g.fillRect(rand() * size, rand() * size, 1.4, 1.4);
  }
  g.globalAlpha = 0.16;
  g.strokeStyle = shade(base, -0.12);
  for (let i = 0; i <= tiles; i++) {
    g.beginPath();
    g.moveTo(i * ts, 0);
    g.lineTo(i * ts, size);
    g.moveTo(0, i * ts);
    g.lineTo(size, i * ts);
    g.stroke();
  }
  const t = finish(c, 2.5);
  texCache.set(key, t);
  return t;
}
