// 에어하키 사전(큰 화면 /airhockey/ 와 폰 /play/airhockey/ 가 같이 씁니다).
// 난이도·설정·튜토리얼 엔진·준비 띠 같은 공통 문장은 /common/i18n-common.js 에 있으니 여기에 다시 적지 않습니다.
// 표 한 줄 = [한국어 원문, English, 日本語, 简体中文]. 열쇠는 화면에 나오는 한국어 그대로입니다.
import '/common/i18n-common.js'; // 공통 사전을 먼저 등록(첫 번역 전에 두 사전이 모두 들어가게)
import { register } from '/common/i18n.js';

const ROWS = [
  // ───────── 큰 화면: 경기 중 HUD ─────────
  ['퍽 속도', 'Puck speed', 'パック速度', '冰球速度'],
  ['{name} 강슛!', '{name} smash!', '{name}の強打！', '{name}强力扣杀！'],
  ['{n}점 선승', 'First to {n}', '{n}点先取', '先得{n}分'],
  ['매치 포인트', 'Match point', 'マッチポイント', '赛点'],
  ['연결 끊김', 'Disconnected', '接続切れ', '已断线'],
  ['연결 끊김 · 자동', 'Offline · auto', '切断 · 自動', '断线 · 自动'],
  ['키보드', 'Keyboard', 'キーボード', '键盘'],
  ['{n}초 안에 쳐 내세요', 'Hit it within {n}s', '{n}秒以内に打って', '请在{n}秒内击球'],
  ['가운데에 멈춘 퍽을 다시 놓았어요', 'The stopped puck was served again', '真ん中で止まったパックを置き直しました', '停在中间的冰球已重新发球'],
  ['8초가 지나 퍽이 상대 쪽으로 넘어갔어요', '8 seconds passed: the puck goes to the other side', '8秒経過でパックが相手側へ移りました', '超过8秒，冰球交给对方'],
  ['준비', 'Ready', '準備', '准备'],
  ['{name} 득점', '{name} scores', '{name}の得点', '{name}得分'],
  ['{name} 득점 · 굴절', '{name} scores · deflected', '{name}の得点 · 跳ね返り', '{name}得分 · 折射'],
  ['{name} 자책골', '{name} own goal', '{name}のオウンゴール', '{name}乌龙球'],
  ['{name} 승리!', '{name} wins!', '{name}の勝ち！', '{name}获胜！'],

  // ───────── 큰 화면: 대기실 ─────────
  ['엄지로 끌어서 퍽을 쳐요.', 'Drag with your thumb to hit the puck.', '親指でドラッグしてパックを打とう。', '用拇指拖动来击球。'],
  ['폰에서 모두 준비를 누르면 시작해요', 'Starts when everyone taps Ready on their phone', '全員がスマホで準備を押すと始まります', '所有人在手机上点“准备”后开始'],
  ['봇 시험 시작', 'Start bot test', 'ボットテスト開始', '开始机器人测试'],
  ['방향키', 'Arrows', '矢印キー', '方向键'],
  ['아래쪽', 'Bottom', '手前側', '下方'],
  ['위쪽', 'Top', '奥側', '上方'],
  ['판을 마우스로 끌기', 'Drag the table with the mouse', 'マウスで盤をドラッグ', '用鼠标拖动球台'],
  ['(시험용)', '(test)', '(テスト用)', '(测试用)'],
  ['참가', 'Join', '参加', '加入'],
  ['참가 QR', 'Join QR', '参加QR', '加入二维码'],
  ['방 코드', 'Room code', 'ルームコード', '房间码'],
  ['http 주소라 폰 화면이 꺼질 수 있어요', 'On http the phone screen may turn off', 'httpアドレスのため、スマホの画面が消えることがあります', 'http地址下手机屏幕可能会熄灭'],
  ['http 주소라 화면이 꺼질 수 있어요', 'On http the screen may turn off', 'httpアドレスのため、画面が消えることがあります', 'http地址下屏幕可能会熄灭'],
  ['{n}P 비어 있음', '{n}P empty', '{n}P 空き', '{n}P 空位'],
  ['준비 완료 ✓', 'Ready ✓', '準備完了 ✓', '已准备 ✓'],
  ['준비 대기', 'Not ready', '準備待ち', '等待准备'],
  ['아래쪽 {name}', 'Bottom: {name}', '手前 {name}', '下方 {name}'],
  ['위쪽 {name}', 'Top: {name}', '奥 {name}', '上方 {name}'],
  ['화면을 한 번 눌러 소리 켜기', 'Tap the screen once to turn on sound', '画面を一度タップして音を出す', '点一下屏幕开启声音'],
  ['폰을 먼저 연결해 주세요. QR을 찍고 시작하기를 누르면 자리가 생겨요.', 'Connect a phone first: scan the QR and tap Start to get a seat.', 'まずスマホをつないでください。QRを読み取って開始を押すと席ができます。', '请先连接手机：扫描二维码并点“开始”即可入座。'],
  ['서버가 다시 시작돼서 대기실로 돌아왔어요', 'The server restarted, so we are back in the lobby', 'サーバーが再起動したのでロビーに戻りました', '服务器已重启，已回到大厅'],
  ['모든 폰의 연결이 끊겨 대기실로 돌아왔어요', 'All phones disconnected, so we are back in the lobby', 'すべてのスマホが切断されたのでロビーに戻りました', '所有手机都已断线，已回到大厅'],

  // ───────── 큰 화면: 결과 ─────────
  ['승리', 'Win', '勝利', '胜利'],
  ['{name} 승리', '{name} wins', '{name}の勝利', '{name}获胜'],
  ['승', 'W', '勝', '胜'],
  ['패', 'L', '敗', '负'],
  ['골', 'Goals', 'ゴール', '进球'],
  ['타격', 'Hits', '打数', '击球'],
  ['최고 km/h', 'Top km/h', '最高 km/h', '最高 km/h'],
  ['폰에서 모두 다시 하기를 누르면 다음 판', 'Next match starts when everyone taps Play again', '全員がスマホで「もう一度」を押すと次の試合', '所有人在手机上点“再来一局”后开始下一局'],
  ['다른 화면에서 열었어요', 'Opened on another screen', '別の画面で開かれました', '已在其他屏幕打开'],

  // ───────── 폰: 시작·메시지 ─────────
  ['에어하키 컨트롤러', 'Air hockey controller', 'エアホッケー コントローラー', '桌上冰球控制器'],
  ['방 {code}', 'Room {code}', 'ルーム {code}', '房间 {code}'],
  ['폰이 말렛이 됩니다', 'Your phone is the mallet', 'スマホがマレットになります', '手机就是球拍'],
  ['시작하기', 'Start', '開始', '开始'],
  ['방 코드가 없어요', 'No room code', 'ルームコードがありません', '没有房间码'],
  ['큰 화면의 QR을 찍어 주세요.', 'Scan the QR on the big screen.', '大きな画面のQRを読み取ってください。', '请扫描大屏幕上的二维码。'],
  ['들어가는 중…', 'Joining…', '入室中…', '正在加入…'],
  ['큰 화면과 연결하고 있어요.', 'Connecting to the big screen.', '大きな画面につないでいます。', '正在连接大屏幕。'],
  ['방에 다시 연결하는 중', 'Reconnecting to the room', 'ルームに再接続中', '正在重新连接房间'],
  ['잠시만 기다려 주세요.', 'Please wait a moment.', 'しばらくお待ちください。', '请稍等。'],
  ['방을 찾을 수 없어요', 'Room not found', 'ルームが見つかりません', '找不到房间'],
  ['큰 화면의 QR을 다시 찍어 주세요.', 'Scan the QR on the big screen again.', '大きな画面のQRをもう一度読み取ってください。', '请重新扫描大屏幕上的二维码。'],
  ['4명이 꽉 찼어요', 'The room is full (4 players)', '4人で満員です', '4人已满'],
  ['빈자리가 생기면 다시 찍어 주세요.', 'Scan again when a seat opens up.', '空きができたらもう一度読み取ってください。', '有空位时请再扫一次。'],
  ['다른 탭에서 열었어요', 'Opened in another tab', '別のタブで開かれました', '已在其他标签页打开'],
  ['마지막으로 연 화면에서 조작해요.', 'Play from the last one you opened.', '最後に開いた画面で操作してください。', '请在最后打开的页面操作。'],
  ['방이 닫혔어요', 'The room was closed', 'ルームが閉じられました', '房间已关闭'],
  ['큰 화면의 새 QR을 찍어 주세요.', 'Scan the new QR on the big screen.', '大きな画面の新しいQRを読み取ってください。', '请扫描大屏幕上的新二维码。'],
  ['큰 화면 연결이 끊겼어요', 'The big screen disconnected', '大きな画面との接続が切れました', '大屏幕已断开'],

  // ───────── 폰: 대기실·결과 ─────────
  ['대기실', 'Lobby', 'ロビー', '大厅'],
  ['경기 중', 'In play', '試合中', '比赛中'],
  ['경기 끝', 'Match over', '試合終了', '比赛结束'],
  ['승리!', 'You win!', '勝利！', '胜利！'],
  ['패배', 'You lose', '敗北', '失败'],
  ['다음 판부터 함께해요.', 'Join from the next match.', '次の試合から参加できます。', '下一局开始加入。'],
  ['모두 준비를 누르면 시작해요.', 'Starts when everyone taps Ready.', '全員が準備を押すと始まります。', '所有人点“准备”后开始。'],
  ['팀원 {names}', 'Teammate {names}', 'チームメイト {names}', '队友 {names}'],
  ['상대 {name}', 'Opponent {name}', '相手 {name}', '对手 {name}'],
  ['왼쪽 레인', 'Left lane', '左レーン', '左路'],
  ['오른쪽 레인', 'Right lane', '右レーン', '右路'],
  ['최고', 'Top', '最高', '最高'],
  ['누르면 준비 완료', 'Tap when ready', '押すと準備完了', '点击即准备好'],
  ['다시 하기', 'Play again', 'もう一度', '再来一局'],
  ['다른 사람 기다리는 중 · {n}/{need}', 'Waiting for others · {n}/{need}', '他の人を待っています · {n}/{need}', '等待其他人 · {n}/{need}'],
  ['곧 시작해요', 'Starting soon', 'まもなく始まります', '马上开始'],
  ['모두 준비하면 시작 · 지금 {n}/{need}', 'Starts when all are ready · now {n}/{need}', '全員準備で開始 · 現在 {n}/{need}', '全员准备后开始 · 现在 {n}/{need}'],
  ['누르면 바로 시작해요', 'Tap to start now', '押すとすぐ始まります', '点击立即开始'],
  ['준비 {n}/{need}', 'Ready {n}/{need}', '準備 {n}/{need}', '已准备 {n}/{need}'],
  ['대기', 'Waiting', '待機', '等待'],
  ['모두 준비하면 바로 시작해요', 'Starts as soon as everyone is ready', '全員が準備するとすぐ始まります', '全员准备后马上开始'],
  ['연결 중이에요. 잠시 뒤 다시 눌러 주세요', 'Connecting. Try again in a moment', '接続中です。少し後でもう一度押してください', '正在连接，请稍后再点'],
  ['↕ 뒤집기', '↕ Flip', '↕ 反転', '↕ 翻转'],
  ['↕ 뒤집힘', '↕ Flipped', '↕ 反転中', '↕ 已翻转'],

  // ───────── 폰: 경기 ─────────
  ['우리', 'Us', '自分', '我方'],
  ['상대', 'Them', '相手', '对手'],
  ['우리 {name}', 'Us {name}', '自分 {name}', '我方 {name}'],
  ['{name} 자리', '{name} zone', '{name}のエリア', '{name}的区域'],
  ['팀원 자리', 'Teammate zone', 'チームメイトのエリア', '队友区域'],
  ['엄지로 끌어요', 'Drag with your thumb', '親指でドラッグ', '用拇指拖动'],
  ['준비… 곧 시작해요', 'Get ready… starting soon', '準備… まもなく開始', '准备…马上开始'],
  ['경기 끝!', 'Match over!', '試合終了！', '比赛结束！'],
  ['연결이 끊겼어요', 'Disconnected', '接続が切れました', '连接已断开'],
  ['연결이 잠깐 끊겼어요…', 'Connection dropped for a moment…', '接続が一瞬切れました…', '连接暂时中断…'],
  ['{n}초 안에 쳐요', 'Hit it in {n}s', '{n}秒以内に打とう', '{n}秒内击球'],
  ['내 골!', 'My goal!', '自分のゴール！', '我进球了！'],
  ['골!', 'Goal!', 'ゴール！', '进球！'],
  ['실점', 'Conceded', '失点', '失分'],
  ['자동 움직이기(시험)', 'Auto move (test)', '自動で動かす(テスト)', '自动移动(测试)'],
  ['자동 움직임 끄기', 'Stop auto move', '自動移動を止める', '停止自动移动'],

  // ───────── 연습(튜토리얼) ─────────
  ['퍽 치기', 'Hit the puck', 'パックを打つ', '击球'],
  ['딱 좋아요!', 'Nice hit!', 'ナイスショット！', '打得漂亮！'],
  ['딱!', 'Pow!', 'カン！', '啪！'],
  ['막았다!', 'Blocked!', 'ナイスガード！', '拦住了！'],
  ['골 먹었어요', 'Goal against you', '失点しました', '被进球了'],
  ['앗, 내 골문!', 'Oops, my own goal!', 'あっ、自分のゴール！', '糟了，打进自家球门！'],
  ['슛! {kmh}km/h', 'Shot! {kmh}km/h', 'シュート！{kmh}km/h', '射门！{kmh}km/h'],
  ['퍽이 오는 길목, 골문 앞에 말렛을 두고 막아요', 'Put the mallet in front of your goal, where the puck is coming', 'パックの来る道、ゴール前にマレットを置いて止めよう', '把球拍放在球门前冰球来的路上拦住它'],
  ['아래는 내 골문이에요. 위쪽으로 쳐요', 'Your goal is at the bottom. Hit upward', '下は自分のゴールです。上に向かって打とう', '下方是自己的球门，往上击球'],
  ['조금 약해요. 퍽 뒤에서 위로 휙 밀어 쳐요', 'A bit weak. Flick up from behind the puck', '少し弱いです。パックの後ろから上へ弾こう', '力度有点小，从冰球后面向上一推'],
  ['위쪽(상대 쪽)으로 빠르게 밀어 보내요', 'Push it fast toward the top, the other side', '上(相手側)へ素早く押し出そう', '朝上方(对方那边)快速推出']
];

const dicts = { en: {}, ja: {}, zh: {} };
for (const [ko, en, ja, zh] of ROWS) {
  dicts.en[ko] = en;
  dicts.ja[ko] = ja;
  dicts.zh[ko] = zh;
}
register(dicts);
export const AIRHOCKEY_I18N_ROWS = ROWS.length;
