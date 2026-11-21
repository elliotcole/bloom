// Bloom's command palette on the editor's page: the same box and the same
// commands, but what's typed is handed back (as one function and its names)
// to be run on each pass, rather than on a bloom of the page's own.

import { Bloom } from '../core/Bloom';
import { BLOOM_COMMANDS } from '../ui/bloomCommands';
import type { PaletteCommand } from '../ui/commandPalette';
import { CommandPalette } from '../ui/commandPalette';

export class VerbPalette {
  private palette: CommandPalette;
  private chain: PaletteCommand[] = [];

  /** `done` gets the commands typed, as one function on a bloom, and their names joined as typed */
  constructor(done: (run: (b: Bloom) => void, names: string) => void) {
    const scratch = new Bloom();
    this.palette = new CommandPalette(
      () => { this.chain = []; return scratch; },
      () => {
        const chain = this.chain;
        if (chain.length) done(b => { for (const c of chain) c.fn(b); }, chain.map(c => c.names[0]).join('.'));
      },
    );
    // each command is only noted as it's met: the passes get them after
    for (const c of BLOOM_COMMANDS) this.palette.register(c.names, c.description, () => { this.chain.push(c); });
  }

  open(): void { this.palette.open(); }
}
