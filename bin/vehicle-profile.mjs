#!/usr/bin/env node
import {lookupVehicle} from '../dist/index.js';

const usage = 'Usage: vehicle-profile <VIN>';
const args = process.argv.slice(2);

if (args.length === 1 && ['-h', '--help'].includes(args[0])) {
  console.log(usage);
} else if (args.length !== 1) {
  console.error(usage);
  process.exitCode = 2;
} else {
  try {
    const profile = await lookupVehicle(args[0], {signal: AbortSignal.timeout(25_000)});
    console.log(JSON.stringify(profile, null, 2));
    if (!profile.identity.vehicle) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
