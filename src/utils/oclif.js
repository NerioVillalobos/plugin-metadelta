import * as oclifCore from '@oclif/core';

const core = oclifCore.default ?? oclifCore;

export const Command = oclifCore.Command ?? core.Command;
export const Flags = oclifCore.Flags ?? core.Flags;
export const run = oclifCore.run ?? core.run;
