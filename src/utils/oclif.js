import * as commandModule from '@oclif/core/command';
import * as flagsModule from '@oclif/core/flags';
import * as runModule from '@oclif/core/run';

export const Command = commandModule.Command ?? commandModule.default?.Command;
export const Flags = flagsModule.Flags ?? flagsModule.default ?? flagsModule;
export const run = runModule.run ?? runModule.default?.run;
