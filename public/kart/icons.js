// 아이템 그림(SVG). 큰 화면 HUD 와 폰 아이템 버튼이 같이 씁니다. three 에 기대지 않습니다.
// 모두 viewBox 0 0 64 64, 굵은 외곽선 + 밝은 색이라 작게 보여도 알아봅니다.

const svg = (inner) => `<svg viewBox="0 0 64 64" aria-hidden="true">${inner}</svg>`;

export const ITEM_ICONS = {
  // 바나나: 노란 초승달 + 꼭지
  banana: svg(
    '<path d="M11 37c7 13 31 16 42-3 2-4 0-7-3-5-8 11-23 13-35 5-3-2-6 0-4 3z" fill="#ffd93b" stroke="#5c3d00" stroke-width="3.2" stroke-linejoin="round"/>' +
    '<path d="M18 40c9 5 21 5 30-3" fill="none" stroke="#e6a400" stroke-width="2.6" stroke-linecap="round"/>' +
    '<path d="M50 29l4-8" stroke="#5c3d00" stroke-width="5" stroke-linecap="round"/><circle cx="13" cy="35" r="2.6" fill="#5c3d00"/>'
  ),
  // 니트로: 불꽃 하나
  nitro: svg(
    '<path d="M32 5c4 10 15 15 15 30a15 15 0 0 1-30 0c0-8 4-12 6-16 1 5 3 8 6 9-1-8 0-15 3-23z" fill="#ff8a1f" stroke="#6b2200" stroke-width="3.2" stroke-linejoin="round"/>' +
    '<path d="M32 30c3 4 7 7 7 12a7 7 0 0 1-14 0c0-5 3-7 7-12z" fill="#fff1a8"/>'
  ),
  // 슈퍼 터보: 큰 불꽃 + 위로 겹친 꺾쇠
  turbo: svg(
    '<path d="M14 20l18-13 18 13M18 30l14-10 14 10" fill="none" stroke="#ffd23a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M32 22c4 7 12 11 12 22a12 12 0 0 1-24 0c0-6 3-9 5-12 1 4 3 6 5 7-1-6 0-11 2-17z" fill="#ff4d2e" stroke="#5c0f00" stroke-width="3.2" stroke-linejoin="round"/>' +
    '<path d="M32 42c2 3 5 5 5 8a5 5 0 0 1-10 0c0-3 2-5 5-8z" fill="#fff1a8"/>'
  ),
  // 유도탄: 비스듬히 오르는 빨간 로켓
  missile: svg(
    '<g transform="rotate(-38 32 32)">' +
    '<path d="M2 32h8" stroke="#ffb347" stroke-width="7" stroke-linecap="round"/>' +
    '<path d="M14 25l-6-9h9l7 9M14 39l-6 9h9l7-9" fill="#c9ced8" stroke="#2a2f3a" stroke-width="2.6" stroke-linejoin="round"/>' +
    '<path d="M11 25h31l14 7-14 7H11z" fill="#ff4d4d" stroke="#4a0808" stroke-width="3.2" stroke-linejoin="round"/>' +
    '<path d="M42 25l14 7-14 7z" fill="#f6f6f2" stroke="#4a0808" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M20 29h14" stroke="#ffd0d0" stroke-width="2.6" stroke-linecap="round"/></g>'
  ),
  // 무적 질주: 금색 별 + 반짝임
  star: svg(
    '<defs><linearGradient id="pcgk-star" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6a8"/><stop offset=".55" stop-color="#ffd23a"/><stop offset="1" stop-color="#ff9a1f"/></linearGradient></defs>' +
    '<path d="M32 5l7.6 16.3 17.8 2.2-13 12.3 3.4 17.6L32 44.8 16.2 53.4l3.4-17.6-13-12.3 17.8-2.2z" fill="url(#pcgk-star)" stroke="#6b4300" stroke-width="3.2" stroke-linejoin="round"/>' +
    '<path d="M26 22l3 1M24 27l1 3" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'
  ),
  // 번개: 보라 원 안의 노란 번개
  bolt: svg(
    '<circle cx="32" cy="32" r="27" fill="#5b2bd6" stroke="#1d0b55" stroke-width="3"/>' +
    '<path d="M36 7L17 36h12l-4 21 21-31H34z" fill="#ffe14a" stroke="#4a3200" stroke-width="3" stroke-linejoin="round"/>'
  )
};

export const ITEM_NAMES = {
  banana: '바나나',
  nitro: '니트로',
  turbo: '슈퍼 터보',
  missile: '유도탄',
  star: '무적 질주',
  bolt: '번개'
};

// 추격 부스트 표시용 불꽃(파랑·보라)
export const CHASE_ICON = svg(
  '<path d="M32 5c4 10 15 15 15 30a15 15 0 0 1-30 0c0-8 4-12 6-16 1 5 3 8 6 9-1-8 0-15 3-23z" fill="#7b6bff" stroke="#1d1460" stroke-width="3.2" stroke-linejoin="round"/>' +
  '<path d="M32 30c3 4 7 7 7 12a7 7 0 0 1-14 0c0-5 3-7 7-12z" fill="#bfe6ff"/>'
);
