export type Frame = 'start' | 'end';

// One shared scene so every exercise reads as the same athlete in the same
// gym (spec §5). Reworked after the 2026-07-07 pilot with the user's
// reference prompt ("Gym Bro doing a Perfect <exercise>, instructional
// how-to poster style"): perfect-form emphasis + poster clarity, WITHOUT the
// baked-in poster text ("3squenie" garble class — annotations are
// app-rendered, never in the image). The equipment-consistency lines exist
// because frames generate independently: the pilot's squat came back with an
// unloaded bar at start and a loaded bar at end.
export const STYLE_BLOCK = `Photorealistic instructional exercise-demonstration photograph, in the visual style of a professional "how to do this exercise" reference poster — image only, without any of a poster's text.
The demonstrator performs the movement with PERFECT textbook form, posed with the deliberate clarity of a certified trainer demonstrating for a training manual.
The SAME athlete in every image: a man in his early 30s, athletic and visibly muscular build — an experienced lifter — short dark hair,
plain heather-gray t-shirt, black shorts, neutral dark training shoes.
Setting: modern commercial gym, dark rubber flooring, matte-black equipment, soft even overhead lighting, clean uncluttered background.
Equipment consistency: barbells are loaded identically in every image — one matte-black bumper plate per side with collars; dumbbells are always a matching pair of black rubber hex dumbbells; the same equipment and load appears in both the start and end frame of an exercise.
Lighting consistency: the same lighting in every image — soft, even, neutral-white overhead light; never moody or dramatic in one frame and bright in another.
Scene consistency: the same bench, rack, and machine setup appears in both the start and end frame of an exercise — identical station, identical camera position.
Camera: chest height, three-quarter side angle, the full body and the equipment in frame.
Composition: 4:3 landscape orientation.
Strictly NO text, NO lettering, NO numbers, NO logos, NO watermarks, NO diagrams, NO arrows, NO overlays, NO mirrors facing the camera, NO other people.`;

const FRAME_LINE: Record<Frame, string> = {
  start:
    'Show the STARTING position of the exercise: set up and ready, the instant before the first rep begins.',
  // NOT "peak contraction": for movements that start contracted (a press at
  // lockout, an RDL standing tall) that phrase makes start and end the same
  // pose. The end frame is the other extreme of the rep.
  end: 'Show the END position of the rep: the turnaround point, the body position furthest away from the starting position within one full repetition at complete range of motion (for a press: the bar at the chest; for a hinge: the deepest hinge; for a raise or pull: the top of the movement).',
};

export function buildPrompt(input: {
  name: string;
  equipment: string[];
  setupCallout: string;
  frame: Frame;
  positionOverride?: string;
  sceneOverride?: string;
}): string {
  const scene = input.sceneOverride ?? STYLE_BLOCK;
  const equipmentLine =
    input.equipment.length > 0 ? `Equipment in use: ${input.equipment.join(', ')}.` : '';
  const position =
    input.positionOverride ?? `Setup, for reference: ${input.setupCallout}`;
  return [scene, `Exercise: ${input.name}.`, equipmentLine, FRAME_LINE[input.frame], position]
    .filter(Boolean)
    .join('\n\n');
}
