// Phase 7 acceptance: every example that the help of the CLI shows works. The examples of the
// welcome screen and of each command's help are run in order in one folder with the files of
// examples/offer, as a reader following the help would.
import { describe, expect, it } from 'vitest';
import { COMMANDS, helpScreen, welcomeScreen } from '../../packages/tplvane/src/cli/spec';
import { exampleFolder, runCli } from '../helpers/cli';

/** The commands a screen shows: lines that start with "tplvane " after the indentation. */
function examplesOf(screen: string): string[][] {
  return screen
    .split('\n')
    .slice(1) // the title line
    .map((l) => l.trim())
    .filter((l) => l.startsWith('tplvane ') && !l.includes('<'))
    .map((l) => l.split(/\s{2,}/)[0] as string)
    .map((l) => l.split(' ').slice(1));
}

describe('CLI help examples', () => {
  const screens = [welcomeScreen(), ...COMMANDS.map(helpScreen)];
  const all = screens.flatMap(examplesOf);

  it('there are examples on every screen', () => {
    for (const screen of screens) expect(examplesOf(screen).length, screen.split('\n')[0]).toBeGreaterThan(0);
    expect(all.length).toBeGreaterThanOrEqual(12);
  });

  it('every example runs successfully, in order, in the folder of the offer example', async () => {
    const dir = exampleFolder();
    for (const argv of all) {
      const run = await runCli(dir, argv);
      expect(run.code, `tplvane ${argv.join(' ')}\n${run.stderr}`).toBe(0);
      expect(run.stdout.length + run.stderr.length, `tplvane ${argv.join(' ')}`).toBeGreaterThan(0);
    }
  });
});
