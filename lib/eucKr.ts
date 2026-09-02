// ─── EUC-KR 인코더 (TextDecoder 역방향 lookup) ───────────────────────────────
//
// Node.js는 TextEncoder('euc-kr')을 지원하지 않으나 TextDecoder('euc-kr')는 지원함.
// 0xA1~0xFE 범위의 2바이트 쌍(8836가지)을 EUC-KR로 디코딩해
// Unicode 문자 → %XX%XX 맵을 런타임에 빌드한다.
// 한 번 빌드 후 모듈 스코프에 캐싱(~수 ms 소요).
//
// 네이버 금융(finance.naver.com)의 구형 리서치 검색 폼(company_list.naver 등)이
// EUC-KR 파라미터만 인식하므로, 한글 keyword 검색 시 반드시 이 인코딩을 거쳐야 한다.

let _eucKrMap: Map<string, string> | null | false = null; // null=미초기화, false=미지원

export function getEucKrMap(): Map<string, string> | false {
  if (_eucKrMap !== null) return _eucKrMap as Map<string, string> | false;

  try {
    const decoder = new TextDecoder("euc-kr");
    const map = new Map<string, string>();

    for (let b1 = 0xa1; b1 <= 0xfe; b1++) {
      for (let b2 = 0xa1; b2 <= 0xfe; b2++) {
        const char = decoder.decode(new Uint8Array([b1, b2]));
        // 유효한 단일 문자이고 ASCII가 아닌 경우만 저장
        if (char.length === 1 && char !== "�" && char.charCodeAt(0) > 0x7f) {
          map.set(
            char,
            `%${b1.toString(16).toUpperCase().padStart(2, "0")}%${b2.toString(16).toUpperCase().padStart(2, "0")}`,
          );
        }
      }
    }
    _eucKrMap = map;
    return map;
  } catch {
    _eucKrMap = false;
    return false;
  }
}

/** 한국어 문자열 → EUC-KR percent-encoded 파라미터 문자열. 매핑 불가 문자가 있으면 빈 문자열 반환. */
export function toEucKrParam(text: string): string {
  const map = getEucKrMap();
  if (!map) return "";

  let result = "";
  for (const ch of text) {
    if (ch.charCodeAt(0) <= 0x7f) {
      result += encodeURIComponent(ch); // ASCII
    } else {
      const enc = map.get(ch);
      if (!enc) return ""; // EUC-KR에 없는 문자 → 실패
      result += enc;
    }
  }
  return result;
}
