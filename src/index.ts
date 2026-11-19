import {lookupFuelEconomy} from './fuel-economy.js';
import {hasIdentity, lookupIdentity, validateVin} from './identity.js';
import {lookupComplaints, lookupRatings, lookupRecalls} from './safety.js';
import {createGetter} from './upstream.js';

export {validateVin};
export type {Drive, Identity, IdentitySection} from './identity.js';
export type {LookupStatus, Section} from './upstream.js';

export interface LookupOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export async function lookupVehicle(vinInput: string, options: LookupOptions = {}) {
  const {vin, northAmericanCheckDigitValid} = validateVin(vinInput);
  const get = createGetter(options.fetch ?? fetch, options.timeoutMs ?? 6_000, options.signal);
  const identity = await lookupIdentity(vin, get);
  const vehicle = hasIdentity(identity.vehicle) ? identity.vehicle : null;
  const [recalls, complaints, safetyRatings, fuelEconomy] = await Promise.all([
    lookupRecalls(vehicle, get), lookupComplaints(vehicle, get),
    lookupRatings(vehicle, get), lookupFuelEconomy(vehicle, get),
  ]);
  return {version: 1 as const, vin, northAmericanCheckDigitValid, identity, recalls, complaints, safetyRatings, fuelEconomy};
}

export type VehicleProfile = Awaited<ReturnType<typeof lookupVehicle>>;
