// File: api/src/seed/exerciseGuides.ts
// Setup-card content for every seed exercise (spec 2026-07-06 §4, W2).
// One entry per exercise in ./exercises.ts — coverage enforced by
// tests/seed/exerciseGuideContent.test.ts. Authored prose, reviewed like any
// PR. media stays {} until W3 commits approved photos.
import type { ExerciseGuideSeed } from '../schemas/exerciseGuide.js';

export const exerciseGuides: ExerciseGuideSeed[] = [
  {
    exercise_slug: 'incline-dumbbell-bench-press',
    setup_callout:
      'Bench: 30° — usually the 2nd incline notch. 15–30° hits upper chest; past 45° it becomes a shoulder press. Feet flat, slight arch, shoulder blades pinched.',
    setup_facts: { bench_angle_deg: 30 },
    cues: [
      'Lower the dumbbells to the outside of your chest',
      'Keep your shoulder blades pinched the whole set',
      'Press up and slightly together at the top',
    ],
    donts: [
      'Setting the bench too steep — past 45° your shoulders take over',
      'Bouncing the weights out of the bottom position',
    ],
    media: {},
  },
  {
    exercise_slug: 'barbell-back-squat',
    setup_callout:
      'Bar sits on your upper traps, not your neck. Grip just outside your shoulders, elbows pointed down. Feet shoulder-width, toes out about 20°. Take a big breath and brace before every rep.',
    setup_facts: { toe_angle_deg: 20, stance: 'shoulder-width' },
    cues: [
      'Brace your core before each rep, not during it',
      'Sit down between your heels with your chest proud',
      'Drive the floor apart as you stand up',
    ],
    donts: [
      'Letting your knees cave inward on the way up',
      'Cutting depth short — aim for thighs at least parallel',
    ],
    media: {},
  },
  {
    exercise_slug: 'outdoor-walking-z2',
    setup_callout:
      'Zone 2 means a pace where you can talk in full sentences but singing would be hard. Pick a mostly flat route and comfortable shoes. If you are panting, slow down — easy is the point.',
    setup_facts: { effort: 'conversational pace' },
    cues: [
      'Hold a pace you could keep up for an hour',
      'Relax your shoulders and let your arms swing',
      'Check yourself: can you still speak in full sentences?',
    ],
    donts: [
      'Racing the clock — this session builds your base, not your ego',
      'Stopping and starting — keep continuous movement for the full time',
    ],
    media: {},
  },

  // ── CHEST · push_horizontal ──────────────────────────────────────────────

  {
    exercise_slug: 'barbell-bench-press',
    setup_callout:
      'Lie with your eyes directly under the bar. Grip just outside your shoulders — forearms vertical when the bar touches your chest. Feet flat, shoulder blades pinched, slight arch. Set safety arms or ask for a spotter before going heavy.',
    setup_facts: { grip_width: 'just outside shoulders' },
    cues: [
      'Lower the bar to your mid-chest with control',
      'Keep your feet planted and your butt on the bench',
      'Press the bar up and slightly back over your shoulders',
    ],
    donts: [
      'Bouncing the bar off your chest to start the press',
      'Flaring your elbows straight out to the sides',
    ],
    media: {},
  },
  {
    exercise_slug: 'dumbbell-bench-press',
    setup_callout:
      'Bench flat. Sit with the dumbbells standing on your thighs, then lie back and kick them up one at a time. Unlike the barbell version, each arm works alone and you get a deeper stretch at the bottom — start lighter than you think.',
    setup_facts: { bench_angle_deg: 0 },
    cues: [
      'Lower until you feel a stretch across your chest',
      'Keep each dumbbell stacked over your elbow',
      'Press up and slightly together at the top',
    ],
    donts: [
      'Letting the dumbbells wobble outward at the bottom',
      'Clanging the weights together at the top of every rep',
    ],
    media: {},
  },
  {
    exercise_slug: 'slingshot-bench-press',
    setup_callout:
      'Slide the slingshot band up both arms until it sits just above your elbows. Everything else is your normal barbell bench setup. The band pushes back at the bottom, so load about 5–10% more than your regular bench weight.',
    setup_facts: { sling_position: 'just above the elbows' },
    cues: [
      'Set up exactly like your normal bench — only the band changes',
      "Control the bar down — don't let the band rush you",
      'Touch your chest on every rep',
    ],
    donts: [
      'Wearing the band on your forearms instead of just above the elbows',
      'Cutting range short — the band only helps if you touch your chest',
    ],
    media: {},
  },

  // ── FRONT DELT / TRICEPS · push_vertical ─────────────────────────────────

  {
    exercise_slug: 'barbell-overhead-press-standing',
    setup_callout:
      'Set the bar in the rack at upper-chest height. Grip just outside your shoulders, elbows under the bar, and step back with the bar resting on your front shoulders. Feet hip-width. Squeeze your glutes and brace before every press.',
    setup_facts: { rack_height: 'upper chest', grip_width: 'just outside shoulders' },
    cues: [
      'Squeeze your glutes and brace before the bar moves',
      'Move your head back, press, then push your head through',
      'Finish with the bar over the middle of your feet, arms locked',
    ],
    donts: [
      'Leaning way back and turning it into an incline press',
      'Pressing the bar out around your chin instead of moving your head',
    ],
    media: {},
  },
  {
    exercise_slug: 'dumbbell-shoulder-press-seated',
    setup_callout:
      'Set the bench nearly upright — about 80°, one notch back from vertical. Kick the dumbbells up to shoulder height, palms facing forward, feet planted. Your lower back stays against the pad for the whole set.',
    setup_facts: { bench_angle_deg: 80 },
    cues: [
      'Lower until the dumbbells reach about ear height',
      'Keep your lower back against the pad',
      'Press up and slightly in until your arms are straight',
    ],
    donts: [
      'Arching off the backrest to grind out heavy reps',
      'Stopping halfway down — ear height, every rep',
    ],
    media: {},
  },

  // ── SIDE DELT ─────────────────────────────────────────────────────────────

  {
    exercise_slug: 'dumbbell-lateral-raise',
    setup_callout:
      'Stand tall with a light dumbbell in each hand, elbows slightly bent, and lean forward a touch at the hips. Go lighter than feels impressive — shoulder height with control beats heavy swinging every time.',
    setup_facts: { raise_height: 'shoulder level' },
    cues: [
      'Lead with your elbows, not your hands',
      'Raise to shoulder height, no higher',
      'Lower slowly — the way down builds muscle too',
    ],
    donts: [
      'Swinging the weights up with a bounce from your hips',
      'Shrugging your shoulders toward your ears as you lift',
    ],
    media: {},
  },

  // ── REAR DELT · pull_horizontal ──────────────────────────────────────────

  {
    exercise_slug: 'dumbbell-rear-delt-raise',
    setup_callout:
      'Push your hips back and lean forward until your chest is nearly parallel to the floor — or sit on the end of a bench with your chest on your thighs. Let the dumbbells hang under your shoulders, palms facing each other. Go light; this is a small muscle.',
    setup_facts: { torso_angle: 'chest near parallel to floor' },
    cues: [
      'Raise the dumbbells out to your sides with soft elbows',
      'Hold the top for a one-count squeeze',
      'Keep your torso frozen — only your arms move',
    ],
    donts: [
      'Standing up taller each rep until it becomes a lateral raise',
      'Heaving the weights with a bounce from your lower back',
    ],
    media: {},
  },
  {
    exercise_slug: 'cable-face-pull',
    setup_callout:
      'Set the pulley at forehead height and clip on the rope. Grab the ends with your palms facing in, thumbs toward you, then step back until the stack lifts. Stand square or split-stance — whatever keeps you steady.',
    setup_facts: { pulley_height: 'forehead level' },
    cues: [
      'Pull the rope toward your eyes, elbows high and wide',
      'Pull the ends apart as they reach your face',
      'Pause when your knuckles are beside your ears',
    ],
    donts: [
      'Going so heavy it turns into a row toward your chest',
      'Leaning back to move the stack with body weight',
    ],
    media: {},
  },

  // ── UPPER BACK · pull_horizontal ─────────────────────────────────────────

  {
    exercise_slug: 'chest-supported-dumbbell-row',
    setup_callout:
      'Set the bench to about 45° and lie chest-down on it, head over the top edge. Feet on the floor, arms hanging straight, a dumbbell in each hand. The pad holds your position, so all you do is row — no lower-back guesswork.',
    setup_facts: { bench_angle_deg: 45 },
    cues: [
      'Keep your chest glued to the pad the whole set',
      'Pull your elbows up and back toward your hips',
      'Let your arms hang fully straight between reps',
    ],
    donts: [
      'Lifting your chest off the pad to heave the weight',
      'Cutting the stretch short at the bottom of each rep',
    ],
    media: {},
  },
  {
    exercise_slug: 'barbell-bent-over-row',
    setup_callout:
      'Push your hips back and lean your torso to about 45°, knees soft. Grip the bar just outside your legs and let it hang under your shoulders. Unlike the chest-supported row, your lower back holds this position — brace hard and stay rigid.',
    setup_facts: { torso_angle_deg: 45 },
    cues: [
      'Lock your torso angle before the first pull',
      'Pull the bar to your lower ribs',
      "Lower under control — don't let the bar yank you forward",
    ],
    donts: [
      'Standing up taller each rep to move heavier weight',
      'Jerking the bar up with a bounce from your lower back',
    ],
    media: {},
  },

  // ── LATS · pull_vertical ─────────────────────────────────────────────────

  {
    exercise_slug: 'pullup',
    setup_callout:
      'Grab the bar just outside shoulder-width, palms facing away. Start from a dead hang, arms straight. If you cannot get a full rep yet, loop a band under one foot or use an assisted machine — full range beats half reps.',
    setup_facts: { grip_width: 'just outside shoulders' },
    cues: [
      'Start every rep from a dead hang',
      'Drive your elbows down toward your ribs',
      'Pull until your chin clears the bar',
    ],
    donts: [
      'Kipping or swinging your legs for momentum',
      'Stopping short of straight arms at the bottom',
    ],
    media: {},
  },
  {
    exercise_slug: 'lat-pulldown-machine',
    setup_callout:
      'Set the thigh pad so your legs lock in snug when seated. Grab the bar just outside shoulder-width, palms facing away, and lean back slightly. Same pull as a pull-up, but the machine lets you pick the exact weight.',
    setup_facts: { grip_width: 'just outside shoulders' },
    cues: [
      'Pull the bar down to the top of your chest',
      'Drive your elbows down and back',
      'Let your arms straighten fully at the top',
    ],
    donts: ['Leaning way back and rowing the weight down', 'Pulling the bar behind your neck'],
    media: {},
  },

  // ── LATS + UPPER BACK · pull_horizontal ──────────────────────────────────

  {
    exercise_slug: 'dumbbell-row-1arm',
    setup_callout:
      'Put your left hand and left knee on a bench, right foot on the floor, back flat like a tabletop. The dumbbell hangs from your right arm, directly under your shoulder. Do all reps, then switch sides.',
    setup_facts: { support: 'hand and knee on bench' },
    cues: [
      'Pull the dumbbell up toward your hip pocket',
      'Keep your hips and shoulders square to the floor',
      'Let the weight stretch you at the bottom of every rep',
    ],
    donts: [
      'Twisting your torso open to hoist the weight up',
      'Shrugging the weight up instead of pulling with your back',
    ],
    media: {},
  },

  // ── BICEPS ────────────────────────────────────────────────────────────────

  {
    exercise_slug: 'dumbbell-curl',
    setup_callout:
      'Stand tall with a dumbbell in each hand, arms straight, palms facing forward. Pin your elbows to your ribs — they stay there for the whole set. If you have to lean back to lift it, the weight is too heavy.',
    setup_facts: {},
    cues: [
      'Pin your elbows to your ribs for the whole set',
      'Curl all the way up, then lower for a slow two-count',
      'Keep your wrists straight — no flicking at the top',
    ],
    donts: [
      'Rocking your torso to swing the weight up',
      'Letting your elbows drift forward at the top',
    ],
    media: {},
  },
  {
    exercise_slug: 'dumbbell-hammer-curl',
    setup_callout:
      'Same stance as a regular curl, but your palms face each other — like holding two hammers — and stay that way for every rep. The thumbs-up grip brings in more forearm, so you can usually go a bit heavier than your standard curl.',
    setup_facts: { grip: 'palms facing each other' },
    cues: [
      'Keep your palms facing each other the entire rep',
      'Squeeze the handles hard — your forearms are working too',
      'Lower all the way to a straight arm',
    ],
    donts: [
      "Rotating your wrists mid-rep — that's a regular curl",
      'Bouncing out of the bottom with a swing',
    ],
    media: {},
  },

  // ── TRICEPS ───────────────────────────────────────────────────────────────

  {
    exercise_slug: 'dumbbell-skull-crusher',
    setup_callout:
      'Lie flat on the bench and press the dumbbells straight up, palms facing each other. Your upper arms freeze in place — only your elbows bend, lowering the weights back beside your ears. Start light; this one is hard on the elbows.',
    setup_facts: { bench_angle_deg: 0 },
    cues: [
      'Freeze your upper arms — only your elbows bend',
      'Lower the weights back beside your ears with control',
      'Stop the press just short of locked to keep tension on',
    ],
    donts: [
      'Flaring your elbows out wide as you lower',
      'Turning it into a press by letting your upper arms drift',
    ],
    media: {},
  },
  {
    exercise_slug: 'cable-tricep-pressdown',
    setup_callout:
      'Set the pulley to the top of the stack and clip on a straight bar or rope. Stand close, lean forward slightly, and pin your elbows to your sides. From elbows bent past 90°, press straight down until your arms are fully straight.',
    setup_facts: { pulley_height: 'top of the stack' },
    cues: [
      'Pin your elbows to your sides — only your forearms move',
      'Press down until your arms are fully straight',
      'Resist the cable on the way back up',
    ],
    donts: [
      'Leaning over the cable and pressing with body weight',
      'Letting your elbows flare out and drift forward',
    ],
    media: {},
  },

  // ── QUADS · squat ─────────────────────────────────────────────────────────

  {
    exercise_slug: 'dumbbell-goblet-squat',
    setup_callout:
      'Hold one dumbbell vertically against your chest like a goblet, both hands cupping the top end, elbows tucked. Feet shoulder-width, toes slightly out. The front-loaded weight balances you — this is the friendliest squat for learning depth.',
    setup_facts: { stance: 'shoulder-width' },
    cues: [
      'Keep the dumbbell in contact with your chest',
      'Sit down between your heels, elbows inside your knees',
      'Push the floor away to stand',
    ],
    donts: ['Letting the weight drift away from your body', 'Rocking onto your toes at the bottom'],
    media: {},
  },
  {
    exercise_slug: 'leg-extension-machine',
    setup_callout:
      "Adjust the seat back so your knees line up with the machine's pivot point, and set the pad on your shins just above the ankles. Sit all the way back, grip the side handles, and pick a weight you can move without jerking.",
    setup_facts: { pivot_alignment: 'knees at machine pivot', pad_position: 'just above ankles' },
    cues: [
      'Extend until your knees are fully straight, then pause',
      'Lower for a slow two-count',
      'Keep your back against the pad and grip the handles',
    ],
    donts: [
      'Kicking the weight up with a bounce from your hips',
      'Letting the weight freefall between reps',
    ],
    media: {},
  },

  // ── HAMSTRINGS · hinge ────────────────────────────────────────────────────

  {
    exercise_slug: 'barbell-romanian-deadlift',
    setup_callout:
      'Start standing with the bar at your thighs — take it from a rack if you can. Feet hip-width, knees soft. Lower by pushing your hips straight back, sliding the bar down your thighs to about mid-shin. Your knee bend stays fixed the entire rep.',
    setup_facts: { stance: 'hip-width', lowest_point: 'mid-shin' },
    cues: [
      'Push your hips straight back, not down',
      'Drag the bar along your thighs the whole way',
      'Stop at a deep hamstring stretch — around mid-shin',
    ],
    donts: [
      'Rounding your lower back to reach the floor',
      'Bending your knees more to get deeper — that turns it into a squat',
    ],
    media: {},
  },
  {
    exercise_slug: 'dumbbell-romanian-deadlift',
    setup_callout:
      'Hold a dumbbell in front of each thigh, palms facing you, feet hip-width. Same hip-back move as the barbell version, but with no rack needed and free hands — the best place to learn the pattern before loading a bar.',
    setup_facts: { stance: 'hip-width' },
    cues: [
      'Keep the dumbbells brushing your thighs and shins',
      'Push your hips back until your hamstrings pull tight',
      'Stand up by driving your hips forward',
    ],
    donts: [
      'Letting the dumbbells swing out in front of you',
      'Squatting the weight down instead of pushing your hips back',
    ],
    media: {},
  },
  {
    exercise_slug: 'conventional-deadlift',
    setup_callout:
      'Bar over the middle of your feet, about an inch from your shins. Feet hip-width, grip just outside your legs. Bend down by pushing your hips back, chest up, back flat. Pull the slack out of the bar before it leaves the floor.',
    setup_facts: { stance: 'hip-width', bar_position: 'over mid-foot' },
    cues: [
      'Pull the slack out of the bar before you lift',
      'Push the floor away and keep the bar against your legs',
      'Finish standing tall — no lean-back at the top',
    ],
    donts: [
      'Letting your hips shoot up first so your back lifts the weight',
      'Jerking the bar off the floor with slack arms',
    ],
    media: {},
  },
  {
    exercise_slug: 'leg-curl-machine',
    setup_callout:
      "Set the pad so it rests just above your heels, and line your knees up with the machine's pivot. Adjust the seat or thigh pad until you are locked in with no gap. The machine does the balancing — you do the work, full stretch to full curl.",
    setup_facts: {
      pad_position: 'just above the heels',
      pivot_alignment: 'knees at machine pivot',
    },
    cues: [
      'Curl your heels in as far as the machine allows',
      'Pause for a beat at the full curl',
      'Return slowly to a full stretch',
    ],
    donts: [
      'Lifting your hips off the pad to cheat the weight up',
      'Letting the stack drop between reps',
    ],
    media: {},
  },

  // ── GLUTES · hinge / squat ────────────────────────────────────────────────

  {
    exercise_slug: 'dumbbell-hip-thrust',
    setup_callout:
      'Sit on the floor with your upper back against the long side of a bench, dumbbell resting across your hips — a pad or folded towel saves the bruise. Feet flat and hip-width, close enough that your shins are vertical at the top.',
    setup_facts: { stance: 'hip-width', shins_at_top: 'vertical' },
    cues: [
      'Drive through your heels until your body is a flat tabletop',
      'Squeeze your glutes hard at the top for a full second',
      'Keep your chin tucked and eyes forward',
    ],
    donts: [
      'Arching your lower back to fake extra height',
      'Pushing through your toes instead of your heels',
    ],
    media: {},
  },
  {
    exercise_slug: 'dumbbell-bulgarian-split-squat',
    setup_callout:
      'Stand one big step in front of a bench and put your rear foot on it, laces down. Dumbbells at your sides. Shuffle your front foot until you find balance — far enough forward that your front shin stays near vertical at the bottom.',
    setup_facts: { front_foot_distance: 'one big step from bench' },
    cues: [
      'Drop your back knee straight down toward the floor',
      'Keep almost all your weight on the front leg',
      'Lean your chest slightly forward and stay balanced',
    ],
    donts: [
      'Setting up so close to the bench that your front knee jams',
      "Pushing off the back foot — it's only there for balance",
    ],
    media: {},
  },

  // ── LUNGE ─────────────────────────────────────────────────────────────────

  {
    exercise_slug: 'dumbbell-walking-lunge',
    setup_callout:
      'Find a clear lane 10–15 steps long. Dumbbells at your sides, arms relaxed. Each step is a full rep: long stride out, back knee down toward the floor, then drive up and through into the next step.',
    setup_facts: {},
    cues: [
      'Step far enough that your front shin stays near vertical',
      'Lower your back knee to just above the floor',
      'Push through your front heel into the next step',
    ],
    donts: [
      'Taking short, choppy steps that cramp your front knee',
      'Letting your front knee cave inward as you drive up',
    ],
    media: {},
  },
  {
    exercise_slug: 'dumbbell-reverse-lunge',
    setup_callout:
      'Stand tall, dumbbells at your sides. Instead of stepping forward, you step backward — the front foot never moves. That keeps your front shin vertical, making this the most knee-friendly lunge in the book.',
    setup_facts: {},
    cues: [
      'Step back long — think stride, not stomp',
      'Keep your front heel planted and drive through it to stand',
      'Stay tall through the whole rep',
    ],
    donts: [
      'Stepping back too short so your front knee slides far forward',
      'Slamming your back knee into the floor',
    ],
    media: {},
  },

  // ── CALVES ────────────────────────────────────────────────────────────────

  {
    exercise_slug: 'dumbbell-standing-calf-raise',
    setup_callout:
      'Hold a dumbbell in one hand and rest the other hand on a rack or wall for balance. For a deeper stretch, stand with the balls of your feet on a plate or step edge. Full range beats heavy weight — all the way up, all the way down.',
    setup_facts: {},
    cues: [
      'Rise as high onto the balls of your feet as you can',
      'Pause for a beat at the top and at the bottom',
      'Lower until you feel a full stretch in your calves',
    ],
    donts: [
      'Bouncing quick half reps out of the bottom',
      'Bending your knees to bounce the weight up',
    ],
    media: {},
  },

  // ── CARRIES ───────────────────────────────────────────────────────────────

  {
    exercise_slug: 'dumbbell-farmers-carry',
    setup_callout:
      "Grab the heaviest pair of dumbbells you can hold with tall posture — deadlift them up, don't bend and snatch. Stand tall, shoulders back, and walk. This is the two-handed heavy carry: grip and posture are the whole game.",
    setup_facts: {},
    cues: [
      'Walk tall — ears over shoulders, shoulders over hips',
      'Take short, quick steps',
      'Crush the handles the entire walk',
    ],
    donts: [
      'Letting your shoulders round forward as your grip tires',
      'Letting the dumbbells swing and bang into your legs',
    ],
    media: {},
  },
  {
    exercise_slug: 'suitcase-carry',
    setup_callout:
      'Pick up one heavy dumbbell — heavy enough that staying upright takes real effort — and carry it at your side like a suitcase. Free arm relaxed. The work is refusing to lean toward or away from the weight.',
    setup_facts: {},
    cues: [
      "Stand dead level — don't lean toward or away from the weight",
      'Keep your free arm relaxed at your side',
      'Walk a straight line with even steps',
    ],
    donts: [
      'Leaning away from the dumbbell to make it easier',
      'Going so light your body never has to fight the lean',
    ],
    media: {},
  },
  {
    exercise_slug: 'dumbbell-suitcase-carry',
    setup_callout:
      'One moderate dumbbell at your side, longer walks. Where the heavy suitcase carry is a short, brutal fight against the lean, this version trains posture over distance — pick a weight you can carry 40+ steps with perfect form.',
    setup_facts: {},
    cues: [
      'Set your shoulders back before the first step',
      'Keep your hips level — no dipping toward the weight',
      'Switch hands each lap and match your steps',
    ],
    donts: [
      'Shrugging the loaded shoulder up toward your ear',
      'Speeding up as you tire — pace stays even',
    ],
    media: {},
  },
  {
    exercise_slug: 'dumbbell-overhead-carry',
    setup_callout:
      'Press one light dumbbell overhead until your arm is locked, biceps beside your ear. Then walk. Start lighter than pride suggests — holding a lockout while moving is much harder than pressing the weight once.',
    setup_facts: { arm_position: 'locked out, biceps by ear' },
    cues: [
      'Lock your elbow and keep your knuckles to the ceiling',
      'Keep your ribs down and stacked over your hips',
      'Walk slowly — balance beats distance',
    ],
    donts: [
      'Arching your lower back as your shoulder tires',
      'Letting the dumbbell drift forward past your head',
    ],
    media: {},
  },

  // ── ROTATION ──────────────────────────────────────────────────────────────

  {
    exercise_slug: 'cable-woodchop-high-to-low',
    setup_callout:
      'Set the pulley above shoulder height. Stand sideways to the machine, feet wider than shoulders, both hands stacked on the handle. Pull the handle diagonally across your body — high near the machine, low at your far hip.',
    setup_facts: { pulley_height: 'above shoulder height' },
    cues: [
      'Turn from your hips and torso, not your arms',
      'Pivot your back foot as you rotate through',
      'Let the cable pull you back slowly — control the return',
    ],
    donts: [
      'Chopping with just your arms while your hips stay frozen',
      'Loading so heavy the cable drags you off balance',
    ],
    media: {},
  },
  {
    exercise_slug: 'dumbbell-rotational-chop',
    setup_callout:
      'Hold one dumbbell with both hands at shoulder height, off to one side. Feet wider than shoulders. Same diagonal path as the cable chop, but gravity is the resistance — so the slow, controlled return matters as much as the chop.',
    setup_facts: {},
    cues: [
      'Move the dumbbell on a diagonal from shoulder to opposite hip',
      'Rotate your hips and let your back heel pivot',
      'Slow the weight down at the bottom — no whipping',
    ],
    donts: [
      'Rounding your back at the bottom of the chop',
      'Letting momentum steer the dumbbell instead of your torso',
    ],
    media: {},
  },

  // ── CORE ──────────────────────────────────────────────────────────────────

  {
    exercise_slug: 'cable-pallof-press',
    setup_callout:
      'Set the pulley at chest height and stand sideways to the machine, feet shoulder-width. Hold the handle with both hands at the center of your chest and step out until the cable is taut. The job is simple: press out, and refuse to twist.',
    setup_facts: { pulley_height: 'chest level', stance: 'shoulder-width' },
    cues: [
      'Press the handle straight out from your chest and hold',
      'Keep your hips and shoulders square to the front',
      'Breathe steadily while you resist the twist',
    ],
    donts: [
      'Standing so close to the machine the cable goes slack',
      'Letting your arms drift sideways toward the stack',
    ],
    media: {},
  },
  {
    exercise_slug: 'dead-bug',
    setup_callout:
      'Lie on your back. Arms straight up over your chest, knees bent to 90° and stacked over your hips. Press your lower back flat into the floor — keeping it there while your limbs move is the entire exercise.',
    setup_facts: { hip_knee_angle_deg: 90 },
    cues: [
      'Lower one arm and the opposite leg at the same time',
      'Keep your lower back pressed into the floor',
      'Exhale slowly as your limbs extend',
    ],
    donts: [
      'Letting your lower back arch off the floor',
      'Racing through reps instead of moving with control',
    ],
    media: {},
  },
  {
    exercise_slug: 'hanging-leg-raise',
    setup_callout:
      'Hang from the bar at shoulder-width, palms facing away, arms straight. Pull your shoulders down away from your ears before the first rep. Too hard with straight legs? Bend your knees — a controlled knee raise beats a swinging leg raise.',
    setup_facts: { grip_width: 'shoulder-width' },
    cues: [
      'Tuck your hips under as you raise your knees',
      'Lower slowly to a full hang',
      'Keep your shoulders pulled down away from your ears',
    ],
    donts: [
      'Swinging to build momentum between reps',
      'Arching your back and kicking your legs up',
    ],
    media: {},
  },
  {
    exercise_slug: 'ab-wheel-rollout',
    setup_callout:
      'Kneel on a pad with the wheel on the floor under your shoulders. Tuck your hips under and brace hard before you move. Range is earned here: roll out only as far as you can keep your lower back from sagging, even if that is halfway.',
    setup_facts: { start_position: 'wheel under shoulders' },
    cues: [
      'Tuck your hips under and brace before you roll',
      'Roll out only as far as your back stays flat',
      'Pull back with your abs, not your arms',
    ],
    donts: [
      'Letting your lower back sag toward the floor',
      'Chasing full range before you have earned it',
    ],
    media: {},
  },
  {
    exercise_slug: 'side-plank',
    setup_callout:
      'Lie on your side with your elbow directly under your shoulder, forearm flat on the floor, feet stacked. Lift your hips until you form a straight line from head to heels. Too hard? Drop to your bottom knee — same exercise, less to hold up.',
    setup_facts: { elbow_position: 'directly under shoulder' },
    cues: [
      'Push the floor away through your forearm',
      'Hold one straight line from head to heels',
      "Breathe normally — don't hold your breath",
    ],
    donts: ['Letting your hips sag toward the floor', 'Rolling your top shoulder forward'],
    media: {},
  },
  {
    exercise_slug: 'cable-crunch',
    setup_callout:
      'Set the rope at the top of the stack, kneel facing the machine, and hold the rope ends beside your head. Your hips stay parked — the movement is your ribs curling down toward your hips, your spine rounding one notch at a time.',
    setup_facts: { pulley_height: 'top of the stack' },
    cues: [
      'Curl your ribs down toward your hips',
      'Keep your hands parked beside your head',
      'Uncurl slowly back to a tall kneel',
    ],
    donts: [
      'Pulling the rope down with your arms',
      'Folding at the hips instead of curling your spine',
    ],
    media: {},
  },

  // ── CARDIO ────────────────────────────────────────────────────────────────

  {
    exercise_slug: 'recumbent-bike-steady-state',
    setup_callout:
      'Slide the seat so your knee keeps a slight bend when the pedal is farthest away. Pick a resistance where you can talk in full sentences for the whole ride — steady and easy is the goal, not a sweat-soaked sprint.',
    setup_facts: { knee_bend_at_full_extension: 'slight', effort: 'conversational pace' },
    cues: [
      'Keep a smooth, even pedal pace',
      'Settle back into the seat and let the backrest work',
      'Check yourself: full sentences should still come easy',
    ],
    donts: [
      'Grinding a gear so heavy your pace falls apart',
      'Setting the seat so close your knees stay cramped',
    ],
    media: {},
  },
];
