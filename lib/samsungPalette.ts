// 삼성증권 브랜드 컬러 팔레트 (로컬 테마)
//   Primary   : 0/60/220 계열
//   Secondary : SS Blue / Magenta / Abundant Spectrum
// 차트 시리즈·카테고리 색은 가급적 이 팔레트에서 뽑되, 구분이 어려운 경우
// 스펙트럼 밖의 보조 색을 소량 섞는다.

export const SS = {
  // Primary
  blue: "#003CDC",
  blue500: "#3363E3",
  blue400: "#668AE0",
  blue300: "#99B1F1",
  blue200: "#CBD1E8",
  navy: "#141E78",
  // SS Blue Spectrum
  bright: "#0A78F5",
  sky: "#1EB4F0",
  skyPale: "#A0E6F5",
  // SS Magenta Spectrum
  magentaDeep: "#CF244E",
  magenta: "#EC3B67",
  magentaSoft: "#EC6D8C",
  magentaPale: "#F5A7BB",
  // SS Abundant Spectrum
  amber: "#FFCF1F",
  amberDeep: "#E0A400",
  amberPale: "#FFE696",
  cyan: "#00B5CD",
  cyanDeep: "#008C9E",
  cyanPale: "#A3E8E8",
  coral: "#F25536",
  coralDeep: "#B23A1F",
  coralPale: "#F9B2A5",
  purple: "#A514D7",
  purpleDeep: "#7A1FC0",
  purplePale: "#F0C8F5",
  // 중립
  slate: "#5B6270",
  slateLight: "#94A3B8",
} as const;

/** 시맨틱 (수익/손실/주의/중립) — 가독성을 위해 색상환에서 최대한 벌린다 */
export const SS_SEMANTIC = {
  positive: SS.cyan, // 상승·수익·안전
  negative: SS.magenta, // 하락·손실
  warning: SS.amberDeep, // 주의·경계
  neutral: SS.slate,
  info: SS.blue,
} as const;

/** 범용 카테고리 팔레트 (인접 대비 고려한 순서, 17색) */
export const SS_CATEGORICAL: string[] = [
  SS.blue,
  SS.magenta,
  SS.cyan,
  SS.coral,
  SS.purple,
  SS.bright,
  SS.amberDeep,
  SS.navy,
  SS.magentaDeep,
  SS.sky,
  SS.blue500,
  SS.purpleDeep,
  SS.cyanDeep,
  SS.coralDeep,
  SS.magentaSoft,
  SS.blue400,
  SS.slate,
];

/** n개의 구분되는 색을 돌려준다 (팔레트를 순환) */
export function ssCategorical(n: number): string[] {
  return Array.from({ length: n }, (_, i) => SS_CATEGORICAL[i % SS_CATEGORICAL.length]);
}

/** 파랑 단색 순차 팔레트 (히트맵·농도) */
export const SS_SEQUENTIAL_BLUE = [
  "#EEF2FE",
  "#CBD1E8",
  "#99B1F1",
  "#668AE0",
  "#3363E3",
  "#003CDC",
  "#0A2FA8",
  "#141E78",
];
