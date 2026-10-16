// Challenges, rated like trail signs: green circle to double black diamond.
export const TIERS = {
  green: { label: 'Easiest' },
  blue: { label: 'More difficult' },
  black: { label: 'Most difficult' },
  double: { label: 'Experts only' },
};

const air = (e) => e.type === 'trick' && e.trick.kind === 'air';

export const CHALLENGES = [
  { id: 'first-air', tier: 'green', name: 'First Air', desc: 'Land any air trick.', test: (e) => air(e) },
  { id: 'spin-360', tier: 'green', name: 'Three-Sixty', desc: 'Land a 360 or bigger.', test: (e) => air(e) && e.trick.spinDeg >= 360 },
  { id: 'grab-any', tier: 'green', name: 'Grab Bag', desc: 'Land a trick with a grab.', test: (e) => air(e) && e.trick.grabs.length > 0 },
  { id: 'rail-any', tier: 'green', name: 'Rail Rookie', desc: 'Grind any rail or box to the end.', test: (e) => e.type === 'trick' && e.trick.kind === 'grind' },
  { id: 'butter', tier: 'green', name: 'Butter Up', desc: 'Hold a nose or tail press for 2 seconds.', test: (e) => e.type === 'trick' && e.trick.kind === 'butter' && e.trick.time >= 2 },
  { id: 'switch-any', tier: 'green', name: 'Switch It Up', desc: 'Land a spin or flip that takes off switch.', test: (e) => air(e) && e.trick.switchTakeoff && (e.trick.halfTurns > 0 || e.trick.flips > 0) },
  { id: 'spin-540', tier: 'blue', name: 'Five-Forty', desc: 'Land a 540 or bigger.', test: (e) => air(e) && e.trick.spinDeg >= 540 },
  { id: 'flip-any', tier: 'blue', name: 'Flip Side', desc: 'Land a backflip or frontflip.', test: (e) => air(e) && e.trick.flips >= 1 },
  { id: 'grind-15', tier: 'blue', name: 'Long Slide', desc: 'Grind 15 m in one go.', test: (e) => e.type === 'trick' && e.trick.kind === 'grind' && e.trick.dist >= 15 },
  { id: 'combo-3', tier: 'blue', name: 'Combo Starter', desc: 'Bank a combo of 3 or more tricks.', test: (e) => e.type === 'bank' && e.mult >= 3 },
  { id: 'pipe-trick', tier: 'blue', name: 'Pipe Dream', desc: 'Land a spin in the superpipe.', test: (e) => air(e) && e.trick.inPipe && e.trick.halfTurns >= 1 },
  { id: 'shred', tier: 'blue', name: 'S-H-R-E-D', desc: 'Collect all five letters on the mountain.', test: (e) => e.type === 'collect' && e.letters >= 5 },
  { id: 'boardslide', tier: 'blue', name: 'Sideways', desc: 'Land a boardslide on any rail or box.', test: (e) => e.type === 'trick' && e.trick.kind === 'grind' && /Boardslide/.test(e.trick.type) },
  { id: 'combo-10k', tier: 'blue', name: 'Ten Grand', desc: 'Bank 10,000 points in one combo.', test: (e) => e.type === 'bank' && e.score >= 10000 },
  { id: 'spin-1080', tier: 'black', name: 'Ten-Eighty', desc: 'Land a 1080 or bigger.', test: (e) => air(e) && e.trick.spinDeg >= 1080 },
  { id: 'double', tier: 'black', name: 'Double Trouble', desc: 'Land a double cork, rodeo or misty.', test: (e) => air(e) && e.trick.offAxis && e.trick.flips >= 2 },
  { id: 'mctwist', tier: 'black', name: 'McTwist', desc: 'Land a McTwist in the superpipe (frontflip with a 540).', test: (e) => air(e) && /McTwist/.test(e.trick.name) },
  { id: 'hang', tier: 'black', name: 'Hang Time', desc: 'Stay in the air for 3 seconds and land it.', test: (e) => air(e) && e.trick.airTime >= 3 },
  { id: 'cliff', tier: 'black', name: 'Cliff Hanger', desc: 'Drop 8 m or more off a cliff and ride away.', test: (e) => e.type === 'drop' && e.drop >= 8 },
  { id: 'tweak-720', tier: 'black', name: 'Tweak It', desc: 'Land a 720 or bigger with a tweaked grab.', test: (e) => air(e) && e.trick.spinDeg >= 720 && e.trick.tweaked },
  { id: 'slope-gold', tier: 'black', name: 'Top Step', desc: 'Win gold in Slopestyle.', test: (e) => e.type === 'medal' && e.mode === 'slopestyle' && e.medal === 'gold' },
  { id: 'spin-1440', tier: 'double', name: 'Fourteen-Forty', desc: 'Land a 1440 or bigger.', test: (e) => air(e) && e.trick.spinDeg >= 1440 },
  { id: 'triple', tier: 'double', name: 'Triple Threat', desc: 'Land any triple flip.', test: (e) => air(e) && e.trick.flips >= 3 },
  { id: 'combo-50k', tier: 'double', name: 'Combo King', desc: 'Bank 50,000 points in one combo.', test: (e) => e.type === 'bank' && e.score >= 50000 },
  { id: 'flakes', tier: 'double', name: 'Flake Hunter', desc: 'Find all 20 hidden snowflakes.', test: (e) => e.type === 'collect' && e.flakes >= 20 },
  { id: 'crown', tier: 'double', name: 'Triple Crown', desc: 'Win gold in Slopestyle, Big Air and Superpipe.', test: (e) => e.type === 'medal' && e.allGold },
];

export function checkChallenges(save, event) {
  const done = [];
  for (const c of CHALLENGES) {
    if (save.data.challenges[c.id]) continue;
    let ok = false;
    try {
      ok = c.test(event);
    } catch (err) {
      ok = false;
    }
    if (ok) {
      save.data.challenges[c.id] = Date.now();
      done.push(c);
    }
  }
  if (done.length) save.persist();
  return done;
}
