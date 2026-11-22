// 실제 녹음 효과음 목록: 이름 → { file | files: [여러 벌], gain: 기본 세기, loop: 이어 도는 소리 }.
// 파일은 이 폴더 기준 경로입니다. 출처와 라이선스는 CREDITS.md 에 있습니다. 이 파일은 .work/r4/assemble-sfx.mjs 가 만듭니다.
export const SFX = {
  'ball/bat-crack': { files: ['ball/bat-crack-1.mp3', 'ball/bat-crack-2.mp3', 'ball/bat-crack-3.mp3'], gain: 1 }, // Three separate hits of a wooden bat on a softball (liner) from one outdoor field recording, trimmed to 0.4 s w
  'ball/bat-tick': { file: 'ball/bat-tick.mp3', gain: 0.9 }, // Very short dry click of bat grazing a ball, close microphone.
  'ball/cup-drop': { file: 'ball/cup-drop.mp3', gain: 1 }, // Ball rattling and clicking down into a mini-golf cup, about 1.5 s of decaying clicks. Cut starts after the put
  'ball/golf-drive': { files: ['ball/golf-drive-1.mp3', 'ball/golf-drive-2.mp3'], gain: 1 }, // Driver striking a golf ball outdoors, metallic ring (1) and fuller whack (2). Swing swish removed.
  'ball/golf-iron': { files: ['ball/golf-iron-1.mp3', 'ball/golf-iron-2.mp3'], gain: 1 }, // Golf club hitting a ball, two different swings (first and fourth hit) from one multi-hit practice recording, c
  'ball/mitt-pop': { files: ['ball/mitt-pop-1.mp3', 'ball/mitt-pop-2.mp3'], gain: 0.8 }, // Ball landing in a leather baseball glove. 1 is a crisp pop (tightened to 0.17 s to drop faint late reflections
  'ball/pingpong-paddle': { files: ['ball/pingpong-paddle-1.mp3', 'ball/pingpong-paddle-2.mp3', 'ball/pingpong-paddle-3.mp3'], gain: 0.9 }, // Table-tennis ball on a rubber paddle, bright tick with a short hollow ring. Variant 3 is a clearly different, 
  'ball/pingpong-table': { files: ['ball/pingpong-table-1.mp3', 'ball/pingpong-table-2.mp3'], gain: 0.9 }, // Table-tennis ball bouncing on a table, hollow knock.
  'ball/puck-hit': { files: ['ball/puck-hit-1.mp3', 'ball/puck-hit-2.mp3', 'ball/puck-hit-3.mp3'], gain: 0.6 }, // Real air-hockey table recording: three different puck plinks (hard plastic knock on the table) taken from one 
  'ball/puck-rail': { files: ['ball/puck-rail-1.mp3', 'ball/puck-rail-2.mp3'], gain: 0.6 }, // Real air-hockey table recording: two different plinks of the puck against the table or rail, with the blower h
  'ball/putt-tap': { files: ['ball/putt-tap-1.mp3', 'ball/putt-tap-2.mp3'], gain: 0.8 }, // Putter tapping a golf ball on a mini-golf course, short dry tap (1 has a faint ball rattle after).
  'ball/tennis-bounce': { files: ['ball/tennis-bounce-1.mp3', 'ball/tennis-bounce-2.mp3'], gain: 1 }, // Tennis ball bouncing on a hard surface, dry low thump. Variant 1 is from a court recording, variant 2 is the f
  'ball/tennis-hit': { files: ['ball/tennis-hit-1.mp3', 'ball/tennis-hit-2.mp3', 'ball/tennis-hit-3.mp3'], gain: 1 }, // Tennis ball on racket strings, three different backhand-slice strikes from one practice recording (a slice, no
  'ball/tennis-serve': { file: 'ball/tennis-serve.mp3', gain: 1 }, // Single racket smack from a serve practice recording, a little fuller than the rally hits.
  'bowling/alley-loop': { file: 'bowling/alley-loop.mp3', gain: 0.5, loop: true }, // Quiet real bowling-alley ambience (room tone with distant pin crashes and rolls, no music, distant voices inau
  'bowling/ball-drop': { file: 'bowling/ball-drop.mp3', gain: 1 }, // Bowling ball landing on the lane: a dull wooden thud with a short rumble after it, 0.5 s. Cut from a ball-drop
  'bowling/ball-return': { file: 'bowling/ball-return.mp3', gain: 0.8 }, // Bowling alley ball-return: ticking/rumbling of the ball travelling through the return rail, ending in a loud c
  'bowling/pin-single': { file: 'bowling/pin-single.mp3', gain: 1 }, // One real bowling pin knocked onto a floor: hard wooden impact then two or three bounces/clatters, 0.7 s. Recor
  'bowling/pins-hit': { files: ['bowling/pins-hit-1.mp3', 'bowling/pins-hit-2.mp3'], gain: 0.9 }, // Two different events cut from one real recording (freesound 441856, titled as a bowling ball striking pins, i.
  'bowling/pins-strike': { files: ['bowling/pins-strike-1.mp3', 'bowling/pins-strike-2.mp3'], gain: 1 }, // Two different real ten-pin crashes of a ball hitting a full rack: loud broadband crash with pins scattering an
  'bowling/roll-loop': { file: 'bowling/roll-loop.mp3', gain: 0.6, loop: true }, // Real recording of a bowling ball rolling down a lane (steady low rumble with small ticks from the wood), 3.1 s
  'crowd/applause-long': { file: 'crowd/applause-long.mp3', gain: 0.9 }, // Full concert-hall audience applauding (De Doelen, Rotterdam), swells in and fades out naturally over 6.5 s. Wh
  'crowd/applause-short': { file: 'crowd/applause-short.mp3', gain: 1 }, // Polite applause from roughly 30 people in a room, dry clapping with a soft fade-out. Cut from the first 2.8 s 
  'crowd/aww': { file: 'crowd/aww.mp3', gain: 1 }, // Small audience 'aww' pity moan, about 1.75 s, soft and sympathetic. Source tags include 'sitcom' and 'reaction
  'crowd/cheer-big': { file: 'crowd/cheer-big.mp3', gain: 0.9 }, // Big rock-concert or stadium crowd roaring, swells up in about 1.5 s then holds; 4.5 s with a fade-out, starts 
  'crowd/cheer-small': { file: 'crowd/cheer-small.mp3', gain: 1 }, // About 25 mixed-gender people cheering 'yay', dry indoor recording, 2.3 s starting about 20 ms before the onset
  'crowd/golf-clap': { file: 'crowd/golf-clap.mp3', gain: 1 }, // Slow, sparse, polite applause in a small theatre, individual claps are audible. First 2.8 s with fade-out.
  'crowd/kids-cheer': { file: 'crowd/kids-cheer.mp3', gain: 0.9 }, // Group of children cheering and shouting indoors at a school, steady yelling for 3 s, wordless.
  'crowd/murmur-loop': { file: 'crowd/murmur-loop.mp3', gain: 0.5, loop: true }, // Seamless loop of real open-air football stadium ambience (Viking vs Sarpsborg, Stavanger, Norway): distant cro
  'crowd/ooh': { file: 'crowd/ooh.mp3', gain: 1 }, // One synchronized wordless 'ooh' from a small group of actors (loop-group ADR recording), swells in and fades o
  'gun/boss-roar': { file: 'gun/boss-roar.mp3', gain: 0.9 }, // Tiger roar, pitched down and processed in Audacity into a deep monster roar, about 2 s, low and broadband.
  'gun/empty-click': { file: 'gun/empty-click.mp3', gain: 0.7 }, // Mix of several airsoft Browning Hi-Power replica recordings made to sound like a video-game dry-fire click: ha
  'gun/headshot': { file: 'gun/headshot.mp3', gain: 0.9 }, // A single hit on a watermelon: sharp crack with a low wet thump.
  'gun/impact': { files: ['gun/impact-1.mp3', 'gun/impact-2.mp3'], gain: 0.8 }, // bullet-hit-body variants. Per file: impact-1.mp3: Plain recording of a gloved hand striking a helmet outdoors:
  'gun/reload': { file: 'gun/reload.mp3', gain: 0.7 }, // 1911 pistol magazine out/in and slide-rack clacks, about 1 s.
  'gun/shot': { files: ['gun/shot-1.mp3', 'gun/shot-2.mp3', 'gun/shot-3.mp3'], gain: 0.75 }, // pistol/shot variants; shot-3 is a louder shotgun-like layered blast. Per file: shot-1.mp3: Close, dry single 1
  'gun/zombie-death': { files: ['gun/zombie-death-1.mp3', 'gun/zombie-death-2.mp3'], gain: 0.75 }, // 2 zombie dying groans. Per file: zombie-death-1.mp3: Zombie dying exhale/groan that rises then fades out, 0.7 
  'gun/zombie-groan': { files: ['gun/zombie-groan-1.mp3', 'gun/zombie-groan-2.mp3', 'gun/zombie-groan-3.mp3', 'gun/zombie-groan-4.mp3'], gain: 0.78 }, // 4 different wordless zombie groans/growls. Per file: zombie-groan-1.mp3: Breathy, rough wordless zombie groan,
  'kart/boost': { file: 'kart/boost.mp3', gain: 0.7 }, // Real air rush: noise swell that rises over about 0.6 s then fades, 1.0 s.
  'kart/crash-1': { file: 'kart/crash-1.mp3', gain: 1 }, // Soft low thud made by hitting a mattress; muffled bumper / tyre-barrier bump, 0.6 s.
  'kart/crash-2': { file: 'kart/crash-2.mp3', gain: 1 }, // Short soft dull hit, low thump with quick decay, 0.26 s.
  'kart/engine-loop': { file: 'kart/engine-loop.mp3', gain: 0.6, loop: true }, // Real small go-kart engine at steady rpm, taken from the steady-running middle of a longer recording (the sourc
  'kart/explosion': { file: 'kart/explosion.mp3', gain: 0.8 }, // Small explosion with a sharp onset, low boom and short decay (a composite of other CC0 sounds by the author, s
  'kart/horn-start': { file: 'kart/horn-start.mp3', gain: 0.6 }, // Real industrial air horn recorded on an oil rig, strong blast with harmonics, 1.2 s with fade.
  'kart/item-pickup': { file: 'kart/item-pickup.mp3', gain: 0.9 }, // Very short bright mouth pop with a rising pitch (wordless, made by voice and isolated), 0.14 s.
  'kart/rocket': { file: 'kart/rocket.mp3', gain: 0.8 }, // Firework rocket ignition: hissing fizz that swells up quickly and fades out, 1.2 s.
  'kart/skid-1': { file: 'kart/skid-1.mp3', gain: 0.8 }, // Rubber tyres squealing and sliding on a street, clear harmonic squeal bands, 1.1 s with fade.
  'kart/skid-2': { file: 'kart/skid-2.mp3', gain: 0.8 }, // Car tyres skidding hard on tarmac, noisier broadband skid with fading tail, 1.2 s.
  'perc/big-drum': { files: ['perc/big-drum-1.mp3', 'perc/big-drum-2.mp3'], gain: 0.9 }, // Deep bass drum hits. big-drum-1 is the softer recording (suggested playback gain about 0.55), big-drum-2 is a 
  'perc/castanet': { files: ['perc/castanet-1.mp3', 'perc/castanet-2.mp3'], gain: 0.9 }, // Two single castanet clacks from different recordings: castanet-1 is a sharper click with tonal ring (0.2 s), c
  'perc/castanet-roll': { file: 'perc/castanet-roll.mp3', gain: 0.9 }, // Castanet roll, about eight fast clacks in the first half second, then decays (cut at 1 s).
  'perc/clap': { file: 'perc/clap.mp3', gain: 1 }, // Single real hand clap, close-miked, broadband with short decay.
  'perc/crash': { file: 'perc/crash.mp3', gain: 0.8 }, // 18 inch B8 crash cymbal hit, bright wash decaying over 2.5 s (tail faded).
  'perc/hat-closed': { file: 'perc/hat-closed.mp3', gain: 0.8 }, // Closed hi-hat hit, Zildjian A Custom, bright short tick.
  'perc/hat-open': { file: 'perc/hat-open.mp3', gain: 0.7 }, // Open hi-hat, Paiste 302+ 14 inch, loud open hit with sizzling decay (cut at 0.8 s with fade).
  'perc/heave': { files: ['perc/heave-1.mp3', 'perc/heave-2.mp3'], gain: 0.8 }, // Wordless-ish group male shouts 'hey!' (heave-1 0.65 s, heave-2 0.55 s), voices.
  'perc/kick': { file: 'perc/kick.mp3', gain: 1 }, // Acoustic drum-kit kick (bass drum) one-shot, dry, short thump with beater click.
  'perc/ride': { file: 'perc/ride.mp3', gain: 0.8 }, // Ride cymbal bell hit with sizzle, ping with shimmering tail (1.5 s, faded).
  'perc/snare': { file: 'perc/snare.mp3', gain: 1 }, // Acoustic snare drum hit, dry, broadband crack with snare rattle decay.
  'perc/snare-rim': { file: 'perc/snare-rim.mp3', gain: 0.9 }, // Snare side-stick / rim click, short dry knock.
  'perc/tambourine': { file: 'perc/tambourine.mp3', gain: 1 }, // Tambourine single hit/slap with jingles, 0.5 s.
  'perc/tom-high': { file: 'perc/tom-high.mp3', gain: 1 }, // Mid/high rack tom hit, Yamaha Oak Custom, clear tonal thud.
  'perc/tom-low': { file: 'perc/tom-low.mp3', gain: 1 }, // 16 inch floor tom hit, deep boomy tone.
  'perc/triangle': { file: 'perc/triangle.mp3', gain: 0.9 }, // Orchestral triangle ting, shimmering metallic partials (short natural sample, 0.56 s).
  'perc/whistle-long': { file: 'perc/whistle-long.mp3', gain: 0.8 }, // Long steady coach whistle blast with vibrato, about 1.4 s.
  'perc/whistle-short': { file: 'perc/whistle-short.mp3', gain: 0.8 }, // Referee pea whistle short blast with trill, then breathy tail (0.5 s).
  'perc/woodblock': { file: 'perc/woodblock.mp3', gain: 1 }, // Wood block hit, pitched hollow tock with harmonic partials.
  'scifi/clash': { files: ['scifi/clash-1.mp3', 'scifi/clash-2.mp3', 'scifi/clash-3.mp3'], gain: 1 }, // Three energy blade clashes: a loud electric crackle burst with hum underneath and a noisy metallic hit, 0.5 s 
  'scifi/deflect': { file: 'scifi/deflect.mp3', gain: 0.9 }, // Ricochet ping from a recorded/simulated bullet ricochet: sharp impact click followed by a descending whine, 0.
  'scifi/hum-loop': { file: 'scifi/hum-loop.mp3', gain: 0.8, loop: true }, // Steady energy-blade electric hum with a gentle pulsing beat (about 3 per second), 3.0 s seamless stereo loop a
  'scifi/ignite': { file: 'scifi/ignite.mp3', gain: 0.9 }, // Energy blade power-on: a short sizzling hiss that rises into a tonal snap, 0.55 s.
  'scifi/laser-shot': { file: 'scifi/laser-shot.mp3', gain: 0.7 }, // Short synthesised laser bolt: stack of harmonics sweeping steeply downward (classic pew), 0.4 s.
  'scifi/power-down': { file: 'scifi/power-down.mp3', gain: 0.8 }, // Large machine shutting down: falling-pitch harmonic whine with hiss, cut to 1.45 s with a 250 ms fade (the ori
  'scifi/robot-swing': { file: 'scifi/robot-swing.mp3', gain: 0.9 }, // Heavy low whoosh: dark, low-frequency swoosh recorded and processed by the uploader to sound heavy, 0.66 s, ra
  'scifi/servo-charge': { file: 'scifi/servo-charge.mp3', gain: 0.8 }, // Machine power-up charge: a dense stack of harmonics sweeping upward over a noisy bed, 2.34 s, ends at its peak
  'scifi/sizzle': { file: 'scifi/sizzle.mp3', gain: 0.9 }, // Short electric sizzle: a burst followed by crackling pops, 0.49 s, recorded buzz/electricity (own work of the 
  'scifi/swing': { files: ['scifi/swing-1.mp3', 'scifi/swing-2.mp3', 'scifi/swing-3.mp3'], gain: 0.9 }, // Three energy-blade swings. swing-1 is a clean airy whoosh (0.34 s, noise-based, with a metallic edge); swing-2
  'swing/arrow-fly': { file: 'swing/arrow-fly.mp3', gain: 0.7 }, // Short fast whoosh with about 15 ms of lead-in, described by the author as a bamboo or arrow type whoosh (bambo
  'swing/arrow-thud': { files: ['swing/arrow-thud-1.mp3', 'swing/arrow-thud-2.mp3'], gain: 0.9 }, // Arrow hits: 1 = real compound-bow arrow (aluminium shaft, blunt tip) striking a plastic and foam target, short
  'swing/bow-draw': { file: 'swing/bow-draw.mp3', gain: 0.7 }, // A real bow being slowly drawn: series of creaks and tension ticks, light noise reduction applied.
  'swing/bow-release': { files: ['swing/bow-release-1.mp3', 'swing/bow-release-2.mp3'], gain: 0.9 }, // Bow release: 1 = longbow string loose, short thwack; 2 = foley twang (horse whip + ruler) with decaying low to
  'swing/cast': { file: 'swing/cast.mp3', gain: 0.8 }, // Fishing cast: initial whoosh followed by ratcheting of line running off the reel, slowing down. Author states 
  'swing/reel-click': { files: ['swing/reel-click-1.mp3', 'swing/reel-click-2.mp3'], gain: 0.7 }, // Fly fishing reel ratchet clicks from one real slow-wind recording, cut at two different moments: 1 = four clic
  'swing/reel-drag-loop': { file: 'swing/reel-drag-loop.mp3', gain: 0.5, loop: true }, // Seamless 1.5 s loop of a fly reel pulling line fast (clicking buzz, some outdoor background). Stereo, about -2
  'swing/rope-creak': { file: 'swing/rope-creak.mp3', gain: 0.7 }, // Real recording of a rope creaking and groaning under tension (author tags: rope-creak, tension, twine, leather
  'swing/swoosh-heavy': { files: ['swing/swoosh-heavy-1.mp3', 'swing/swoosh-heavy-2.mp3'], gain: 0.9 }, // Two heavy low whooshes: 1 = dark low-pitched swoosh (Tascam recording), 2 = plastic baseball bat swung near a 
  'swing/swoosh-light': { files: ['swing/swoosh-light-1.mp3', 'swing/swoosh-light-2.mp3', 'swing/swoosh-light-3.mp3'], gain: 0.8 }, // Three fast light swishes of a stick swung through air (thin stick, bamboo stick, bamboo staff). Variants.
  'ui/beep': { file: 'ui/beep.mp3', gain: 0.6 }, // A real microwave oven beep, one short 2 kHz beep (about 0.12 s) with the natural small ring-out of the real ap
  'ui/beep-high': { file: 'ui/beep-high.mp3', gain: 0.6 }, // A real handheld parcel scanner beep (delivery driver's scanner), higher than beep (about 2.7 kHz with strong h
  'ui/click': { file: 'ui/click.mp3', gain: 0.8 }, // A real computer mouse click (down and up in one 0.12 s snap), dry and soft.
  'ui/coin': { file: 'ui/coin.mp3', gain: 0.8 }, // A real quarter dropped on a desk, first bright impact then two quick bounces and ring, 0.5 s.
  'ui/countdown-tick': { file: 'ui/countdown-tick.mp3', gain: 0.7 }, // A real wall clock tick/tock, close-miked (Zoom H6) in a kitchen, one tick with a short woody decay.
  'ui/ding': { file: 'ui/ding.mp3', gain: 0.8 }, // Single real bell ding (pet training bell recorded with a Blue Yeti), bright strike with a ringing decay, 1.2 s
  'ui/fail': { file: 'ui/fail.mp3', gain: 0.7 }, // A low drum hit (bonk) recorded with a Samson Meteor mic, a muffled low thud with a quick decay. Soft negative 
  'ui/fanfare-win': { file: 'ui/fanfare-win.mp3', gain: 0.8 }, // A real trumpet fanfare, recorded on a Rode NT2 (B-flat): a quick run of staccato notes ending in one long held
  'ui/party-horn': { file: 'ui/party-horn.mp3', gain: 0.8 }, // A real paper party horn/blower, one long blast of 1 s with reed buzz and a drop at the end.
  'ui/pop': { file: 'ui/pop.mp3', gain: 0.9 }, // A real cork pop from a gin bottle, recorded with a Rode NT2-A. Dull low thump with a short airy tail.
  'ui/shutter': { files: ['ui/shutter-1.mp3', 'ui/shutter-2.mp3'], gain: 0.9 }, // Two real camera shutter clicks (different cameras). Variant 1 is a short mechanical shutter snap, variant 2 is
  'ui/sting-lose': { file: 'ui/sting-lose.mp3', gain: 0.8 }, // Classic sad 'wah wah waah' made by a person with a hand in the bell of a French horn (notes E4 Eb4 D4), record
  'ui/success': { file: 'ui/success.mp3', gain: 0.8 }, // Short happy two-note chime played on a Yamaha keyboard and recorded with a phone (bell-like, bright). Quite sh
  'ui/whoosh-ui': { file: 'ui/whoosh-ui.mp3', gain: 0.6 }, // A quick real air whoosh, 0.3 s, sharp start with a fast smooth decay (leading silence trimmed so it can be tri
  'water/fish-flop': { file: 'water/fish-flop.mp3', gain: 0.8 }, // Fish jumping and thrashing at the surface: a dense wash of small splashes (1.4 s), cut from a longer fish-jump
  'water/lake-loop': { file: 'water/lake-loop.mp3', gain: 0.5, loop: true }, // Lakeside ambience at Dieksee (Germany): soft lapping waves with a few distant birds calling now and then, fore
  'water/plop': { files: ['water/plop-1.mp3', 'water/plop-2.mp3'], gain: 0.9 }, // Two different small objects dropping into water. plop-1: pebble thrown into a river, plop with a few ripples (
  'water/splash-big': { file: 'water/splash-big.mp3', gain: 0.9 }, // Large heavy splash: a rock dropped into water, loud broadband wash that decays over about 1.5 s, cut to 1.7 s 
  'water/splash-small': { file: 'water/splash-small.mp3', gain: 0.9 }, // Stone thrown into water: one clear splash with a short wet tail.
};
