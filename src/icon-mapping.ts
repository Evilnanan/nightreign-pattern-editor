import { LocalizedError, message, t } from "./i18n";

export type IconConfig = {
  schemaVersion: 10;
  unitIcons: Record<string, string | null>;
  variantIcons: Record<string, string | null>;
  unitBadges: Record<string, string>;
  variantBadges: Record<string, string | null>;
  unitBadgeStyles: Record<string, BadgeStyle>;
  variantBadgeStyles: Record<string, BadgeStyle>;
  unitIconFrames: Record<string, boolean>;
  variantIconFrames: Record<string, boolean>;
  unitIconGlows: Record<string, boolean>;
  variantIconGlows: Record<string, boolean>;
  unitIconShadows: Record<string, boolean>;
  variantIconShadows: Record<string, boolean>;
  unitIconScales: Record<string, number>;
  variantIconScales: Record<string, number>;
  mapIconScales: Record<string, number>;
  unitMapIconScales: Record<string, number>;
  variantMapIconScales: Record<string, number>;
  fileIconStyles: Record<string, Partial<IconFileStyle>>;
};

export type BadgeStyle = {size: number; frame: boolean; glow: boolean; scale: number};
export type IconFileStyle = BadgeStyle & {shadow:boolean};
export const defaultBadgeStyle: BadgeStyle = {size: 48, frame: false, glow: false, scale: 100};

export type IconResource = {name: string; dataUrl: string};

export let iconFiles: string[] = __ICON_FILES__;
let runtimeIcons: Map<string, string> | null = null;
const missingImageUrl = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="5" y="5" width="54" height="54" rx="8" fill="#372722" stroke="#e3a37a" stroke-width="4"/><text x="32" y="45" text-anchor="middle" font-family="sans-serif" font-size="40" font-weight="bold" fill="#f3c69f">?</text></svg>')}`;
export const emptyIconConfig = (): IconConfig => ({schemaVersion: 10, unitIcons: {}, variantIcons: {}, unitBadges: {}, variantBadges: {}, unitBadgeStyles: {}, variantBadgeStyles: {}, unitIconFrames: {}, variantIconFrames: {}, unitIconGlows: {}, variantIconGlows: {}, unitIconShadows:{},variantIconShadows:{},unitIconScales: {}, variantIconScales: {},mapIconScales:{},unitMapIconScales:{},variantMapIconScales:{},fileIconStyles:{}});
export const imageUrl = (file: string) => runtimeIcons
  ? runtimeIcons.get(file) || missingImageUrl
  : iconFiles.includes(file) ? `/icons/${encodeURIComponent(file)}` : missingImageUrl;
export const missingIcon = (file: string) => !iconFiles.includes(file);
export const iconFileKey = (file:string) => file.replace(/\.(webp|png|jpe?g)$/i, "").toLowerCase();
export function fileIconStyle(config:IconConfig,file:string|null):IconFileStyle {
  return {...defaultBadgeStyle,shadow:true,...(file===null ? undefined : config.fileIconStyles?.[iconFileKey(file)])};
}
export function mapIconScale(config:IconConfig,file:string|null,id?:number,variation:number|null=null):number {
  const override=(id===undefined || variation===null ? undefined : config.variantMapIconScales?.[`${id}|${variation}`]) ??
    (id===undefined ? undefined : config.unitMapIconScales?.[String(id)]);
  const filename=file===null ? undefined : iconFileKey(file);
  return (override ?? (filename ? config.mapIconScales?.[filename] : undefined) ?? 100)/100;
}

function deriveAutomaticIcons(files: string[]): Record<string, string> {
  return Object.fromEntries(files.flatMap(file => {
    const id = file.replace(/\.(webp|png|jpe?g)$/i, "");
    return /^\d+$/.test(id) ? [[id, file] as const] : [];
  }));
}
export let automaticUnitIcons = deriveAutomaticIcons(iconFiles);

export function setIconResources(resources: IconResource[]) {
  const next = new Map<string, string>();
  try {
    for (const resource of resources) {
      const data = /^data:(image\/(?:webp|png|jpeg));base64,(.*)$/s.exec(resource.dataUrl);
      if (!data) throw new LocalizedError(message("errors.invalidIconData", { file: resource.name }));
      const [, mime, encoded] = data;
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      next.set(resource.name, URL.createObjectURL(new Blob([bytes], {type: mime})));
    }
  } catch (error) {
    for (const url of next.values()) URL.revokeObjectURL(url);
    throw error;
  }
  const previous = runtimeIcons;
  iconFiles = resources.map(resource => resource.name);
  runtimeIcons = next;
  automaticUnitIcons = deriveAutomaticIcons(iconFiles);
  if (previous) setTimeout(() => { for (const url of previous.values()) URL.revokeObjectURL(url); }, 1000);
}

export type IconLocation = {index?: number; category: string; typeIndex: number | null};

