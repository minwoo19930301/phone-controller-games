// 다국어 화면 깜빡임 막기: 한국어가 아닌 언어로 볼 사람에게는 번역이 끝날 때까지 본문을 잠깐 숨깁니다.
// <head> 맨 앞에서 일반 스크립트로 부릅니다(모듈보다 먼저 실행). 번역 모듈이 끝나면 클래스를 떼고, 늦어도 1.5초 뒤에는 보여 줍니다.
(function () {
  try {
    var q = new URLSearchParams(location.search).get('lang');
    var l = q || localStorage.getItem('pcg-lang') || (navigator.languages && navigator.languages[0]) || navigator.language || '';
    if (/^ko/i.test(l)) return;
    var d = document.documentElement;
    d.classList.add('pcg-i18n-wait');
    var s = document.createElement('style');
    s.textContent = '.pcg-i18n-wait body{visibility:hidden}';
    document.head.appendChild(s);
    setTimeout(function () { d.classList.remove('pcg-i18n-wait'); }, 1500);
  } catch (e) {}
})();
