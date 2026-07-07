export type Frame = 'start' | 'end';

// One shared scene so all 44 exercises read as the same athlete in the same
// gym (spec §5). Text/logo bans guard the AI-garbled-text failure mode the
// spec calls out ("3squenie") — annotations are app-rendered, never baked in.
export const STYLE_BLOCK = `Photorealistic photograph shot in a modern commercial gym.
The SAME athlete in every image: a man in his early 30s, average athletic build, short dark hair,
plain heather-gray t-shirt, black shorts, neutral dark training shoes.
Setting: dark rubber gym flooring, matte-black equipment, soft even overhead lighting,
clean uncluttered background, shallow depth of field.
Camera: chest height, three-quarter side angle, the full body and the equipment in frame.
Composition: 4:3 landscape orientation.
Strictly NO text, NO lettering, NO logos, NO watermarks, NO mirrors facing the camera, NO other people.`;

const FRAME_LINE: Record<Frame, string> = {
  start:
    'Show the STARTING position of the exercise: set up and ready, the instant before the first rep begins.',
  end: 'Show the END position of the rep: peak contraction at full range of motion.',
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
