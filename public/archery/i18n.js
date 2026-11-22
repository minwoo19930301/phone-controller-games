// 양궁 사전: 큰 화면(/archery/)과 폰(/play/archery/)이 함께 씁니다.
// 공통 문장(난이도·준비 띠·튜토리얼 엔진·진동 안내 등)은 /common/i18n-common.js 에 있으니 여기서 다시 등록하지 않습니다.
// [한국어 원문, English, 日本語, 简体中文] 표 하나로 적어 세 언어의 열쇠가 어긋나지 않게 합니다.
// 공통 사전을 같은 모듈 묶음에서 먼저 불러옵니다. 번역이 시작된 뒤에 사전이 늘면 이미 본 정적 글자는 다시 번역되지 않아서,
// 두 사전이 같은 순간에 등록돼야 정적 HTML 글자까지 번역됩니다.
import '/common/i18n-common.js';
import { register } from '/common/i18n.js';

const ROWS = [
  // ───── 큰 화면: 대기실 ─────
  ['1~4인 · 차례로 한 발씩', '1–4 players · One arrow each, in turn', '1〜4人 · 順番に1射ずつ', '1~4人 · 轮流各射一箭'],
  ['폰으로 겨누고, 시위를 당겼다 놓으면 쏩니다.', 'Aim with your phone, then pull the string and let go.', 'スマホで狙って、弦を引いて放つと射てます。', '用手机瞄准，拉弦后松手即可射箭。'],
  ['폰에서 모두 준비를 누르면 시작해요', 'Starts when everyone taps Ready on their phone', '全員がスマホで準備を押すと始まります', '所有人在手机上点“准备”后开始'],
  ['폰에서 모두 다시 하기를 누르면 새 경기', 'New match when everyone taps Play again', '全員が「もう一度」を押すと新しい試合', '所有人点“再来一局”后开始新比赛'],
  ['엔드 수', 'Ends', 'エンド数', '轮数'],
  ['3엔드', '3 ends', '3エンド', '3轮'],
  ['5엔드', '5 ends', '5エンド', '5轮'],
  ['엔드마다 3발 · 총 9발', '3 arrows per end · 9 total', '1エンド3射 · 計9射', '每轮3箭 · 共9箭'],
  ['엔드마다 3발 · 총 15발', '3 arrows per end · 15 total', '1エンド3射 · 計15射', '每轮3箭 · 共15箭'],
  ['참가 QR', 'Join QR', '参加用QR', '加入二维码'],
  ['방 코드', 'Room code', 'ルームコード', '房间码'],
  ['이 주소는 http라서 폰 동작 센서가 꺼져 있어요. https 주소에서 열어 주세요.', 'This is an http address, so the phone motion sensor is off. Open an https address.', 'httpのアドレスなのでスマホの動作センサーが切れています。httpsのアドレスで開いてください。', '这是http地址，手机动作传感器已关闭。请用https地址打开。'],
  ['비어 있음', 'Empty', '空き', '空位'],
  ['준비 완료', 'Ready', '準備OK', '已准备'],
  ['연결됨', 'Connected', '接続中', '已连接'],
  ['서버가 다시 시작돼서 대기실로 돌아왔어요', 'The server restarted, so you are back in the lobby', 'サーバーが再起動したのでロビーに戻りました', '服务器已重启，已回到大厅'],
  ['폰을 먼저 연결해 주세요. QR을 찍고 준비를 누르면 자리가 생겨요.', 'Connect a phone first. Scan the QR and tap Ready to get a seat.', 'まずスマホを接続してください。QRを読み取って準備を押すと席ができます。', '请先连接手机。扫描二维码并点“准备”即可入座。'],
  ['화면을 한 번 눌러 소리 켜기', 'Tap once to turn on sound', '画面を1回タップして音を出す', '点一下屏幕开启声音'],

  // ───── 큰 화면: 경기 중 ─────
  ['과녁', 'Target', '的', '靶'],
  ['바람', 'Wind', '風', '风'],
  ['잔잔', 'Calm', '無風', '无风'],
  ['왼쪽에서 불어요', 'From the left', '左から', '左侧吹来'],
  ['오른쪽에서 불어요', 'From the right', '右から', '右侧吹来'],
  ['뒷바람', 'Tailwind', '追い風', '顺风'],
  ['맞바람', 'Headwind', '向かい風', '逆风'],
  ['중간 참가', 'Join in', '途中参加', '中途加入'],
  ['과녁 확대', 'Target close-up', '的アップ', '靶心特写'],
  ['차례', 'Turn', '番', '回合'],
  ['(BOT) 차례', '(BOT) turn', '(BOT)の番', '(BOT)回合'],
  ['차례 · {a}/{b}발', 'Turn · arrow {a}/{b}', '番 · {a}/{b}射目', '回合 · 第{a}/{b}箭'],
  ['{p} 차례', "{p}'s turn", '{p}の番', '轮到{p}'],
  ['활을 들어요', 'Raise your bow', '弓を構えて', '举起弓'],
  ['당기는 중', 'Drawing', '引いています', '拉弓中'],
  ['숨 고르기!', 'Steady your breath!', '息を整えて！', '调整呼吸！'],
  ['팔이 떨려요', 'Arms shaking', '腕が震えます', '手臂在抖'],
  ['만궁', 'Full draw', '満月', '满弓'],
  ['발사!', 'Fire!', '発射！', '发射！'],
  ['짧아요', 'Too short', '届かず', '射短了'],
  ['{n}엔드', 'End {n}', '第{n}エンド', '第{n}轮'],
  ['{n}엔드 종료', 'End {n} over', '第{n}エンド終了', '第{n}轮结束'],
  ['경기 종료', 'Match over', '試合終了', '比赛结束'],
  ['{p} 선두 · {n}점', '{p} leads · {n} pts', '{p}が首位 · {n}点', '{p}领先 · {n}分'],
  ['합계', 'Total', '合計', '合计'],
  ['포기', 'Skipped', '見送り', '放弃'],
  ['나갔어요', 'Left the room', '退出しました', '已离开'],
  ['시간이 지났어요', 'Time ran out', '時間切れです', '超时了'],

  // ───── 큰 화면: 결과 ─────
  ['경기 결과', 'Results', '試合結果', '比赛结果'],
  ['{d}m · {e}엔드 · 총 {n}발', '{d} m · {e} ends · {n} arrows', '{d}m · {e}エンド · 計{n}射', '{d}米 · {e}轮 · 共{n}箭'],
  ['10점', '10s', '10点', '10环'],
  ['총점', 'Total', '合計', '总分'],
  ['다른 화면에서 열었어요', 'Opened on another screen', '別の画面で開きました', '已在其他屏幕打开'],
  ['이 방은 마지막으로 연 화면에서 이어져요.', 'This room continues on the screen opened last.', 'このルームは最後に開いた画面で続きます。', '该房间将在最后打开的屏幕上继续。'],

  // ───── 큰 화면이 폰으로 보내는 안내(폰 화면에 뜸) ─────
  ['더 당겨야 쏠 수 있어요', 'Pull further to shoot', 'もっと引かないと射てません', '再拉一点才能射'],
  ['곧 시간이 끝나요', 'Time is almost up', 'もうすぐ時間切れです', '时间快到了'],
  ['연결이 끊겼어요', 'Disconnected', '接続が切れました', '连接已断开'],

  // ───── 폰: 시작·대기실 ─────
  ['양궁 컨트롤러', 'Archery controller', 'アーチェリーコントローラー', '射箭控制器'],
  ['방 {c}', 'Room {c}', 'ルーム {c}', '房间 {c}'],
  ['다시 맞추기', 'Recenter', '位置合わせ', '重新校准'],
  ['폰이 활이 됩니다', 'Your phone is the bow', 'スマホが弓になります', '手机就是弓'],
  ['폰으로 겨누고, 아래로 당겼다 놓아요.', 'Aim with your phone, pull down, then let go.', 'スマホで狙って、下に引いて離します。', '用手机瞄准，向下拉再松手。'],
  ['https 주소가 아니라 센서가 꺼질 수 있어요.', 'Not an https address, so the sensor may be off.', 'httpsではないのでセンサーが切れることがあります。', '不是https地址，传感器可能无法使用。'],
  ['시작하기', 'Start', 'はじめる', '开始'],
  ['대기실', 'Lobby', 'ロビー', '大厅'],
  ['준비', 'Ready', '準備', '准备'],
  ['준비 완료 ✓', 'Ready ✓', '準備OK ✓', '已准备 ✓'],
  ['다른 사람을 기다려요', 'Waiting for others', '他の人を待っています', '等待其他人'],
  ['동작 센서 확인 중…', 'Checking motion sensor…', '動作センサーを確認中…', '正在检查动作传感器…'],
  ['모두 준비를 누르면 시작해요.', 'Starts when everyone taps Ready.', '全員が準備を押すと始まります。', '所有人点“准备”后开始。'],
  ['모두 준비 완료!', 'Everyone is ready!', '全員準備OK！', '全员已准备！'],
  ['{who} 기다리는 중', 'Waiting for {who}', '{who}を待っています', '等待{who}'],
  ['준비 {a}/{b}', 'Ready {a}/{b}', '準備 {a}/{b}', '已准备 {a}/{b}'],
  ['참가', 'Players', '参加', '参加'],
  ['{n}명', '{n}', '{n}人', '{n}人'],
  ['조작', 'Controls', '操作', '操作'],
  ['끌어서', 'Drag', 'ドラッグ', '拖动'],
  ['관전 중', 'Spectating', '観戦中', '观战中'],
  ['다음 엔드부터 함께 쏴요. 자리는 이미 잡혀 있어요.', 'You join from the next end. Your seat is already saved.', '次のエンドから参加します。席は確保済みです。', '从下一轮起一起射箭。座位已为你保留。'],
  ['1위!', '1st place!', '1位！', '第1名！'],
  ['{n}위', '#{n}', '{n}位', '第{n}名'],
  ['{a}점 · X {b} · 10점 {c}', '{a} pts · X {b} · 10s {c}', '{a}点 · X {b} · 10点 {c}', '{a}分 · X {b} · 10环 {c}'],
  ['큰 화면에서 순위를 확인해요.', 'Check the ranking on the big screen.', '順位は大画面で確認してね。', '请在大屏幕上查看排名。'],
  ['다시 하기', 'Play again', 'もう一度', '再来一局'],

  // ───── 폰: 경기 중 ─────
  ['{a}/{b}엔드', 'End {a}/{b}', '第{a}/{b}エンド', '第{a}/{b}轮'],
  ['내 화살 {a}/{b}발', 'My arrows {a}/{b}', '自分の矢 {a}/{b}', '我的箭 {a}/{b}'],
  ['왼쪽에서', 'From left', '左から', '左侧'],
  ['오른쪽에서', 'From right', '右から', '右侧'],
  ['곧 시작해요', 'Starting soon', 'まもなく始まります', '即将开始'],
  ['조준', 'Aim', '照準', '瞄准'],
  ['끌어서 조준', 'Drag to aim', 'ドラッグで狙う', '拖动瞄准'],
  ['바로 쏘기', 'Shoot now', 'すぐ射つ', '直接射箭'],
  ['{n}엔드 곧 시작해요', 'End {n} starts soon', '第{n}エンドがまもなく始まります', '第{n}轮即将开始'],
  ['엔드 종료 · 큰 화면을 보세요', 'End over · Look at the big screen', 'エンド終了 · 大画面を見てね', '本轮结束 · 请看大屏幕'],
  ['내 차례! 아래로 당겨요', 'Your turn! Pull down', 'あなたの番！ 下に引いて', '轮到你了！向下拉'],
  ['화살이 날아가요', 'Arrow in flight', '矢が飛んでいきます', '箭飞出去了'],
  ['{p} 쏘는 중', '{p} is shooting', '{p}が射っています', '{p}正在射箭'],
  ['{p} 차례 · 기다려요', "{p}'s turn · Wait", '{p}の番 · 待ってね', '轮到{p} · 请等待'],
  ['지금은 못 쏴요', "You can't shoot now", '今は射てません', '现在不能射'],
  ['내 차례가 아니에요', 'Not your turn', 'あなたの番ではありません', '还没轮到你'],
  ['가운데를 다시 잡았어요', 'Recentered', '中央を取り直しました', '已重新对准中心'],
  ['다시 맞췄어요', 'Recentered', '合わせ直しました', '已重新校准'],
  ['더 당겨요', 'Pull more', 'もっと引いて', '再多拉一点'],
  ['만궁! 손을 떼요', 'Full draw! Let go', '満月！ 離して', '满弓！松手'],
  ['손을 떼요!', 'Let go!', '離して！', '松手！'],
  ['만궁!', 'Full draw!', '満月！', '满弓！'],
  ['아래로 끌어요', 'Pull down', '下に引いて', '向下拉'],

  // ───── 폰: 연습(2단계) ─────
  ['당기기', 'Draw', '引く', '拉弓'],
  ['아래로 끌어요.', 'Pull down.', '下に引きます。', '向下拉。'],
  ['끝까지 끌기', 'Pull all the way', '最後まで引く', '拉到底'],
  ['놓기', 'Release', '放す', '松手'],
  ['당긴 채 손을 떼요.', 'Let go while drawn.', '引いたまま指を離します。', '拉满后松手。'],
  ['손 떼기', 'Let go', '指を離す', '松手'],

  // ───── 폰: 센서·연결 안내 ─────
  ['동작 센서가 없어 화면을 끌어서 겨눠요.', 'No motion sensor, so drag the screen to aim.', '動作センサーがないので、画面をドラッグして狙います。', '没有动作传感器，请拖动屏幕瞄准。'],
  ['https 주소가 아니라 센서가 꺼져 있어요. 화면을 끌어서 겨눠요.', 'Not an https address, so the sensor is off. Drag the screen to aim.', 'httpsではないのでセンサーが切れています。画面をドラッグして狙います。', '不是https地址，传感器已关闭。请拖动屏幕瞄准。'],
  ['동작 권한이 거절돼 화면을 끌어서 겨눠요.', 'Motion access was denied, so drag the screen to aim.', '動作の許可が拒否されたので、画面をドラッグして狙います。', '动作权限被拒绝，请拖动屏幕瞄准。'],
  ['(키보드: 방향키·스페이스)', '(Keyboard: arrow keys and Space)', '(キーボード：矢印キーとスペース)', '(键盘：方向键和空格)'],
  ['동작 센서를 쓸 수 없어요', "Can't use the motion sensor", '動作センサーを使えません', '无法使用动作传感器'],
  ['iPhone: Safari를 완전히 닫고 QR을 다시 찍어요. Android: 사이트 설정에서 동작 센서를 허용해요.', 'iPhone: Fully close Safari and scan the QR again.\nAndroid: Allow motion sensors in site settings.', 'iPhone：Safariを完全に閉じてQRを読み直してください。\nAndroid：サイト設定で動作センサーを許可してください。', 'iPhone：完全关闭Safari后重新扫描二维码。\nAndroid：在网站设置中允许动作传感器。'],
  ['끌어서 겨눌게요', "I'll drag to aim", 'ドラッグで狙います', '改用拖动瞄准'],
  ['들어가는 중…', 'Joining…', '参加中…', '正在加入…'],
  ['큰 화면과 연결하고 있어요.', 'Connecting to the big screen.', '大画面に接続しています。', '正在连接大屏幕。'],
  ['서버 연결이 끊겼어요. 다시 잇는 중…', 'Lost the server. Reconnecting…', 'サーバーとの接続が切れました。再接続中…', '与服务器断开，正在重连…'],
  ['큰 화면이 꺼져 있어요. 다시 열리면 이어서 해요.', 'The big screen is off. We continue when it reopens.', '大画面が閉じています。開き直したら続けます。', '大屏幕已关闭，重新打开后继续。'],
  ['방에 다시 연결하는 중', 'Reconnecting to the room', 'ルームに再接続中', '正在重新连接房间'],
  ['잠시만 기다려 주세요.', 'Please wait a moment.', '少々お待ちください。', '请稍等。'],
  ['방을 찾을 수 없어요', "Can't find the room", 'ルームが見つかりません', '找不到房间'],
  ['큰 화면의 QR을 다시 찍어 주세요.', 'Scan the QR on the big screen again.', '大画面のQRをもう一度読み取ってください。', '请重新扫描大屏幕上的二维码。'],
  ['4명이 꽉 찼어요', 'All 4 seats are taken', '4人で満員です', '4个座位已满'],
  ['빈자리가 생기면 다시 찍어 주세요.', 'Scan again when a seat opens up.', '空きが出たらもう一度読み取ってください。', '有空位时请再次扫描。'],
  ['다른 탭에서 열었어요', 'Opened in another tab', '別のタブで開きました', '已在其他标签页打开'],
  ['마지막으로 연 화면에서 조작해요.', 'Play from the screen opened last.', '最後に開いた画面で操作します。', '请在最后打开的页面操作。'],
  ['방이 닫혔어요', 'The room was closed', 'ルームが閉じられました', '房间已关闭'],
  ['큰 화면의 새 QR을 찍어 주세요.', 'Scan the new QR on the big screen.', '大画面の新しいQRを読み取ってください。', '请扫描大屏幕上的新二维码。'],
  ['방 코드가 없어요', 'No room code', 'ルームコードがありません', '没有房间码'],
  ['큰 화면의 QR을 찍어 주세요.', 'Scan the QR on the big screen.', '大画面のQRを読み取ってください。', '请扫描大屏幕上的二维码。'],
];

const dicts = { en: {}, ja: {}, zh: {} };
for (const [ko, en, ja, zh] of ROWS) {
  dicts.en[ko] = en;
  dicts.ja[ko] = ja;
  dicts.zh[ko] = zh;
}
// 3엔드·5엔드는 설정 알약 글자라 '{n}엔드'(End 3)가 아니라 개수로 읽혀야 합니다(정확 일치가 틀보다 먼저 이깁니다)
register(dicts);
