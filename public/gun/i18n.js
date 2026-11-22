// 좀비 건 아케이드 사전(큰 화면 /gun/ 과 폰 /play/gun/ 이 같이 씁니다).
// 난이도·설정·튜토리얼 엔진·준비 띠 같은 공통 문장은 /common/i18n-common.js 에 있으니 여기에 다시 적지 않습니다.
// 표 한 줄 = [한국어 원문, English, 日本語, 简体中文]. 열쇠는 화면에 나오는 한국어 그대로입니다.
import { register } from '/common/i18n.js';

const ROWS = [
  // ───────── 큰 화면: 대기실 ─────────
  ['1~8인 · 한 화면', '1–8 players · one screen', '1〜8人 · 1画面', '1~8人 · 同屏'],
  ['폰을 겨누고 좀비를 쏴요.', 'Aim your phone and shoot zombies.', 'スマホを向けてゾンビを撃とう。', '用手机瞄准，射击僵尸。'],
  ['화면을 한 번 눌러 소리 켜기', 'Click the screen once to turn on sound', '画面を一度タップして音を出す', '点一下屏幕以开启声音'],
  ['남은 좀비', 'Zombies left', 'ゾンビ残り', '剩余僵尸'],
  ['참가', 'Join', '参加', '加入'],
  ['참가 {n}명', 'Players: {n}', '参加 {n}人', '已加入 {n}人'],
  ['모두 {x}', 'Everyone: {x}', 'みんなで{x}', '全员{x}'],
  ['준비', 'Ready', '準備OK', '准备'],
  ['다시 하기', 'Play again', 'もう一度', '再玩一次'],
  ['연습 사격장', 'Practice range', '練習射撃場', '练习靶场'],
  ['참가 QR', 'Join QR code', '参加用QR', '加入二维码'],
  ['방 코드', 'Room code', 'ルームコード', '房间码'],
  ['http 주소라 폰 센서가 꺼져요. https로 열어 주세요.', 'Phone sensors are off on http. Open it with https.', 'httpではスマホのセンサーが使えません。httpsで開いてください。', 'http 下手机传感器无法使用，请用 https 打开。'],
  ['QR을 찍고 준비를 눌러요.', 'Scan the QR code and press Ready.', 'QRを読み取って準備OKを押そう。', '扫描二维码并点“准备”。'],
  ['서버가 다시 시작됐어요', 'The server restarted', 'サーバーが再起動しました', '服务器已重启'],
  ['다른 화면에서 열었어요', 'Opened on another screen', '別の画面で開かれました', '已在其他屏幕打开'],
  ['마지막으로 연 화면에서 이어져요.', 'It continues on the last screen you opened.', '最後に開いた画面で続けられます。', '将在最后打开的屏幕上继续。'],
  ['비어 있음', 'Empty', '空き', '空位'],
  ['준비 완료', 'Ready', '準備OK', '已准备'],
  ['조준 완료', 'Aimed', '照準OK', '已校准'],
  ['연결됨', 'Connected', '接続済み', '已连接'],

  // ───────── 큰 화면: 경기 ─────────
  ['폐허가 된 거리', 'Ruined street', '廃墟の通り', '废墟街道'],
  ['버려진 쇼핑몰', 'Abandoned mall', '廃れたショッピングモール', '废弃商场'],
  ['지하 주차장', 'Underground garage', '地下駐車場', '地下停车场'],
  ['쓰러짐', 'Down', 'ダウン', '倒下'],
  ['쓰러짐 · 다음 웨이브에 부활', 'Down · back next wave', 'ダウン · 次のウェーブで復活', '倒下 · 下一波复活'],
  ['장전', 'Reload', 'リロード', '装弹'],
  ['장전!', 'Reload!', 'リロード！', '装弹！'],
  ['장전 중', 'Reloading', 'リロード中', '装弹中'],
  ['x{m} 콤보', 'x{m} combo', 'x{m}コンボ', 'x{m}连击'],
  ['{n} 연속', '{n} streak', '{n}連続', '连中{n}'],
  ['{p} 쓰러짐', '{p} is down', '{p}がダウン', '{p}倒下了'],
  ['코어를 쏴요!', 'Shoot the core!', 'コアを撃て！', '射击核心！'],
  ['저지!', 'Blocked!', '阻止！', '拦住了！'],
  ['보스 출현', 'Boss incoming', 'ボス出現', 'Boss 出现'],
  ['보스 출현!', 'Boss incoming!', 'ボス出現！', 'Boss 出现！'],
  ['웨이브 {n}', 'Wave {n}', 'ウェーブ{n}', '第{n}波'],
  ['{p} 부활!', '{p} revived!', '{p}が復活！', '{p}复活了！'],
  ['작전 성공!', 'Mission complete!', '作戦成功！', '任务成功！'],
  ['전멸...', 'Wiped out...', '全滅...', '全军覆没...'],

  // ───────── 3D 간판(쇼핑몰) ─────────
  ['드림 몰', 'Dream Mall', 'ドリームモール', '梦想商城'],
  ['카페', 'Cafe', 'カフェ', '咖啡'],
  ['약국', 'Pharmacy', '薬局', '药店'],
  ['오락실', 'Arcade', 'ゲーセン', '游戏厅'],
  ['의류', 'Fashion', '服', '服饰'],
  ['서점', 'Books', '書店', '书店'],
  ['푸드', 'Food', 'フード', '美食'],
  ['마트', 'Mart', 'マート', '超市'],
  ['신발', 'Shoes', '靴', '鞋店'],

  // ───────── 큰 화면: 결과 ─────────
  ['작전 결과', 'Mission results', '作戦結果', '任务结果'],
  ['작전 성공', 'Mission complete', '作戦成功', '任务成功'],
  ['작전 실패', 'Mission failed', '作戦失敗', '任务失败'],
  ['처치', 'Kills', '撃破', '击杀'],
  ['헤드샷', 'Headshots', 'ヘッドショット', '爆头'],
  ['명중률', 'Accuracy', '命中率', '命中率'],
  ['최고 연속', 'Best streak', '最高連続', '最高连中'],
  ['점수', 'Score', 'スコア', '得分'],

  // ───────── 연습(튜토리얼) ─────────
  ['좀비 쏘기', 'Shoot a zombie', 'ゾンビを撃つ', '射击僵尸'],
  ['겨누고 발사!', 'Aim and fire!', '狙って発射！', '瞄准，开火！'],

  // ───────── 폰: 시작·메시지 ─────────
  ['좀비 건 컨트롤러', 'Zombie gun controller', 'ゾンビガンコントローラー', '僵尸枪战手柄'],
  ['폰이 총이 됩니다', 'Your phone is the gun', 'スマホが銃になる', '手机变成枪'],
  ['폰을 화면에 겨누고 큰 버튼을 눌러요.', 'Point at the screen and press the big button.', '画面に向けて大きなボタンを押そう。', '对准屏幕，按大按钮。'],
  ['https 아니면 버튼으로 해요.', 'Without https, use the buttons.', 'httpsでないとボタン操作になります。', '没有 https 时用按钮操作。'],
  ['시작하기', 'Start', 'スタート', '开始'],
  ['방 {code}', 'Room {code}', 'ルーム {code}', '房间 {code}'],
  ['들어가는 중…', 'Joining…', '入室中…', '正在进入…'],
  ['큰 화면과 연결하고 있어요.', 'Connecting to the big screen.', '大画面に接続しています。', '正在连接大屏幕。'],
  ['동작 센서를 쓸 수 없어요', 'Motion sensor unavailable', 'モーションセンサーが使えません', '无法使用动作传感器'],
  ['Safari를 닫고 QR을 다시 찍어 허용해 주세요.', 'Close Safari, scan the QR code again and allow motion.', 'Safariを閉じてQRを読み直し、許可してください。', '请关闭 Safari，重新扫描二维码并允许。'],
  ['주소창 자물쇠 → 사이트 설정 → 동작 센서 허용', 'Address bar lock → Site settings → Allow motion sensors', 'アドレスバーの鍵 → サイト設定 → モーションセンサーを許可', '地址栏锁图标 → 网站设置 → 允许动作传感器'],
  ['버튼으로 할게요', 'Use buttons', 'ボタンで遊ぶ', '用按钮玩'],
  ['방 코드가 없어요', 'No room code', 'ルームコードがありません', '没有房间码'],
  ['큰 화면의 QR을 찍어 주세요.', 'Scan the QR code on the big screen.', '大画面のQRを読み取ってください。', '请扫描大屏幕上的二维码。'],
  ['방에 다시 연결하는 중', 'Reconnecting to the room', 'ルームに再接続中', '正在重新连接房间'],
  ['잠시만 기다려 주세요.', 'Please wait a moment.', '少々お待ちください。', '请稍等。'],
  ['방을 찾을 수 없어요', 'Room not found', 'ルームが見つかりません', '找不到房间'],
  ['큰 화면의 QR을 다시 찍어 주세요.', 'Scan the QR code on the big screen again.', '大画面のQRをもう一度読み取ってください。', '请重新扫描大屏幕上的二维码。'],
  ['8명이 꽉 찼어요', 'All 8 seats are taken', '8人で満員です', '8个位置已满'],
  ['빈자리가 생기면 다시 찍어 주세요.', 'Scan again when a seat opens up.', '空きができたらもう一度読み取ってください。', '有空位时请再扫描。'],
  ['다른 탭에서 열었어요', 'Opened in another tab', '別のタブで開かれました', '已在其他标签页打开'],
  ['마지막으로 연 화면에서 조작해요.', 'Play from the last one you opened.', '最後に開いた画面で操作します。', '请在最后打开的页面操作。'],
  ['방이 닫혔어요', 'The room is closed', 'ルームが閉じられました', '房间已关闭'],
  ['큰 화면의 새 QR을 찍어 주세요.', 'Scan the new QR code on the big screen.', '大画面の新しいQRを読み取ってください。', '请扫描大屏幕上的新二维码。'],
  ['서버 연결이 끊겼어요. 다시 잇는 중…', 'Lost the server. Reconnecting…', 'サーバーとの接続が切れました。再接続中…', '与服务器断开，正在重连…'],
  ['큰 화면이 꺼져 있어요. 다시 열리면 이어서 해요.', 'The big screen is off. Play resumes when it reopens.', '大画面が閉じています。開き直すと続けられます。', '大屏幕已关闭，重新打开后可继续。'],

  // ───────── 폰: 대기실 ─────────
  ['대기실', 'Lobby', '待機室', '等候室'],
  ['모두 준비하면 시작해요.', 'Starts when everyone is ready.', '全員が準備OKになるとスタートします。', '所有人准备后开始。'],
  ['준비 완료 ✓', 'Ready ✓', '準備OK ✓', '已准备 ✓'],
  ['다른 사람을 기다려요', 'Waiting for the others', '他の人を待っています', '等待其他人'],
  ['모두 준비 완료!', 'Everyone is ready!', '全員準備OK！', '全员已准备！'],
  ['{s} 기다리는 중', 'Waiting for {s}', '{s}を待っています', '等待 {s}'],
  ['준비 {a}/{b}', 'Ready {a}/{b}', '準備OK {a}/{b}', '已准备 {a}/{b}'],
  ['조작', 'Controls', '操作', '操作'],
  ['버튼', 'Buttons', 'ボタン', '按钮'],
  ['연습 사격', 'Practice', '練習', '练习'],
  ['다시 맞추기', 'Recenter', '合わせ直す', '重新校准'],
  ['화면 가운데를 겨누고 눌러요.', 'Aim at the center of the screen and tap.', '画面の中央に向けてタップ。', '对准屏幕中央并点击。'],
  ['여기가 중앙', 'This is center', 'ここが中央', '这里是中央'],
  ['돌아가기', 'Back', '戻る', '返回'],
  ['센서 확인 중…', 'Checking sensors…', 'センサー確認中…', '正在检查传感器…'],
  ['센서 값이 없어요. 잠시 뒤 다시 눌러요.', 'No sensor data. Try again in a moment.', 'センサーの値がありません。少し待ってからもう一度。', '没有传感器数据，请稍后再试。'],
  ['센서 값이 끊겼어요. 다시 눌러요.', 'Sensor data stopped. Tap again.', 'センサーの値が途切れました。もう一度タップ。', '传感器数据中断，请再点一次。'],
  ['버튼으로 해요.', 'Using buttons.', 'ボタンで操作します。', '用按钮操作。'],
  ['동작 권한이 없어 버튼으로 해요.', 'No motion access, using buttons.', 'モーションの許可がないのでボタン操作です。', '没有动作权限，改用按钮。'],
  ['(Space 발사 · R 장전 · 방향키)', '(Space fire · R reload · arrow keys)', '(Space 発射 · R リロード · 矢印キー)', '(空格开火 · R 装弹 · 方向键)'],

  // ───────── 폰: 경기 ─────────
  ['점', 'pts', '点', '分'],
  ['체력', 'HP', 'HP', '体力'],
  ['곧 시작해요', 'Starting soon', 'まもなく開始', '马上开始'],
  ['발사', 'Fire', '発射', '开火'],
  ['장전 중…', 'Reloading…', 'リロード中…', '装弹中…'],
  ['끌어서 조준', 'Drag to aim', 'ドラッグで照準', '拖动瞄准'],
  ['쓰러졌어요', 'You are down', 'ダウンしました', '你倒下了'],
  ['다음 웨이브가 끝나면 부활해요', 'You revive after the next wave', '次のウェーブ後に復活します', '下一波结束后复活'],
  ['준비!', 'Get ready!', '準備！', '准备！'],
  ['전멸…', 'Wiped out…', '全滅…', '全军覆没…'],
  ['{stage} · 이동 중', '{stage} · moving on', '{stage} · 移動中', '{stage} · 移动中'],
  ['웨이브 {w}/{n} · 남은 좀비 {k}', 'Wave {w}/{n} · {k} zombies left', 'ウェーブ {w}/{n} · 残りゾンビ {k}', '第 {w}/{n} 波 · 剩余僵尸 {k}'],
  ['콤보 x{m}', 'Combo x{m}', 'コンボ x{m}', '连击 x{m}'],
  ['{n}연속', '{n} streak', '{n}連続', '连中{n}'],
  ['조준을 다시 맞췄어요', 'Aim recentered', '照準を合わせ直しました', '已重新校准'],
  ['더 크게!', 'Bigger!', 'もっと大きく！', '再大幅一点！'],
  ['끝났어요', 'It is over', '終わりました', '已经结束'],
  ['지금은 쏠 수 없어요', 'Cannot shoot right now', '今は撃てません', '现在不能射击'],
  ['연결이 끊겼어요', 'Disconnected', '接続が切れました', '连接已断开'],
  ['탄이 가득 차 있어요', 'Magazine is full', '弾は満タンです', '弹匣已满'],
  ['장전 중이에요', 'Already reloading', 'リロード中です', '正在装弹'],

  // ───────── 폰: 결과 ─────────
  ['1위!', '1st place!', '1位！', '第1名！'],
  ['{r}위', 'Rank {r}', '{r}位', '第{r}名'],
  ['{s}점 · 처치 {k} · 헤드샷 {h} · 명중률 {a}%', '{s} pts · {k} kills · {h} headshots · {a}% accuracy', '{s}点 · 撃破 {k} · ヘッドショット {h} · 命中率 {a}%', '{s}分 · 击杀 {k} · 爆头 {h} · 命中率 {a}%'],
  ['{r}위 · {s}점', 'Rank {r} · {s} pts', '{r}位 · {s}点', '第{r}名 · {s}分'],
  ['작전 종료', 'Mission over', '作戦終了', '任务结束'],
  ['관전 중', 'Spectating', '観戦中', '观战中'],
  ['지금 판이 끝나면 함께할 수 있어요.', 'You can join when this round ends.', 'このラウンドが終わったら参加できます。', '本局结束后即可加入。']
];

const dicts = { en: {}, ja: {}, zh: {} };
for (const [ko, en, ja, zh] of ROWS) {
  dicts.en[ko] = en;
  dicts.ja[ko] = ja;
  dicts.zh[ko] = zh;
}
register(dicts);
export const GUN_I18N_ROWS = ROWS.length;