export function categoryIcon(location: IconLocation | null): string {
  if (!location) return "Boss.webp";
  if (location.index === 46) return "Strong Boss.webp";
  if (location.index === 45) return "Boss.webp";
  const type = location.typeIndex;
  if (type === 8 || location.category === "Frenzy Tower") return "Frenzy Tower.webp";
  if (type === 7 || location.category === "Rot Blessing") return "Event.webp";
  if (type === 0 || location.category === "Castle") return "Castle.webp";
  if (type === 2 || type === 19 || location.category === "Minor Base") return "4100.webp";
  if (type === 3 || location.category === "Evergaol") return "Evergaol.webp";
  if (type === 4 || location.category === "Arena Boss") return "Strong Boss.webp";
  if (type === 20 || location.category === "Great Merchant") return "Great Merchant.webp";
  if (type === 9 || location.category === "Scale-Bearing Merchant" || location.category === "Merchant") return "Scale-Bearing Merchant.webp";
  if (type === 10 || type === 11) return "3800.webp";
  if (type === 12 || type === 13) return "3400.webp";
  if (type === 14) return "Strong Boss.webp";
  if (type === 15 || type === 16) return "South Castle.webp";
  if (type === 17 || type === 18) return "North Castle.webp";
  if (type === 5 || type === 6 || location.category.includes("Boss") || location.category === "Rotted Woods") return "Boss.webp";
  return "4000.webp";
}

export function unitDefaultIcon(config: IconConfig, id: number, location: IconLocation | null): string | null {
  return Object.hasOwn(config.unitIcons, String(id)) ? config.unitIcons[String(id)] : automaticUnitIcons[String(id)] || categoryIcon(location);
}

export function unitIcon(config: IconConfig, id: number, variation: number, location: IconLocation | null): string | null {
  const key = `${id}|${variation}`;
  return Object.hasOwn(config.variantIcons, key) ? config.variantIcons[key] : unitDefaultIcon(config, id, location);
}

export function unitBadge(config: IconConfig, id: number, variation: number): string | null {
  const key = `${id}|${variation}`;
  return Object.hasOwn(config.variantBadges, key) ? config.variantBadges[key] : config.unitBadges[String(id)] || null;
}

export function badgeStyle(config: IconConfig, id: number, variation: number | null): BadgeStyle {
  const file=variation===null ? config.unitBadges[String(id)] ?? null : unitBadge(config,id,variation);
  const {shadow,...style}=fileIconStyle(config,file);
  return {...style,...config.unitBadgeStyles[String(id)],
    ...(variation===null ? undefined : config.variantBadgeStyles[`${id}|${variation}`])};
}

export function baseFrame(config: IconConfig, id: number, variation: number | null,file:string|null=variation===null ? unitDefaultIcon(config,id,null) : unitIcon(config,id,variation,null)): boolean {
  return (variation === null ? undefined : config.variantIconFrames?.[`${id}|${variation}`]) ??
    config.unitIconFrames?.[String(id)] ?? fileIconStyle(config,file).frame;
}

export function baseGlow(config: IconConfig, id: number, variation: number | null,file:string|null=variation===null ? unitDefaultIcon(config,id,null) : unitIcon(config,id,variation,null)): boolean {
  return (variation === null ? undefined : config.variantIconGlows?.[`${id}|${variation}`]) ??
    config.unitIconGlows?.[String(id)] ?? fileIconStyle(config,file).glow;
}

export function baseShadow(config:IconConfig,id:number,variation:number|null,file:string|null=variation===null ? unitDefaultIcon(config,id,null) : unitIcon(config,id,variation,null)):boolean {
  return (variation===null ? undefined : config.variantIconShadows?.[`${id}|${variation}`]) ??
    config.unitIconShadows?.[String(id)] ?? fileIconStyle(config,file).shadow;
}

export function baseScale(config: IconConfig, id: number, variation: number | null,file:string|null=variation===null ? unitDefaultIcon(config,id,null) : unitIcon(config,id,variation,null)): number {
  return (variation === null ? undefined : config.variantIconScales?.[`${id}|${variation}`]) ??
    config.unitIconScales?.[String(id)] ?? fileIconStyle(config,file).scale;
}

export function iconSource(config: IconConfig, id: number, variation: number): string {
  const key = `${id}|${variation}`;
  if (Object.hasOwn(config.variantIcons, key)) {
    const file = config.variantIcons[key];
    return file === null ? t("ui.variantSetToNoIcon") : t("assets.variantAssignment", { missing: missingIcon(file) ? "yes" : "no" });
  }
  if (Object.hasOwn(config.unitIcons, String(id))) {
    const file = config.unitIcons[String(id)];
    return file === null ? t("assets.inheritedNoIcon") : t("assets.unitAssignment", { missing: missingIcon(file) ? "yes" : "no" });
  }
  if (automaticUnitIcons[String(id)]) return t("ui.matchedByNumericFilename");
  return t("ui.categoryFallbackPending");
}

